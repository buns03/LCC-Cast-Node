import { NextFunction, Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { getAuthUserId } from '../auth/sessionUser';
import { renderView } from '../render';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { downloadFile, DownloadResult } from '../storage'; // DownloadResult is exported by storage.ts
import { findAvatarStoragePath } from '../candidatePortalService';
import { findVoterEmail } from '../candidateSettingsService';
import { updateVoterSettings } from '../voterSettingsService';
import { getSscElection, submitSscVote, getVoter } from '../sscElectionService';
import { getVoteSummariesForVoter } from '../voteSummaryService';
import { TtlCache } from '../ttlCache';
import { avatarImg } from './candidate';
import { findVoterDepartmentForPage, getCurrentDepartmentElection, submitDepartmentVote } from '../departmentElectionService';

export const voterRouter = Router();

// every /voter/** URL: STUDENT or CANDIDATE (passwordRouter, mounted earlier, still handles /voter/password-handler)
voterRouter.use('/voter', requireAny('ROLE_STUDENT', 'ROLE_CANDIDATE'));

// ---------------------------------------------------------------- helpers

const CANDIDATE_NAV = `
        <a href="/candidate/personal-information">
          <i class="bi bi-person-vcard"></i>
          <span>Personal Information</span>
        </a>

        <a href="/candidate/partylist-information">
          <i class="bi bi-people"></i>
          <span>Partylist Information</span>
        </a>

        <hr />`;

async function pageVars(req: Request) {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
  const authUserId = getAuthUserId(req);
  const storagePath = authUserId ? await findAvatarStoragePath(authUserId) : null;
  const avatarUrl = storagePath ? '/api/storage/file?path=' + encodeURIComponent(storagePath) : null;

  return {
    displayName,
    profileLine: `${user.programCourse ?? ''} - ${user.campus ?? ''}`,
    html_candidateNav: user.role === 'CANDIDATE' ? CANDIDATE_NAV : '',
    html_avatar: avatarImg(avatarUrl),
  };
}

function page(view: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.send(renderView(view, await pageVars(req)));
    } catch (e) {
      next(e);
    }
  };
}

function requireAuth(req: Request, res: Response): string | null {
  const id = getAuthUserId(req);
  if (!id) res.status(401).json({ message: 'Session expired. Please log in again.' });
  return id;
}

function sendError(res: Response, e: unknown, fallback: string) {
  if (e instanceof IllegalArgumentError) return res.status(400).json({ message: e.message });
  if (e instanceof IllegalStateError) return res.status(409).json({ message: e.message });
  console.error(e);
  return res.status(500).json({ message: fallback });
}

// ---------------------------------------------------------------- pages

voterRouter.get('/voter/ssc-election', page('voter/ssc-election.html'));
voterRouter.get('/voter/vote-summaries', page('voter/vote-summaries.html')); // its data endpoint comes after you send the summary files

voterRouter.get('/voter/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authUserId = getAuthUserId(req);
    const email = authUserId ? ((await findVoterEmail(authUserId)) ?? '') : '';
    res.set('Cache-Control', 'no-store');
    res.send(renderView('voter/settings.html', { ...(await pageVars(req)), email }));
  } catch (e) {
    next(e);
  }
});

// POST /voter/settings (JSON)
voterRouter.post('/voter/settings', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    const result = await updateVoterSettings(authUserId, req.body ?? {});
    res.status(result.status).json({ message: result.message });
  } catch (e) {
    console.error('Voter settings error:', e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// ---------------------------------------------------------------- SSC election API

// GET /voter/api/elections/ssc
voterRouter.get('/voter/api/elections/ssc', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getSscElection(authUserId));
  } catch (e) {
    sendError(res, e, 'Something went wrong. Please try again.');
  }
});

// POST /voter/api/elections/vote
voterRouter.post('/voter/api/elections/vote', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    res.json(await submitSscVote(authUserId, req.body));
  } catch (e) {
    sendError(res, e, 'Unable to submit your vote. Please try again.');
  }
});

// GET /voter/api/elections/file?path=...  (candidate photos / posters; cached: ~100 MB, 30 min, like the Caffeine cache)
const fileCache = new TtlCache<DownloadResult>(30 * 60_000, 100 * 1024 * 1024, (r) => (r.body ? r.body.length : 1));

voterRouter.get('/voter/api/elections/file', async (req: Request, res: Response) => {
  const path = req.query.path;
  if (typeof path !== 'string' || !path) return res.status(400).end();
  try {
    const r = await fileCache.get(path, () => downloadFile(path), (x) => x.status === 200 && !!x.body);
    if (!r.body) return res.status(r.status).end();
    res.status(r.status);
    if (r.contentType) res.set('Content-Type', r.contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    return res.send(r.body);
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).end();
    console.error(e);
    return res.status(500).end();
  }
});

// ---------------------------------------------------------------- department election

function deptScripts(votingType: string | null): string {
  if (votingType) {
    return `<script>
    const DEPARTMENT_ELECTION_TYPE = ${JSON.stringify(votingType)};
  </script>
  <script src="/js/voter/position-order.js"></script>
  <script src="/js/voter/department-election.js"></script>
  <script src="/js/voter/department-partylist-election.js"></script>`;
  }
  return `<script>
    document.addEventListener("DOMContentLoaded", function () {
      var el = document.querySelector(".election-content");
      if (el) {
        el.innerHTML = '<div class="election-instructions"><h3>Not Available</h3><p>There is no department election available for your account.</p></div>';
      }
    });
  </script>`;
}

// GET /voter/department-election
voterRouter.get('/voter/department-election', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.session.user!;
    const authUserId = getAuthUserId(req);
    const dept = authUserId ? await findVoterDepartmentForPage(authUserId) : null;

    res.set('Cache-Control', 'no-store');
    res.send(
      renderView('voter/department-election.html', {
        ...(await pageVars(req)),
        campus: user.campus ?? '',
        departmentTitle: dept ? dept.title : '',
        html_deptScripts: deptScripts(dept ? dept.votingType : null),
      }),
    );
  } catch (e) {
    next(e);
  }
});

// GET /voter/api/department-elections/current
voterRouter.get('/voter/api/department-elections/current', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getCurrentDepartmentElection(authUserId));
  } catch (e) {
    sendError(res, e, 'Something went wrong. Please try again.');
  }
});

// POST /voter/api/department-elections/vote
voterRouter.post('/voter/api/department-elections/vote', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    res.json(await submitDepartmentVote(authUserId, req.body));
  } catch (e) {
    sendError(res, e, 'Unable to submit your vote. Please try again.');
  }
});

// ---------------------------------------------------------------- vote summaries

// GET /voter/vote-summaries/data  (VOTER-ONLY: the voter always comes from the session, never from a request parameter)
voterRouter.get('/voter/vote-summaries/data', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    const voter = await getVoter(authUserId);
    res.set('Cache-Control', 'no-store');
    res.json(await getVoteSummariesForVoter(voter.id, req.session.user?.campus ?? null));
  } catch (e) {
    sendError(res, e, 'Unable to load vote summaries.');
  }
});
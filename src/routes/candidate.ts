import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import multer from 'multer';
import { requireAny } from '../auth/guards';
import { getAuthUserId } from '../auth/sessionUser';
import { renderView } from '../render';
import { auditLog } from '../auditLog';
import { pool } from '../db';
import { IllegalArgumentError, IllegalStateError } from '../errors';
import { serve } from './storage';
import * as svc from '../candidatePortalService';
import type { CandidateType } from '../candidatePortalService';
import * as settings from '../candidateSettingsService';

export const candidateRouter = Router();

// every /candidate/** URL: CANDIDATE only (401 JSON for /api/ URLs, redirect for pages)
candidateRouter.use('/candidate', requireAny('ROLE_CANDIDATE'));

// ---------------------------------------------------------------- helpers

// TODO: confirm against application.properties (spring.servlet.multipart.max-file-size)
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

/** turns multer errors into the { message } JSON the browser JS reads */
function runUpload(mw: RequestHandler): RequestHandler {
  return (req, res, next) =>
    mw(req, res, (err?: unknown) => {
      if (!err) return next();
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ message: tooBig ? 'File is too large.' : 'Invalid upload.' });
    });
}

const fileUrl = (storagePath: string | null) =>
  storagePath && storagePath.trim() ? '/candidate/api/file?path=' + encodeURIComponent(storagePath) : null;

function requireAuth(req: Request, res: Response): string | null {
  const id = getAuthUserId(req);
  if (!id) res.status(401).json({ message: 'Session expired. Please log in again.' });
  return id;
}

function typeOr400(req: Request, res: Response): CandidateType | null {
  const t = String(req.params.type ?? '').toLowerCase();
  if (t === 'ssc') return 'SSC';
  if (t === 'department') return 'DEPARTMENT';
  res.status(400).json({ message: "Invalid candidate type. Use 'ssc' or 'department'." });
  return null;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** replaces th:if="${avatarUrl}" th:src="${avatarUrl}" */
export function avatarImg(url: string | null, id?: string): string {
  if (!url) return '';
  return `<img src="${escAttr(url)}" alt="Avatar"${id ? ` id="${id}"` : ''} style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
}

async function renderPage(view: string, avatarId: string | undefined, req: Request, res: Response) {
  const user = req.session.user!;
  const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;

  const authUserId = getAuthUserId(req);
  const storagePath = authUserId ? await svc.findAvatarStoragePath(authUserId) : null;
  const avatarUrl = storagePath ? '/api/storage/file?path=' + encodeURIComponent(storagePath) : null;

  res.set('Cache-Control', 'no-store');
  res.send(renderView(view, { displayName, html_avatar: avatarImg(avatarUrl, avatarId) }));
}

// ---------------------------------------------------------------- pages (CandidateController)

candidateRouter.get('/candidate/personal-information', (req: Request, res: Response, next: NextFunction) => {
  renderPage('candidate/personal-information.html', 'topbarAvatarImg', req, res).catch(next);
});

candidateRouter.get('/candidate/partylist-information', (req: Request, res: Response, next: NextFunction) => {
  renderPage('candidate/partylist-information.html', undefined, req, res).catch(next);
});

// ---------------------------------------------------------------- API (CandidatePortalApiController)

// GET /candidate/api/file?path=...
candidateRouter.get('/candidate/api/file', (req: Request, res: Response) => {
  const path = req.query.path;
  if (typeof path !== 'string' || !path) return res.status(400).end();
  return serve(res, path);
});

// GET /candidate/api/candidacy-status
candidateRouter.get('/candidate/api/candidacy-status', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    res.json(await svc.getCandidacyStatus(authUserId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// GET /candidate/api/:type/personal-info
candidateRouter.get('/candidate/api/:type/personal-info', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  const type = typeOr400(req, res);
  if (!type) return;
  try {
    const r = await svc.findRecordByAuthUserId(authUserId, type);
    if (!r) {
      return res.status(404).json({
        message: type === 'SSC' ? 'You are not currently an SSC candidate.' : 'You are not currently a department candidate.',
      });
    }
    res.json({
      studentId: r.studentId,
      lastName: r.lastName,
      firstName: r.firstName,
      middleName: r.middleName ?? '',
      position: r.position ?? '',
      isPresident: svc.isPresident(r),
      photoUrl: fileUrl(r.photoImageUrl),
      backgroundUrl: fileUrl(r.backgroundImageUrl),
      campaignUrl: fileUrl(r.campaignImageUrl),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// POST /candidate/api/:type/personal-info/{photo|background|campaign}   (multipart field "file")
function handleUpload(imageType: 'photo' | 'background' | 'campaign'): RequestHandler {
  return async (req: Request, res: Response) => {
    const authUserId = requireAuth(req, res);
    if (!authUserId) return;
    const type = typeOr400(req, res);
    if (!type) return;

    try {
      const storagePath = await svc.uploadPersonalImage(authUserId, type, imageType, req.file, req);
      res.json({ message: 'Image updated successfully.', url: fileUrl(storagePath) });
    } catch (e) {
      if (e instanceof IllegalArgumentError || e instanceof IllegalStateError) {
        return res.status(400).json({ message: e.message });
      }
      console.error(e);
      res.status(500).json({ message: 'Upload failed.' });
    }
  };
}

for (const imageType of ['photo', 'background', 'campaign'] as const) {
  candidateRouter.post(
    `/candidate/api/:type/personal-info/${imageType}`,
    runUpload(upload.single('file')),
    handleUpload(imageType),
  );
}

// GET /candidate/api/:type/group-info
candidateRouter.get('/candidate/api/:type/group-info', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  const type = typeOr400(req, res);
  if (!type) return;

  try {
    const info = await svc.getGroupInfo(authUserId, type);
    res.json({
      groupType: info.groupType,
      groupId: info.groupId,
      name: info.name,
      description: info.description ?? '',
      posterUrl: fileUrl(info.posterImageUrl),
      logoUrl: fileUrl(info.posterLogoUrl),
      schoolYear: info.schoolYear ?? '',
      canEdit: info.canEdit,
      members: info.members.map((m) => ({
        fullName: m.fullName,
        position: m.position ?? '',
        photoUrl: fileUrl(m.photoImageUrl),
      })),
    });
  } catch (e) {
    if (e instanceof IllegalStateError) return res.status(404).json({ message: e.message });
    console.error(e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// POST /candidate/api/:type/group-info   (multipart: description, poster, logo)
candidateRouter.post(
  '/candidate/api/:type/group-info',
  runUpload(upload.fields([{ name: 'poster', maxCount: 1 }, { name: 'logo', maxCount: 1 }])),
  async (req: Request, res: Response) => {
    const authUserId = requireAuth(req, res);
    if (!authUserId) return;
    const type = typeOr400(req, res);
    if (!type) return;

    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const poster = files.poster?.[0];
    const logo = files.logo?.[0];
    const description = typeof req.body?.description === 'string' ? req.body.description : undefined;

    try {
     await svc.updateGroupInfo(authUserId, type, description, poster, logo, req);
  res.json({ message: 'Group information updated successfully.' });
    } catch (e) {
      if (e instanceof svc.ForbiddenError) return res.status(403).json({ message: e.message });
      if (e instanceof IllegalArgumentError || e instanceof IllegalStateError) {
        return res.status(400).json({ message: e.message });
      }
      console.error(e);
      res.status(500).json({ message: 'Update failed.' });
    }
  },
);

// GET /candidate/settings
candidateRouter.get('/candidate/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.session.user!;
    const displayName = user.firstName && user.firstName.trim() ? user.firstName : user.role;
    const authUserId = getAuthUserId(req);
    const email = authUserId ? ((await settings.findVoterEmail(authUserId)) ?? '') : '';

    res.set('Cache-Control', 'no-store');
    res.send(renderView('candidate/settings.html', { displayName, email }));
  } catch (e) {
    next(e);
  }
});

// POST /candidate/settings  (JSON body)
candidateRouter.post('/candidate/settings', async (req: Request, res: Response) => {
  const authUserId = requireAuth(req, res);
  if (!authUserId) return;
  try {
    const result = await settings.updateSettings(authUserId, req.body ?? {});
    res.status(result.status).json({ message: result.message });
  } catch (e) {
    console.error('Candidate settings error:', e);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});
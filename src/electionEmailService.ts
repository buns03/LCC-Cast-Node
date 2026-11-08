import { Request } from 'express';
import { pool } from './db';
import { config } from './config';
import { sendHtmlMail } from './mailer';
import { IllegalArgumentError, IllegalStateError } from './errors';
import { auditLog } from './auditLog';
import { createSignedUrl } from './storage';
import { findCampusName } from './repositories';
import { getById } from './electionService';
import { extractProgramCode } from './departmentUtils';
import * as repo from './electionRepository';
import { Election, phaseOf } from './electionRepository';
import * as er from './electionEmailRepository';
import { CandidateRow, Campaign, VoterRef } from './electionEmailRepository';
import { detect, drawPositions, DrawOutcome, openPositions } from './drawDetection';
import { NotificationData, renderNotification, renderWinners } from './emailTemplates';
import { sortByPositionOrder } from './positionOrder';

/** Port of ElectionEmailService + EmailProgressTracker. */

// =====================================================================
// progress (EmailProgressTracker): the page polls this while an email batch is being sent
// =====================================================================

export interface Progress {
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  sent: number;
  total: number;
  message: string | null;
}

const jobs = new Map<string, { progress: Progress; at: number }>();
const put = (jobId: string | null, progress: Progress) => {
  if (jobId) jobs.set(jobId, { progress, at: Date.now() });
};

export const progressTracker = {
  start: (jobId: string | null, total: number) => put(jobId, { status: 'RUNNING', sent: 0, total, message: null }),
  advance: (jobId: string | null, sent: number, total: number) => put(jobId, { status: 'RUNNING', sent, total, message: null }),
  complete: (jobId: string | null, total: number) => put(jobId, { status: 'COMPLETED', sent: total, total, message: null }),
  fail(jobId: string | null, message: string) {
    if (!jobId) return;
    const last = jobs.get(jobId)?.progress ?? { status: 'RUNNING' as const, sent: 0, total: 0, message: null };
    put(jobId, { status: 'FAILED', sent: last.sent, total: last.total, message });
  },
  get: (jobId: string): Progress | null => jobs.get(jobId)?.progress ?? null,
  /** drop finished/stale jobs (older than 1 hour) */
  purge() {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, e] of jobs) if (e.at < cutoff) jobs.delete(id);
  },
};

// =====================================================================
// eligibility
// =====================================================================

export async function getEligibleVoters(election: Election): Promise<VoterRef[]> {
  if (election.category === 'SSC') return er.votersByCampus(pool, election.campusId);

  const departments = await repo.departmentLinks(pool, election.id);
  if (!departments.length) return [];

  const codes = departments.map((d) => extractProgramCode(d)).filter((c): c is string => !!c);
  if (!codes.length) return [];

  return er.votersByCampusAndPrograms(pool, election.campusId, codes.map((c) => c.toLowerCase()));
}

export async function getEmailStatus(electionId: string) {
  const election = await getById(electionId);
  const body: Record<string, unknown> = { eligibleVoterCount: (await getEligibleVoters(election)).length };
  const scheduled = await er.findScheduledCampaign(pool, electionId);
  body.scheduled = !!scheduled;
  if (scheduled) body.scheduledAt = scheduled.scheduledAt;
  return body;
}

// =====================================================================
// rendering helpers
// =====================================================================

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "January 5, 2027 at 5:00 PM" in the SERVER's time zone (Java used ZoneId.systemDefault() too). */
function formatDate(d: Date | null): string {
  if (!d) return 'To be announced';
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function assertHasSchedule(e: Election) {
  if (!e.startAt || !e.endAt) {
    throw new IllegalStateError('Set the voting schedule for this draw election before sending the announcement email.');
  }
}

const candidateFullName = (c: CandidateRow) =>
  [c.firstName, c.middleName, c.lastName].filter((p) => p && p.trim()).join(' ');

const signedPhoto = (path: string | null) => (path && path.trim() ? createSignedUrl(path, 60 * 60 * 24 * 7) : Promise.resolve(null)); // 7-day link

async function partylistGroupName(c: CandidateRow): Promise<string> {
  if (!c.partylistId) return 'Independent';
  return (await er.findPartylistName(pool, c.partylistId)) ?? 'Independent';
}

async function departmentGroupName(c: CandidateRow): Promise<string> {
  if (!c.departmentId) return 'Independent';
  const d = await repo.findDepartment(pool, c.departmentId);
  return d?.title ?? 'Independent';
}

async function groupByPosition(candidates: CandidateRow[], resolveGroup: (c: CandidateRow) => Promise<string>) {
  const byPosition = new Map<string, CandidateRow[]>();
  for (const c of candidates) {
    const key = !c.position || !c.position.trim() ? 'Unassigned' : c.position;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key)!.push(c);
  }

  const result: NotificationData['positionsWithCandidates'] = [];
  for (const [name, list] of byPosition) {
    const infos = await Promise.all(
      list.map(async (c) => ({ name: candidateFullName(c), group: await resolveGroup(c), photo: await signedPhoto(c.photoImageUrl) })),
    );
    result.push({ name, candidates: infos });
  }
  return sortByPositionOrder(result, (p) => p.name); // President, VP, Secretary, ... unknown last
}

async function buildNotification(election: Election): Promise<NotificationData> {
  const campusName = (await findCampusName(election.campusId)) ?? '';

  let description =
    phaseOf(election) === 'UPCOMING'
      ? 'This election has not started yet. Mark your calendar and log in to LCC Cast once voting opens to cast your vote.'
      : 'Voting for this election is now open. Log in to LCC Cast to view the candidates or program information and cast your vote before it closes.';
  if (repo.isDrawElection(election)) {
    description = 'This is a tie-break election for positions that ended in a draw. ' + description;
  }

  const data: NotificationData = {
    loginUrl: config.appLoginUrl,
    categoryLabel: '',
    electionTitle: election.title,
    campus: campusName,
    schoolYear: election.schoolYear,
    startAt: formatDate(election.startAt),
    endAt: formatDate(election.endAt),
    description,
    isSSC: election.category === 'SSC',
    showGroups: false,
    groupNames: [],
    departmentNames: [],
    votingTypeLabel: '',
    isRepresentative: false,
    positionsWithCandidates: [],
    representativeCandidates: [],
  };

  const candidates = await er.candidatesFull(pool, election.id);

  if (data.isSSC) {
    data.categoryLabel = 'Student Supreme Council Election';
    data.groupNames = (await repo.partylistLinks(pool, election.id)).map((p) => p.name);
    data.showGroups = true;
    data.positionsWithCandidates = await groupByPosition(candidates, partylistGroupName);
    return data;
  }

  const departments = await repo.departmentLinks(pool, election.id);
  const votingType = departments.length ? departments[0].votingType : null;
  const label = votingType === 'PARTYLIST' ? 'Partylist Voting' : 'Representative Voting';

  data.categoryLabel = `Department Election (${label})`;
  data.votingTypeLabel = label;
  data.departmentNames = departments.map((d) => d.title ?? '');
  data.isRepresentative = votingType === 'REPRESENTATIVE';

  if (data.isRepresentative) {
    data.showGroups = false;
    data.representativeCandidates = await Promise.all(
      candidates
        .filter((c) => candidateFullName(c))
        .map(async (c) => ({ name: candidateFullName(c), photo: await signedPhoto(c.photoImageUrl) })),
    );
  } else {
    data.showGroups = true;
    data.groupNames = departments.map((d) => d.title ?? '');
    data.positionsWithCandidates = await groupByPosition(candidates, departmentGroupName);
  }
  return data;
}

const renderHtml = async (e: Election) => renderNotification(await buildNotification(e));
const buildSubject = (e: Election) => `[LCC Cast] ${e.title}`;

// =====================================================================
// actual sending
// =====================================================================

async function dispatch(campaign: Campaign, voters: VoterRef[], html: string, subject: string, jobId: string | null, total: number) {
  let processed = 0;

  for (const voter of voters) {
    if (!voter.email || !voter.email.trim()) continue;

    const recipientId = await er.insertRecipient(pool, campaign.id, voter.id, voter.email);
    try {
      await sendHtmlMail(voter.email, subject, html);
      await er.setRecipientResult(pool, recipientId, 'SENT', null);
    } catch (e) {
      await er.setRecipientResult(pool, recipientId, 'FAILED', (e as Error).message);
    }

    progressTracker.advance(jobId, ++processed, total);
  }
}

const countDeliverable = (voters: VoterRef[]) => voters.filter((v) => v.email && v.email.trim()).length;

// ---------------- SEND NOW ----------------

export async function sendNow(electionId: string, adminId: string, req: Request, jobId: string | null) {
  let campaign: Campaign | null = null;
  try {
    const election = await getById(electionId);
    assertHasSchedule(election);
    const recipients = await getEligibleVoters(election);

    const total = countDeliverable(recipients);
    progressTracker.start(jobId, total);

    const html = await renderHtml(election);
    const subject = buildSubject(election);

    campaign = await er.insertCampaign(pool, { electionId, subject, body: html, sendType: 'NOW', status: 'SENDING', createdBy: adminId });

    await dispatch(campaign, recipients, html, subject, jobId, total);

    campaign = await er.setCampaignStatus(pool, campaign.id, 'SENT', new Date());

    await auditLog(pool, req, 'UPDATE', 'Elections', electionId, `sent election email for: ${election.title}`, {
      recipients: recipients.length, sendType: 'NOW',
    });

    progressTracker.complete(jobId, total);
    return campaign;
  } catch (e) {
    progressTracker.fail(jobId, (e as Error).message);
    if (campaign) await er.setCampaignStatus(pool, campaign.id, 'FAILED').catch(() => {});
    throw e;
  }
}

// ---------------- SCHEDULE ----------------

export async function schedule(electionId: string, scheduledAt: Date | null, adminId: string, req: Request) {
  if (!scheduledAt || !(scheduledAt.getTime() > Date.now())) {
    throw new IllegalArgumentError('Scheduled time must be in the future.');
  }

  if (await er.findScheduledCampaign(pool, electionId)) {
    throw new IllegalStateError('An email is already scheduled for this election. Cancel it first.');
  }

  const election = await getById(electionId);
  assertHasSchedule(election);
  const html = await renderHtml(election);
  const subject = buildSubject(election);

  const campaign = await er.insertCampaign(pool, {
    electionId, subject, body: html, sendType: 'SCHEDULED', scheduledAt, status: 'SCHEDULED', createdBy: adminId,
  });

  await auditLog(pool, req, 'UPDATE', 'Elections', electionId, `scheduled election email for: ${election.title}`, {
    scheduledAt: scheduledAt.toISOString(),
  });
  return campaign;
}

export async function cancelScheduled(electionId: string, req: Request): Promise<void> {
  const campaign = await er.findScheduledCampaign(pool, electionId);
  if (!campaign) throw new IllegalArgumentError('No scheduled email found for this election.');

  await er.setCampaignStatus(pool, campaign.id, 'CANCELLED');
  await auditLog(pool, req, 'UPDATE', 'Elections', electionId, 'cancelled scheduled election email', {});
}

/** Called by the scheduler for emails whose time has come. */
export async function sendScheduledCampaign(campaign: Campaign): Promise<void> {
  try {
    const election = await getById(campaign.electionId);
    const recipients = await getEligibleVoters(election);

    await er.setCampaignStatus(pool, campaign.id, 'SENDING');
    await dispatch(campaign, recipients, campaign.body, campaign.subject, null, 0);
    await er.setCampaignStatus(pool, campaign.id, 'SENT', new Date());
  } catch (e) {
    console.error('Scheduled campaign failed:', (e as Error).message);
    await er.setCampaignStatus(pool, campaign.id, 'FAILED').catch(() => {});
  }
}

// =====================================================================
// winner announcement
// =====================================================================

interface WinnerRow {
  position: string;
  name: string;
  group: string;
  photo: string | null;
  votes: number;
}

const DEFAULT_REPRESENTATIVE_POSITIONS = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor', 'PRO Internal', 'PRO External'];

async function computeWinners(election: Election, outcome: DrawOutcome): Promise<WinnerRow[]> {
  const candidates = await er.candidatesFull(pool, election.id);
  if (!candidates.length) {
    console.warn(`No candidates found for electionId=${election.id} — winner email will have no winners.`);
    return [];
  }

  const votes = await er.votesByCandidate(pool, election.id);

  let department: repo.DepartmentRow | null = null;
  if (election.category !== 'SSC') {
    const departments = await repo.departmentLinks(pool, election.id);
    department = departments[0] ?? null;
  }

  const isRepresentative = department !== null && department.votingType === 'REPRESENTATIVE';

  const winners = isRepresentative
    ? await computeRepresentativeWinners(election, department!, candidates, outcome)
    : await computePositionalWinners(election, candidates, votes, outcome);

  return sortByPositionOrder(winners, (w) => w.position);
}

/** SSC and Department-Partylist: one winner per distinct declared position. */
async function computePositionalWinners(
  election: Election, candidates: CandidateRow[], votes: Map<string, number>, outcome: DrawOutcome,
): Promise<WinnerRow[]> {
  const drawSet = new Set(drawPositions(outcome).map((p) => p.trim()));

  const byPosition = new Map<string, CandidateRow[]>();
  for (const c of candidates) {
    const key = !c.position || !c.position.trim() ? 'Unassigned' : c.position.trim();
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key)!.push(c);
  }

  const winners: WinnerRow[] = [];
  for (const [position, list] of byPosition) {
    if (drawSet.has(position)) continue; // draw: no official winner yet

    let top: CandidateRow | null = null;
    let topVotes = -1;
    for (const c of list) {
      const v = votes.get(c.id) ?? 0;
      if (v > topVotes) {
        topVotes = v;
        top = c;
      }
    }
    if (!top) continue;

    const group = election.category === 'SSC' ? await partylistGroupName(top) : await departmentGroupName(top);
    winners.push({ position, name: candidateFullName(top), group, photo: await signedPhoto(top.photoImageUrl), votes: topVotes });
  }
  return winners;
}

/** Department-Representative: winners come from the draw detection outcome, in the department's position order. */
async function computeRepresentativeWinners(
  election: Election, department: repo.DepartmentRow, candidates: CandidateRow[], outcome: DrawOutcome,
): Promise<WinnerRow[]> {
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // position -> candidateId -> votes (only used to show the winner's vote count)
  const tally = new Map<string, Map<string, number>>();
  for (const row of await er.votesByCandidateAndPosition(pool, election.id, department.id)) {
    if (!row.position || !row.position.trim()) continue;
    if (!byId.has(row.candidateId)) continue;
    if (!tally.has(row.position)) tally.set(row.position, new Map());
    const m = tally.get(row.position)!;
    m.set(row.candidateId, (m.get(row.candidateId) ?? 0) + row.votes);
  }

  let positionOrder = openPositions(election, department);
  if (!positionOrder.length) positionOrder = DEFAULT_REPRESENTATIVE_POSITIONS;

  const group = await departmentGroupName(candidates[0]);
  const winners: WinnerRow[] = [];

  for (const position of positionOrder) {
    if (outcome.tiedByPosition.has(position)) continue; // draw: no official winner yet

    const winnerId = outcome.winnersByPosition.get(position);
    const top = winnerId ? byId.get(winnerId) : undefined;
    if (!top) continue;

    winners.push({
      position,
      name: candidateFullName(top),
      group,
      photo: await signedPhoto(top.photoImageUrl),
      votes: tally.get(position)?.get(winnerId!) ?? 0,
    });
  }
  return winners;
}

/**
 * Sends the winner announcement to every voter eligible for this election.
 * Idempotent: a WINNERS campaign is only sent once per election (a second call throws IllegalStateError).
 */
export async function sendWinnerAnnouncement(electionId: string, req: Request | null) {
  if (await er.existsCampaign(pool, electionId, 'WINNERS')) {
    throw new IllegalStateError('Winner announcement already sent for this election.');
  }

  const election = await getById(electionId);
  console.log(`Building winner announcement — electionId=${electionId}, title=${election.title}`);

  const recipients = await getEligibleVoters(election);

  const outcome = await detect(pool, election);
  const winners = await computeWinners(election, outcome);

  const campusName = (await findCampusName(election.campusId)) ?? '';
  const isSSC = election.category === 'SSC';
  const electionType = isSSC ? 'Supreme Student Council' : 'Departmental Election';

  let programCourse: string | null = null;
  if (!isSSC) programCourse = (await repo.departmentLinks(pool, election.id))[0]?.name ?? null;

  const headerSubtitle = programCourse
    ? `${programCourse} - ${campusName} - ${electionType}`
    : `${campusName} - ${electionType}`;

  const html = renderWinners({
    loginUrl: config.appLoginUrl,
    headerSubtitle,
    electionTitle: election.title,
    campus: campusName,
    schoolYear: election.schoolYear,
    winners,
    drawPositions: sortByPositionOrder(drawPositions(outcome), (p) => p),
  });
  const subject = `[LCC Cast] Results: ${election.title}`;

  let campaign = await er.insertCampaign(pool, { electionId, subject, body: html, sendType: 'WINNERS', status: 'SENDING', createdBy: null });

  await dispatch(campaign, recipients, html, subject, null, 0);

  campaign = await er.setCampaignStatus(pool, campaign.id, 'SENT', new Date());
  console.log(`Winner announcement sent — electionId=${electionId}, recipients=${recipients.length}`);

  if (req) {
    await auditLog(pool, req, 'UPDATE', 'Elections', electionId, `sent winner announcement for: ${election.title}`, {
      recipients: recipients.length, sendType: 'WINNERS',
    });
  }
  return campaign;
}

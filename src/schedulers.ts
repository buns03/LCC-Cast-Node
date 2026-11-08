import { pool } from './db';
import { config } from './config';
import { IllegalStateError } from './errors';
import { listByStatus } from './electionRepository';
import { listDueScheduledCampaigns } from './electionEmailRepository';
import { progressTracker, sendScheduledCampaign, sendWinnerAnnouncement } from './electionEmailService';
import { processConcludedElections } from './drawElectionService';

/** Runs `job`, waits `everyMs` AFTER it finishes, repeats (like @Scheduled(fixedDelay)). A crash never stops the loop. */
function every(name: string, everyMs: number, job: () => Promise<void>) {
  const run = async () => {
    try {
      await job();
    } catch (e) {
      console.error(`[scheduler:${name}]`, e);
    } finally {
      setTimeout(run, everyMs).unref();
    }
  };
  setTimeout(run, 5_000).unref();
}

// ElectionEmailScheduler: every 60s, send scheduled emails whose time has come
async function dispatchDueCampaigns() {
  const due = await listDueScheduledCampaigns(pool, new Date());
  if (due.length) console.log(`[scheduled-emails] ${due.length} scheduled email(s) due, sending...`);
  for (const campaign of due) {
    await sendScheduledCampaign(campaign);
    console.log(`[scheduled-emails] finished campaign ${campaign.id}`);
  }
}

// ElectionWinnerAnnouncementScheduler: every 5 min, announce winners of finished elections (once each)
async function sendDueWinnerAnnouncements() {
  const active = await listByStatus(pool, 'ACTIVE');
  const now = Date.now();

  for (const election of active) {
    if (!election.endAt) continue;
    if (now <= election.endAt.getTime()) continue;

    try {
      await sendWinnerAnnouncement(election.id, null);
      console.log(`Sent winner announcement for electionId=${election.id}`);
    } catch (e) {
      if (e instanceof IllegalStateError) continue; // already sent
      console.error(`Failed to send winner announcement for electionId=${election.id}`, e);
    }
  }
}

export function startSchedulers() {
  // memory clean-up only, no emails: always on
  setInterval(() => progressTracker.purge(), 600_000).unref();

  if (!config.enableSchedulers) {
    console.log('Background jobs are OFF (ENABLE_SCHEDULERS is not "true"): no scheduled emails, winner emails or draw checks.');
    return;
  }

  console.log('Background jobs are ON: scheduled emails, winner announcements, draw-election check.');
  every('draw-elections', 60_000, processConcludedElections);
  every('scheduled-emails', 60_000, dispatchDueCampaigns);
  every('winner-announcements', 5 * 60_000, sendDueWinnerAnnouncements);
}

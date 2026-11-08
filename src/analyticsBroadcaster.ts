import { onVoteCast, publish } from './realtime';

/**
 * Replaces AnalyticsPushListener. Spring pushed the whole analytics payload after every vote.
 * Here the push is only a "something changed" ping; the page re-fetches /api/superadmin/analytics (login-protected).
 * Bursts of events are merged into one ping per second.
 */
let timer: NodeJS.Timeout | null = null;

export function startAnalyticsBroadcaster(): void {
  onVoteCast(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      publish('/topic/analytics', { ts: Date.now() });
    }, 1000);
  });
}
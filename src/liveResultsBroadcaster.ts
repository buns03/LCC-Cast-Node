import { publish, onVoteCast } from './realtime';
import { hasClients } from './socketServer';
import { getDepartmentLiveResults, getSscLiveResults } from './liveResultsService';

/**
 * Port of LiveResultsBroadcaster + LiveResultsScheduler:
 *  - every time a vote-cast event happens, push the fresh results to /topic/live-results
 *  - and once a minute, so pages flip to UPCOMING / ONGOING / CONCLUDED on time
 * Nothing is computed while no browser is connected.
 */
let running = false;

export async function broadcastLiveResults(): Promise<void> {
  if (running || !hasClients()) return;
  running = true;
  try {
    const [ssc, departments] = await Promise.all([getSscLiveResults(), getDepartmentLiveResults()]);

    publish('/topic/live-results', { ssc, departments });

    // department pages that only care about their own department
    for (const dept of departments) {
      for (const departmentId of dept.departmentIds) {
        publish(`/topic/live-results/department/${dept.campusId}/${departmentId}`, dept);
      }
    }
  } catch (e) {
    console.error('[live-results] broadcast failed:', (e as Error).message);
  } finally {
    running = false;
  }
}

export function startLiveResultsBroadcaster(): void {
  onVoteCast(() => void broadcastLiveResults());
  setInterval(() => void broadcastLiveResults(), 60_000).unref();
}

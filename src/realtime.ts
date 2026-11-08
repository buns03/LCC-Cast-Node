/**
 * Port of RealtimeBroadcastService.java: same topics, same payloads.
 *
 * Call these from your write endpoints (e.g. after a vote is saved):
 *     realtime.dashboardChanged(campusId, programCode);
 *
 * Messages go to an in-process hub. The browser-facing socket server (the part that
 * replaces Spring's /ws-analytics STOMP endpoint) will subscribe with onBroadcast().
 * Until that exists, nothing receives them.
 */
type Listener = (topic: string, payload: Record<string, unknown>) => void;

const listeners = new Set<Listener>();

export function onBroadcast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** send any payload to a topic (used by the live-results broadcaster) */
export function publish(topic: string, payload: unknown) {
  send(topic, payload as Record<string, unknown>);
}

function send(topic: string, payload: Record<string, unknown>) {
  for (const l of listeners) l(topic, payload);
}

function payload(campusId: string | null, extraKey?: string, extraVal?: unknown): Record<string, unknown> {
  const m: Record<string, unknown> = { campusId, ts: Date.now() };
  if (extraKey) m[extraKey] = extraVal ?? null;
  return m;
}

export const realtime = {
  electionsChanged(campusId: string | null) {
    send('/topic/elections', payload(campusId));
    if (campusId) send(`/topic/elections/campus/${campusId}`, payload(campusId));
  },

  partylistsChanged(campusId: string | null) {
    send('/topic/partylists', payload(campusId));
    if (campusId) send(`/topic/partylists/campus/${campusId}`, payload(campusId));
  },

  departmentsChanged(campusId: string | null) {
    send('/topic/departments', payload(campusId));
    if (campusId) send(`/topic/departments/campus/${campusId}`, payload(campusId));
  },

  dashboardChanged(campusId: string | null, programCode: string | null = null) {
    send('/topic/dashboard', payload(campusId, 'program', programCode));
    if (campusId) {
      const topic =
        !programCode || !programCode.trim()
          ? `/topic/dashboard/${campusId}`
          : `/topic/dashboard/${campusId}/${programCode}`;
      send(topic, payload(campusId, 'program', programCode));
    }
  },

  historyChanged(section: string) {
    send(`/topic/history/${section}`, payload(null));
  },
};

/**
 * Port of Spring's VoteCastEvent: "something changed that live results / analytics should refresh".
 * The listeners (LiveResultsBroadcaster, analytics) are not migrated yet; they will call onVoteCast().
 */
const voteListeners = new Set<() => void>();

export function onVoteCast(listener: () => void): () => void {
  voteListeners.add(listener);
  return () => voteListeners.delete(listener);
}

export function emitVoteCast(): void {
  for (const l of voteListeners) l();
}

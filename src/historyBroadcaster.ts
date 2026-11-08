import { onVoteCast, realtime } from './realtime';

/** collapses bursts of events into one ping */
function debounced(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

const pingVoteLogs = debounced(() => realtime.historyChanged('vote-logs'), 1000);

/** call after an audit_logs row is written (delayed a little so the surrounding transaction can commit) */
export const notifyActionsChanged = debounced(() => realtime.historyChanged('actions'), 700);

/** vote cast / election restored / election archived all change what Vote Logs shows */
export function startHistoryBroadcaster(): void {
  onVoteCast(pingVoteLogs);
}
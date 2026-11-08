export type Diff = Record<string, { from?: unknown; to?: unknown }>;

const norm = (v: unknown) => (v === '' || v === undefined ? null : v);

/** fields whose value changed, as { "Field": { from, to } } */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): Diff {
  const out: Diff = {};
  for (const k of Object.keys(after)) {
    const b = norm(before[k]);
    const a = norm(after[k]);
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = { from: b, to: a };
  }
  return out;
}

/** "<label> added" / "<label> removed" entries */
export function listDiff(label: string, before: string[], after: string[]): Diff {
  const out: Diff = {};
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  if (added.length) out[`${label} added`] = { to: added.join(', ') };
  if (removed.length) out[`${label} removed`] = { from: removed.join(', ') };
  return out;
}

export const memberLabel = (m: { firstName?: string | null; lastName?: string | null; position?: string | null }) => {
  const name = `${(m.firstName ?? '').trim()} ${(m.lastName ?? '').trim()}`.trim();
  const pos = (m.position ?? '').trim();
  return pos ? `${name} (${pos})` : name;
};
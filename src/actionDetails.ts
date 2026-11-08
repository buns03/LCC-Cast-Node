import { Db } from './electionRepository';
import * as hr from './historyRepository';

export interface DetailRow { target: string; field: string; from: string | null; to: string | null }
export interface ActionDetails {
  kind: 'create' | 'update' | 'bulk' | 'import' | 'other';
  stats: { label: string; value: string }[];
  rows: DetailRow[];
  totalRows: number;
}

const MAX_ROWS = 500;
const HIDDEN_KEY_RE = /^(id|authUserId)$|url$|password/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const humanize = (key: string) => {
  const s = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && ISO_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
  }
  if (Array.isArray(v)) return v.map(show).join(', ') || '—';
  if (isObj(v)) {
    return Object.entries(v).filter(([k]) => !HIDDEN_KEY_RE.test(k)).map(([k, x]) => `${humanize(k)}: ${show(x)}`).join(' · ') || '—';
  }
  return String(v);
}

function parseMeta(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return {}; }
  }
  return isObj(v) ? v : {};
}

async function flatten(db: Db, data: Record<string, unknown>, target: string): Promise<DetailRow[]> {
  const rows: DetailRow[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (HIDDEN_KEY_RE.test(k) || v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    if (k === 'campusId' && typeof v === 'string') {
      rows.push({ target, field: 'Campus', from: null, to: (await hr.lookupName(db, 'campus', v)) ?? v });
      continue;
    }
    rows.push({ target, field: humanize(k), from: null, to: show(v) });
  }
  return rows;
}

export async function buildActionDetails(db: Db, row: hr.AuditRow): Promise<ActionDetails> {
  const meta = parseMeta(row.metadata);
  const target = String(meta.fullName ?? meta.name ?? meta.title ?? meta.studentId ?? row.entityType ?? 'Record');
  const num = (k: string) => (typeof meta[k] === 'number' ? (meta[k] as number) : null);
  const fmt = (n: number) => n.toLocaleString('en-US');
  const verbs: Record<string, string> = { ARCHIVE: 'Archived', DELETE: 'Moved to trash', RESTORE: 'Restored' };

  // ---- import: totals only
  if (row.action === 'IMPORT' && num('added') !== null) {
    const added = num('added') ?? 0, updated = num('updated') ?? 0, skipped = num('skipped') ?? 0;
    return {
      kind: 'import',
      stats: [
        { label: 'Added', value: fmt(added) },
        { label: 'Updated', value: fmt(updated) },
        { label: 'Skipped', value: fmt(skipped) },
        { label: 'Total rows', value: fmt(added + updated + skipped) },
      ],
      rows: [], totalRows: 0,
    };
  }

  // ---- update: previous -> new
  const diff = isObj(meta.diff) ? meta.diff : isObj(meta.changes) ? meta.changes : null;
  if (diff) {
    const rows: DetailRow[] = Object.entries(diff).map(([field, e]) => {
      const entry = isObj(e) ? e : {};
      return { target, field: humanize(field), from: 'from' in entry ? show(entry.from) : null, to: 'to' in entry ? show(entry.to) : null };
    });
    return { kind: 'update', stats: [], rows: rows.slice(0, MAX_ROWS), totalRows: rows.length };
  }
  if (Array.isArray(meta.changes)) {
    const rows: DetailRow[] = meta.changes.map((c) => ({ target, field: String(c), from: null, to: null }));
    return { kind: 'update', stats: [], rows, totalRows: rows.length };
  }

  // ---- bulk (archive / trash / empty trash): count + names
  const voters = Array.isArray(meta.voters) ? (meta.voters as unknown[]).filter(isObj) : null;
  const count = num('count');
  if (voters || count !== null) {
    const total = count ?? voters!.length;
    const verb = verbs[row.action] ?? humanize(row.action);
    const rows: DetailRow[] = (voters ?? []).slice(0, MAX_ROWS).map((v) => ({
      target: String(v.fullName ?? 'Unknown'),
      field: v.studentId ? `ID ${v.studentId}` : String(row.entityType ?? ''),
      from: null,
      to: verb,
    }));
    return {
      kind: 'bulk',
      stats: [{ label: 'Records affected', value: fmt(total) }, { label: 'Action', value: verb }],
      rows, totalRows: voters?.length ?? 0,
    };
  }

  // ---- create / everything else: list what was recorded
  const created = isObj(meta.created) ? meta.created : null;
  const rows = await flatten(db, created ?? meta, String(created?.Name ?? target));
  return {
    kind: row.action === 'CREATE' ? 'create' : 'other',
    stats: [], rows: rows.slice(0, MAX_ROWS), totalRows: rows.length,
  };
}
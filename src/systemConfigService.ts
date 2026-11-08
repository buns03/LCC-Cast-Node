import { pool } from './db';
import type { Db } from './electionRepository';
import { IllegalArgumentError, IllegalStateError } from './errors';
import { refreshProgramResolver } from './programResolver';
import { Request } from 'express';
import { auditLog, AuditAction } from './auditLog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACRONYM_RE = /^[A-Z0-9][A-Z0-9 \-]{0,19}$/;
const ALIAS_RE = /^[A-Z0-9][A-Z0-9 .\-&]{0,39}$/;

export interface ProgramDTO { id: string; acronym: string; fullName: string; sortOrder: number; aliases: string[] }
export interface CampusDTO { id: string; name: string; description: string | null; customPrograms: boolean; programIds: string[] }

function uuid(v: unknown, what: string): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new IllegalArgumentError(`Invalid ${what}.`);
  return v;
}

function text(v: unknown, label: string, max: number, required = true): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (required && !s) throw new IllegalArgumentError(`${label} is required.`);
  if (s.length > max) throw new IllegalArgumentError(`${label} must be at most ${max} characters.`);
  return s;
}

const refreshQuietly = () =>
  refreshProgramResolver().catch((e) => console.error('Could not reload programs:', (e as Error).message));

async function audit(req: Request, action: AuditAction, entityType: 'Campuses' | 'Programs', entityId: string | null, description: string, metadata: Record<string, unknown>) {
  try {
    await auditLog(pool, req, action, entityType, entityId, description, metadata);
  } catch (e) {
    console.error('Audit log failed:', (e as Error).message);
  }
}

/** fields whose value actually changed, as { field: { from, to } } */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

// ---------------------------------------------------------------- read (used by every page's dropdowns)

export async function getOptions(): Promise<{ campuses: CampusDTO[]; programs: ProgramDTO[] }> {
  const [c, p, cp] = await Promise.all([
    pool.query(`SELECT id, name, description, custom_programs FROM campuses WHERE status::text = 'ACTIVE' ORDER BY name`),
    pool.query(`SELECT id, acronym, full_name, sort_order, aliases FROM programs ORDER BY sort_order, acronym`),
    pool.query(`SELECT campus_id, program_id FROM campus_programs`),
  ]);

  const programs: ProgramDTO[] = p.rows.map((r) => ({
    id: r.id, acronym: r.acronym, fullName: r.full_name, sortOrder: r.sort_order, aliases: r.aliases ?? [],
  }));
  const allIds = programs.map((x) => x.id);

  const linked = new Map<string, string[]>();
  for (const r of cp.rows) {
    const list = linked.get(r.campus_id) ?? [];
    list.push(r.program_id);
    linked.set(r.campus_id, list);
  }

  const campuses: CampusDTO[] = c.rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    customPrograms: !!r.custom_programs,
    programIds: r.custom_programs ? (linked.get(r.id) ?? []) : allIds,
  }));

  return { campuses, programs };
}

// ---------------------------------------------------------------- campuses

async function assertCampusNameFree(name: string, exceptId: string | null) {
  const { rows } = await pool.query(
    `SELECT 1 FROM campuses WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
    [name, exceptId],
  );
  if (rows[0]) throw new IllegalArgumentError('A campus with that name already exists.');
}

export async function createCampus(body: any, req: Request): Promise<void> {
  const name = text(body?.name, 'Campus name', 100);
  const description = text(body?.description, 'Description', 500, false) || null;
  await assertCampusNameFree(name, null);
  const r = await pool.query(`INSERT INTO campuses (name, description) VALUES ($1, $2) RETURNING id`, [name, description]);
  await audit(req, 'CREATE', 'Campuses', r.rows[0].id, `Created campus: ${name}`, { name, description });
}

export async function updateCampus(idRaw: unknown, body: any, req: Request): Promise<void> {
  const id = uuid(idRaw, 'campus id');
  const name = text(body?.name, 'Campus name', 100);
  const description = text(body?.description, 'Description', 500, false) || null;
  await assertCampusNameFree(name, id);

  const before = (await pool.query(`SELECT name, description FROM campuses WHERE id = $1::uuid`, [id])).rows[0];
  if (!before) throw new IllegalArgumentError('Campus not found.');

  await pool.query(
    `UPDATE campuses SET name = $2, description = $3, updated_at = now() WHERE id = $1::uuid`,
    [id, name, description],
  );

  const changes = changedFields({ name: before.name, description: before.description }, { name, description });
  if (Object.keys(changes).length) {
    await audit(req, 'UPDATE', 'Campuses', id, `Updated campus: ${name} (${Object.keys(changes).join(', ')})`, { changes });
  }
}

export async function deleteCampus(idRaw: unknown, req: Request): Promise<void> {
  const id = uuid(idRaw, 'campus id');
  const campus = (await pool.query(`SELECT name FROM campuses WHERE id = $1::uuid`, [id])).rows[0];
  if (!campus) throw new IllegalArgumentError('Campus not found.');

  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM voters WHERE campus_id = $1::uuid) AS voters,
       (SELECT COUNT(*) FROM elections WHERE campus_id = $1::uuid) AS elections,
       (SELECT COUNT(*) FROM partylists WHERE campus_id = $1::uuid) AS partylists,
       (SELECT COUNT(*) FROM departments WHERE campus_id = $1::uuid) AS departments,
       (SELECT COUNT(*) FROM user_profiles WHERE campus_id = $1::uuid) AS accounts`,
    [id],
  );
  const u = rows[0];
  const parts: string[] = [];
  for (const [key, label] of [['voters', 'voter(s)'], ['elections', 'election(s)'], ['partylists', 'partylist(s)'], ['departments', 'department(s)'], ['accounts', 'account(s)']]) {
    if (Number(u[key]) > 0) parts.push(`${u[key]} ${label}`);
  }
  if (parts.length) throw new IllegalStateError(`This campus still has ${parts.join(', ')}. Remove or move them first.`);

  await pool.query(`DELETE FROM campuses WHERE id = $1::uuid`, [id]);
  await audit(req, 'DELETE', 'Campuses', id, `Deleted campus: ${campus.name}`, { name: campus.name });
}

// ---------------------------------------------------------------- programs

/** voters count under a program when program_course IS the name or starts with it ("BSBA - MKT"); admins store the acronym */
async function programUsage(names: string[]) {
  const up = names.map((n) => n.toUpperCase());
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM voters v WHERE EXISTS (
               SELECT 1 FROM unnest($1::text[]) n
                WHERE upper(v.program_course) = n
                   OR upper(v.program_course) LIKE n || ' -%'
                   OR upper(v.program_course) LIKE n || '-%')) AS voters,
            (SELECT COUNT(*) FROM user_profiles WHERE upper(admin_department) = ANY($1::text[])) AS admins`,
    [up],
  );
  return { voters: Number(rows[0].voters), admins: Number(rows[0].admins) };
}

function readAliases(v: unknown, acronym: string): string[] {
  const parts: unknown[] = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out: string[] = [];
  for (const raw of parts) {
    const a = String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!a || a === acronym || out.includes(a)) continue;
    if (!ALIAS_RE.test(a)) throw new IllegalArgumentError(`"${a}" is not a valid spelling. Use letters, numbers, spaces, dots, hyphens or &.`);
    out.push(a);
  }
  if (out.length > 10) throw new IllegalArgumentError('Use at most 10 other spellings.');
  return out;
}

function readProgramBody(body: any) {
  const acronym = text(body?.acronym, 'Acronym', 20).toUpperCase();
  if (!ACRONYM_RE.test(acronym)) throw new IllegalArgumentError('Acronym can only use letters, numbers, spaces and hyphens.');
  const fullName = text(body?.fullName, 'Full name', 150);
  const aliases = readAliases(body?.aliases, acronym);
  return { acronym, fullName, aliases };
}

/** none of these names may already belong to another program (as acronym or as other spelling) */
async function assertNamesFree(names: string[], exceptId: string | null) {
  const { rows } = await pool.query(
    `SELECT p.acronym FROM programs p
      WHERE ($2::uuid IS NULL OR p.id <> $2::uuid)
        AND (upper(p.acronym) = ANY($1::text[])
             OR EXISTS (SELECT 1 FROM unnest(p.aliases) a WHERE upper(a) = ANY($1::text[])))
      LIMIT 1`,
    [names.map((n) => n.toUpperCase()), exceptId],
  );
  if (rows[0]) throw new IllegalArgumentError(`One of these names is already used by program ${rows[0].acronym}.`);
}

export async function createProgram(body: any, req: Request): Promise<void> {
  const { acronym, fullName, aliases } = readProgramBody(body);
  await assertNamesFree([acronym, ...aliases], null);
  const r = await pool.query(
    `INSERT INTO programs (acronym, full_name, aliases, sort_order)
     VALUES ($1, $2, $3::text[], (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM programs)) RETURNING id`,
    [acronym, fullName, aliases],
  );
  await refreshQuietly();
  await audit(req, 'CREATE', 'Programs', r.rows[0].id, `Created program: ${acronym} - ${fullName}`, { acronym, fullName, aliases });
}

export async function updateProgram(idRaw: unknown, body: any, req: Request): Promise<void> {
  const id = uuid(idRaw, 'program id');
  const { acronym, fullName, aliases } = readProgramBody(body);

  const cur = await pool.query(`SELECT acronym, full_name, aliases FROM programs WHERE id = $1::uuid`, [id]);
  if (!cur.rows[0]) throw new IllegalArgumentError('Program not found.');
  const before = cur.rows[0];

  if (String(before.acronym).toUpperCase() !== acronym) {
    const u = await programUsage([before.acronym, ...(before.aliases ?? [])]);
    if (u.voters + u.admins > 0) {
      throw new IllegalStateError(`${before.acronym} is already used by ${u.voters} voter(s) and ${u.admins} admin(s), so its acronym cannot be changed. You can still edit the full name and other spellings.`);
    }
  }
  await assertNamesFree([acronym, ...aliases], id);

  await pool.query(
    `UPDATE programs SET acronym = $2, full_name = $3, aliases = $4::text[], updated_at = now() WHERE id = $1::uuid`,
    [id, acronym, fullName, aliases],
  );
  await refreshQuietly();

  const changes = changedFields(
    { acronym: before.acronym, fullName: before.full_name, aliases: before.aliases ?? [] },
    { acronym, fullName, aliases },
  );
  if (Object.keys(changes).length) {
    await audit(req, 'UPDATE', 'Programs', id, `Updated program: ${acronym} (${Object.keys(changes).join(', ')})`, { changes });
  }
}

export async function deleteProgram(idRaw: unknown, req: Request): Promise<void> {
  const id = uuid(idRaw, 'program id');
  const cur = await pool.query(`SELECT acronym, full_name, aliases FROM programs WHERE id = $1::uuid`, [id]);
  if (!cur.rows[0]) throw new IllegalArgumentError('Program not found.');
  const { acronym, full_name, aliases } = cur.rows[0];

  const u = await programUsage([acronym, ...(aliases ?? [])]);
  if (u.voters + u.admins > 0) {
    throw new IllegalStateError(`${acronym} is still used by ${u.voters} voter(s) and ${u.admins} admin(s). It cannot be deleted.`);
  }
  await pool.query(`DELETE FROM programs WHERE id = $1::uuid`, [id]);
  await refreshQuietly();
  await audit(req, 'DELETE', 'Programs', id, `Deleted program: ${acronym} - ${full_name}`, { acronym, fullName: full_name });
}

// ---------------------------------------------------------------- per-campus program list

export async function setCampusPrograms(campusIdRaw: unknown, customRaw: unknown, idsRaw: unknown, req: Request): Promise<void> {
  const campusId = uuid(campusIdRaw, 'campus id');
  const custom = customRaw === true;
  const ids = Array.isArray(idsRaw) ? [...new Set(idsRaw.map((x) => uuid(x, 'program id')))] : [];
  if (custom && ids.length === 0) throw new IllegalArgumentError('Select at least one program for this campus.');

  let campusName = '';            // declared above the try so it is usable after COMMIT
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE campuses SET custom_programs = $2, updated_at = now() WHERE id = $1::uuid RETURNING id, name`,
      [campusId, custom],
    );
    if (!upd.rows[0]) throw new IllegalArgumentError('Campus not found.');
    campusName = upd.rows[0].name;

    await client.query(`DELETE FROM campus_programs WHERE campus_id = $1::uuid`, [campusId]);
    if (custom) {
      const ins = await client.query(
        `INSERT INTO campus_programs (campus_id, program_id) SELECT $1::uuid, id FROM programs WHERE id = ANY($2::uuid[])`,
        [campusId, ids],
      );
      if (ins.rowCount !== ids.length) throw new IllegalArgumentError('One of the selected programs no longer exists.');
    }
    await client.query('COMMIT');

    const list = custom
      ? (await pool.query(`SELECT acronym FROM programs WHERE id = ANY($1::uuid[]) ORDER BY sort_order, acronym`, [ids])).rows.map((r) => r.acronym as string)
      : null;
    await audit(
      req, 'UPDATE', 'Campuses', campusId,
      custom
        ? `Updated campus: ${campusName} (custom program list, ${list!.length} programs)`
        : `Updated campus: ${campusName} (offers all programs)`,
      { customPrograms: custom, programs: list },
    );
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- used by adminService + departmentService

/**
 * Turns a typed program/department name into the stored acronym and checks that this campus offers it.
 * If `current` is the value already saved on the record and the name did not change, it is accepted as-is,
 * so old records can still be edited after a campus drops a program.
 */
export async function resolveOfferedProgram(db: Db, campusId: string, name: string, current: string | null = null): Promise<string> {
  const wanted = name.trim();
  if (current && current.trim().toUpperCase() === wanted.toUpperCase()) return current;

  const found = await db.query(
    `SELECT p.acronym FROM programs p
      WHERE upper(p.acronym) = upper($1)
         OR EXISTS (SELECT 1 FROM unnest(p.aliases) a WHERE upper(a) = upper($1))
      ORDER BY (upper(p.acronym) = upper($1)) DESC LIMIT 1`,
    [wanted],
  );
  if (!found.rows[0]) throw new IllegalArgumentError(`Unknown program: ${name}`);
  const acronym = found.rows[0].acronym as string;

  const offered = await db.query(
    `SELECT 1 FROM campuses c
      WHERE c.id = $1::uuid
        AND (c.custom_programs = false
             OR EXISTS (SELECT 1 FROM campus_programs cp JOIN programs p ON p.id = cp.program_id
                         WHERE cp.campus_id = c.id AND p.acronym = $2))`,
    [campusId, acronym],
  );
  if (!offered.rows[0]) throw new IllegalArgumentError(`${acronym} is not offered by this campus.`);
  return acronym;
}
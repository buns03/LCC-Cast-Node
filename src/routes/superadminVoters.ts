import { Request, Response, Router } from "express";
import { requireAny } from "../auth/guards";
import { renderView } from "../render";
import { avatarHtml, profilePictureUrlFor } from "../profilePicture";
import { pool } from "../db"; // ← CHECK PATH (file that exports `pool`)
import * as svc from "../voterService";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { getAuthUserId } from "../auth/sessionUser";
import { startJob, chunks, detachRequest } from "../jobs";

export const superadminVotersRouter = Router();
superadminVotersRouter.use("/superadmin", requireAny("ROLE_SUPERADMIN"));

// GET /superadmin/voters  (page)
superadminVotersRouter.get(
  "/superadmin/voters",
  async (req: Request, res: Response) => {
    const user = req.session.user!;
    const displayName =
      user.firstName && user.firstName.trim() ? user.firstName : user.role;
    let avatar = "";
    try {
      avatar = avatarHtml(await profilePictureUrlFor(req));
    } catch (e) {
      console.error("Could not load profile picture:", (e as Error).message);
    }
    res.send(
      renderView("superadmin/voters.html", {
        displayName,
        html_avatar: avatar,
      }),
    );
  },
);

// ---------------------------------------------------------------- API
const api = Router();
superadminVotersRouter.use("/superadmin/api/voters", api);

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    console.error("Voters API error:", e);
    if (!res.headersSent)
      res.status(500).json({ message: "Something went wrong on the server." });
  }
};
const q = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const idParam = (req: Request) => String(req.params.id);
const bad = (res: Response, message: string) =>
  res.status(400).json({ message });
const toVotedFlag = (s?: string): boolean | null => {
  if (!s || !s.trim()) return null;
  const t = s.trim().toLowerCase();
  if (t.includes("not")) return false;
  if (t.includes("voted")) return true;
  return null;
};
const csv = (v: unknown) =>
  `"${String(v instanceof Date ? v.toISOString() : (v ?? "")).replace(/"/g, '""')}"`;

/** campusId must be a UUID if given (Spring answered 400 otherwise) */
function readFilter(
  src: Record<string, unknown>,
  res: Response,
): svc.VoterFilter | null {
  const campusId = svc.blankToNull(src.campusId);
  if (campusId && !svc.isUuid(campusId)) {
    bad(res, "Invalid campus ID.");
    return null;
  }
  return {
    campusId,
    program: svc.blankToNull(src.program),
    yearLevel: svc.blankToNull(src.yearLevel),
    section: svc.blankToNull(src.section),
    search: svc.blankToNull(src.search),
    schoolYear: svc.blankToNull(src.schoolYear),
  };
}

// GET /  (all active voters)
api.get(
  "/",
  wrap(async (_req, res) => {
    const { rows } = await svc.searchVoters({
      filter: {},
      sscVoted: null,
      deptVoted: null,
      nameSort: "default",
      timeSort: "default",
      page: 0,
      size: 1_000_000,
    });
    res.json(await svc.toResponseList(pool, rows));
  }),
);

// GET /page
api.get(
  "/page",
  wrap(async (req, res) => {
    const page = Math.max(0, parseInt(q(req.query.page) ?? "0", 10) || 0);
    const size = Math.min(
      100,
      Math.max(1, parseInt(q(req.query.size) ?? "20", 10) || 20),
    );
    const filter = readFilter(req.query as Record<string, unknown>, res);
    if (!filter) return;

    const { rows, total } = await svc.searchVoters({
      filter,
      sscVoted: toVotedFlag(q(req.query.sscStatus)),
      deptVoted: toVotedFlag(q(req.query.departmentStatus)),
      nameSort: svc.normalizeNameSort(q(req.query.nameSort)),
      timeSort: svc.normalizeTimeSort(q(req.query.timeSort)),
      page,
      size,
    });

    res.json({
      content: await svc.toResponseList(pool, rows),
      totalElements: total,
      totalPages: Math.ceil(total / size),
      page,
    });
  }),
);

// GET /facets?program=a&program=b
api.get(
  "/facets",
  wrap(async (req, res) => {
    const campusId = svc.blankToNull(req.query.campusId);
    if (campusId && !svc.isUuid(campusId))
      return bad(res, "Invalid campus ID.");
    const raw = req.query.program;
    const programs = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
      (p): p is string => typeof p === "string" && p !== "",
    );
    res.json(await svc.getFacets(campusId, programs));
  }),
);

// GET /export  (sync CSV)
api.get(
  "/export",
  wrap(async (req, res) => {
    const filter = readFilter(req.query as Record<string, unknown>, res);
    if (!filter) return;
    const ids = await svc.findIdsMatching(filter);

    res.setHeader("Content-Type", "text/csv;charset=UTF-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="lccast-voters.csv"',
    );
    res.write(
      "Student ID,Full Name,Course,Year Level,Section,Campus,Email,SSC Voting Status,SSC Time Voted,Department Voting Status,Department Time Voted\n",
    );

    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const voters = (
        await pool.query(`SELECT * FROM voters WHERE id = ANY($1::uuid[])`, [
          chunk,
        ])
      ).rows as svc.VoterRow[];
      for (const v of await svc.toResponseList(pool, voters)) {
        res.write(
          [
            v.studentId,
            v.fullName,
            v.programCourse,
            v.yearLevel,
            v.section,
            v.campus,
            v.email,
            v.sscVotingStatus,
            v.sscVotedAt,
            v.departmentVotingStatus,
            v.departmentVotedAt,
          ]
            .map(csv)
            .join(",") + "\n",
        );
      }
    }
    res.end();
  }),
);

// GET /student/:studentId
api.get(
  "/student/:studentId",
  wrap(async (req, res) => {
    const studentId = String(req.params.studentId).trim();
    if (!studentId) return res.status(404).end();
    const r = await pool.query(
      `SELECT * FROM voters WHERE student_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [studentId],
    );
    if (!r.rows[0]) return res.status(404).end();
    res.json(await svc.toResponse(pool, r.rows[0]));
  }),
);

// PATCH /archive-matching  and  DELETE /delete-matching  (sync versions)
api.patch(
  "/archive-matching",
  wrap(async (req, res) => {
    const filter = readFilter(req.body ?? {}, res);
    if (!filter) return;
    const ids = await svc.findIdsMatching(filter);
    if (!ids.length)
      return res.json({ message: "No matching voters.", count: 0 });
    res.json({
      message: "Voters archived successfully.",
      count: await svc.moveVoters("archive", ids, req),
    });
  }),
);

api.delete(
  "/delete-matching",
  wrap(async (req, res) => {
    const filter = readFilter(req.body ?? {}, res);
    if (!filter) return;
    const ids = await svc.findIdsMatching(filter);
    if (!ids.length)
      return res.json({ message: "No matching voters.", count: 0 });
    res.json({
      message: "Voters moved to trash successfully.",
      count: await svc.moveVoters("trash", ids, req),
    });
  }),
);

// PATCH /archive  and  DELETE /bulk  (body = array of ids)
api.patch(
  "/archive",
  wrap(async (req, res) => {
    const ids = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return bad(res, "No voters selected.");
    if (!ids.every(svc.isUuid)) return bad(res, "Invalid voter id.");
    try {
      res.json({
        message: "Voters archived successfully.",
        count: await svc.moveVoters("archive", ids, req),
      });
    } catch (e) {
      bad(res, (e as Error).message);
    }
  }),
);

api.delete(
  "/bulk",
  wrap(async (req, res) => {
    const ids = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return bad(res, "No voters selected.");
    if (!ids.every(svc.isUuid)) return bad(res, "Invalid voter id.");
    try {
      res.json({
        message: "Voters moved to trash successfully.",
        count: await svc.moveVoters("trash", ids, req),
      });
    } catch (e) {
      bad(res, (e as Error).message);
    }
  }),
);

// POST /import  (sync)
api.post(
  "/import",
  wrap(async (req, res) => {
    const rows = req.body;
    if (!Array.isArray(rows) || !rows.length)
      return bad(res, "The import file contains no voter records.");
    const r = await svc.importVoters(rows, req);
    res.json({
      success: true,
      added: r.added,
      updated: r.updated,
      skipped: r.skipped,
      errors: r.errors,
    });
  }),
);

// ---------------------------------------------------------------- BACKGROUND JOBS

const EXPORT_HEADER =
  "Student ID,Full Name,Course,Year Level,Section,Campus,Email,SSC Voting Status,SSC Time Voted,Department Voting Status,Department Time Voted\n";

const csvLine = (v: Record<string, unknown>) =>
  [
    v.studentId,
    v.fullName,
    v.programCourse,
    v.yearLevel,
    v.section,
    v.campus,
    v.email,
    v.sscVotingStatus,
    v.sscVotedAt,
    v.departmentVotingStatus,
    v.departmentVotedAt,
  ]
    .map(csv)
    .join(",") + "\n";

const NO_SESSION = { message: "Session expired. Please log in again." };

// POST /import-async
api.post(
  "/import-async",
  wrap(async (req, res) => {
    const rows = req.body;
    if (!Array.isArray(rows) || !rows.length)
      return bad(res, "The import file contains no voter records.");
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json(NO_SESSION);
    const detached = detachRequest(req);

    const job = startJob(
      userId,
      "VOTER_IMPORT",
      "Importing voters",
      rows.length,
      async (j) => {
        let added = 0,
          updated = 0,
          skipped = 0;
        const problems: string[] = [];
        for (const chunk of chunks(rows as Record<string, unknown>[], 25)) {
          const r = await svc.importVoters(chunk, detached);
          added += r.added;
          updated += r.updated;
          skipped += r.skipped;
          problems.push(...r.errors);
          j.advance(r.added + r.updated, r.skipped);
          let msg = `Added ${added} · Updated ${updated} · Skipped ${skipped}`;
          if (problems.length) msg += ` — ${problems[0]}`;
          j.setMessage(msg);
        }
        problems.forEach((p) => console.log("IMPORT PROBLEM:", p));
      },
    );
    res.status(202).json(job.toMap());
  }),
);

// POST /export-async?campusId=&program=&yearLevel=&section=&search=
api.post(
  "/export-async",
  wrap(async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json(NO_SESSION);
    const filter = readFilter(req.query as Record<string, unknown>, res);
    if (!filter) return;

    const job = startJob(
      userId,
      "VOTER_EXPORT",
      "Exporting voters",
      0,
      async (j) => {
        const ids = await svc.findIdsMatching(filter);
        j.setTotal(ids.length);

        const file = path.join(os.tmpdir(), `lccast-voters-${Date.now()}.csv`);
        await fsp.writeFile(file, EXPORT_HEADER, "utf8");

        for (const chunk of chunks(ids, 200)) {
          const voters = (
            await pool.query(
              `SELECT * FROM voters WHERE id = ANY($1::uuid[])`,
              [chunk],
            )
          ).rows as svc.VoterRow[];
          const rows = await svc.toResponseList(pool, voters);
          await fsp.appendFile(file, rows.map(csvLine).join(""), "utf8");
          j.advance(chunk.length, 0);
        }
        j.setResult(file, "lccast-voters.csv");
      },
    );
    res.status(202).json(job.toMap());
  }),
);

// DELETE /delete-matching/async  and  PATCH /archive-matching/async   (body = filter)
const matchingJob = (kind: "archive" | "trash", type: string, title: string) =>
  wrap(async (req, res) => {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json(NO_SESSION);
    const filter = readFilter(req.body ?? {}, res);
    if (!filter) return;
    const detached = detachRequest(req);

    const job = startJob(userId, type, title, 0, async (j) => {
      const ids = await svc.findIdsMatching(filter);
      j.setTotal(ids.length);
      if (!ids.length) j.setMessage("No matching voters.");

      for (const chunk of chunks(ids, 100)) {
        const ok = await svc.moveVoters(kind, chunk, detached);
        j.advance(ok, chunk.length - ok);
      }
    });
    res.status(202).json(job.toMap());
  });

api.delete(
  "/delete-matching/async",
  matchingJob("trash", "VOTER_DELETE", "Moving voters to trash"),
);
api.patch(
  "/archive-matching/async",
  matchingJob("archive", "VOTER_ARCHIVE", "Archiving voters"),
);

// ---- single voter ----
api.get(
  "/:id",
  wrap(async (req, res) => {
    if (!svc.isUuid(idParam(req))) return bad(res, "Invalid voter id.");
    const r = await pool.query(
      `SELECT * FROM voters WHERE id = $1::uuid AND status = 'ACTIVE'`,
      [idParam(req)],
    );
    if (!r.rows[0]) return res.status(404).end();
    res.json(await svc.toResponse(pool, r.rows[0]));
  }),
);

api.put(
  "/:id",
  wrap(async (req, res) => {
    if (!svc.isUuid(idParam(req))) return bad(res, "Invalid voter id.");
    const result = await svc.updateVoter(idParam(req), req.body ?? {}, req);
    if (result.status === 404) return res.status(404).end();
    if (result.status !== 200)
      return bad(res, result.message ?? "Failed to update voter.");
    res.json(result.voter);
  }),
);

api.patch(
  "/:id/archive",
  wrap(async (req, res) => {
    if (!svc.isUuid(idParam(req))) return bad(res, "Invalid voter id.");
    try {
      await svc.moveVoter("archive", idParam(req), req);
      res.json({ message: "Voter archived successfully." });
    } catch (e) {
      bad(res, (e as Error).message);
    }
  }),
);

api.patch(
  "/:id/restore",
  wrap(async (req, res) => {
    if (!svc.isUuid(idParam(req))) return bad(res, "Invalid voter id.");
    try {
      const restored = await svc.restoreVoter(idParam(req), req);
      if (!restored) return res.status(404).end();
      res.json(await svc.toResponse(pool, restored));
    } catch (e) {
      bad(res, (e as Error).message);
    }
  }),
);

api.delete(
  "/:id/permanent",
  wrap(async (req, res) => {
    if (!svc.isUuid(idParam(req))) return bad(res, "Invalid voter id.");
    try {
      await svc.permanentlyDeleteVoter(idParam(req));
      res.json({ message: "Voter permanently deleted." });
    } catch (e) {
      bad(res, (e as Error).message);
    }
  }),
);

api.delete(
  "/:id",
  wrap(async (req, res) => {
    if (!svc.isUuid(idParam(req))) return bad(res, "Invalid voter id.");
    try {
      await svc.moveVoter("trash", idParam(req), req);
      res.json({ message: "Voter moved to trash successfully." });
    } catch (e) {
      bad(res, (e as Error).message);
    }
  }),
);

import { Request, Response, Router } from "express";
import multer from "multer";
import { requireAny } from "../auth/guards";
import { renderView } from "../render";
import { avatarHtml, profilePictureUrlFor } from "../profilePicture";
import { uploadFile } from "../storage";
import { IllegalArgumentError, IllegalStateError } from "../errors";
import * as svc from "../adminSscPartylistService";
import { HttpError } from "../adminSscPartylistService";
import { serve } from "./storage";

export const adminSscPartylistsRouter = Router();

const guard = requireAny("ROLE_ADMIN_SSC");
const BASE = "/admin-ssc/api/partylists";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}); // CHECK vs Spring limit

// ---------------------------------------------------------------- helpers

/** requireCampusId(session) from the Java controller */
function campusIdOf(req: Request): string {
  const id = req.session.user?.campusId;
  if (!id || !isUuid(id))
    throw new HttpError(401, "No campus is associated with this account.");
  return id;
}

function idParam(req: Request, name: string): string {
  const v = String(req.params[name] ?? "");
  if (!isUuid(v)) throw new IllegalArgumentError("Invalid id.");
  return v;
}

/** The JS reads error bodies as plain text and shows them in a toast. */
function sendError(res: Response, e: unknown) {
  if (res.headersSent) return;
  const message = (e as Error)?.message || "Something went wrong.";
  let status = 500;
  if (e instanceof HttpError) status = e.status;
  else if (e instanceof IllegalArgumentError) status = 400;
  else if (e instanceof IllegalStateError) status = 409;
  else if (message === "Partylist not found") status = 404;
  if (status === 500) console.error("[admin-ssc partylists]", e);
  res.status(status).type("text/plain").send(message);
}

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => {
    fn(req, res).catch((e) => sendError(res, e));
  };

// ---------------------------------------------------------------- page (AdminPartylistController)

adminSscPartylistsRouter.get(
  "/admin-ssc/partylists",
  guard,
  async (req: Request, res: Response) => {
    try {
      const user = req.session.user!;
      const displayName =
        user.firstName && user.firstName.trim() ? user.firstName : user.role;
      const campus = user.campus ?? "";

      let htmlAvatar = "";
      try {
        htmlAvatar = avatarHtml(await profilePictureUrlFor(req));
      } catch (e) {
        console.error(
          "admin-ssc partylists avatar lookup failed:",
          (e as Error).message,
        );
      }

      res.set("Cache-Control", "no-store");
      res.send(
        renderView("admin-ssc/partylists.html", {
          displayName,
          campus,
          campusId: user.campusId ?? "",
          programCampus: `${user.programCourse ?? ""} - ${campus}`,
          html_avatar: htmlAvatar,
        }),
      );
    } catch (e) {
      console.error("SSC partylists page error:", e);
      res.status(500).send("Something went wrong.");
    }
  },
);

// ---------------------------------------------------------------- API (static paths FIRST, /:id routes LAST)

adminSscPartylistsRouter.get(
  BASE,
  guard,
  h(async (req, res) => {
    res.json(await svc.getActivePartylists(campusIdOf(req)));
  }),
);

adminSscPartylistsRouter.get(
  `${BASE}/file`,
  guard,
  (req: Request, res: Response) => {
    const path = req.query.path;
    if (typeof path !== "string" || !path) return res.status(400).end();
    return serve(res, path);
  },
);

adminSscPartylistsRouter.get(
  `${BASE}/voters`,
  guard,
  h(async (req, res) => {
    res.json(await svc.getVotersForCampus(campusIdOf(req)));
  }),
);

adminSscPartylistsRouter.get(
  `${BASE}/members/student/:studentId`,
  guard,
  h(async (req, res) => {
    const voter = await svc.findVoterByStudentId(
      String(req.params.studentId),
      campusIdOf(req),
    );
    if (!voter) return res.status(404).end();
    res.json(voter);
  }),
);

adminSscPartylistsRouter.post(
  `${BASE}/validate-members`,
  guard,
  h(async (req, res) => {
    const campusId = campusIdOf(req);
    const body = req.body ?? {};
    try {
      if (body.id != null && !isUuid(body.id))
        throw new IllegalArgumentError("Invalid partylist id.");
      await svc.validateMembers(
        body.id ?? null,
        campusId,
        body.schoolYear ?? null,
        body.members,
      );
      res.json({ valid: true });
    } catch (e) {
      if (e instanceof IllegalArgumentError)
        return res.status(400).json({ valid: false, error: e.message });
      console.error(e);
      res.status(500).json({ valid: false, error: "Validation failed." });
    }
  }),
);

adminSscPartylistsRouter.post(
  `${BASE}/upload`,
  guard,
  (req: Request, res: Response) => {
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        const error =
          err.code === "LIMIT_FILE_SIZE"
            ? "File is too large (max 10 MB)."
            : err.message || "File upload failed.";
        return res.status(400).json({ success: false, error });
      }
      try {
        const path = await uploadFile(req.file, String(req.body?.type ?? ""));
        res.json({ success: true, path });
      } catch (e) {
        res
          .status(400)
          .json({
            success: false,
            error: (e as Error).message || "File upload failed.",
          });
      }
    });
  },
);

adminSscPartylistsRouter.post(
  BASE,
  guard,
  h(async (req, res) => {
    res.json(await svc.save(req.body ?? {}, campusIdOf(req), req));
  }),
);

// ---- /:id routes ----

adminSscPartylistsRouter.get(
  `${BASE}/:id`,
  guard,
  h(async (req, res) => {
    res.json(await svc.getByIdWithMembers(idParam(req, "id"), campusIdOf(req)));
  }),
);

adminSscPartylistsRouter.get(
  `${BASE}/:id/members`,
  guard,
  h(async (req, res) => {
    res.json(await svc.getMembers(idParam(req, "id"), campusIdOf(req)));
  }),
);

adminSscPartylistsRouter.get(
  `${BASE}/:id/file/:type`,
  guard,
  h(async (req, res) => {
    const p = await svc.getById(idParam(req, "id"), campusIdOf(req));
    let storagePath: string | null;
    switch (String(req.params.type).toLowerCase()) {
      case "poster":
        storagePath = p.posterImageUrl;
        break;
      case "logo":
        storagePath = p.posterLogoUrl;
        break;
      default:
        throw new IllegalArgumentError("Invalid partylist file type.");
    }
    await serve(res, storagePath ?? "");
  }),
);

adminSscPartylistsRouter.get(
  `${BASE}/:partylistId/members/:memberId/file/:type`,
  guard,
  h(async (req, res) => {
    const m = await svc.getMember(
      idParam(req, "partylistId"),
      idParam(req, "memberId"),
      campusIdOf(req),
    );
    let storagePath: string | null;
    switch (String(req.params.type).toLowerCase()) {
      case "campaign":
        storagePath = m.campaignImageUrl;
        break;
      case "background":
        storagePath = m.backgroundImageUrl;
        break;
      case "photo":
        storagePath = m.photoImageUrl;
        break;
      default:
        throw new IllegalArgumentError("Invalid member file type.");
    }
    await serve(res, storagePath ?? "");
  }),
);

adminSscPartylistsRouter.put(
  `${BASE}/:id`,
  guard,
  h(async (req, res) => {
    res.json(
      await svc.update(
        idParam(req, "id"),
        req.body ?? {},
        campusIdOf(req),
        req,
      ),
    );
  }),
);

adminSscPartylistsRouter.put(
  `${BASE}/:id/archive`,
  guard,
  h(async (req, res) => {
    await svc.archive(idParam(req, "id"), campusIdOf(req), req);
    res.status(200).end();
  }),
);

adminSscPartylistsRouter.put(
  `${BASE}/:id/restore`,
  guard,
  h(async (req, res) => {
    await svc.restore(idParam(req, "id"), campusIdOf(req), req);
    res.status(200).end();
  }),
);

adminSscPartylistsRouter.delete(
  `${BASE}/:id`,
  guard,
  h(async (req, res) => {
    await svc.remove(idParam(req, "id"), campusIdOf(req), req);
    res.status(200).end();
  }),
);

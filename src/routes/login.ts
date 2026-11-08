import { Request, Response, Router } from "express";
import path from "path";
import {
  findBySchoolId,
  findByEmail,
  findCampusName,
  findVoterInfo,
  isVoterActive,
  touchLastLogin,
} from "../repositories";
import { supabaseLogin, SupabaseAuthResponse, AuthRateLimitError } from "../supabaseAuth";
import { isLoggedInElsewhere, registerSession, unregisterSession } from "../auth/sessions";
import { loginRedirectFor } from "../auth/landing";
import { SessionUser, UserProfile } from "../types";
import { needsMfa, isTrustedDevice, trustDevice, sendLoginOtp, verifyLoginOtp } from "../auth/mfa";
import { maskEmail } from "../auth/maskEmail";

export const loginRouter = Router();

const INVALID = {
  success: false,
  code: "INVALID_CREDENTIALS",
  message: "Invalid School ID or password.",
};

const MFA_WINDOW_MS = 10 * 60 * 1000;

const regenerate = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
const save = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

// ---------- shared: build the real session (old steps 5-7) ----------
async function completeLogin(req: Request, res: Response, profile: UserProfile) {
  const isVoterType = profile.role === "STUDENT" || profile.role === "CANDIDATE";
  const userKey = profile.authUserId ?? profile.id;

  let campus: string | null = null;
  let campusId: string | null = null;
  let programCourse: string | null = null;

  if (isVoterType) {
    const voter = await findVoterInfo(profile.authUserId);
    if (voter) {
      campus = await findCampusName(voter.campusId);
      programCourse = voter.programCourse;
    }
  } else if (profile.role === "ADMIN") {
    campusId = profile.campusId;
    campus = await findCampusName(profile.campusId);
    programCourse =
      profile.adminType === "DEPARTMENT" && profile.adminDepartment
        ? profile.adminDepartment
        : "Supreme Student Council";
  }

  await regenerate(req); // also wipes pendingMfa

  const user: SessionUser = {
    userId: profile.authUserId,
    authUserId: profile.authUserId,
    schoolId: profile.schoolId,
    firstName: profile.firstName,
    role: profile.role,
    adminType: profile.adminType,
    campus,
    campusId,
    programCourse,
    mustChangePassword: isVoterType ? profile.mustChangePassword : false,
  };
  req.session.user = user;
  await save(req);

  if (isVoterType) registerSession(userKey, req.sessionID);
  await touchLastLogin(profile.id);

  const redirectUrl =
    isVoterType && profile.mustChangePassword ? "/voter/password-handler" : loginRedirectFor(user);

  return res.json({ success: true, redirectUrl });
}

// ---------- GET /login ----------
loginRouter.get("/login", (req: Request, res: Response) => {
  if (req.session.user) return res.redirect(loginRedirectFor(req.session.user));
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "..", "..", "views", "login.html"));
});

// ---------- POST /login ----------
loginRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const schoolId = String(req.body?.schoolId ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!schoolId || !password) return res.status(401).json(INVALID);

    const profile: UserProfile | null =
      (await findBySchoolId(schoolId)) ?? (await findByEmail(schoolId));

    if (!profile || !profile.email || !profile.active) return res.status(401).json(INVALID);

    const isVoterType = profile.role === "STUDENT" || profile.role === "CANDIDATE";

    if (isVoterType && !(await isVoterActive(profile.authUserId))) {
      return res.status(401).json(INVALID);
    }

    let authResponse: SupabaseAuthResponse | null = null;
    try {
      authResponse = await supabaseLogin(profile.email, password, req.ip);
    } catch (e) {
      if (e instanceof AuthRateLimitError) {
        console.warn("Supabase Auth rate limit hit for a login attempt");
        return res.status(429).json({
          success: false,
          code: "RATE_LIMITED",
          message: "Too many people are logging in right now. Please wait a minute and try again.",
        });
      }
      console.error("Supabase login error:", (e as Error).message);
    }
    if (!authResponse) return res.status(401).json(INVALID);

    const userKey = profile.authUserId ?? profile.id;
    if (isVoterType && (await isLoggedInElsewhere(userKey, req.sessionID))) {
      return res.status(409).json({
        success: false,
        code: "CONCURRENT_LOGIN",
        message: "This account is already logged in on another device or browser.",
      });
    }

    // ---------- NEW: MFA for SUPERADMIN / ADMIN on new or long-idle devices ----------
    if (needsMfa(profile.role)) {
      if (!profile.authUserId) return res.status(401).json(INVALID);

      if (!(await isTrustedDevice(req, res, profile.authUserId))) {
        req.session.pendingMfa = {
          email: profile.email,
          authUserId: profile.authUserId,
          expiresAt: Date.now() + MFA_WINDOW_MS,
        };
        await save(req);
        try {
          await sendLoginOtp(profile.email, profile.authUserId); // if a code was sent <60s ago it is simply reused
        } catch (e) {
          console.error("MFA email error:", (e as Error).message);
          delete req.session.pendingMfa;
          return res.status(500).json({
            success: false,
            code: "MFA_SEND_FAILED",
            message: "We could not send the verification code. Please try again.",
          });
        }
        return res.json({ success: false, code: "MFA_REQUIRED", maskedEmail: maskEmail(profile.email) });
      }
    }

    return await completeLogin(req, res, profile);
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Something went wrong. Please try again.",
    });
  }
});

// ---------- POST /login/mfa/verify ----------
loginRouter.post("/login/mfa/verify", async (req: Request, res: Response) => {
  try {
    const pending = req.session.pendingMfa;
    if (!pending || pending.expiresAt < Date.now()) {
      return res.status(401).json({
        success: false,
        code: "MFA_EXPIRED",
        message: "Your verification session expired. Please log in again.",
      });
    }

    const otp = String(req.body?.otp ?? "").trim();
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, code: "MFA_INVALID", message: "OTP must contain exactly 6 digits." });
    }

    const check = await verifyLoginOtp(pending.email, otp);
    if (!check.ok) {
      return res.status(400).json({ success: false, code: check.code, message: check.message });
    }

    const profile = await findByEmail(pending.email);
    if (!profile || !profile.active || profile.authUserId !== pending.authUserId || !needsMfa(profile.role)) {
      return res.status(401).json(INVALID);
    }

    if (req.body?.rememberDevice === true) await trustDevice(req, res, pending.authUserId);

    return await completeLogin(req, res, profile);
  } catch (e) {
    console.error("MFA verify error:", e);
    return res.status(500).json({ success: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." });
  }
});

// ---------- POST /login/mfa/resend ----------
loginRouter.post("/login/mfa/resend", async (req: Request, res: Response) => {
  try {
    const pending = req.session.pendingMfa;
    if (!pending || pending.expiresAt < Date.now()) {
      return res.status(401).json({
        success: false,
        code: "MFA_EXPIRED",
        message: "Your verification session expired. Please log in again.",
      });
    }
    const result = await sendLoginOtp(pending.email, pending.authUserId);
    if (!result.ok) {
      return res.status(429).json({
        success: false,
        code: "MFA_COOLDOWN",
        retryAfter: result.retryAfter,
        message: `Please wait ${result.retryAfter}s before requesting a new code.`,
      });
    }
    return res.json({ success: true, maskedEmail: maskEmail(pending.email) });
  } catch (e) {
    console.error("MFA resend error:", e);
    return res.status(500).json({ success: false, message: "Could not resend the code. Please try again." });
  }
});

// ---------- /logout ----------
function logout(req: Request, res: Response) {
  const user = req.session.user;
  const sid = req.sessionID;
  req.session.destroy(() => {
    if (user) unregisterSession(user.authUserId ?? user.userId ?? "", sid);
    res.clearCookie("lccast.sid");
    res.redirect("/login");
  });
}
loginRouter.post("/logout", logout);
loginRouter.get("/logout", logout);
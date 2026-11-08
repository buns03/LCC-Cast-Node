import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  clearMustChangePassword,
  deleteOtp,
  findByEmail,
  findBySchoolId,
  findLatestOtp,
  findVoterByEmail,
  findVoterEmailByStudentId,
  insertOtp,
  markOtpVerified,
  updateOtpAttempts,
} from "./repositories";
import { sendHtmlMail } from "./mailer";
import { renderView } from "./render";
import { updatePassword } from "./supabaseAuth";
import { maskEmail } from "./auth/maskEmail";
import { revokeTrustedDevices } from "./auth/mfa";

// same constants as ForgotPasswordService.java
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const VERIFIED_WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const PURPOSE = "FORGOT_PASSWORD";

export interface ApiResult {
  success: boolean;
  message: string;
  maskedEmail?: string;
  via?: "EMAIL" | "SCHOOL_ID";
}

const fail = (message: string): ApiResult => ({ success: false, message });
const ok = (message: string, extra: Partial<ApiResult> = {}): ApiResult => ({
  success: true,
  message,
  ...extra,
});

const generateOtp = () =>
  Array.from({ length: OTP_LENGTH }, () => crypto.randomInt(0, 10)).join("");

/**
 * The user can type a School ID or an email.
 *  - contains "@"  -> it is the email
 *  - otherwise     -> School ID: look up the email registered to it
 * (The front end sends the same typed value on all 3 steps, so every step resolves to the same email.)
 */
async function resolveIdentifier(
  raw: string | undefined,
): Promise<{ email: string; via: "EMAIL" | "SCHOOL_ID" } | null> {
  const value = (raw ?? "").trim();
  if (!value) return null;

  // typed an email
  if (value.includes("@")) return { email: value.toLowerCase(), via: "EMAIL" };

  // typed a School ID -> students/candidates: use the email in the voters data
  const voter = await findVoterEmailByStudentId(value);
  if (voter) {
    const voterEmail = (voter.email ?? "").trim().toLowerCase();
    return voterEmail ? { email: voterEmail, via: "SCHOOL_ID" } : null; // voter has no email saved
  }

  // no voter record -> admins / superadmin have no voters row, so use their user_profiles email
  const profile = await findBySchoolId(value);
  if (!profile || !profile.active || !profile.email) return null;
  return { email: profile.email.trim().toLowerCase(), via: "SCHOOL_ID" };
}

/** voters first (students), then user_profiles (admins) - same order as Java. */
async function resolveAuthUserId(email: string): Promise<string | null> {
  const voter = await findVoterByEmail(email);
  if (voter) return voter.authUserId;
  const profile = await findByEmail(email);
  return profile ? profile.authUserId : null;
}

export async function verifyEmail(
  rawIdentifier: string | undefined,
): Promise<ApiResult> {
  if (!rawIdentifier || !rawIdentifier.trim())
    return fail("School ID or email is required.");

  const resolved = await resolveIdentifier(rawIdentifier);
  if (!resolved) return fail("The account could not be verified."); // generic on purpose
  const email = resolved.email;

  const authUserId = await resolveAuthUserId(email);
  if (!authUserId) return fail("The account could not be verified."); // generic on purpose

  const otp = generateOtp();
  await insertOtp({
    authUserId,
    email,
    otpHash: await bcrypt.hash(otp, 10), // BCrypt strength 10 = Spring's default, same format
    purpose: PURPOSE,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000),
  });

  const html = renderView("otp-email.html", {
    otpCode: otp,
    expiresMinutes: OTP_EXPIRY_MINUTES,
  });
  await sendHtmlMail(email, "Your LCC Cast Password Reset Code", html);

  return ok("Verification code sent.", {
    maskedEmail: maskEmail(email),
    via: resolved.via,
  });
}

export async function verifyOtp(
  rawIdentifier: string | undefined,
  otp: string | undefined,
): Promise<ApiResult> {
  if (!rawIdentifier || !otp) return fail("Invalid or expired OTP.");

  const resolved = await resolveIdentifier(rawIdentifier);
  if (!resolved) return fail("Invalid or expired OTP.");
  const email = resolved.email;

  const record = await findLatestOtp(email, PURPOSE);
  if (!record) return fail("Please request a new OTP.");

  if (record.expiresAt.getTime() < Date.now())
    return fail("This OTP has expired. Please request a new one.");
  if (record.attempts >= MAX_ATTEMPTS)
    return fail("Too many incorrect attempts. Please request a new OTP.");

  if (!(await bcrypt.compare(otp, record.otpHash))) {
    await updateOtpAttempts(record.id, record.attempts + 1);
    return fail("Invalid or expired OTP.");
  }

  await markOtpVerified(record.id);
  return ok("OTP verified.");
}

export async function resetPassword(
  rawIdentifier: string | undefined,
  _otp: string | undefined,
  newPassword: string | undefined,
): Promise<ApiResult> {
  if (!rawIdentifier) return fail("Unable to change the password.");

  const resolved = await resolveIdentifier(rawIdentifier);
  if (!resolved) return fail("Unable to change the password.");
  const email = resolved.email;

  const record = await findLatestOtp(email, PURPOSE);
  if (!record || !record.verifiedAt)
    return fail("Please verify the OTP before changing your password.");

  if (
    record.verifiedAt.getTime() <
    Date.now() - VERIFIED_WINDOW_MINUTES * 60_000
  ) {
    return fail("This reset session has expired. Please start again.");
  }

  if (!newPassword || newPassword.length < 8)
    return fail("Password must be at least 8 characters.");

  try {
    await updatePassword(record.authUserId, newPassword);
  } catch (e) {
    console.error("Reset password failed:", (e as Error).message);
    return fail("Unable to change the password right now.");
  }

  await clearMustChangePassword(record.authUserId); // no-op when there is no user_profiles row
  await revokeTrustedDevices(record.authUserId); // admins must verify with an OTP again on every device
  await deleteOtp(record.id);

  return ok("Password changed successfully.");
}

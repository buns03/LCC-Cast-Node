import nodemailer from 'nodemailer';
import { config } from './config';

let cached: ReturnType<typeof nodemailer.createTransport> | null = null;

function createTransport() {
  if (cached) return cached;
  if (!config.mail.username || !config.mail.password) {
    throw new Error('MAIL_USERNAME / MAIL_PASSWORD are not set in .env');
  }
  // same as spring.mail.host=smtp.gmail.com, port 587, auth + starttls
  cached = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: config.mail.username, pass: config.mail.password },
  });
  return cached;
}

export async function sendHtmlMail(to: string, subject: string, html: string): Promise<void> {
  await createTransport().sendMail({
    from: `"${config.mail.fromName}" <${config.mail.username}>`,
    to,
    subject,
    html,
  });
}

/** Used by `npm run db:check` to confirm the Gmail login works. */
export async function verifyMailLogin(): Promise<void> {
  await createTransport().verify();
}

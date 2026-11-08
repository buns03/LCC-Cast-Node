/**
 * The two Thymeleaf email templates (email/election-notification.html, email/election-winners.html)
 * rebuilt as plain functions. Same HTML, same styles; th:text / th:if / th:each became ${...} and loops.
 */

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BTN = 'display:inline-block; padding:12px 20px; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px;';
const BTN_WIDE = 'display:inline-block; padding:12px 22px; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px;';

const shell = (headerRow: string, rows: string, title: string) => `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
</head>
<body style="margin:0; padding:0; background:#f4f5fb; font-family:Arial, Helvetica, sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5fb; padding:32px 0;">
    <tr>
        <td align="center">

            <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                   style="width:600px; max-width:92vw; background:#ffffff; border-radius:20px; overflow:hidden; border:1px solid #e5e7eb;">
${headerRow}
${rows}
            </table>
        </td>
    </tr>
</table>

</body>
</html>`;

const ctaButton = (href: string, label: string, style: string) => `
                <tr>
                    <td style="padding:24px 30px 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="border-radius:10px; background:#435CFF;">
                                    <a href="${esc(href)}" style="${style}">${label}</a>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>`;

const footer = (href: string, buttonLabel: string, note: string) => `
                <tr>
                    <td style="padding:28px 30px 30px;">
                        <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="border-radius:10px; background:#435CFF;">
                                    <a href="${esc(href)}" style="${BTN_WIDE}">${buttonLabel}</a>
                                </td>
                            </tr>
                        </table>
                        <p style="font-size:11px; color:#9ca3af; margin:20px 0 0;">${note}</p>
                    </td>
                </tr>`;

const card = (inner: string) => `
                <tr>
                    <td style="padding:24px 30px 0;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                               style="border:1px solid #e5e7eb; border-radius:16px;">
                            <tr>
                                <td style="padding:22px 24px;">${inner}</td>
                            </tr>
                        </table>
                    </td>
                </tr>`;

// =====================================================================
// election-notification
// =====================================================================

export interface NotificationData {
  loginUrl: string;
  categoryLabel: string;
  electionTitle: string;
  campus: string;
  schoolYear: string;
  startAt: string;
  endAt: string;
  description: string;
  isSSC: boolean;
  showGroups: boolean;
  groupNames: string[];
  departmentNames: string[];
  votingTypeLabel: string;
  isRepresentative: boolean;
  positionsWithCandidates: { name: string; candidates: { name: string; group: string; photo: string | null }[] }[];
  representativeCandidates: { name: string; photo: string | null }[];
}

const photo36 = (url: string | null) =>
  url
    ? `<td style="width:40px; padding-right:10px; vertical-align:top;">
                                                <img src="${esc(url)}" width="36" height="36"
                                                     style="width:36px; height:36px; border-radius:50%; object-fit:cover; display:block;" />
                                            </td>`
    : '';

export function renderNotification(d: NotificationData): string {
  const header = `
                <tr>
                    <td style="background:#435CFF; padding:24px 30px;" align="left">
                        <span style="font-size:20px; font-weight:700; color:#ffffff;">LCC Cast</span>
                    </td>
                </tr>`;

  const info = card(`
                                    <div style="font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:uppercase;
                                color:#435CFF; margin-bottom:8px;">${esc(d.categoryLabel)}</div>

                                    <div style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:6px;">${esc(d.electionTitle)}</div>

                                    <div style="font-size:13px; color:#6b7280; margin-bottom:16px;">
                                        <span>${esc(d.campus)}</span> &middot;
                                        School Year <span>${esc(d.schoolYear)}</span>
                                    </div>

                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td style="background:#f8f9ff; border:1px solid #e5e7eb; border-radius:10px;
                                   padding:9px 13px; font-size:12px; color:#374151;">
                                                Starts: <span>${esc(d.startAt)}</span>
                                            </td>
                                        </tr>
                                        <tr><td style="height:8px;"></td></tr>
                                        <tr>
                                            <td style="background:#f8f9ff; border:1px solid #e5e7eb; border-radius:10px;
                                   padding:9px 13px; font-size:12px; color:#374151;">
                                                Ends: <span>${esc(d.endAt)}</span>
                                            </td>
                                        </tr>
                                    </table>
`);

  const description = d.description
    ? `
                <tr>
                    <td style="padding:20px 30px 0;">
                        <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:6px;">About this election</div>
                        <p style="font-size:13px; line-height:1.6; color:#4b5563; margin:0;">${esc(d.description)}</p>
                    </td>
                </tr>`
    : '';

  const groups = d.showGroups
    ? `
                <tr>
                    <td style="padding:20px 30px 0;">
                        <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:10px;">Participating Partylists</div>
                        <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>${d.groupNames
                              .map(
                                (n) => `
                                <td style="padding:6px 12px; margin:0 6px 6px 0; display:inline-block;
                             background:#eef1ff; color:#435CFF; font-size:12px; font-weight:600;
                             border-radius:20px;">${esc(n)}</td>`,
                              )
                              .join('')}
                            </tr>
                        </table>
                    </td>
                </tr>`
    : '';

  const dept = !d.isSSC
    ? `
                <tr>
                    <td style="padding:20px 30px 0;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td style="border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px;">
                                    <div style="font-size:11px; color:#9ca3af; margin-bottom:4px;">Program / Department</div>
                                    <div style="font-size:13px; font-weight:600; color:#0f172a;">${esc(d.departmentNames.join(', '))}</div>
                                </td>
                            </tr>
                            <tr><td style="height:8px;"></td></tr>
                            <tr>
                                <td style="border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px;">
                                    <div style="font-size:11px; color:#9ca3af; margin-bottom:4px;">Election Type</div>
                                    <div style="font-size:13px; font-weight:600; color:#0f172a;">${esc(d.votingTypeLabel)}</div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>`
    : '';

  const positions = d.positionsWithCandidates.length
    ? `
                <tr>
                    <td style="padding:20px 30px 0;">
                        <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:10px;">Candidates</div>
${d.positionsWithCandidates
  .map(
    (p) => `
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                               style="border:1px solid #e5e7eb; border-radius:12px; margin-bottom:10px;">
                            <tr>
                                <td style="padding:12px 16px 4px;">
                                    <div style="font-size:11px; font-weight:700; letter-spacing:.02em; text-transform:uppercase; color:#435CFF;">${esc(p.name)}</div>
                                </td>
                            </tr>${p.candidates
                              .map(
                                (c) => `
                            <tr>
                                <td style="padding:6px 16px 12px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                        <tr>
                                            ${photo36(c.photo)}
                                            <td style="vertical-align:top;">
                                                <div style="font-size:13px; font-weight:600; color:#0f172a;">${esc(c.name)}</div>
                                                <div style="font-size:12px; color:#6b7280;">${esc(c.group)}</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>`,
                              )
                              .join('')}
                        </table>`,
  )
  .join('')}
                    </td>
                </tr>`
    : '';

  const roster =
    d.isRepresentative && d.representativeCandidates.length
      ? `
                <tr>
                    <td style="padding:20px 30px 0;">
                        <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:10px;">Candidates</div>

                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                               style="border:1px solid #e5e7eb; border-radius:12px;">${d.representativeCandidates
                                 .map((c, i, all) => {
                                   const last = i === all.length - 1;
                                   return `
                            <tr>
                                <td style="${last ? 'padding:12px 16px;' : 'padding:12px 16px; border-bottom:1px solid #e5e7eb;'}">
                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                        <tr>
                                            ${photo36(c.photo)}
                                            <td style="vertical-align:top;">
                                                <div style="font-size:13px; font-weight:600; color:#0f172a;">${esc(c.name)}</div>
                                                <div style="font-size:11px; color:#9ca3af;">Department Member</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>`;
                                 })
                                 .join('')}
                        </table>
                    </td>
                </tr>`
      : '';

  const rows =
    ctaButton(d.loginUrl, 'Login to LCC Cast to View Details', BTN) +
    info +
    description +
    groups +
    dept +
    positions +
    roster +
    footer(
      d.loginUrl,
      'Login to Vote',
      'This is an automated notification from LCC Cast. You are receiving this because you are an eligible voter for this election.',
    );

  return shell(header, rows, 'LCC Cast Election Notice');
}

// =====================================================================
// election-winners
// =====================================================================

export interface WinnersData {
  loginUrl: string;
  headerSubtitle: string;
  electionTitle: string;
  campus: string;
  schoolYear: string;
  winners: { position: string; name: string; group: string; photo: string | null; votes: number }[];
  drawPositions: string[];
}

export function renderWinners(d: WinnersData): string {
  const header = `
                <tr>
                    <td style="background:#435CFF; padding:22px 30px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td align="center" style="vertical-align:middle;">
                                    <div style="font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#ffffff;">
                                        Official Election Results
                                    </div>
                                    <div style="font-size:13px; color:#dfe3ff; margin-top:2px;">${esc(d.headerSubtitle)}</div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>`;

  // The Java context never sets "categoryLabel" for this template, so that line is empty (kept identical).
  const info = card(`
                                    <div style="font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:uppercase;
                                color:#435CFF; margin-bottom:8px;"></div>

                                    <div style="font-size:20px; font-weight:700; color:#0f172a; margin-bottom:6px;">${esc(d.electionTitle)}</div>

                                    <div style="font-size:13px; color:#6b7280;">
                                        <span>${esc(d.campus)}</span> &middot;
                                        School Year <span>${esc(d.schoolYear)}</span>
                                    </div>
`);

  const winners = d.winners.length
    ? `
                <tr>
                    <td style="padding:24px 30px 0;">
                        <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:10px;">
                            &#127942; Winners
                        </div>
${d.winners
  .map(
    (w) => `
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                               style="border:1px solid #e5e7eb; border-radius:12px; margin-bottom:10px;">
                            <tr>
                                <td style="padding:14px 16px;">
                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                        <tr>${
                                          w.photo
                                            ? `
                                            <td style="width:48px; padding-right:12px; vertical-align:top;">
                                                <img src="${esc(w.photo)}" width="44" height="44"
                                                     style="width:44px; height:44px; border-radius:10px; object-fit:cover; display:block;" />
                                            </td>`
                                            : ''
                                        }
                                            <td style="vertical-align:top;">
                                                <div style="font-size:10px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; color:#9ca3af; margin-bottom:2px;">${esc(w.position)}</div>
                                                <div style="font-size:14px; font-weight:700; color:#0f172a;">${esc(w.name)}</div>
                                                <div style="font-size:12px; color:#6b7280; margin-top:1px;">${esc(w.group)}</div>
                                                <div style="font-size:11px; color:#435CFF; font-weight:600; margin-top:3px;">${esc(`${w.votes} votes`)}</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>`,
  )
  .join('')}
                    </td>
                </tr>`
    : '';

  const draw = d.drawPositions.length
    ? `
                <tr>
                    <td style="padding:8px 30px 0;">
                        <div style="padding:14px 16px; border:1px dashed #F59E0B; background:#FFFBEB; border-radius:12px; font-size:13px; color:#92400E;">
                            <strong>No official winner yet</strong> for
                            <span>${esc(d.drawPositions.join(', '))}</span>.
                            These positions ended in a draw. A tie-break election will be scheduled and the result announced afterwards.
                        </div>
                    </td>
                </tr>`
    : '';

  const rows =
    ctaButton(d.loginUrl, 'Login to LCC Cast to View Full Results', BTN) +
    info +
    winners +
    draw +
    footer(
      d.loginUrl,
      'View Full Results',
      'This is an automated notification from LCC Cast. You are receiving this because you were an eligible voter for this election.',
    );

  return shell(header, rows, 'LCC Cast Election Results');
}

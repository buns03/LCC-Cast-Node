export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 4) return `${local[0] ?? ''}*****@${domain}`;
  return `${local.slice(0, 2)}*****${local.slice(-2)}@${domain}`;
}
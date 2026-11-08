import fs from 'fs';
import path from 'path';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Tiny replacement for Thymeleaf: reads views/<name> and swaps every {{key}}
 * with the (HTML-escaped) value. Unknown keys become empty text.
 */
export function renderView(name: string, vars: Record<string, string | number> = {}): string {
  const file = path.join(__dirname, '..', 'views', name);
  const html = fs.readFileSync(file, 'utf8');
  return html.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const value = String(vars[key] ?? '');
    return key.startsWith('html_') ? value : escapeHtml(value); // html_* keys are inserted as-is (built in code)
  });
}

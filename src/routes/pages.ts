import { Router, Request, Response } from 'express';
import { requireAny } from '../auth/guards';

export const pagesRouter = Router();

/**
 * TEMPORARY test pages - one per role, just to prove the login + role guard work.
 * Later you replace each `testPage(...)` with res.sendFile(<your real html in /views>).
 */
function testPage(title: string, expectedRole: string) {
  return (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.send(`<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1e1b4b}
 .ok{background:#e0e7ff;border-radius:12px;padding:16px 20px}
 pre{background:#f4f4f5;padding:12px;border-radius:8px;overflow:auto}
 button{padding:10px 18px;border:0;border-radius:8px;background:#4338ca;color:#fff;cursor:pointer}
</style></head><body>
<div class="ok"><h1>${title}</h1><p>Login works. Expected role: <b>${expectedRole}</b></p></div>
<h3>Session info (from /api/me)</h3>
<pre id="me">loading...</pre>
<form method="post" action="/logout"><button type="submit">Log out</button></form>
<script>
fetch('/api/me').then(r=>r.json()).then(d=>{document.getElementById('me').textContent=JSON.stringify(d,null,2)});
</script></body></html>`);
  };
}

// ---------- SUPERADMIN ----------
pagesRouter.use('/superadmin', requireAny('ROLE_SUPERADMIN'));

// ---------- ADMIN (Department) ----------
pagesRouter.use('/admin-dept', requireAny('ROLE_ADMIN_DEPARTMENT'));

// ---------- ADMIN (SSC) ----------
pagesRouter.use('/admin-ssc', requireAny('ROLE_ADMIN_SSC'));

// ---------- CANDIDATE ----------
pagesRouter.use('/candidate', requireAny('ROLE_CANDIDATE'));

// ---------- VOTER (students AND candidates) ----------
pagesRouter.use('/voter', requireAny('ROLE_STUDENT', 'ROLE_CANDIDATE'));

// ---------- who am I? (used by the test pages) ----------
pagesRouter.get('/api/me', requireAny(), (req: Request, res: Response) => {
  res.json(req.session.user);
});

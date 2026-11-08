import { config } from './config';
import cors from 'cors';
import { NextFunction, Request, Response } from 'express';

/**
 * CORS restriction. Localhost only for now.
 * To allow other origins later, set ALLOWED_ORIGINS in .env (comma separated), e.g.
 *   ALLOWED_ORIGINS=https://your-domain.com
 */
const port = config.port;


const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? `http://localhost:${port},http://127.0.0.1:${port}`)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** no Origin header = same-origin page load, curl, or the server itself: always fine */
export function isAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    return new URL(origin).host === host; // our own pages calling our own server
  } catch {
    return false;
  }
}

/** sends the CORS headers only to allowed origins (cookies/sessions allowed) */
export const corsMiddleware = (req: Request, res: Response, next: NextFunction) =>
  cors({
    origin: (origin, callback) => callback(null, isAllowed(origin, req.headers.host)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 600,
  })(req, res, next);

/**
 * CORS only stops the browser from READING a response; the request would still run.
 * This rejects any request that comes from a foreign origin before it reaches a route.
 */
export function blockForeignOrigins(req: Request, res: Response, next: NextFunction) {
  if (isAllowed(req.headers.origin, req.headers.host)) return next();

  if (req.originalUrl.includes('/api/')) {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  return res.status(403).send('Forbidden');
}
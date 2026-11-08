import { Request, Response, Router } from 'express';
import { requireAny } from '../auth/guards';
import { IllegalArgumentError } from '../errors';
import { downloadFile } from '../storage';

export const storageRouter = Router();

export async function serve(res: Response, path: string) {
  try {
    const result = await downloadFile(path);
    if (!result.body) return res.status(result.status).end();
    res.status(result.status);
    if (result.contentType) res.set('Content-Type', result.contentType);
    res.set('Cache-Control', 'private, max-age=300');
    return res.send(result.body);
  } catch (e) {
    if (e instanceof IllegalArgumentError) return res.status(400).end();
    console.error(e);
    return res.status(500).end();
  }
}

// StorageController: GET /api/storage/file?path=...   (login required, like Spring's anyRequest().authenticated())
storageRouter.get('/api/storage/file', requireAny(), (req: Request, res: Response) => {
  const path = req.query.path;
  if (typeof path !== 'string' || !path) return res.status(400).end();
  return serve(res, path);
});

// FileController: GET /files/** -> getFile(<path after /files/>). Candidate photos, posters, logos and avatars use this URL.
storageRouter.get(/^\/files\/(.+)$/, requireAny(), (req: Request, res: Response) => serve(res, String(req.params[0])));

import { Request, Response, Router } from 'express';
import * as service from '../forgotPasswordService';

export const forgotPasswordRouter = Router();

async function handle(res: Response, work: () => Promise<service.ApiResult>) {
  try {
    const result = await work();
    res.status(result.success ? 200 : 400).json(result);
  } catch (e) {
    console.error('Forgot-password error:', e);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

forgotPasswordRouter.post('/forgot-password/verify-email', (req: Request, res: Response) =>
  handle(res, () => service.verifyEmail(req.body?.email)),
);

forgotPasswordRouter.post('/forgot-password/verify-otp', (req: Request, res: Response) =>
  handle(res, () => service.verifyOtp(req.body?.email, req.body?.otp)),
);

forgotPasswordRouter.post('/forgot-password/reset', (req: Request, res: Response) =>
  handle(res, () => service.resetPassword(req.body?.email, req.body?.otp, req.body?.newPassword)),
);

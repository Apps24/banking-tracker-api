import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { responseHelper } from "../utils/responseHelper";

/**
 * requireAuth
 *
 * Validates the Bearer token by calling Better Auth's session API directly
 * (no HTTP round-trip — reads from the Neon DB via Prisma).
 *
 * On success, attaches `req.userId` and `req.user` for downstream handlers.
 * Returns 401 on missing/invalid/expired tokens.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      responseHelper.error(res, "Unauthorized", 401);
      return;
    }

    req.userId = session.user.id;
    req.user = session.user as any;
    next();
  } catch {
    responseHelper.error(res, "Unauthorized", 401);
  }
};

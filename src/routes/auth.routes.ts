import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { prisma } from "../config/database";
import { responseHelper } from "../utils/responseHelper";

const router = Router();

// GET /api/v1/auth/me — return full profile from our DB
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, phone: true, avatar: true, createdAt: true },
    });
    if (!user) {
      responseHelper.error(res, "User not found", 404);
      return;
    }
    responseHelper.success(res, user);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/auth/profile — update phone + avatar
router.patch("/profile", requireAuth, async (req, res, next) => {
  try {
    const { phone, avatar } = req.body as { phone?: string; avatar?: string };
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(phone !== undefined && { phone }),
        ...(avatar !== undefined && { avatar }),
      },
      select: { id: true, name: true, email: true, phone: true, avatar: true, updatedAt: true },
    });
    responseHelper.success(res, updated, "Profile updated");
  } catch (err) {
    next(err);
  }
});

export default router;

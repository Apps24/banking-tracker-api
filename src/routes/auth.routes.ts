import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth.middleware";
import { prisma } from "../config/database";
import { responseHelper } from "../utils/responseHelper";

const router = Router();

const updateProfileSchema = z.object({
  phone:  z.string().max(20).regex(/^[\d\s\-\+\(\)]+$/, "Invalid phone number").optional(),
  avatar: z.string().url("Must be a valid URL").max(2048).optional(),
});

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
    const { phone, avatar } = updateProfileSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(phone  !== undefined && { phone }),
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

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { responseHelper } from "../utils/responseHelper";

export const validate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field: e.path.join("."),
        message: String(e.message),
      }));
      responseHelper.error(res, "Validation failed", 400, errors);
      return;
    }
    req.body = result.data;
    next();
  };

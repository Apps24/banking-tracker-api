import type { Response } from "express";

export const responseHelper = {
  success(
    res: Response,
    data: unknown,
    message = "Success",
    statusCode = 200,
  ) {
    return res.status(statusCode).json({ success: true, message, data });
  },

  paginated(
    res: Response,
    data: unknown,
    pagination: { page: number; limit: number; total: number },
    message = "Success",
  ) {
    const { page, limit, total } = pagination;
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  },

  error(
    res: Response,
    message: string,
    statusCode = 400,
    errors?: unknown,
  ) {
    return res.status(statusCode).json({
      success: false,
      message,
      ...(errors !== undefined && { errors }),
    });
  },
};

import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../config/database";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,    // 30 days
    updateAge: 60 * 60 * 24,          // refresh if older than 1 day
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    additionalFields: {
      phone: { type: "string", required: false },
      avatar: { type: "string", required: false },
    },
  },
  plugins: [bearer()],
  trustedOrigins: process.env.ALLOWED_ORIGINS?.split(",") ?? [],
  advanced: {
    cookiePrefix: "bt",
    generateId: () => crypto.randomUUID(),
    disableCSRFCheck: true,  // Mobile API — requests have no Origin header, no browser CSRF risk
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

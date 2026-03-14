import "dotenv/config";

const required = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "BETTER_AUTH_SECRET", // signing secret for Better Auth sessions
  "BETTER_AUTH_URL",    // public base URL of this Express server (used by Better Auth for cookie domain)
  "ALLOWED_ORIGINS",
  "BCRYPT_ROUNDS",
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED!,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
  PORT: parseInt(process.env.PORT ?? "3000", 10),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS!.split(","),
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS!, 10),
};

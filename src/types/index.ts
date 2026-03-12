// Minimal user shape returned by Better Auth's getSession() call
interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  phone?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      userId: string;
      user: AuthUser;
      requestId: string;
    }
  }
}

export {};

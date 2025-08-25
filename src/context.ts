import type { inferAsyncReturnType } from '@trpc/server';
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';

/** Build per-request context (e.g., auth, db handles, request info) */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  // Example: super light auth via header (replace with real auth)
  const authHeader = req.headers['authorization'];
  const user =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? { id: 'user_123', role: 'user' as const }
      : null;

  return { req, res, user };
}

export type Context = inferAsyncReturnType<typeof createContext>;

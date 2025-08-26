// src/server/trpc/context.ts
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { prisma } from "./lib/prisma.js";
import { verifyCustomAuthCookie } from "./lib/auth.js";
import cookie from "cookie";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const cookies = cookie.parse(req.headers.cookie ?? "");

  // Only use custom auth cookie
  const custom = verifyCustomAuthCookie(cookies["auth_token"]);
  if (custom) {
    return { db: prisma, session: { user: { id: custom.userId } } as any, req, res, cookies };
  }

  return { db: prisma, session: null, req, res, cookies };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

// src/server/trpc/context.ts
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { prisma } from "./lib/prisma.js";

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const session = (req as any).auth ?? null;
  
  return { db: prisma, session, req, res };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

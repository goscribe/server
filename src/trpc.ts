import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

/** Middleware that enforces authentication */
const isAuthed = middleware(({ ctx, next }) => {
  const hasUser = Boolean((ctx.session as any)?.user?.id);
  if (!ctx.session || !hasUser) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      session: ctx.session,
    },
  });
});

/** Exported authed procedure */
export const authedProcedure = publicProcedure.use(isAuthed);

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

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
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      // refine ctx: session is guaranteed, user.id is string
      session: {
        ...ctx.session,
        user: {
          ...ctx.session.user,
          id: ctx.session.user.id, // typed non-null
        },
      },
    },
  });
});

/** Exported authed procedure */
export const authedProcedure = publicProcedure.use(isAuthed);

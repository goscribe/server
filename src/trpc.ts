import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";
import { logger } from "./lib/logger.js";
import { toTRPCError } from "./lib/errors.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Log errors in development
    if (process.env.NODE_ENV === 'development') {
      logger.error('TRPC Error', 'TRPC', {
        code: error.code,
        message: error.message,
        cause: error.cause,
      });
    }
    
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error ? error.cause.message : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

/**
 * Logging middleware
 */
const loggingMiddleware = middleware(async ({ ctx, next, path, type }) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  
  logger.info(`TRPC ${type} ${path}`, 'TRPC', {
    duration: `${duration}ms`,
    userId: (ctx.session as any)?.user?.id,
  });
  
  return result;
});

/**
 * Middleware that enforces authentication
 */
const isAuthed = middleware(({ ctx, next }) => {
  const hasUser = Boolean((ctx.session as any)?.user?.id);
  if (!ctx.session || !hasUser) {
    throw new TRPCError({ 
      code: "UNAUTHORIZED",
      message: "You must be logged in to access this resource"
    });
  }

  return next({
    ctx: {
      session: ctx.session,
      userId: (ctx.session as any).user.id,
    },
  });
});

/**
 * Error handling middleware
 */
const errorHandler = middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toTRPCError(error);
  }
});

/** Exported procedures with middleware */
export const authedProcedure = publicProcedure
  .use(loggingMiddleware)
  .use(errorHandler)
  .use(isAuthed);

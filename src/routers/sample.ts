import { z } from 'zod';
import { router, publicProcedure, authedProcedure } from '../trpc';

export const sampleRouter = router({
  // GET-like: query without input
  hello: publicProcedure.query(() => {
    return { message: 'Hello from tRPC + Express 👋' };
  }),

  // Mutation with Zod input
  echo: publicProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(({ input }) => {
      return { echoed: input.text };
    }),

  // Authed query
  me: authedProcedure.query(({ ctx }) => {
    return { userId: ctx.user.id, role: ctx.user.role };
  }),
});

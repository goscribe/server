import { z } from 'zod';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import bcrypt from 'bcryptjs';

export const auth = router({
signup: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.user.findUnique({
        where: { email: input.email },
      });
      if (existing) {
        throw new Error("Email already registered");
      }

      const hash = await bcrypt.hash(input.password, 10);

      const user = await ctx.db.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: hash,
          emailVerified: new Date(), // skip verification for demo
        },
      });

      return { id: user.id, email: user.email, name: user.name };
    }),
});


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
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { email: input.email },
      });
      if (!user) {
        throw new Error("Invalid credentials");
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash!);
      if (!valid) {
        throw new Error("Invalid credentials");
      }

      return { id: user.id, email: user.email, name: user.name };
    }),
  getSession: publicProcedure.query(async ({ ctx }) => {
    const session = await ctx.db.session.findUnique({
      where: {
        id: ctx.session?.id,
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.expires < new Date()) {
      throw new Error("Session expired");
    }

    const user = await ctx.db.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return { id: session.id, userId: session.userId, user: { id: user.id, email: user.email, name: user.name } };
  }),
});


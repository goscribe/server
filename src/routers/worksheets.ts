import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';

// Avoid importing Prisma enums directly; mirror values as string literals
const ArtifactType = {
  WORKSHEET: 'WORKSHEET',
} as const;

const Difficulty = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
} as const;

export const worksheets = router({
  // List all worksheet artifacts for a workspace
  listSets: authedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.artifact.findMany({
        where: { workspaceId: input.workspaceId, type: ArtifactType.WORKSHEET },
        orderBy: { updatedAt: 'desc' },
      });
    }),

  // Create a worksheet set
  createSet: authedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), title: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.artifact.create({
        data: {
          workspaceId: input.workspaceId,
          type: ArtifactType.WORKSHEET,
          title: input.title,
          createdById: ctx.session.user.id,
        },
      });
    }),

  // Get a worksheet with its questions
  getSet: authedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const set = await ctx.db.artifact.findFirst({
        where: {
          id: input.setId,
          type: ArtifactType.WORKSHEET,
          workspace: { ownerId: ctx.session.user.id },
        },
        include: { questions: true },
      });
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });
      return set;
    }),

  // Add a question to a worksheet
  createQuestion: authedProcedure
    .input(z.object({
      setId: z.string().uuid(),
      prompt: z.string().min(1),
      answer: z.string().optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      order: z.number().int().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await ctx.db.artifact.findFirst({
        where: { id: input.setId, type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } },
      });
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.worksheetQuestion.create({
        data: {
          artifactId: input.setId,
          prompt: input.prompt,
          answer: input.answer,
          difficulty: (input.difficulty ?? Difficulty.MEDIUM) as any,
          order: input.order ?? 0,
          meta: input.meta as any,
        },
      });
    }),

  // Update a question
  updateQuestion: authedProcedure
    .input(z.object({
      questionId: z.string().uuid(),
      prompt: z.string().optional(),
      answer: z.string().optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      order: z.number().int().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const q = await ctx.db.worksheetQuestion.findFirst({
        where: { id: input.questionId, artifact: { type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } } },
      });
      if (!q) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.worksheetQuestion.update({
        where: { id: input.questionId },
        data: {
          prompt: input.prompt ?? q.prompt,
          answer: input.answer ?? q.answer,
          difficulty: (input.difficulty ?? q.difficulty) as any,
          order: input.order ?? q.order,
          meta: (input.meta ?? q.meta) as any,
        },
      });
    }),

  // Delete a question
  deleteQuestion: authedProcedure
    .input(z.object({ questionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const q = await ctx.db.worksheetQuestion.findFirst({
        where: { id: input.questionId, artifact: { workspace: { ownerId: ctx.session.user.id } } },
      });
      if (!q) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.worksheetQuestion.delete({ where: { id: input.questionId } });
      return true;
    }),

  // Delete a worksheet set and its questions
  deleteSet: authedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db.artifact.deleteMany({
        where: { id: input.setId, type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } },
      });
      if (deleted.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return true;
    }),
});



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

const QuestionType = {
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  TEXT: 'TEXT',
  NUMERIC: 'NUMERIC',
  TRUE_FALSE: 'TRUE_FALSE',
  MATCHING: 'MATCHING',
  FILL_IN_THE_BLANK: 'FILL_IN_THE_BLANK',
} as const;

export const worksheets = router({
  // List all worksheet artifacts for a workspace
  list: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const worksheets = await ctx.db.artifact.findMany({
        where: { workspaceId: input.workspaceId, type: ArtifactType.WORKSHEET },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1, // Get only the latest version
          },
          questions: true,
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!worksheets) throw new TRPCError({ code: 'NOT_FOUND' });

      // Merge per-user progress into question.meta for compatibility with UI
      const allQuestionIds = worksheets.flatMap(w => w.questions.map(q => q.id));
      if (allQuestionIds.length === 0) return worksheets;

      const progress = await ctx.db.worksheetQuestionProgress.findMany({
        where: { userId: ctx.session.user.id, worksheetQuestionId: { in: allQuestionIds } },
      });
      const progressByQuestionId = new Map(progress.map(p => [p.worksheetQuestionId, p]));

      const merged = worksheets.map(w => ({
        ...w,
        questions: w.questions.map(q => {
          const p = progressByQuestionId.get(q.id);
          if (!p) return q;
          const existingMeta = q.meta ? (typeof q.meta === 'object' ? q.meta : JSON.parse(q.meta as any)) : {} as any;
          return {
            ...q,
            meta: {
              ...existingMeta,
              completed: p.completed,
              userAnswer: p.userAnswer,
              completedAt: p.completedAt,
            },
          } as typeof q;
        }),
      }));

      return merged as any;
    }),

  // Create a worksheet set
  create: authedProcedure
    .input(z.object({ 
      workspaceId: z.string(), 
      title: z.string().min(1).max(120),
      description: z.string().optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      estimatedTime: z.string().optional(),
      problems: z.array(z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
        type: z.enum(['MULTIPLE_CHOICE', 'TEXT', 'NUMERIC', 'TRUE_FALSE', 'MATCHING', 'FILL_IN_THE_BLANK']).default('TEXT'),
        options: z.array(z.string()).optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

      const { problems, ...worksheetData } = input;

      return ctx.db.artifact.create({
        data: {
          workspaceId: input.workspaceId,
          type: ArtifactType.WORKSHEET,
          title: input.title,
          difficulty: input.difficulty as any,
          estimatedTime: input.estimatedTime,
          createdById: ctx.session.user.id,
          questions: problems ? {
            create: problems.map((problem, index) => ({
              prompt: problem.question,
              answer: problem.answer,
              type: problem.type as any,
              order: index,
              meta: problem.options ? { options: problem.options } : undefined,
            })),
          } : undefined,
        },
        include: {
          questions: true,
        },
      });
    }),

  // Get a worksheet with its questions
  get: authedProcedure
    .input(z.object({ worksheetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const worksheet = await ctx.db.artifact.findFirst({
        where: {
          id: input.worksheetId,
          type: ArtifactType.WORKSHEET,
          workspace: { ownerId: ctx.session.user.id },
        },
        include: { questions: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (!worksheet) throw new TRPCError({ code: 'NOT_FOUND' });

      // Merge per-user progress into question.meta for compatibility with UI
      const questionIds = worksheet.questions.map(q => q.id);
      if (questionIds.length === 0) return worksheet;
      const progress = await ctx.db.worksheetQuestionProgress.findMany({
        where: { userId: ctx.session.user.id, worksheetQuestionId: { in: questionIds } },
      });
      const progressByQuestionId = new Map(progress.map(p => [p.worksheetQuestionId, p]));

      const merged = {
        ...worksheet,
        questions: worksheet.questions.map(q => {
          const p = progressByQuestionId.get(q.id);
          if (!p) return q;
          const existingMeta = q.meta ? (typeof q.meta === 'object' ? q.meta : JSON.parse(q.meta as any)) : {} as any;
          return {
            ...q,
            meta: {
              ...existingMeta,
              completed: p.completed,
              userAnswer: p.userAnswer,
              completedAt: p.completedAt,
            },
          } as typeof q;
        }),
      };

      return merged as any;
    }),

  // Add a question to a worksheet
  createWorksheetQuestion: authedProcedure
    .input(z.object({
      worksheetId: z.string(),
      prompt: z.string().min(1),
      answer: z.string().optional(),
      type: z.enum(['MULTIPLE_CHOICE', 'TEXT', 'NUMERIC', 'TRUE_FALSE', 'MATCHING', 'FILL_IN_THE_BLANK']).optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      order: z.number().int().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const worksheet = await ctx.db.artifact.findFirst({
        where: { id: input.worksheetId, type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } },
      });
      if (!worksheet) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.worksheetQuestion.create({
        data: {
          artifactId: input.worksheetId,
          prompt: input.prompt,
          answer: input.answer,
          type: (input.type ?? QuestionType.TEXT) as any,
          difficulty: (input.difficulty ?? Difficulty.MEDIUM) as any,
          order: input.order ?? 0,
          meta: input.meta as any,
        },
      });
    }),

  // Update a question
  updateWorksheetQuestion: authedProcedure
    .input(z.object({
      worksheetQuestionId: z.string(),
      prompt: z.string().optional(),
      answer: z.string().optional(),
      type: z.enum(['MULTIPLE_CHOICE', 'TEXT', 'NUMERIC', 'TRUE_FALSE', 'MATCHING', 'FILL_IN_THE_BLANK']).optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      order: z.number().int().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const q = await ctx.db.worksheetQuestion.findFirst({
        where: { id: input.worksheetQuestionId, artifact: { type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } } },
      });
      if (!q) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.worksheetQuestion.update({
        where: { id: input.worksheetQuestionId },
        data: {
          prompt: input.prompt ?? q.prompt,
          answer: input.answer ?? q.answer,
          type: (input.type ?? q.type) as any,
          difficulty: (input.difficulty ?? q.difficulty) as any,
          order: input.order ?? q.order,
          meta: (input.meta ?? q.meta) as any,
        },
      });
    }),

  // Delete a question
  deleteWorksheetQuestion: authedProcedure
    .input(z.object({ worksheetQuestionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const q = await ctx.db.worksheetQuestion.findFirst({
        where: { id: input.worksheetQuestionId, artifact: { workspace: { ownerId: ctx.session.user.id } } },
      });
      if (!q) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.worksheetQuestion.delete({ where: { id: input.worksheetQuestionId } });
      return true;
    }),

  // Update problem completion status
  updateProblemStatus: authedProcedure
    .input(z.object({
      problemId: z.string(),
      completed: z.boolean(),
      answer: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify question ownership through worksheet
      const question = await ctx.db.worksheetQuestion.findFirst({
        where: {
          id: input.problemId,
          artifact: {
            type: ArtifactType.WORKSHEET,
            workspace: { ownerId: ctx.session.user.id },
          },
        },
      });
      if (!question) throw new TRPCError({ code: 'NOT_FOUND' });

      // Upsert per-user progress row
      const progress = await ctx.db.worksheetQuestionProgress.upsert({
        where: {
          worksheetQuestionId_userId: {
            worksheetQuestionId: input.problemId,
            userId: ctx.session.user.id,
          },
        },
        create: {
          worksheetQuestionId: input.problemId,
          userId: ctx.session.user.id,
          completed: input.completed,
          userAnswer: input.answer,
          completedAt: input.completed ? new Date() : null,
          attempts: 1,
        },
        update: {
          completed: input.completed,
          userAnswer: input.answer,
          completedAt: input.completed ? new Date() : null,
          attempts: { increment: 1 },
        },
      });

      return progress;
    }),

  // Get current user's progress for all questions in a worksheet
  getProgress: authedProcedure
    .input(z.object({ worksheetId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify worksheet ownership
      const worksheet = await ctx.db.artifact.findFirst({
        where: {
          id: input.worksheetId,
          type: ArtifactType.WORKSHEET,
          workspace: { ownerId: ctx.session.user.id },
        },
      });
      if (!worksheet) throw new TRPCError({ code: 'NOT_FOUND' });

      const questions = await ctx.db.worksheetQuestion.findMany({
        where: { artifactId: input.worksheetId },
        select: { id: true },
      });
      const questionIds = questions.map(q => q.id);

      const progress = await ctx.db.worksheetQuestionProgress.findMany({
        where: {
          userId: ctx.session.user.id,
          worksheetQuestionId: { in: questionIds },
        },
      });

      return progress;
    }),

  // Update a worksheet
  update: authedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).max(120).optional(),
      description: z.string().optional(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
      estimatedTime: z.string().optional(),
      problems: z.array(z.object({
        id: z.string().optional(),
        question: z.string().min(1),
        answer: z.string().min(1),
        type: z.enum(['MULTIPLE_CHOICE', 'TEXT', 'NUMERIC', 'TRUE_FALSE', 'MATCHING', 'FILL_IN_THE_BLANK']).default('TEXT'),
        options: z.array(z.string()).optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, problems, ...updateData } = input;
      
      // Verify worksheet ownership
      const existingWorksheet = await ctx.db.artifact.findFirst({
        where: {
          id,
          type: ArtifactType.WORKSHEET,
          workspace: { ownerId: ctx.session.user.id },
        },
      });
      if (!existingWorksheet) throw new TRPCError({ code: 'NOT_FOUND' });

      // Handle questions update if provided
      if (problems) {
        // Delete existing questions and create new ones
        await ctx.db.worksheetQuestion.deleteMany({
          where: { artifactId: id },
        });

        await ctx.db.worksheetQuestion.createMany({
          data: problems.map((problem, index) => ({
            artifactId: id,
            prompt: problem.question,
            answer: problem.answer,
            type: problem.type as any,
            order: index,
            meta: problem.options ? { options: problem.options } : undefined,
          })),
        });
      }

      // Process update data
      const processedUpdateData = {
        ...updateData,
        difficulty: updateData.difficulty as any,
      };

      return ctx.db.artifact.update({
        where: { id },
        data: processedUpdateData,
        include: {
          questions: {
            orderBy: { order: 'asc' },
          },
        },
      });
    }),

  // Delete a worksheet set and its questions
  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db.artifact.deleteMany({
        where: { id: input.id, type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } },
      });
      if (deleted.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return true;
    }),
});



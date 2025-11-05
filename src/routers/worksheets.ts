import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { aiSessionService } from '../lib/ai-session.js';
import PusherService from '../lib/pusher.js';
import { logger } from '../lib/logger.js';

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
          const progressMeta = p.meta ? (typeof p.meta === 'object' ? p.meta : JSON.parse(p.meta as any)) : {} as any;
          return {
            ...q,
            meta: {
              ...existingMeta,
              completed: p.modified,
              userAnswer: p.userAnswer,
              completedAt: p.completedAt,
              userMarkScheme: progressMeta.userMarkScheme,
            },
          } as typeof q;
        }),
      }));

      return merged;
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
          const progressMeta = p.meta ? (typeof p.meta === 'object' ? p.meta : JSON.parse(p.meta as any)) : {} as any;
          return {
            ...q,
            meta: {
              ...existingMeta,
              completed: p.modified,
              userAnswer: p.userAnswer,
              completedAt: p.completedAt,
              userMarkScheme: progressMeta.userMarkScheme,
            },
          } as typeof q;
        }),
      };

      return merged;
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
      correct: z.boolean().optional(),
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
          modified: input.completed,
          userAnswer: input.answer,
          correct: input.correct,
          completedAt: input.completed ? new Date() : null,
          attempts: 1,
        },
        update: {
          modified: input.completed,
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

  // Generate a worksheet from a user prompt
  generateFromPrompt: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      prompt: z.string().min(1),
      numQuestions: z.number().int().min(1).max(20).default(8),
      difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
      title: z.string().optional(),
      estimatedTime: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({ where: { id: input.workspaceId, ownerId: ctx.session.user.id } });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

      const artifact = await ctx.db.artifact.create({
        data: {
          workspaceId: input.workspaceId,
          type: ArtifactType.WORKSHEET,
          title: input.title || `Worksheet - ${new Date().toLocaleString()}`,
          createdById: ctx.session.user.id,
          difficulty: (input.difficulty.toUpperCase()) as any,
          estimatedTime: input.estimatedTime,
          generating: true,
          generatingMetadata: { quantity: input.numQuestions, difficulty: input.difficulty.toLowerCase() },
        },
      });
      await PusherService.emitTaskComplete(input.workspaceId, 'worksheet_info', { contentLength: input.numQuestions });
      try {
      
      const content = await aiSessionService.generateWorksheetQuestions(input.workspaceId, ctx.session.user.id, input.numQuestions, input.difficulty as any);
      try {
        const worksheetData = JSON.parse(content);
        let actualWorksheetData = worksheetData;
        if (worksheetData.last_response) {
          try { actualWorksheetData = JSON.parse(worksheetData.last_response); } catch {}
        }
        const problems = actualWorksheetData.problems || actualWorksheetData.questions || actualWorksheetData || [];
        for (let i = 0; i < Math.min(problems.length, input.numQuestions); i++) {
          const problem = problems[i];
          const prompt = problem.question || problem.prompt || `Question ${i + 1}`;
          const answer = problem.answer || problem.solution || `Answer ${i + 1}`;
          const type = problem.type || 'TEXT';
          const options = problem.options || [];

          await ctx.db.worksheetQuestion.create({
            data: {
              artifactId: artifact.id,
              prompt,
              answer,
              difficulty: (input.difficulty.toUpperCase()) as any,
              order: i,
              meta: { 
                type,
                options: options.length > 0 ? options : undefined,
                mark_scheme: problem.mark_scheme || undefined,
              },
            },
          });
        }
      } catch {
        logger.error('Failed to parse worksheet JSON,');
        await ctx.db.artifact.delete({
          where: { id: artifact.id },
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse worksheet JSON' });
      }

      await ctx.db.artifact.update({
        where: { id: artifact.id },
        data: { generating: false },
      });

      await PusherService.emitWorksheetComplete(input.workspaceId, artifact);
    } catch (error) {
      await ctx.db.artifact.delete({
        where: { id: artifact.id },
      });
      await PusherService.emitError(input.workspaceId, `Failed to generate worksheet: ${error instanceof Error ? error.message : 'Unknown error'}`, 'worksheet_generation');
      throw error;
    }

      return { artifact };
    }),
    checkAnswer: authedProcedure
    .input(z.object({
      worksheetId: z.string(),
      questionId: z.string(),
      answer: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const worksheet = await ctx.db.artifact.findFirst({ where: { id: input.worksheetId, type: ArtifactType.WORKSHEET, workspace: { ownerId: ctx.session.user.id } }, include: { workspace: true } });
      if (!worksheet) throw new TRPCError({ code: 'NOT_FOUND' });
      const question = await ctx.db.worksheetQuestion.findFirst({ where: { id: input.questionId, artifactId: input.worksheetId } });
      if (!question) throw new TRPCError({ code: 'NOT_FOUND' });
      
      // Parse question meta to get mark_scheme
      const questionMeta = question.meta ? (typeof question.meta === 'object' ? question.meta : JSON.parse(question.meta as any)) : {} as any;
      const markScheme = questionMeta.mark_scheme;

      let isCorrect = false;
      let userMarkScheme = null;

      // If mark scheme exists, use AI marking
      if (markScheme && markScheme.points && markScheme.points.length > 0) {
        try {
          userMarkScheme = await aiSessionService.checkWorksheetQuestions(
            worksheet.workspace.id,
            ctx.session.user.id,
            question.prompt,
            input.answer,
            markScheme
          );
          
          // Determine if correct by comparing achieved points vs total points
          const achievedTotal = userMarkScheme.points.reduce((sum: number, p: any) => sum + (p.achievedPoints || 0), 0);
          isCorrect = achievedTotal === markScheme.totalPoints;
          
        } catch (error) {
          logger.error('Failed to check answer with AI', error instanceof Error ? error.message : 'Unknown error');
          // Fallback to simple string comparison
          isCorrect = question.answer === input.answer;
        }
      } else {
        // Simple string comparison if no mark scheme
        isCorrect = question.answer === input.answer;
      }


      
      // @todo: figure out this wierd fix
      const progress = await ctx.db.worksheetQuestionProgress.upsert({
        where: {
          worksheetQuestionId_userId: {
            worksheetQuestionId: input.questionId,
            userId: ctx.session.user.id,
          },
        },
        create: {
          worksheetQuestionId: input.questionId,
          userId: ctx.session.user.id,
          modified: true,
          userAnswer: input.answer,
          correct: isCorrect,
          completedAt: new Date(),
          attempts: 1,
          meta: userMarkScheme ? { userMarkScheme: JSON.parse(JSON.stringify(userMarkScheme)) } : { userMarkScheme: null },
        },
        update: {
          modified: true,
          userAnswer: input.answer,
          correct: isCorrect,
          completedAt: new Date(),
          attempts: { increment: 1 },
          meta: userMarkScheme
            ? { userMarkScheme: JSON.parse(JSON.stringify(userMarkScheme)) }
            : { userMarkScheme: null },
        },
      });

      return { isCorrect, userMarkScheme, progress };
    }),
  });



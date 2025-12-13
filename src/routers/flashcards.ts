import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import createInferenceService from '../lib/inference.js';
import { aiSessionService } from '../lib/ai-session.js';
import PusherService from '../lib/pusher.js';
import { createFlashcardProgressService } from '../services/flashcard-progress.service.js';
// Prisma enum values mapped manually to avoid type import issues in ESM
const ArtifactType = {
  STUDY_GUIDE: 'STUDY_GUIDE',
  FLASHCARD_SET: 'FLASHCARD_SET',
  WORKSHEET: 'WORKSHEET',
  MEETING_SUMMARY: 'MEETING_SUMMARY',
  PODCAST_EPISODE: 'PODCAST_EPISODE',
} as const;

export const flashcards = router({
  listSets: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.artifact.findMany({
        where: { workspaceId: input.workspaceId, type: ArtifactType.FLASHCARD_SET },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1, // Get only the latest version
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }),
  listCards: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const set = await ctx.db.artifact.findFirst({
        where: { workspaceId: input.workspaceId, type: ArtifactType.FLASHCARD_SET, workspace: { ownerId: ctx.session.user.id } },
        include: {
          flashcards: {
            include: {
              progress: {
                where: {
                  userId: ctx.session.user.id,
                },
              },
            }
          },

        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });
      return set.flashcards;
    }),
  isGenerating: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const artifact = await ctx.db.artifact.findFirst({
        where: { workspaceId: input.workspaceId, type: ArtifactType.FLASHCARD_SET, workspace: { ownerId: ctx.session.user.id } }, orderBy: { updatedAt: 'desc' },
      });
      return artifact?.generating;
    }),
  createCard: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      front: z.string().min(1),
      back: z.string().min(1),
      tags: z.array(z.string()).optional(),
      order: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await ctx.db.artifact.findFirst({
        where: { type: ArtifactType.FLASHCARD_SET, workspace: {
          id: input.workspaceId,
        } },
        include: {
          flashcards: true,
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.flashcard.create({
        data: {
          artifactId: set.id,
          front: input.front,
          back: input.back,
          tags: input.tags ?? [],
          order: input.order ?? 0,
        },
      });
    }),

  updateCard: authedProcedure
    .input(z.object({
      cardId: z.string(),
      front: z.string().optional(),
      back: z.string().optional(),
      tags: z.array(z.string()).optional(),
      order: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const card = await ctx.db.flashcard.findFirst({
        where: { id: input.cardId, artifact: { type: ArtifactType.FLASHCARD_SET, workspace: { ownerId: ctx.session.user.id } } },
      });
      if (!card) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.flashcard.update({
        where: { id: input.cardId },
        data: {
          front: input.front ?? card.front,
          back: input.back ?? card.back,
          tags: input.tags ?? card.tags,
          order: input.order ?? card.order,
        },
      });
    }),

  deleteCard: authedProcedure
    .input(z.object({ cardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const card = await ctx.db.flashcard.findFirst({
        where: { id: input.cardId, artifact: { workspace: { ownerId: ctx.session.user.id } } },
      });
      if (!card) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.flashcard.delete({ where: { id: input.cardId } });
      return true;
    }),

  deleteSet: authedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db.artifact.deleteMany({
        where: { id: input.setId, type: ArtifactType.FLASHCARD_SET, workspace: { ownerId: ctx.session.user.id } },
      });
      if (deleted.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return true;
    }),

  // Generate a flashcard set from a user prompt
  generateFromPrompt: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      prompt: z.string().min(1),
      numCards: z.number().int().min(1).max(50).default(10),
      difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
      title: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify workspace ownership
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

      const flashcardCurrent = await ctx.db.artifact.findFirst({
        where: {
          workspaceId: input.workspaceId,
          type: ArtifactType.FLASHCARD_SET,
        },
        select: {
          id: true,
          flashcards: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      try {
      await ctx.db.artifact.update({
        where: { id: flashcardCurrent?.id },
        data: { generating: true, generatingMetadata: { quantity: input.numCards, difficulty: input.difficulty.toLowerCase() } },
      });

      await PusherService.emitTaskComplete(input.workspaceId, 'flash_card_info', { status: 'generating', numCards: input.numCards, difficulty: input.difficulty });

      const artifact = await ctx.db.artifact.create({
        data: {
          workspaceId: input.workspaceId,
          type: ArtifactType.FLASHCARD_SET,
          title: input.title || `Flashcards - ${new Date().toLocaleString()}`,
          createdById: ctx.session.user.id,
          flashcards: {
            create: flashcardCurrent?.flashcards.map((card) => ({
              front: card.front,
              back: card.back,
            })),
          },
        },
      });
      
      const currentCards = flashcardCurrent?.flashcards.length || 0;
      const newCards = input.numCards - currentCards;


      // Generate
      const content = await aiSessionService.generateFlashcardQuestions(input.workspaceId, ctx.session.user.id, input.numCards, input.difficulty);

      let createdCards = 0;
      try {
        const flashcardData: any = content;
        for (let i = 0; i < Math.min(flashcardData.length, input.numCards); i++) {
          const card = flashcardData[i];
          const front = card.term || card.front || card.question || card.prompt || `Question ${i + 1}`;
          const back = card.definition || card.back || card.answer || card.solution || `Answer ${i + 1}`;
          await ctx.db.flashcard.create({
            data: {
              artifactId: artifact.id,
              front,
              back,
              order: i,
              tags: input.tags ?? ['ai-generated', input.difficulty],
            },
          });
          createdCards++;
        }
      } catch {
        // Fallback to text parsing if JSON fails
        const lines = content.split('\n').filter(line => line.trim());
        for (let i = 0; i < Math.min(lines.length, input.numCards); i++) {
          const line = lines[i];
          if (line.includes(' - ')) {
            const [front, back] = line.split(' - ');
            await ctx.db.flashcard.create({
              data: {
                artifactId: artifact.id,
                front: front.trim(),
                back: back.trim(),
                order: i,
                tags: input.tags ?? ['ai-generated', input.difficulty],
              },
            });
            createdCards++;
          }
        }
      }

      // Pusher complete
      await PusherService.emitFlashcardComplete(input.workspaceId, artifact);

      return { artifact, createdCards };

    } catch (error) {
      await ctx.db.artifact.update({ where: { id: flashcardCurrent?.id }, data: { generating: false } });
      await PusherService.emitError(input.workspaceId, `Failed to generate flashcards: ${error}`, 'flash_card_generation');
      throw error;
    }
    }),

  // Record study attempt
  recordStudyAttempt: authedProcedure
    .input(z.object({
      flashcardId: z.string().cuid(),
      isCorrect: z.boolean(),
      confidence: z.enum(['easy', 'medium', 'hard']).optional(),
      timeSpentMs: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const service = createFlashcardProgressService(ctx.db);
      return service.recordStudyAttempt({
        userId: ctx.userId,
        ...input,
      });
    }),

  // Get progress for a flashcard set
  getSetProgress: authedProcedure
    .input(z.object({ artifactId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const service = createFlashcardProgressService(ctx.db);
      return service.getSetProgress(ctx.userId, input.artifactId);
    }),

  // Get flashcards due for review
  getDueFlashcards: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const service = createFlashcardProgressService(ctx.db);

      return service.getDueFlashcards(ctx.userId, input.workspaceId);
    }),

  // Get statistics for a flashcard set
  getSetStatistics: authedProcedure
    .input(z.object({ artifactId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const service = createFlashcardProgressService(ctx.db);
      return service.getSetStatistics(ctx.userId, input.artifactId);
    }),

  // Reset progress for a flashcard
  resetProgress: authedProcedure
    .input(z.object({ flashcardId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = createFlashcardProgressService(ctx.db);
      return service.resetProgress(ctx.userId, input.flashcardId);
    }),

  // Bulk record study session
  recordStudySession: authedProcedure
    .input(z.object({
      attempts: z.array(z.object({
        flashcardId: z.string().cuid(),
        isCorrect: z.boolean(),
        confidence: z.enum(['easy', 'medium', 'hard']).optional(),
        timeSpentMs: z.number().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const service = createFlashcardProgressService(ctx.db);
      return service.recordStudySession({
        userId: ctx.userId,
        ...input,
      });
    }),
});



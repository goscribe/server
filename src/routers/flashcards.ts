import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import createInferenceService from '../lib/inference.js';
import { aiSessionService } from '../lib/ai-session.js';
import PusherService from '../lib/pusher.js';
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
          flashcards: true,
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

      // Pusher start
      await PusherService.emitTaskComplete(input.workspaceId, 'flash_card_load_start', { source: 'prompt' });
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

      await ctx.db.artifact.update({
        where: { id: flashcardCurrent?.id },
        data: { generating: true, generatingMetadata: { quantity: input.numCards, difficulty: input.difficulty.toLowerCase() } },
      });

      await PusherService.emitTaskComplete(input.workspaceId, 'flash_card_info', { status: 'generating', numCards: input.numCards, difficulty: input.difficulty });

      const formattedPreviousCards = flashcardCurrent?.flashcards.map((card) => ({
        front: card.front,
        back: card.back,
      }));


      const partialPrompt = `
      This is the users previous flashcards, avoid repeating any existing cards.
      Please generate ${input.numCards} new cards,
      Of a ${input.difficulty} difficulty,
      Of a ${input.tags?.join(', ')} tag,
      Of a ${input.title} title.
      ${formattedPreviousCards?.map((card) => `Front: ${card.front}\nBack: ${card.back}`).join('\n')}

      The user has also left you this prompt: ${input.prompt}
      `
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

      // Init AI session and seed with prompt as instruction
      const session = await aiSessionService.initSession(input.workspaceId, ctx.session.user.id);
      await aiSessionService.setInstruction(session.id, partialPrompt);

      await aiSessionService.startLLMSession(session.id);
      
      const currentCards = flashcardCurrent?.flashcards.length || 0;
      const newCards = input.numCards - currentCards;




      // Generate
      const content = await aiSessionService.generateFlashcardQuestions(session.id, input.numCards, input.difficulty);

      // Previous cards

      // Parse and create cards
      let createdCards = 0;
      try {
        const flashcardData = JSON.parse(content);
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

      // Cleanup AI session (best-effort)
      aiSessionService.deleteSession(session.id);

      return { artifact, createdCards };
    }),
});



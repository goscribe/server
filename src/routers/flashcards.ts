import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
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
});



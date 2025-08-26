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
    .input(z.object({ workspaceId: z.string().uuid() }))
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
          type: ArtifactType.FLASHCARD_SET,
          title: input.title,
          createdById: ctx.session.user.id,
        },
      });
    }),

  getSet: authedProcedure
    .input(z.object({ setId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const set = await ctx.db.artifact.findFirst({
        where: {
          id: input.setId,
          type: ArtifactType.FLASHCARD_SET,
          workspace: { ownerId: ctx.session.user.id },
        },
        include: { flashcards: true },
      });
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });
      return set;
    }),

  createCard: authedProcedure
    .input(z.object({
      setId: z.string().uuid(),
      front: z.string().min(1),
      back: z.string().min(1),
      tags: z.array(z.string()).optional(),
      order: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const set = await ctx.db.artifact.findFirst({
        where: { id: input.setId, type: ArtifactType.FLASHCARD_SET, workspace: { ownerId: ctx.session.user.id } },
      });
      if (!set) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.flashcard.create({
        data: {
          artifactId: input.setId,
          front: input.front,
          back: input.back,
          tags: input.tags ?? [],
          order: input.order ?? 0,
        },
      });
    }),

  updateCard: authedProcedure
    .input(z.object({
      cardId: z.string().uuid(),
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
    .input(z.object({ cardId: z.string().uuid() }))
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
});



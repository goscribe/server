import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { createInferenceService } from '../lib/inference.js';

// Mirror Prisma enum to avoid direct type import
const ArtifactType = {
  STUDY_GUIDE: 'STUDY_GUIDE',
} as const;

export const studyguide = router({
  // Get latest study guide for a workspace or a specific study guide by ID
  get: authedProcedure
    .input(
      z.object({
        workspaceId: z.string().optional(),
        studyGuideId: z.string().optional(),
      }).refine((v) => Boolean(v.workspaceId) !== Boolean(v.studyGuideId), {
        message: 'Provide exactly one of workspaceId or studyGuideId',
        path: ['workspaceId'],
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.workspaceId) {
        const artifact = await ctx.db.artifact.findFirst({
          where: {
            workspaceId: input.workspaceId,
            type: ArtifactType.STUDY_GUIDE,
            workspace: { ownerId: ctx.session.user.id },
          },
          include: {
            versions: { orderBy: { version: 'desc' }, take: 1 },
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (!artifact) throw new TRPCError({ code: 'NOT_FOUND' });
        const latestVersion = artifact.versions[0] ?? null;
        return { artifactId: artifact.id, title: artifact.title, latestVersion };
      }

      // by studyGuideId (artifact id)
      const artifact = await ctx.db.artifact.findFirst({
        where: {
          id: input.studyGuideId!,
          type: ArtifactType.STUDY_GUIDE,
          workspace: { ownerId: ctx.session.user.id },
        },
        include: {
          versions: { orderBy: { version: 'desc' }, take: 1 },
        },
      });
      if (!artifact) throw new TRPCError({ code: 'NOT_FOUND' });
      const latestVersion = artifact.versions[0] ?? null;
      return { artifactId: artifact.id, title: artifact.title, latestVersion };
    }),

  // Edit study guide content by creating a new version
  edit: authedProcedure
    .input(
      z.object({
        studyGuideId: z.string(),
        content: z.string().min(1),
        data: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ensure ownership
      const artifact = await ctx.db.artifact.findFirst({
        where: {
          id: input.studyGuideId,
          type: ArtifactType.STUDY_GUIDE,
          workspace: { ownerId: ctx.session.user.id },
        },
      });
      if (!artifact) throw new TRPCError({ code: 'NOT_FOUND' });

      const last = await ctx.db.artifactVersion.findFirst({
        where: { artifactId: input.studyGuideId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (last?.version ?? 0) + 1;

      const version = await ctx.db.artifactVersion.create({
        data: {
          artifactId: input.studyGuideId,
          content: input.content,
          data: input.data as any,
          version: nextVersion,
          createdById: ctx.session.user.id,
        },
      });

      return { artifactId: input.studyGuideId, version };
    }),

  // Generate study guide using AI
  generate: authedProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      content: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const inference = createInferenceService(ctx);
      return inference.generateStudyGuide(input.workspaceId, input.content);
    }),
});



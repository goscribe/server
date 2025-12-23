import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { title } from 'node:process';

// Mirror Prisma enum to avoid direct type import
const ArtifactType = {
  STUDY_GUIDE: 'STUDY_GUIDE',
} as const;

const initializeEditorJsEmptyBlock = () => ({
  time: Date.now(),
  blocks: [
    {
      id: 'initial',
      type: 'paragraph',
      data: { text: 'Upload some files to begin creating your revision workspace...' },
    },
  ],
  version: '2.27.0',
});

export const studyguide = router({
  // Get latest study guide for a workspace or a specific study guide by ID
  get: authedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // by studyGuideId (artifact id)
      let artifact = await ctx.db.artifact.findFirst({
        where: {
          workspaceId: input.workspaceId!,
          type: ArtifactType.STUDY_GUIDE,
          workspace: { ownerId: ctx.session.user.id },
        },
        include: {
          versions: { orderBy: { version: 'desc' }, take: 1 },
        },
      });

      console.log('artifact', artifact);
      if (!artifact) {
        artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.STUDY_GUIDE,
            title: 'Study Guide',
            createdById: ctx.session.user.id,
            versions: {
              create: {
                content: `${JSON.stringify(initializeEditorJsEmptyBlock())}`,
                version: 1,
                createdById: ctx.session.user.id,
              }
            }
          },
          include: {
            versions: { orderBy: { version: 'desc' }, take: 1 },
          }
        });
      }
      const latestVersion = artifact.versions[0] ?? null;
      return { artifactId: artifact.id, title: artifact.title, latestVersion };
    }),

  // Edit study guide content by creating a new version, or create if doesn't exist
  edit: authedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        studyGuideId: z.string().optional(),
        content: z.string().min(1),
        data: z.record(z.string(), z.unknown()).optional(),
        title: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let artifact;
      
      if (input.studyGuideId) {
        // Try to find existing study guide
        artifact = await ctx.db.artifact.findFirst({
          where: {
            id: input.studyGuideId,
            type: ArtifactType.STUDY_GUIDE,
            workspace: { ownerId: ctx.session.user.id },
          },
        });
      } else {
        // Find by workspace if no specific studyGuideId provided
        artifact = await ctx.db.artifact.findFirst({
          where: {
            workspaceId: input.workspaceId,
            type: ArtifactType.STUDY_GUIDE,
            workspace: { ownerId: ctx.session.user.id },
          },
        });
      }
      
      // If no study guide found, create a new one
      if (!artifact) {
        artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.STUDY_GUIDE,
            title: 'Study Guide',
            createdById: ctx.session.user.id,
          },
        });
      }

      const last = await ctx.db.artifactVersion.findFirst({
        where: { artifactId: artifact.id },
        orderBy: { version: 'desc' },
      });

      if (input.title && input.title !== artifact.title) {
        console.log('rename')
        await ctx.db.artifact.update({
          where: { id: artifact.id },
          data: { title: input.title },
        });
      }
      
      const nextVersion = (last?.version ?? 0) + 1;

      const version = await ctx.db.artifactVersion.create({
        data: {
          artifactId: artifact.id,
          content: input.content,
          data: input.data as any,
          version: nextVersion,
          createdById: ctx.session.user.id,
        },
      });

      return { artifactId: artifact.id, version };
    }),
});



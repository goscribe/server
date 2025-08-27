import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import { bucket } from '../lib/storage.js';
import { ArtifactType } from '@prisma/client';

export const workspace = router({
  // List current user's workspaces
  list: authedProcedure
    .input(z.object({
        parentId: z.string().optional(),
     }))
    .query(async ({ ctx, input }) => {
      const workspaces = await ctx.db.workspace.findMany({
        where: {
          ownerId: ctx.session.user.id,
          folderId: input.parentId ?? null,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const folders = await ctx.db.folder.findMany({
        where: {
          ownerId: ctx.session.user.id,
          parentId: input.parentId ?? null,
        },
      });

      return { workspaces, folders };
    }),
    
  create: authedProcedure
    .input(z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        parentId: z.string().optional(),
     }))
    .mutation(async ({ ctx, input}) => {
      const ws = await ctx.db.workspace.create({
        data: {
          title: input.name,
          description: input.description,
          ownerId: ctx.session.user.id,
          folderId: input.parentId ?? null,
          artifacts: {
            create: {
              type: ArtifactType.FLASHCARD_SET,
              title: "New Flashcard Set",
            },
            createMany: {
              data: [
                { type: ArtifactType.WORKSHEET, title: "Worksheet 1" },
                { type: ArtifactType.WORKSHEET, title: "Worksheet 2" },
              ],
            },
          },
        },
      });
      return ws;
    }),
  createFolder: authedProcedure
    .input(z.object({
        name: z.string().min(1).max(100),
        parentId: z.string().optional(),
     }))
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.db.folder.create({
        data: {
          name: input.name,
          ownerId: ctx.session.user.id,
          parentId: input.parentId ?? null,
        },
      });
      return folder;
    }),
  get: authedProcedure
    .input(z.object({
        id: z.string(),
     }))
    .query(async ({ ctx, input }) => {
      const ws = await ctx.db.workspace.findFirst({
        where: { id: input.id, ownerId: ctx.session.user.id },
        include: {
          artifacts: true,
          folder: true,
          uploads: true,
        },
      });
      if (!ws) throw new TRPCError({ code: 'NOT_FOUND' });
      return ws;
    }),
  update: authedProcedure
    .input(z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
     }))
    .mutation(async ({ ctx, input }) => {
      const existed = await ctx.db.workspace.findFirst({
        where: { id: input.id, ownerId: ctx.session.user.id },
      });
      if (!existed) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await ctx.db.workspace.update({
        where: { id: input.id },
        data: {
          title: input.name ?? existed.title,
          description: input.description,
        },
      });
      return updated; 
    }), 
    delete: authedProcedure
    .input(z.object({
        id: z.string(),
     }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db.workspace.deleteMany({
        where: { id: input.id, ownerId: ctx.session.user.id },
      });
      if (deleted.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return true;
    }),
    uploadFiles: authedProcedure
    .input(z.object({
        id: z.string(),
        files: z.array(
          z.object({
            filename: z.string().min(1).max(255),
            contentType: z.string().min(1).max(100),
            size: z.number().min(1), // size in bytes
          })
        ),
     }))
    .mutation(async ({ ctx, input }) => {
      // ensure workspace belongs to user
      const ws = await ctx.db.workspace.findFirst({ where: { id: input.id, ownerId: ctx.session.user.id } });
      if (!ws) throw new TRPCError({ code: 'NOT_FOUND' });
      const results = [];

      for (const file of input.files) {
        // 1. Insert into DB
        const record = await ctx.db.fileAsset.create({
          data: {
            userId: ctx.session.user.id,
            name: file.filename,
            mimeType: file.contentType,
            size: file.size,
            workspaceId: input.id,   
          },
        });

        // 2. Generate signed URL for direct upload
        const [url] = await bucket
          .file(`${ctx.session.user.id}/${record.id}-${file.filename}`)
          .getSignedUrl({
            action: "write",
            expires: Date.now() + 5 * 60 * 1000, // 5 min
            contentType: file.contentType,
          });

        // 3. Update record with bucket info
        await ctx.db.fileAsset.update({
          where: { id: record.id },
          data: {
            bucket: bucket.name,
            objectKey: `${ctx.session.user.id}/${record.id}-${file.filename}`,
          },
        }); 

        results.push({
          fileId: record.id,
          uploadUrl: url,
        });
      }

      return results;

    }),
    deleteFiles: authedProcedure
    .input(z.object({
        fileId: z.array(z.string()),
        id: z.string(),
     }))
    .mutation(async ({ ctx, input }) => {
      // ensure files are in the user's workspace
      const files = await ctx.db.fileAsset.findMany({
        where: {
          id: { in: input.fileId },
          workspaceId: input.id,
          userId: ctx.session.user.id,
        },
      });
      // Delete from GCS (best-effort)
      for (const file of files) {
        if (file.bucket && file.objectKey) {
          const gcsFile: import('@google-cloud/storage').File = bucket.file(file.objectKey);
          gcsFile.delete({ ignoreNotFound: true }).catch((err: unknown) => {
            console.error(`Error deleting file ${file.objectKey} from bucket ${file.bucket}:`, err);
          });
        }
      }

      await ctx.db.fileAsset.deleteMany({
        where: {
          id: { in: input.fileId },
          workspaceId: input.id,
          userId: ctx.session.user.id,
        },
      });
      return true;
    }),
});

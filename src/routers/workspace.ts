import { z } from 'zod';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import { bucket } from '../lib/storage.js';
import { FileAsset } from '@prisma/client';

export const workspace = router({
  // Mutation with Zod input
  list: authedProcedure
    .query(async ({ ctx, input }) => {
      const workspaces = await ctx.db.workspace.findMany({
        where: {
          ownerId: ctx.session?.user.id,
        },
      });
      return workspaces;
    }),
    
  create: authedProcedure
    .input(z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
     }))
    .mutation(({ ctx, input}) => {
      return ctx.db.workspace.create({
        data: {
          title: input.name,
          description: input.description,
          ownerId: ctx.session?.user.id,
        },
      });
    }),
  get: authedProcedure
    .input(z.object({
        id: z.string().uuid(),
     }))
    .query(({ ctx, input }) => {
      return ctx.db.workspace.findUnique({
        where: {
          id: input.id,
        },
      });
    }),
  update: authedProcedure
    .input(z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
     }))
    .mutation(({ ctx, input }) => {
      return ctx.db.workspace.update({
        where: {
          id: input.id,
        },
        data: {
          title: input.name,
          description: input.description,
        },
      }); 
    }), 
    delete: authedProcedure
    .input(z.object({
        id: z.string().uuid(),
     }))
    .mutation(({ ctx, input }) => {
      ctx.db.workspace.delete({
        where: {
          id: input.id,
        },
      });
      return true;
    }),
    uploadFiles: authedProcedure
    .input(z.object({
        id: z.string().uuid(),
        files: z.array(
          z.object({
            filename: z.string().min(1).max(255),
            contentType: z.string().min(1).max(100),
            size: z.number().min(1), // size in bytes
          })
        ),
     }))
    .mutation(async ({ ctx, input }) => {
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
        fileId: z.array(z.string().uuid()),
        id: z.string().uuid(),
     }))
    .mutation(({ ctx, input }) => {
      const files = ctx.db.fileAsset.findMany({
        where: {
          id: { in: input.fileId },
          workspaceId: input.id,
        },
      });

      // Delete from GCS
      files.then((fileRecords: FileAsset[]) => {
        fileRecords.forEach((file: FileAsset) => {
          if (file.bucket && file.objectKey) {
        const gcsFile: import('@google-cloud/storage').File = bucket.file(file.objectKey);
        gcsFile.delete({ ignoreNotFound: true }).catch((err: unknown) => {
          console.error(`Error deleting file ${file.objectKey} from bucket ${file.bucket}:`, err);
        });
          }
        });
      });

      return ctx.db.fileAsset.deleteMany({
        where: {
          id: { in: input.fileId },
          workspaceId: input.id,
        },
      });
    }),
});

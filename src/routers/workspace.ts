import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import { supabaseClient } from '../lib/storage.js';
import { ArtifactType } from '@prisma/client';
import { aiSessionService } from '../lib/ai-session.js';
import PusherService from '../lib/pusher.js';
import { members } from './members.js';
import { logger } from '../lib/logger.js';
import type { PrismaClient } from '@prisma/client';

// Helper function to update and emit analysis progress
async function updateAnalysisProgress(
  db: PrismaClient,
  workspaceId: string,
  progress: any
) {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { analysisProgress: progress }
  });
  await PusherService.emitAnalysisProgress(workspaceId, progress);
}

// Helper function to calculate search relevance score
function calculateRelevance(query: string, ...texts: (string | null | undefined)[]): number {
  const queryLower = query.toLowerCase();
  let score = 0;

  for (const text of texts) {
    if (!text) continue;

    const textLower = text.toLowerCase();

    // Exact match gets highest score
    if (textLower.includes(queryLower)) {
      score += 10;
    }

    // Word boundary matches get good score
    const words = queryLower.split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && textLower.includes(word)) {
        score += 5;
      }
    }

    // Partial matches get lower score
    const queryChars = queryLower.split('');
    let consecutiveMatches = 0;
    for (const char of queryChars) {
      if (textLower.includes(char)) {
        consecutiveMatches++;
      } else {
        consecutiveMatches = 0;
      }
    }
    score += consecutiveMatches * 0.1;
  }

  return score;
}

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
    .mutation(async ({ ctx, input }) => {
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

      aiSessionService.initSession(ws.id, ctx.session.user.id);
      return ws;
    }),
  createFolder: authedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      color: z.string().optional(),
      parentId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.db.folder.create({
        data: {
          name: input.name,
          ownerId: ctx.session.user.id,
          color: input.color ?? '#9D00FF',
          parentId: input.parentId ?? null,
        },
      });
      return folder;
    }),
  updateFolder: authedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      color: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.db.folder.update({ where: { id: input.id }, data: { name: input.name, color: input.color ?? '#9D00FF' } });
      return folder;
    }),
  deleteFolder: authedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.db.folder.delete({ where: { id: input.id } });
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
  getStats: authedProcedure
    .query(async ({ ctx }) => {
      const workspaces = await ctx.db.workspace.findMany({
        where: { OR: [{ ownerId: ctx.session.user.id }, { sharedWith: { some: { id: ctx.session.user.id } } }] },
      });
      const folders = await ctx.db.folder.findMany({
        where: { OR: [{ ownerId: ctx.session.user.id }] },
      });
      const lastUpdated = await ctx.db.workspace.findFirst({
        where: { OR: [{ ownerId: ctx.session.user.id }, { sharedWith: { some: { id: ctx.session.user.id } } }] },
        orderBy: { updatedAt: 'desc' },
      });

      const spaceLeft = await ctx.db.fileAsset.aggregate({
        where: { workspaceId: { in: workspaces.map(ws => ws.id) }, userId: ctx.session.user.id },
        _sum: { size: true },
      });

      return {
        workspaces: workspaces.length,
        folders: folders.length,
        lastUpdated: lastUpdated?.updatedAt,
        spaceUsed: spaceLeft._sum?.size ?? 0,
        spaceLeft: 1000000000 - (spaceLeft._sum?.size ?? 0) || 0,
      };
    }),
  update: authedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
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
          color: input.color ?? existed.color,
          icon: input.icon ?? existed.icon,
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
  getFolderInformation: authedProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const folder = await ctx.db.folder.findFirst({ where: { id: input.id, ownerId: ctx.session.user.id } });
      // find all of its parents
      if (!folder) throw new TRPCError({ code: 'NOT_FOUND' });

      const parents = [];
      let current = folder;

      while (current.parentId) {
        const parent = await ctx.db.folder.findFirst({ where: { id: current.parentId, ownerId: ctx.session.user.id } });
        if (!parent) break;
        parents.push(parent);
        current = parent;
      }

      return { folder, parents };
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
        const objectKey = `${ctx.session.user.id}/${record.id}-${file.filename}`;
        const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
          .from('files')
          .createSignedUploadUrl(objectKey); // 5 minutes

        if (signedUrlError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to generate upload URL: ${signedUrlError.message}`
          });
        }

        // 3. Update record with bucket info
        await ctx.db.fileAsset.update({
          where: { id: record.id },
          data: {
            bucket: 'files',
            objectKey: objectKey,
          },
        });

        results.push({
          fileId: record.id,
          uploadUrl: signedUrlData.signedUrl,
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
      // Delete from Supabase Storage (best-effort)
      for (const file of files) {
        if (file.bucket && file.objectKey) {
          supabaseClient.storage
            .from(file.bucket)
            .remove([file.objectKey])
            .catch((err: unknown) => {
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
  getFileUploadUrl: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      filename: z.string(),
      contentType: z.string(),
      size: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const objectKey = `workspace_${ctx.session.user.id}/${input.workspaceId}-file_${input.filename}`;
      const fileAsset = await ctx.db.fileAsset.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.filename,
          mimeType: input.contentType,
          size: input.size,
          userId: ctx.session.user.id,
          bucket: 'media',
          objectKey: objectKey,
        },
      });
      const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
        .from('media')
        .createSignedUploadUrl(objectKey); // 5 minutes
      if (signedUrlError) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to generate upload URL: ${signedUrlError.message}` });
      }

      await ctx.db.workspace.update({
        where: { id: input.workspaceId },
        data: { needsAnalysis: true },
      });

      return {
        fileId: fileAsset.id,
        uploadUrl: signedUrlData.signedUrl,
      };
    }),
  uploadAndAnalyzeMedia: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      files: z.array(z.object({
        id: z.string(),
      })),
      generateStudyGuide: z.boolean().default(true),
      generateFlashcards: z.boolean().default(true),
      generateWorksheet: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify workspace ownership
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id }
      });
      if (!workspace) {
        console.error('❌ Workspace not found', { workspaceId: input.workspaceId, userId: ctx.session.user.id });
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      // Check if analysis is already in progress
      if (workspace.fileBeingAnalyzed) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'File analysis is already in progress for this workspace. Please wait for it to complete.'
        });
      }

      // Fetch files from database
      const files = await ctx.db.fileAsset.findMany({
        where: {
          id: { in: input.files.map(file => file.id) },
          workspaceId: input.workspaceId,
          userId: ctx.session.user.id,
        },
      });

      if (files.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No files found with the provided IDs'
        });
      }

      // Validate all files have bucket and objectKey
      for (const file of files) {
        if (!file.bucket || !file.objectKey) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `File ${file.id} does not have bucket or objectKey set`
          });
        }
      }

      // Use the first file for progress tracking and artifact naming
      const primaryFile = files[0];
      const fileType = primaryFile.mimeType.startsWith('image/') ? 'image' : 'pdf';
      try {
        // Set analysis in progress flag
        await ctx.db.workspace.update({
          where: { id: input.workspaceId },
          data: { fileBeingAnalyzed: true },
        });

        PusherService.emitAnalysisProgress(input.workspaceId, {
          status: 'starting',
          filename: primaryFile.name,
          fileType,
          startedAt: new Date().toISOString(),
          steps: {
            fileUpload: { order: 1, status: 'pending' },
          },
        });

        try {
          await updateAnalysisProgress(ctx.db, input.workspaceId, {
            status: 'starting',
            filename: primaryFile.name,
            fileType,
            startedAt: new Date().toISOString(),
            steps: {
              fileUpload: {
                order: 1,
                status: 'pending',
              },
              fileAnalysis: {
                order: 2,
                status: 'pending',
              },
              studyGuide: {
                order: 3,
                status: input.generateStudyGuide ? 'pending' : 'skipped',
              },
              flashcards: {
                order: 4,
                status: input.generateFlashcards ? 'pending' : 'skipped',
              },
            }
          });
        } catch (error) {
          console.error('❌ Failed to update analysis progress:', error);
          await ctx.db.workspace.update({
            where: { id: input.workspaceId },
            data: { fileBeingAnalyzed: false },
          });
          await PusherService.emitError(input.workspaceId, `Failed to update analysis progress: ${error}`, 'file_analysis');
          throw error;
        }

        await updateAnalysisProgress(ctx.db, input.workspaceId, {
          status: 'uploading',
          filename: primaryFile.name,
          fileType,
          startedAt: new Date().toISOString(),
          steps: {
            fileUpload: {
              order: 1,
              status: 'in_progress',
            },
            fileAnalysis: {
              order: 2,
              status: 'pending',
            },
            studyGuide: {
              order: 3,
              status: input.generateStudyGuide ? 'pending' : 'skipped',
            },
            flashcards: {
              order: 4,
              status: input.generateFlashcards ? 'pending' : 'skipped',
            },
          }
        });

        // Process all files using the new process_file endpoint
        for (const file of files) {
          // TypeScript: We already validated bucket and objectKey exist above
          if (!file.bucket || !file.objectKey) {
            continue; // Skip if somehow missing (shouldn't happen due to validation above)
          }

          const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
            .from(file.bucket)
            .createSignedUrl(file.objectKey, 24 * 60 * 60); // 24 hours expiry

          if (signedUrlError) {
            await ctx.db.workspace.update({
              where: { id: input.workspaceId },
              data: { fileBeingAnalyzed: false },
            });
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Failed to generate signed URL for file ${file.name}: ${signedUrlError.message}`
            });
          }

          const fileUrl = signedUrlData.signedUrl;
          const currentFileType = file.mimeType.startsWith('image/') ? 'image' : 'pdf';

          // Use maxPages for large PDFs (>50 pages) to limit processing
          const maxPages = currentFileType === 'pdf' && file.size && file.size > 50 ? 50 : undefined;

          const processResult = await aiSessionService.processFile(
            input.workspaceId,
            ctx.session.user.id,
            fileUrl,
            currentFileType,
            maxPages
          );
          
          if (processResult.status === 'error') {
            logger.error(`Failed to process file ${file.name}:`, processResult.error);
            // Continue processing other files even if one fails
            // Optionally, you could throw an error or mark this file as failed
          } else {
            logger.info(`Successfully processed file ${file.name}: ${processResult.pageCount} pages`);

            // Store the comprehensive description in aiTranscription field
            await ctx.db.fileAsset.update({
              where: { id: file.id },
              data: {
                aiTranscription: {
                  comprehensiveDescription: processResult.comprehensiveDescription,
                  textContent: processResult.textContent,
                  imageDescriptions: processResult.imageDescriptions,
                },
              }
            });
          }
        }

        await updateAnalysisProgress(ctx.db, input.workspaceId, {
          status: 'analyzing',
          filename: primaryFile.name,
          fileType,
          startedAt: new Date().toISOString(),
          steps: {
            fileUpload: {
              order: 1,
              status: 'completed',
            },
            fileAnalysis: {
              order: 2,
              status: 'in_progress',
            },
            studyGuide: {
              order: 3,
              status: input.generateStudyGuide ? 'pending' : 'skipped',
            },
            flashcards: {
              order: 4,
              status: input.generateFlashcards ? 'pending' : 'skipped',
            },
          }
        });

        try {
          // Analyze all files - use PDF analysis if any file is a PDF, otherwise use image analysis
          // const hasPDF = files.some(f => !f.mimeType.startsWith('image/'));
          // if (hasPDF) {
          //   await aiSessionService.analysePDF(input.workspaceId, ctx.session.user.id, file.id);
          // } else {
          //   // If all files are images, analyze them
          //   for (const file of files) {
          //     await aiSessionService.analyseImage(input.workspaceId, ctx.session.user.id, file.id);
          //   }
          // }

          await updateAnalysisProgress(ctx.db, input.workspaceId, {
            status: 'generating_artifacts',
            filename: primaryFile.name,
            fileType,
            startedAt: new Date().toISOString(),
            steps: {
              fileUpload: {
                order: 1,
                status: 'completed',
              },
              fileAnalysis: {
                order: 2,
                status: 'completed',
              },
              studyGuide: {
                order: 3,
                status: input.generateStudyGuide ? 'pending' : 'skipped',
              },
              flashcards: {
                order: 4,
                status: input.generateFlashcards ? 'pending' : 'skipped',
              },
            }
          });
        } catch (error) {
          console.error('❌ Failed to analyze files:', error);
          await updateAnalysisProgress(ctx.db, input.workspaceId, {
            status: 'error',
            filename: primaryFile.name,
            fileType,
            error: `Failed to analyze ${fileType}: ${error}`,
            startedAt: new Date().toISOString(),
            steps: {
              fileUpload: {
                order: 1,
                status: 'completed',
              },
              fileAnalysis: {
                order: 2,
                status: 'error',
              },
              studyGuide: {
                order: 3,
                status: 'skipped',
              },
              flashcards: {
                order: 4,
                status: 'skipped',
              },
            }
          });
          await ctx.db.workspace.update({
            where: { id: input.workspaceId },
            data: { fileBeingAnalyzed: false },
          });
          throw error;
        }

        const results: {
          filename: string;
          artifacts: {
            studyGuide: any | null;
            flashcards: any | null;
            worksheet: any | null;
          };
        } = {
          filename: primaryFile.name,
          artifacts: {
            studyGuide: null,
            flashcards: null,
            worksheet: null,
          }
        };

        // Generate artifacts
        if (input.generateStudyGuide) {
          await updateAnalysisProgress(ctx.db, input.workspaceId, {
            status: 'generating_study_guide',
            filename: primaryFile.name,
            fileType,
            startedAt: new Date().toISOString(),
            steps: {
              fileUpload: {
                order: 1,
                status: 'completed',
              },
              fileAnalysis: {
                order: 2,
                status: 'completed',
              },
              studyGuide: {
                order: 3,
                status: 'in_progress',
              },
              flashcards: {
                order: 4,
                status: input.generateFlashcards ? 'pending' : 'skipped',
              },
            }
          });

          const content = await aiSessionService.generateStudyGuide(input.workspaceId, ctx.session.user.id);

          let artifact = await ctx.db.artifact.findFirst({
            where: { workspaceId: input.workspaceId, type: ArtifactType.STUDY_GUIDE },
          });
          if (!artifact) {
            const fileNames = files.map(f => f.name).join(', ');
            artifact = await ctx.db.artifact.create({
              data: {
                workspaceId: input.workspaceId,
                type: ArtifactType.STUDY_GUIDE,
                title: files.length === 1 ? `Study Guide - ${primaryFile.name}` : `Study Guide - ${files.length} files`,
                createdById: ctx.session.user.id,
              },
            });
          }

          const lastVersion = await ctx.db.artifactVersion.findFirst({
            where: { artifact: { workspaceId: input.workspaceId, type: ArtifactType.STUDY_GUIDE } },
            orderBy: { version: 'desc' },
          });

          await ctx.db.artifactVersion.create({
            data: { artifactId: artifact.id, version: lastVersion ? lastVersion.version + 1 : 1, content: content, createdById: ctx.session.user.id },
          });

          results.artifacts.studyGuide = artifact;
        }

        if (input.generateFlashcards) {
          await updateAnalysisProgress(ctx.db, input.workspaceId, {
            status: 'generating_flashcards',
            filename: primaryFile.name,
            fileType,
            startedAt: new Date().toISOString(),
            steps: {
              fileUpload: {
                order: 1,
                status: 'completed',
              },
              fileAnalysis: {
                order: 2,
                status: 'completed',
              },
              studyGuide: {
                order: 3,
                status: input.generateStudyGuide ? 'completed' : 'skipped',
              },
              flashcards: {
                order: 4,
                status: 'in_progress',
              },
            }
          });

          const content = await aiSessionService.generateFlashcardQuestions(input.workspaceId, ctx.session.user.id, 10, 'medium');

          const artifact = await ctx.db.artifact.create({
            data: {
              workspaceId: input.workspaceId,
              type: ArtifactType.FLASHCARD_SET,
              title: files.length === 1 ? `Flashcards - ${primaryFile.name}` : `Flashcards - ${files.length} files`,
              createdById: ctx.session.user.id,
            },
          });

          // Parse JSON flashcard content
          try {
            const flashcardData: any = content;

            let createdCards = 0;
            for (let i = 0; i < Math.min(flashcardData.length, 10); i++) {
              const card = flashcardData[i];
              const front = card.term || card.front || card.question || card.prompt || `Question ${i + 1}`;
              const back = card.definition || card.back || card.answer || card.solution || `Answer ${i + 1}`;

              await ctx.db.flashcard.create({
                data: {
                  artifactId: artifact.id,
                  front: front,
                  back: back,
                  order: i,
                  tags: ['ai-generated', 'medium'],
                },
              });
              createdCards++;
            }

          } catch (parseError) {
            // Fallback to text parsing if JSON fails
            const lines = content.split('\n').filter(line => line.trim());
            for (let i = 0; i < Math.min(lines.length, 10); i++) {
              const line = lines[i];
              if (line.includes(' - ')) {
                const [front, back] = line.split(' - ');
                await ctx.db.flashcard.create({
                  data: {
                    artifactId: artifact.id,
                    front: front.trim(),
                    back: back.trim(),
                    order: i,
                    tags: ['ai-generated', 'medium'],
                  },
                });
              }
            }
          }

          results.artifacts.flashcards = artifact;
        }

        await ctx.db.workspace.update({
          where: { id: input.workspaceId },
          data: { fileBeingAnalyzed: false },
        });

        await updateAnalysisProgress(ctx.db, input.workspaceId, {
          status: 'completed',
          filename: primaryFile.name,
          fileType,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          steps: {
            fileUpload: {
              order: 1,
              status: 'completed',
            },
            fileAnalysis: {
              order: 2,
              status: 'completed',
            },
            studyGuide: {
              order: 3,
              status: input.generateStudyGuide ? 'completed' : 'skipped',
            },
            flashcards: {
              order: 4,
              status: input.generateFlashcards ? 'completed' : 'skipped',
            },
          }

        });
        return results;
      } catch (error) {
        console.error('❌ Failed to update analysis progress:', error);
        await ctx.db.workspace.update({
          where: { id: input.workspaceId },
          data: { fileBeingAnalyzed: false },
        });
        await PusherService.emitError(input.workspaceId, `Failed to update analysis progress: ${error}`, 'file_analysis');
        throw error;
      }
    }),
  search: authedProcedure
    .input(z.object({
      query: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const { query } = input;
      const workspaces = await ctx.db.workspace.findMany({
        where: {
          ownerId: ctx.session.user.id,
          OR: [
            {
              title: {
                contains: query,
                mode: 'insensitive',
              },
            },
            {
              description: {
                contains: query,
                mode: 'insensitive',
              },
            },
          ],
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: input.limit,
      });

      // Update analysisProgress for each workspace with search metadata
      const workspaceUpdates = workspaces.map(ws =>
        ctx.db.workspace.update({
          where: { id: ws.id },
          data: {
            analysisProgress: {
              lastSearched: new Date().toISOString(),
              searchQuery: query,
              matchedIn: ws.title.toLowerCase().includes(query.toLowerCase()) ? 'title' : 'description',
            }
          }
        })
      );

      await Promise.all(workspaceUpdates);

      return workspaces;
    }),

  // Members sub-router
  members,
});

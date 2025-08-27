import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import { bucket } from '../lib/storage.js';
import { ArtifactType } from '@prisma/client';
import { aiSessionService } from '../lib/ai-session.js';
import PusherService from '../lib/pusher.js';

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
    uploadAndAnalyzeMedia: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      file: z.object({
        filename: z.string(),
        contentType: z.string(),
        size: z.number(),
        content: z.string(), // Base64 encoded file content
      }),
      generateStudyGuide: z.boolean().default(true),
      generateFlashcards: z.boolean().default(true),
      generateWorksheet: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      console.log('🚀 uploadAndAnalyzeMedia started', { 
        workspaceId: input.workspaceId, 
        filename: input.file.filename,
        fileSize: input.file.size,
        generateStudyGuide: input.generateStudyGuide,
        generateFlashcards: input.generateFlashcards,
        generateWorksheet: input.generateWorksheet
      });

      // Verify workspace ownership
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id }
      });
      if (!workspace) {
        console.error('❌ Workspace not found', { workspaceId: input.workspaceId, userId: ctx.session.user.id });
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      console.log('✅ Workspace verified', { workspaceId: workspace.id, workspaceTitle: workspace.title });

      // Convert base64 to buffer
      console.log('📁 Converting base64 to buffer...');
      const fileBuffer = Buffer.from(input.file.content, 'base64');
      console.log('✅ File buffer created', { bufferSize: fileBuffer.length });

      // // Check AI service health first
      // console.log('🏥 Checking AI service health...');
      // const isHealthy = await aiSessionService.checkHealth();
      // if (!isHealthy) {
      //   console.error('❌ AI service is not available');
      //   await PusherService.emitError(input.workspaceId, 'AI service is currently unavailable');
      //   throw new TRPCError({
      //     code: 'SERVICE_UNAVAILABLE',
      //     message: 'AI service is currently unavailable. Please try again later.',
      //   });
      // }
      // console.log('✅ AI service is healthy');

      // Initialize AI session
      console.log('🤖 Initializing AI session...');
      const session = await aiSessionService.initSession(input.workspaceId);
      console.log('✅ AI session initialized', { sessionId: session.id });
      
      const fileObj = new File([fileBuffer], input.file.filename, { type: input.file.contentType });
      const fileType = input.file.contentType.startsWith('image/') ? 'image' : 'pdf';
      console.log('📤 Uploading file to AI service...', { filename: input.file.filename, fileType });
      await aiSessionService.uploadFile(session.id, fileObj, fileType);
      console.log('✅ File uploaded to AI service');
      
      console.log('🚀 Starting LLM session...');
      try {
        await aiSessionService.startLLMSession(session.id);
        console.log('✅ LLM session started');
      } catch (error) {
        console.error('❌ Failed to start LLM session:', error);
        throw error;
      }

      // Analyze the file first
      console.log('🔍 Analyzing file...', { fileType });
      await PusherService.emitTaskComplete(input.workspaceId, 'file_analysis_start', { filename: input.file.filename, fileType });
      try {
        if (fileType === 'image') {
          await aiSessionService.analyseImage(session.id);
          console.log('✅ Image analysis completed');
        } else {
          await aiSessionService.analysePDF(session.id);
          console.log('✅ PDF analysis completed');
        }
        await PusherService.emitTaskComplete(input.workspaceId, 'file_analysis_complete', { filename: input.file.filename, fileType });
      } catch (error) {
        console.error('❌ Failed to analyze file:', error);
        await PusherService.emitError(input.workspaceId, `Failed to analyze ${fileType}: ${error}`, 'file_analysis');
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
        filename: input.file.filename, 
        artifacts: {
          studyGuide: null,
          flashcards: null,
          worksheet: null,
        } 
      };

      // Generate artifacts
      if (input.generateStudyGuide) {
        await PusherService.emitTaskComplete(input.workspaceId, 'study_guide_load_start', { filename: input.file.filename });
        const content = await aiSessionService.generateStudyGuide(session.id);

        await PusherService.emitTaskComplete(input.workspaceId, 'study_guide_info', { contentLength: content.length });
        

        let artifact = await ctx.db.artifact.findFirst({
          where: { workspaceId: input.workspaceId, type: ArtifactType.STUDY_GUIDE },
        });
        if (!artifact) {
          artifact = await ctx.db.artifact.create({
            data: {
              workspaceId: input.workspaceId,
              type: ArtifactType.STUDY_GUIDE,
              title: `Study Guide - ${input.file.filename}`,
              createdById: ctx.session.user.id,
            },
          });
        }
                
        const lastVersion = await ctx.db.artifactVersion.findFirst({
          where: { artifact: {workspaceId: input.workspaceId, type: ArtifactType.STUDY_GUIDE} },
          orderBy: { version: 'desc' },
        });

        await ctx.db.artifactVersion.create({
          data: { artifactId: artifact.id, version: lastVersion ? lastVersion.version + 1 : 1, content: content, createdById: ctx.session.user.id },
        });

        results.artifacts.studyGuide = artifact;
        
        // Emit Pusher notification
        await PusherService.emitStudyGuideComplete(input.workspaceId, artifact);
      }

      if (input.generateFlashcards) {
        await PusherService.emitTaskComplete(input.workspaceId, 'flash_card_load_start', { filename: input.file.filename });
        const content = await aiSessionService.generateFlashcardQuestions(session.id, 10, 'medium');

        await PusherService.emitTaskComplete(input.workspaceId, 'flash_card_info', { contentLength: content.length });
        
        const artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.FLASHCARD_SET,
            title: `Flashcards - ${input.file.filename}`,
            createdById: ctx.session.user.id,
          },
        });
        
        // Parse JSON flashcard content
        try {
          const flashcardData = JSON.parse(content);
          
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
        
        // Emit Pusher notification
        await PusherService.emitFlashcardComplete(input.workspaceId, artifact);
      }

      if (input.generateWorksheet) {
        await PusherService.emitTaskComplete(input.workspaceId, 'worksheet_load_start', { filename: input.file.filename });
        const content = await aiSessionService.generateWorksheetQuestions(session.id, 8, 'medium');
        await PusherService.emitTaskComplete(input.workspaceId, 'worksheet_info', { contentLength: content.length });
        
        const artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.WORKSHEET,
            title: `Worksheet - ${input.file.filename}`,
            createdById: ctx.session.user.id,
          },
        });
        
        // Parse JSON worksheet content
        try {
          const worksheetData = JSON.parse(content);
          
          // The actual worksheet data is in last_response as JSON
          let actualWorksheetData = worksheetData;
          if (worksheetData.last_response) {
            try {
              actualWorksheetData = JSON.parse(worksheetData.last_response);
            } catch (parseError) {
              console.error('❌ Failed to parse last_response JSON:', parseError);
              console.log('📋 Raw last_response:', worksheetData.last_response);
            }
          }
          
          // Handle different JSON structures
          const problems = actualWorksheetData.problems || actualWorksheetData.questions || actualWorksheetData || [];
          let createdQuestions = 0;
          
          for (let i = 0; i < Math.min(problems.length, 8); i++) {
            const problem = problems[i];
            const prompt = problem.question || problem.prompt || `Question ${i + 1}`;
            const answer = problem.answer || problem.solution || `Answer ${i + 1}`;
            const type = problem.type || 'TEXT';
            const options = problem.options || [];
            
            await ctx.db.worksheetQuestion.create({
              data: {
                artifactId: artifact.id,
                prompt: prompt,
                answer: answer,
                difficulty: 'MEDIUM' as any,
                order: i,
                meta: { 
                  type: type,
                  options: options.length > 0 ? options : undefined
                },
              },
            });
            createdQuestions++;
          }
          
        } catch (parseError) {
          console.error('❌ Failed to parse worksheet JSON, using fallback parsing:', parseError);
          // Fallback to text parsing if JSON fails
          const lines = content.split('\n').filter(line => line.trim());
          for (let i = 0; i < Math.min(lines.length, 8); i++) {
            const line = lines[i];
            if (line.includes(' - ')) {
              const [prompt, answer] = line.split(' - ');
              await ctx.db.worksheetQuestion.create({
                data: {
                  artifactId: artifact.id,
                  prompt: prompt.trim(),
                  answer: answer.trim(),
                  difficulty: 'MEDIUM' as any,
                  order: i,
                  meta: { type: 'TEXT' },
                },
              });
            }
          }
        }
        
        results.artifacts.worksheet = artifact;
        
        // Emit Pusher notification
        await PusherService.emitWorksheetComplete(input.workspaceId, artifact);
      }

      await PusherService.emitTaskComplete(input.workspaceId, 'analysis_cleanup_start', { filename: input.file.filename });
      aiSessionService.deleteSession(session.id);
      await PusherService.emitTaskComplete(input.workspaceId, 'analysis_cleanup_complete', { filename: input.file.filename });
      
      // Emit overall completion notification
      await PusherService.emitOverallComplete(input.workspaceId, input.file.filename, results.artifacts);
      
      return results;
    }),
      search: authedProcedure
        .input(z.object({
          query: z.string(),
          workspaceId: z.string().optional(),
          types: z.array(z.enum(['STUDY_GUIDE', 'FLASHCARD_SET', 'WORKSHEET', 'MEETING_SUMMARY', 'PODCAST_EPISODE'])).optional(),
          limit: z.number().min(1).max(100).default(20),
        }))
        .query(async ({ ctx, input }) => {
          const { query, workspaceId, types, limit } = input;
          
          // Build base where clause for workspaces the user has access to
          const workspaceWhere = workspaceId 
            ? { id: workspaceId, ownerId: ctx.session.user.id }
            : { ownerId: ctx.session.user.id };
          
          // Build artifact type filter
          const artifactTypeFilter = types && types.length > 0 
            ? { type: { in: types } }
            : {};
          
          // Search in artifacts (titles and descriptions)
          const artifacts = await ctx.db.artifact.findMany({
            where: {
              workspace: workspaceWhere,
              ...artifactTypeFilter,
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
              ],
            },
            include: {
              workspace: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                }
              },
              versions: {
                take: 1,
                orderBy: { version: 'desc' },
                select: {
                  content: true,
                  version: true,
                }
              },
              flashcards: {
                take: 5,
                select: {
                  front: true,
                  back: true,
                }
              },
              questions: {
                take: 5,
                select: {
                  prompt: true,
                  answer: true,
                }
              },
            },
            take: limit,
            orderBy: { updatedAt: 'desc' },
          });
          
          // Search in artifact versions (content)
          const artifactVersions = await ctx.db.artifactVersion.findMany({
            where: {
              artifact: {
                workspace: workspaceWhere,
                ...artifactTypeFilter,
              },
              content: { contains: query, mode: 'insensitive' },
            },
            include: {
              artifact: {
                include: {
                  workspace: {
                    select: {
                      id: true,
                      title: true,
                      description: true,
                    }
                  },
                }
              },
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
          });
          
          // Search in flashcards
          const flashcards = await ctx.db.flashcard.findMany({
            where: {
              artifact: {
                workspace: workspaceWhere,
                ...artifactTypeFilter,
              },
              OR: [
                { front: { contains: query, mode: 'insensitive' } },
                { back: { contains: query, mode: 'insensitive' } },
              ],
            },
            include: {
              artifact: {
                include: {
                  workspace: {
                    select: {
                      id: true,
                      title: true,
                      description: true,
                    }
                  },
                }
              },
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
          });
          
          // Search in worksheet questions
          const worksheetQuestions = await ctx.db.worksheetQuestion.findMany({
            where: {
              artifact: {
                workspace: workspaceWhere,
                ...artifactTypeFilter,
              },
              OR: [
                { prompt: { contains: query, mode: 'insensitive' } },
                { answer: { contains: query, mode: 'insensitive' } },
              ],
            },
            include: {
              artifact: {
                include: {
                  workspace: {
                    select: {
                      id: true,
                      title: true,
                      description: true,
                    }
                  },
                }
              },
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
          });
          
          // Group results by type and add relevance scoring
          const results = {
            artifacts: artifacts.map(artifact => ({
              type: 'artifact' as const,
              id: artifact.id,
              title: artifact.title,
              description: artifact.description,
              artifactType: artifact.type,
              workspace: artifact.workspace,
              latestVersion: artifact.versions[0],
              sampleFlashcards: artifact.flashcards,
              sampleQuestions: artifact.questions,
              relevance: calculateRelevance(query, artifact.title, artifact.description),
              updatedAt: artifact.updatedAt,
            })),
            
            versions: artifactVersions.map(version => ({
              type: 'version' as const,
              id: version.id,
              artifactId: version.artifact.id,
              artifactTitle: version.artifact.title,
              artifactType: version.artifact.type,
              workspace: version.artifact.workspace,
              content: version.content,
              version: version.version,
              relevance: calculateRelevance(query, version.content),
              createdAt: version.createdAt,
            })),
            
            flashcards: flashcards.map(card => ({
              type: 'flashcard' as const,
              id: card.id,
              front: card.front,
              back: card.back,
              artifactId: card.artifact.id,
              artifactTitle: card.artifact.title,
              artifactType: card.artifact.type,
              workspace: card.artifact.workspace,
              relevance: calculateRelevance(query, card.front, card.back),
              createdAt: card.createdAt,
            })),
            
            worksheetQuestions: worksheetQuestions.map(question => ({
              type: 'worksheet_question' as const,
              id: question.id,
              prompt: question.prompt,
              answer: question.answer,
              artifactId: question.artifact.id,
              artifactTitle: question.artifact.title,
              artifactType: question.artifact.type,
              workspace: question.artifact.workspace,
              relevance: calculateRelevance(query, question.prompt, question.answer),
              createdAt: question.createdAt,
            })),
          };
          
          // Combine all results and sort by relevance
          const allResults = [
            ...results.artifacts,
            ...results.versions,
            ...results.flashcards,
            ...results.worksheetQuestions,
          ].sort((a, b) => b.relevance - a.relevance);
          
          return {
            query,
            totalResults: allResults.length,
            results: allResults.slice(0, limit),
            breakdown: {
              artifacts: results.artifacts.length,
              versions: results.versions.length,
              flashcards: results.flashcards.length,
              worksheetQuestions: results.worksheetQuestions.length,
            },
          };
        }),
});

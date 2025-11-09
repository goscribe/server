import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { v4 as uuidv4 } from 'uuid';
import inference from '../lib/inference.js';
import { uploadToSupabase, generateSignedUrl, deleteFromSupabase } from '../lib/storage.js';
import PusherService from '../lib/pusher.js';
import { aiSessionService } from '../lib/ai-session.js';

// Prisma enum values mapped manually to avoid type import issues in ESM
const ArtifactType = {
  PODCAST_EPISODE: 'PODCAST_EPISODE',
  STUDY_GUIDE: 'STUDY_GUIDE',
  FLASHCARD_SET: 'FLASHCARD_SET',
} as const;

// Podcast segment schema
const podcastSegmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  startTime: z.number(), // in seconds
  duration: z.number(), // in seconds
  keyPoints: z.array(z.string()),
  order: z.number().int(),
  audioUrl: z.string().optional(),
  objectKey: z.string().optional(), // Supabase Storage object key
});

// Speaker schema
const speakerSchema = z.object({
  id: z.string(),
  role: z.enum(['host', 'guest', 'expert']),
  name: z.string().optional(),
});

// Podcast creation input schema
const podcastInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  userPrompt: z.string(),
  speakers: z.array(speakerSchema).min(1).default([{ id: 'pNInz6obpgDQGcFmaJgB', role: 'host' }]),
  speed: z.number().min(0.25).max(4.0).default(1.0),
  generateIntro: z.boolean().default(true),
  generateOutro: z.boolean().default(true),
  segmentByTopics: z.boolean().default(true),
});

// Podcast metadata schema for version data (segments stored separately in database)
const podcastMetadataSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  totalDuration: z.number(),
  speakers: z.array(speakerSchema),
  summary: z.object({
    executiveSummary: z.string(),
    learningObjectives: z.array(z.string()),
    keyConcepts: z.array(z.string()),
    followUpActions: z.array(z.string()),
    targetAudience: z.string(),
    prerequisites: z.array(z.string()),
    tags: z.array(z.string()),
  }),
  generatedAt: z.string(),
});

export const podcast = router({
  // List all podcast episodes for a workspace
  listEpisodes: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });

      // Check if workspace exists

      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      
      const artifacts = await ctx.db.artifact.findMany({
        where: { 
          workspaceId: input.workspaceId, 
          type: ArtifactType.PODCAST_EPISODE 
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1, // Get only the latest version
          },
          podcastSegments: {
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
      
      console.log(`📻 Found ${artifacts.length} podcast artifacts`);
      artifacts.forEach((artifact, i) => {
        console.log(`  Podcast ${i + 1}: "${artifact.title}" - ${artifact.podcastSegments.length} segments`);
      });

      // Transform to include segments with fresh signed URLs


      const episodesWithUrls = await Promise.all(
        artifacts.map(async (artifact) => {
          const latestVersion = artifact.versions[0];
          let objectUrl = null;
          if (artifact.imageObjectKey) {
            objectUrl = await generateSignedUrl(artifact.imageObjectKey, 24);
          }
          
          // Generate fresh signed URLs for all segments
          const segmentsWithUrls = await Promise.all(
            artifact.podcastSegments.map(async (segment) => {
              if (segment.objectKey) {
                try {
                  const signedUrl = await generateSignedUrl(segment.objectKey, 24); // 24 hours
                  return {
                    id: segment.id,
                    title: segment.title,
                    audioUrl: signedUrl,
                    objectKey: segment.objectKey,
                    startTime: segment.startTime,
                    duration: segment.duration,
                    order: segment.order,
                  };
                } catch (error) {
                  console.error(`Failed to generate signed URL for segment ${segment.id}:`, error);
                  return {
                    id: segment.id,
                    title: segment.title,
                    audioUrl: null,
                    objectKey: segment.objectKey,
                    startTime: segment.startTime,
                    duration: segment.duration,
                    order: segment.order,
                  };
                }
              }
              return {
                id: segment.id,
                title: segment.title,
                audioUrl: null,
                objectKey: segment.objectKey,
                startTime: segment.startTime,
                duration: segment.duration,
                order: segment.order,
              };
            })
          );

          // Parse metadata from latest version if available
          let metadata = null;
          if (latestVersion) {
            try {
              console.log(latestVersion.data)
              metadata = podcastMetadataSchema.parse(latestVersion.data);
            } catch (error) {
              console.error('Failed to parse podcast metadata:', error);
            }
          }

          return {
            id: artifact.id,
            title: metadata?.title || artifact.title || 'Untitled Episode',
            description: metadata?.description || artifact.description || null,
            metadata: metadata,
            imageUrl: objectUrl,
            segments: segmentsWithUrls,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
            workspaceId: artifact.workspaceId,
            generating: artifact.generating,
            generatingMetadata: artifact.generatingMetadata,
            type: artifact.type,
            createdById: artifact.createdById,
            isArchived: artifact.isArchived,
          };
        })
      );

      return episodesWithUrls;
    }),

  // Get a specific podcast episode with segments and signed URLs
  getEpisode: authedProcedure
    .input(z.object({ episodeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const episode = await ctx.db.artifact.findFirst({
        where: { 
          id: input.episodeId,
          type: ArtifactType.PODCAST_EPISODE,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
          podcastSegments: {
            orderBy: { order: 'asc' },
          },
        },
      });

      console.log(episode)

      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });
      
      const latestVersion = episode.versions[0];
      if (!latestVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'No version found' });
      
      console.log(latestVersion)
      try {
        const metadata = podcastMetadataSchema.parse(latestVersion.data);
      } catch (error) {
        console.error('Failed to parse podcast metadata:', error);
      }
      const metadata = podcastMetadataSchema.parse(latestVersion.data);

      const imageUrl = episode.imageObjectKey ? await generateSignedUrl(episode.imageObjectKey, 24) : null;
  

      // Generate fresh signed URLs for all segments
      const segmentsWithUrls = await Promise.all(
        episode.podcastSegments.map(async (segment) => {
          if (segment.objectKey) {
            try {
              const signedUrl = await generateSignedUrl(segment.objectKey, 24); // 24 hours
              return {
                id: segment.id,
                title: segment.title,
                content: segment.content,
                audioUrl: signedUrl,
                objectKey: segment.objectKey,
                startTime: segment.startTime,
                duration: segment.duration,
                keyPoints: segment.keyPoints,
                order: segment.order,
              };
            } catch (error) {
              console.error(`Failed to generate signed URL for segment ${segment.id}:`, error);
              return {
                id: segment.id,
                title: segment.title,
                content: segment.content,
                audioUrl: null,
                objectKey: segment.objectKey,
                startTime: segment.startTime,
                duration: segment.duration,
                keyPoints: segment.keyPoints,
                order: segment.order,
              };
            }
          }
          return {
            id: segment.id,
            title: segment.title,
            content: segment.content,
            audioUrl: null,
            objectKey: segment.objectKey,
            startTime: segment.startTime,
            duration: segment.duration,
            keyPoints: segment.keyPoints,
            order: segment.order,
          };
        })
      );
      
      return {
        id: episode.id,
        title: metadata.title, // Use title from version metadata
        description: metadata.description, // Use description from version metadata
        metadata,
        imageUrl: imageUrl,
        segments: segmentsWithUrls,
        content: latestVersion.content, // transcript
        createdAt: episode.createdAt,
        updatedAt: episode.updatedAt,
      };
    }),

  // Generate podcast episode from text input
  generateEpisode: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      podcastData: podcastInputSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      
        // Emit podcast generation start notification
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_generation_start', { 
          title: input.podcastData.title 
        });

        const BEGIN_PODCAST_GENERATION_MESSAGE = 'Structuring podcast contents...';

        const newArtifact = await ctx.db.artifact.create({
          data: {
            title: '----',
            type: ArtifactType.PODCAST_EPISODE,
            generating: true,
            generatingMetadata: {
              message: BEGIN_PODCAST_GENERATION_MESSAGE,
            },
            workspace: {
              connect: {
                id: input.workspaceId,
              }
            }
          }
        });

        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_info', { 
          message: BEGIN_PODCAST_GENERATION_MESSAGE,
        });

      try {

        const structureResult = await aiSessionService.generatePodcastStructure(
          input.workspaceId,
          ctx.session.user.id,
          input.podcastData.title,
          input.podcastData.description || '',
          input.podcastData.userPrompt,
          input.podcastData.speakers
        );

        if (!structureResult.success || !structureResult.structure) {
          throw new TRPCError({ 
            code: 'INTERNAL_SERVER_ERROR', 
            message: 'Failed to generate podcast structure' 
          });
        }

        const structure = structureResult.structure;

        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            title: structure.episodeTitle,
          }
        });

        // Step 2: Generate audio for each segment
        const segments = [];
        const failedSegments = [];
        let totalDuration = 0;
        let fullTranscript = '';

        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            generatingMetadata: {
              message: `Generating podcast image...`,
            },
          }
        });

        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_info', { 
          message: `Generating podcast image...`,
        });

        const podcastImage = await aiSessionService.generatePodcastImage(
          input.workspaceId,
          ctx.session.user.id,
          structure.segments.map((segment: any) => segment.content).join('\n\n'),
        );

        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            imageObjectKey: podcastImage,
          }
        });

        for (let i = 0; i < structure.segments.length; i++) {
          const segment = structure.segments[i];

          try {
            // Emit segment generation progress
            // await PusherService.emitTaskComplete(input.workspaceId, 'podcast_segment_progress', { 
            //   currentSegment: i + 1,
            //   totalSegments: structure.segments.length,
            //   segmentTitle: segment.title || `Segment ${i + 1}`,
            //   successfulSegments: segments.length,
            //   failedSegments: failedSegments.length,
            // });

            await ctx.db.artifact.update({
              where: {
                id: newArtifact.id,
              },
              data: {
                generatingMetadata: {
                  message: `Generating audio for "${segment.title}" (${i + 1} of ${structure.segments.length})...`,
                },
              }
            });

            await PusherService.emitTaskComplete(input.workspaceId, 'podcast_info', { 
              message: `Generating audio for segment ${i + 1} of ${structure.segments.length}...`,
            });

            // Generate audio using new API
            const audioResult = await aiSessionService.generatePodcastAudioFromText(
              input.workspaceId,
              ctx.session.user.id,
              newArtifact.id,
              i,
              segment.content,
              input.podcastData.speakers,
              segment.voiceId
            );

            if (!audioResult.success) {
              throw new Error('Failed to generate audio for segment');
            }

            segments.push({
              id: uuidv4(),
              title: segment.title,
              content: segment.content,
              objectKey: audioResult.objectKey,
              startTime: totalDuration,
              duration: audioResult.duration,
              keyPoints: segment.keyPoints || [],
              order: segment.order || i + 1,
            });

            totalDuration += audioResult.duration;
            fullTranscript += `\n\n## ${segment.title}\n\n${segment.content}`;

          } catch (audioError) {
            const errorMessage = audioError instanceof Error ? audioError.message : 'Unknown error';
            console.error(`❌ Error generating audio for segment ${i + 1}:`, {
              title: segment.title,
              error: errorMessage,
              stack: audioError instanceof Error ? audioError.stack : undefined,
            });
            
            // Track failed segment
            failedSegments.push({
              index: i + 1,
              title: segment.title || `Segment ${i + 1}`,
              error: errorMessage,
            });
            
            await PusherService.emitTaskComplete(input.workspaceId, 'podcast_segment_error', { 
              segmentIndex: i + 1,
              segmentTitle: segment.title || `Segment ${i + 1}`,
              error: errorMessage,
              successfulSegments: segments.length,
              failedSegments: failedSegments.length,
            });
            
            // Continue with other segments even if one fails
          }
        }
        
        // Check if any segments were successfully generated
        if (segments.length === 0) {
          console.error('No segments were successfully generated');
          await PusherService.emitError(input.workspaceId, 
            `Failed to generate any segments. ${failedSegments.length} segment(s) failed.`, 
            'podcast'
          );
          
          // Cleanup the artifact
          await ctx.db.artifact.delete({
            where: { id: newArtifact.id },
          });
          
          throw new TRPCError({ 
            code: 'INTERNAL_SERVER_ERROR', 
            message: `Failed to generate any audio segments. All ${failedSegments.length} attempts failed.` 
          });
        }


        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            generatingMetadata: {
              message: `Preparing podcast summary...`,
            },
          }
        });

        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_info', { 
          message: `Preparing podcast summary...`,
        });

        // Step 3: Generate episode summary using inference API
        const summaryPrompt = `Create a comprehensive podcast episode summary including:
        - Executive summary
        - Learning objectives
        - Key concepts covered
        - Recommended follow-up actions
        - Target audience
        - Prerequisites (if any)

        Format as JSON:
        {
          "executiveSummary": "Brief overview of the episode",
          "learningObjectives": ["objective1", "objective2"],
          "keyConcepts": ["concept1", "concept2"],
          "followUpActions": ["action1", "action2"],
          "targetAudience": "Description of target audience",
          "prerequisites": ["prerequisite1", "prerequisite2"],
          "tags": ["tag1", "tag2", "tag3"]
        }

        Podcast Title: ${structure.episodeTitle}
        Segments: ${JSON.stringify(segments.map(s => ({ title: s.title, keyPoints: s.keyPoints })))}`;

        const summaryResponse = await inference(summaryPrompt);
        const summaryContent: string = summaryResponse.choices[0].message.content || '';

        let episodeSummary;
        try {
          // Extract JSON from the response
          const jsonMatch = summaryContent.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in summary response');
          }
          episodeSummary = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('Failed to parse summary response:', summaryContent);
          await PusherService.emitTaskComplete(input.workspaceId, 'podcast_summary_error', { 
            error: 'Failed to parse summary response'
          });
          episodeSummary = {
            executiveSummary: 'AI-generated podcast episode',
            learningObjectives: [],
            keyConcepts: [],
            followUpActions: [],
            targetAudience: 'General audience',
            prerequisites: [],
            tags: [],
          };
        }

        // Emit summary generation completion notification
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_info', { 
          message: `Podcast summary generated.`,
        });

        // Step 4: Create artifact and initial version
        const episodeTitle = structure.episodeTitle || input.podcastData.title;
        
        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.PODCAST_EPISODE,
            title: episodeTitle, // Store basic title for listing/searching
            description: input.podcastData.description, // Store basic description for listing/searching
            createdById: ctx.session.user.id,
          },
        });
        
        const createdSegments = await ctx.db.podcastSegment.createMany({
          data: segments.map(segment => ({
            artifactId: newArtifact.id,
            title: segment.title,
            content: segment.content,
            startTime: segment.startTime,
            duration: segment.duration,
            order: segment.order,
            objectKey: segment.objectKey,
            keyPoints: segment.keyPoints,
            meta: {
              speed: input.podcastData.speed,
              speakers: input.podcastData.speakers,
            },
          })),
        });
        
        const metadata = {
          title: episodeTitle,
          description: input.podcastData.description,
          totalDuration: totalDuration,
          summary: episodeSummary,
          speakers: input.podcastData.speakers,
          generatedAt: new Date().toISOString(),
        };

        await ctx.db.artifactVersion.create({
          data: {
            artifactId: newArtifact.id,
            version: 1,
            content: fullTranscript.trim(), // Full transcript as markdown
            data: metadata,
            createdById: ctx.session.user.id,
          },
        });

        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            generating: false,
          },
        });

        // Emit podcast generation completion notification
        await PusherService.emitPodcastComplete(input.workspaceId, {});

        return {
          id: newArtifact.id,
          title: metadata.title,
          description: metadata.description,
          metadata,
          content: fullTranscript.trim(),
        };

      } catch (error) {

        console.error('Error generating podcast episode:', error);

        await ctx.db.artifact.delete({
          where: {
            id: newArtifact.id,
          },
        });
        await PusherService.emitError(input.workspaceId, `Failed to generate podcast episode: ${error instanceof Error ? error.message : 'Unknown error'}`, 'podcast');
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `Failed to generate podcast episode: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
    }),

  deleteSegment: authedProcedure
    .input(z.object({ segmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const segment = await ctx.db.podcastSegment.delete({ where: { id: input.segmentId } });
      return segment;
    }),

  // Get episode schema/structure for navigation
  getEpisodeSchema: authedProcedure
    .input(z.object({ episodeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const episode = await ctx.db.artifact.findFirst({
        where: { 
          id: input.episodeId,
          type: ArtifactType.PODCAST_EPISODE,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
          podcastSegments: {
            orderBy: { order: 'asc' },
          },
        },
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });
      
      const latestVersion = episode.versions[0];
      if (!latestVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'No version found' });

      const metadata = podcastMetadataSchema.parse(latestVersion.data);
      
      return {
        segments: episode.podcastSegments.map(s => ({
          id: s.id,
          title: s.title,
          startTime: s.startTime,
          duration: s.duration,
          keyPoints: s.keyPoints,
          order: s.order,
        })),
        summary: metadata.summary,
        metadata: {
          title: metadata.title,
          description: metadata.description,
          totalDuration: metadata.totalDuration,
          speakers: metadata.speakers,
        },
      };
    }),

  // Update episode metadata
  updateEpisode: authedProcedure
    .input(z.object({
      episodeId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await ctx.db.artifact.findFirst({
        where: { 
          id: input.episodeId,
          type: ArtifactType.PODCAST_EPISODE,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });
      
      const latestVersion = episode.versions[0];
      if (!latestVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'No version found' });

      const metadata = podcastMetadataSchema.parse(latestVersion.data);
      
      // Update metadata
      if (input.title) metadata.title = input.title;
      if (input.description) metadata.description = input.description;

      // Create new version with updated metadata
      const nextVersion = (latestVersion.version || 0) + 1;
      await ctx.db.artifactVersion.create({
        data: {
          artifactId: input.episodeId,
          version: nextVersion,
          content: latestVersion.content,
          data: metadata,
          createdById: ctx.session.user.id,
        },
      });
      
      // Update the artifact with basic info for listing/searching
      return ctx.db.artifact.update({
        where: { id: input.episodeId },
        data: {
          title: input.title ?? episode.title,
          description: input.description ?? episode.description,
          updatedAt: new Date(),
        },
      });
    }),

  // Delete episode and associated audio files
  deleteEpisode: authedProcedure
    .input(z.object({ episodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const episode = await ctx.db.artifact.findFirst({
        where: { 
          id: input.episodeId,
          type: ArtifactType.PODCAST_EPISODE,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        // Emit episode deletion start notification
        await PusherService.emitTaskComplete(episode.workspaceId, 'podcast_deletion_start', { 
          episodeId: input.episodeId,
          episodeTitle: episode.title || 'Untitled Episode'
        });

        // Get segments to delete audio files
        const segments = await ctx.db.podcastSegment.findMany({
          where: { artifactId: input.episodeId },
        });

        // Delete audio files from Supabase Storage
        for (const segment of segments) {
          if (segment.objectKey) {
            try {
              await deleteFromSupabase(segment.objectKey);
            } catch (error) {
              console.error(`Failed to delete audio file ${segment.objectKey}:`, error);
            }
          }
        }

        // Delete associated segments
        await ctx.db.podcastSegment.deleteMany({
          where: { artifactId: input.episodeId },
        });

        // Delete associated versions
        await ctx.db.artifactVersion.deleteMany({
          where: { artifactId: input.episodeId },
        });

        // Delete the artifact
        await ctx.db.artifact.delete({
          where: { id: input.episodeId },
        });

        // Emit episode deletion completion notification
        await PusherService.emitTaskComplete(episode.workspaceId, 'podcast_deletion_complete', { 
          episodeId: input.episodeId,
          episodeTitle: episode.title || 'Untitled Episode'
        });

        return true;

      } catch (error) {
        console.error('Error deleting episode:', error);
        await PusherService.emitError(episode.workspaceId, `Failed to delete episode: ${error instanceof Error ? error.message : 'Unknown error'}`, 'podcast');
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to delete episode' 
        });
      }
    }),

  // Get a specific segment with signed URL
  getSegment: authedProcedure
    .input(z.object({ segmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const segment = await ctx.db.podcastSegment.findFirst({
        where: { 
          id: input.segmentId,
          artifact: {
            workspace: { ownerId: ctx.session.user.id }
          }
        },
        include: {
          artifact: true,
        },
      });

      if (!segment) throw new TRPCError({ code: 'NOT_FOUND' });

      // Generate fresh signed URL
      let audioUrl = null;
      if (segment.objectKey) {
        try {
          audioUrl = await generateSignedUrl(segment.objectKey, 24); // 24 hours
        } catch (error) {
          console.error(`Failed to generate signed URL for segment ${segment.id}:`, error);
        }
      }

      return {
        id: segment.id,
        title: segment.title,
        content: segment.content,
        startTime: segment.startTime,
        duration: segment.duration,
        order: segment.order,
        keyPoints: segment.keyPoints,
        audioUrl,
        objectKey: segment.objectKey,
        meta: segment.meta,
        createdAt: segment.createdAt,
        updatedAt: segment.updatedAt,
      };
    }),

  // Get available voices for TTS
  getAvailableVoices: authedProcedure
    .query(async () => {
      return [
        { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced voice' },
        { id: 'echo', name: 'Echo', description: 'Clear, professional voice' },
        { id: 'fable', name: 'Fable', description: 'Warm, storytelling voice' },
        { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative voice' },
        { id: 'nova', name: 'Nova', description: 'Friendly, conversational voice' },
        { id: 'shimmer', name: 'Shimmer', description: 'Bright, energetic voice' },
      ];
    }),






});
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Prisma enum values mapped manually to avoid type import issues in ESM
const ArtifactType = {
  STUDY_GUIDE: 'STUDY_GUIDE',
  FLASHCARD_SET: 'FLASHCARD_SET',
  WORKSHEET: 'WORKSHEET',
  MEETING_SUMMARY: 'MEETING_SUMMARY',
  PODCAST_EPISODE: 'PODCAST_EPISODE',
} as const;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Podcast segment schema
const podcastSegmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  startTime: z.number(), // in seconds
  duration: z.number(), // in seconds
  keyPoints: z.array(z.string()),
  order: z.number().int(),
});

// Podcast creation input schema
const podcastInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  content: z.string(),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('nova'),
  speed: z.number().min(0.25).max(4.0).default(1.0),
  generateIntro: z.boolean().default(true),
  generateOutro: z.boolean().default(true),
  segmentByTopics: z.boolean().default(true),
});

export const podcastGeneration = router({
  // List all podcast episodes for a workspace
  listEpisodes: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      
      return ctx.db.artifact.findMany({
        where: { 
          workspaceId: input.workspaceId, 
          type: ArtifactType.PODCAST_EPISODE 
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1, // Get only the latest version
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    }),

  // Get a specific podcast episode with segments
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
        },
      });
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });
      return episode;
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

      try {
        // Step 1: Structure the content into segments using AI
        const structureResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: `You are a podcast content structuring assistant. Given text content, break it down into logical segments for a podcast episode.

              Create segments that are:
              - 2-5 minutes each when spoken
              - Focused on specific topics or concepts
              - Flow naturally from one to the next
              - Include key takeaways for each segment

              ${input.podcastData.generateIntro ? 'Include an engaging introduction segment.' : ''}
              ${input.podcastData.generateOutro ? 'Include a conclusion/outro segment.' : ''}

              Format your response as JSON:
              {
                "episodeTitle": "Enhanced title for the podcast",
                "totalEstimatedDuration": "estimated duration in minutes",
                "segments": [
                  {
                    "title": "Segment title",
                    "content": "Natural, conversational script for this segment",
                    "keyPoints": ["key point 1", "key point 2"],
                    "estimatedDuration": "duration in minutes",
                    "order": 1
                  }
                ]
              }`
            },
            {
              role: 'user',
              content: `Title: ${input.podcastData.title}
              Description: ${input.podcastData.description || 'No description provided'}
              Content to structure: ${input.podcastData.content}`
            }
          ],
        });

        let structuredContent;
        try {
          structuredContent = JSON.parse(structureResponse.choices[0]?.message?.content || '{}');
        } catch (parseError) {
          throw new TRPCError({ 
            code: 'INTERNAL_SERVER_ERROR', 
            message: 'Failed to structure podcast content' 
          });
        }

        // Step 2: Generate audio for each segment
        const audioDir = path.join(process.cwd(), 'public', 'audio', 'podcasts');
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }

        const episodeId = uuidv4();
        const segments = [];
        let totalDuration = 0;

        for (const [index, segment] of structuredContent.segments.entries()) {
          try {
            // Generate speech for this segment
            const mp3Response = await openai.audio.speech.create({
              model: 'tts-1',
              voice: input.podcastData.voice,
              speed: input.podcastData.speed,
              input: segment.content,
            });

            // Save audio file
            const segmentFileName = `${episodeId}_segment_${index + 1}.mp3`;
            const segmentFilePath = path.join(audioDir, segmentFileName);
            const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());
            fs.writeFileSync(segmentFilePath, audioBuffer);

            // Estimate duration (roughly 150 words per minute for TTS)
            const wordCount = segment.content.split(' ').length;
            const estimatedDuration = Math.ceil((wordCount / 150) * 60); // in seconds

            segments.push({
              id: uuidv4(),
              title: segment.title,
              content: segment.content,
              audioUrl: `/audio/podcasts/${segmentFileName}`,
              startTime: totalDuration,
              duration: estimatedDuration,
              keyPoints: segment.keyPoints || [],
              order: segment.order || index + 1,
            });

            totalDuration += estimatedDuration;
          } catch (audioError) {
            console.error(`Error generating audio for segment ${index + 1}:`, audioError);
            // Continue with other segments even if one fails
          }
        }

        // Step 3: Generate episode summary and schema
        const summaryResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: `Create a comprehensive podcast episode summary including:
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
              }`
            },
            {
              role: 'user',
              content: `Podcast Title: ${structuredContent.episodeTitle}
              Segments: ${JSON.stringify(segments.map(s => ({ title: s.title, keyPoints: s.keyPoints })))}`
            }
          ],
        });

        let episodeSummary;
        try {
          episodeSummary = JSON.parse(summaryResponse.choices[0]?.message?.content || '{}');
        } catch (parseError) {
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

        // Step 4: Create artifact in database
        const podcastContent = {
          originalInput: input.podcastData,
          episodeMetadata: {
            title: structuredContent.episodeTitle || input.podcastData.title,
            description: input.podcastData.description,
            totalDuration: totalDuration,
            voice: input.podcastData.voice,
            speed: input.podcastData.speed,
            generatedAt: new Date().toISOString(),
          },
          segments: segments,
          summary: episodeSummary,
          schema: {
            episodeStructure: segments.map(s => ({
              title: s.title,
              duration: s.duration,
              keyPoints: s.keyPoints,
            })),
            knowledgeMap: {
              concepts: episodeSummary.keyConcepts,
              objectives: episodeSummary.learningObjectives,
              prerequisites: episodeSummary.prerequisites,
            }
          }
        };

        const artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.PODCAST_EPISODE,
            title: structuredContent.episodeTitle || input.podcastData.title,
            content: JSON.stringify(podcastContent),
          },
        });

        // Create initial version
        await ctx.db.artifactVersion.create({
          data: {
            artifactId: artifact.id,
            version: 1,
            content: artifact.content,
          },
        });

        return {
          id: artifact.id,
          title: artifact.title,
          segments: segments,
          summary: episodeSummary,
          metadata: podcastContent.episodeMetadata,
          schema: podcastContent.schema,
        };

      } catch (error) {
        console.error('Error generating podcast episode:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to generate podcast episode' 
        });
      }
    }),

  // Regenerate a specific segment
  regenerateSegment: authedProcedure
    .input(z.object({
      episodeId: z.string(),
      segmentId: z.string(),
      newContent: z.string().optional(),
      voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).optional(),
      speed: z.number().min(0.25).max(4.0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await ctx.db.artifact.findFirst({
        where: { 
          id: input.episodeId,
          type: ArtifactType.PODCAST_EPISODE,
          workspace: { ownerId: ctx.session.user.id }
        },
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        const episodeData = JSON.parse(episode.content);
        const segment = episodeData.segments.find((s: any) => s.id === input.segmentId);
        
        if (!segment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Segment not found' });

        // Use new content or existing content
        const contentToSpeak = input.newContent || segment.content;
        const voice = input.voice || episodeData.episodeMetadata.voice || 'nova';
        const speed = input.speed || episodeData.episodeMetadata.speed || 1.0;

        // Generate new audio
        const mp3Response = await openai.audio.speech.create({
          model: 'tts-1',
          voice: voice,
          speed: speed,
          input: contentToSpeak,
        });

        // Save new audio file
        const audioDir = path.join(process.cwd(), 'public', 'audio', 'podcasts');
        const newFileName = `${input.episodeId}_segment_${segment.order}_${Date.now()}.mp3`;
        const newFilePath = path.join(audioDir, newFileName);
        const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());
        fs.writeFileSync(newFilePath, audioBuffer);

        // Update segment data
        segment.content = contentToSpeak;
        segment.audioUrl = `/audio/podcasts/${newFileName}`;
        
        // Recalculate duration
        const wordCount = contentToSpeak.split(' ').length;
        segment.duration = Math.ceil((wordCount / 150) * 60);

        // Update artifact
        const updatedContent = JSON.stringify(episodeData);
        const updatedArtifact = await ctx.db.artifact.update({
          where: { id: input.episodeId },
          data: {
            content: updatedContent,
            updatedAt: new Date(),
          },
        });

        // Create new version
        const latestVersion = await ctx.db.artifactVersion.findFirst({
          where: { artifactId: input.episodeId },
          orderBy: { version: 'desc' },
        });

        await ctx.db.artifactVersion.create({
          data: {
            artifactId: input.episodeId,
            version: (latestVersion?.version || 0) + 1,
            content: updatedContent,
          },
        });

        return {
          segmentId: input.segmentId,
          audioUrl: segment.audioUrl,
          duration: segment.duration,
          content: segment.content,
        };

      } catch (error) {
        console.error('Error regenerating segment:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to regenerate segment' 
        });
      }
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
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });

      const episodeData = JSON.parse(episode.content);
      return {
        schema: episodeData.schema,
        segments: episodeData.segments.map((s: any) => ({
          id: s.id,
          title: s.title,
          startTime: s.startTime,
          duration: s.duration,
          keyPoints: s.keyPoints,
          order: s.order,
        })),
        summary: episodeData.summary,
        metadata: episodeData.episodeMetadata,
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
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });

      const episodeData = JSON.parse(episode.content);
      
      // Update metadata
      if (input.title) episodeData.episodeMetadata.title = input.title;
      if (input.description) episodeData.episodeMetadata.description = input.description;

      const updatedContent = JSON.stringify(episodeData);
      
      return ctx.db.artifact.update({
        where: { id: input.episodeId },
        data: {
          title: input.title ?? episode.title,
          content: updatedContent,
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
      });
      
      if (!episode) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        // Parse episode data to get audio file paths
        const episodeData = JSON.parse(episode.content);
        const audioDir = path.join(process.cwd(), 'public');

        // Delete audio files
        for (const segment of episodeData.segments || []) {
          if (segment.audioUrl) {
            const filePath = path.join(audioDir, segment.audioUrl);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        }

        // Delete associated versions
        await ctx.db.artifactVersion.deleteMany({
          where: { artifactId: input.episodeId },
        });

        // Delete the artifact
        await ctx.db.artifact.delete({
          where: { id: input.episodeId },
        });

        return true;

      } catch (error) {
        console.error('Error deleting episode:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to delete episode' 
        });
      }
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
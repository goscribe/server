import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { v4 as uuidv4 } from 'uuid';
import inference from '../lib/inference.js';
import { uploadToGCS, generateSignedUrl, deleteFromGCS } from '../lib/storage.js';

// Prisma enum values mapped manually to avoid type import issues in ESM
const ArtifactType = {
  PODCAST_EPISODE: 'PODCAST_EPISODE',
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
  objectKey: z.string().optional(), // Google Cloud Storage object key
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

// Podcast metadata schema for version data
const podcastMetadataSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  totalDuration: z.number(),
  voice: z.string(),
  speed: z.number(),
  segments: z.array(podcastSegmentSchema),
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
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Transform to include metadata from the latest version
      return artifacts.map(artifact => {
        const latestVersion = artifact.versions[0];
        if (!latestVersion) return artifact;

        try {
          const metadata = podcastMetadataSchema.parse(latestVersion.data);
          return {
            ...artifact,
            title: metadata.title, // Use title from version metadata
            description: metadata.description, // Use description from version metadata
            metadata,
            segments: metadata.segments.map(segment => ({
              id: segment.id,
              title: segment.title,
              audioUrl: segment.audioUrl,
              objectKey: segment.objectKey, // Include objectKey for URL refresh
              startTime: segment.startTime,
              duration: segment.duration,
              order: segment.order,
            })),
          };
        } catch (error) {
          console.error('Failed to parse podcast metadata:', error);
          return artifact;
        }
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
      
      const latestVersion = episode.versions[0];
      if (!latestVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'No version found' });
      
      const metadata = podcastMetadataSchema.parse(latestVersion.data);
      
      return {
        id: episode.id,
        title: metadata.title, // Use title from version metadata
        description: metadata.description, // Use description from version metadata
        metadata,
        segments: metadata.segments.map(segment => ({
          id: segment.id,
          title: segment.title,
          content: segment.content,
          objectKey: segment.objectKey, // Include objectKey for URL refresh
          startTime: segment.startTime,
          duration: segment.duration,
          keyPoints: segment.keyPoints,
          order: segment.order,
        })),
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

      try {
        // Step 1: Structure the content into segments using inference API
        const structurePrompt = `You are a podcast content structuring assistant. Given text content, break it down into logical segments for a podcast episode.
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
        }

        Title: ${input.podcastData.title}
        Description: ${input.podcastData.description || 'No description provided'}
        Content to structure: ${input.podcastData.content}`;

        const structureResponse = await inference(structurePrompt, 'podcast_structure');
        const structureData = await structureResponse.json();
        const structureContent = structureData.response || '';

        let structuredContent;
        try {
          // Extract JSON from the response
          const jsonMatch = structureContent.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in response');
          }
          structuredContent = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('Failed to parse structure response:', structureContent);
          throw new TRPCError({ 
            code: 'INTERNAL_SERVER_ERROR', 
            message: 'Failed to structure podcast content' 
          });
        }
        // Step 2: Generate audio for each segment
        const segments = [];
        let totalDuration = 0;
        let fullTranscript = '';

        for (const [index, segment] of structuredContent.segments.entries()) {
          try {
            // Generate speech for this segment using Murf TTS
            const mp3Response = await fetch('https://api.murf.ai/v1/speech/generate', {
              method: 'POST',
              headers: {
                'api-key': process.env.MURF_TTS_KEY || '',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                text: segment.content,
                voiceId: 'en-US-natalie',
              }),
            });

            if (!mp3Response.ok) {
              throw new Error(`Murf TTS error: ${mp3Response.status} ${mp3Response.statusText}`);
            }

            // Parse the response to get the audio URL
            const mp3Data = await mp3Response.json();

            // Check for different possible response structures
            const audioUrl = mp3Data.audioFile || mp3Data.audioUrl || mp3Data.url || mp3Data.downloadUrl;
            
            if (!audioUrl) {
              console.error('No audio URL found in Murf response. Available fields:', Object.keys(mp3Data));
              throw new Error('No audio URL in Murf response');
            }

            // Download the actual audio file from the URL
            const audioResponse = await fetch(audioUrl);
            if (!audioResponse.ok) {
              throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
            }


            // Upload to Google Cloud Storage
            const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
            const fileName = `segment_${index + 1}.mp3`;
            const uploadResult = await uploadToGCS(audioBuffer, fileName, 'audio/mpeg', false); // Keep private

            // Estimate duration (roughly 150 words per minute for TTS)
            const wordCount = segment.content.split(' ').length;
            const estimatedDuration = Math.ceil((wordCount / 150) * 60); // in seconds

            segments.push({
              id: uuidv4(),
              title: segment.title,
              content: segment.content,
              objectKey: uploadResult.objectKey, // Store object key for future operations
              startTime: totalDuration,
              duration: estimatedDuration,
              keyPoints: segment.keyPoints || [],
              order: segment.order || index + 1,
            });

            totalDuration += estimatedDuration;
            fullTranscript += `\n\n## ${segment.title}\n\n${segment.content}`;
          } catch (audioError) {
            console.error(`Error generating audio for segment ${index + 1}:`, audioError);
            // Continue with other segments even if one fails
          }
        }

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

        Podcast Title: ${structuredContent.episodeTitle}
        Segments: ${JSON.stringify(segments.map(s => ({ title: s.title, keyPoints: s.keyPoints })))}`;

        const summaryResponse = await inference(summaryPrompt, 'podcast_summary');
        const summaryData = await summaryResponse.json();
        const summaryContent = summaryData.response || '';

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

        // Step 4: Create artifact and initial version
        const episodeTitle = structuredContent.episodeTitle || input.podcastData.title;
        
        const artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.PODCAST_EPISODE,
            title: episodeTitle, // Store basic title for listing/searching
            description: input.podcastData.description, // Store basic description for listing/searching
            createdById: ctx.session.user.id,
          },
        });

        // Create initial version with complete metadata
        const metadata = {
          title: episodeTitle,
          description: input.podcastData.description,
          totalDuration: totalDuration,
          voice: input.podcastData.voice,
          speed: input.podcastData.speed,
          segments: segments,
          summary: episodeSummary,
          generatedAt: new Date().toISOString(),
        };

        await ctx.db.artifactVersion.create({
          data: {
            artifactId: artifact.id,
            version: 1,
            content: fullTranscript.trim(), // Full transcript as markdown
            data: metadata,
            createdById: ctx.session.user.id,
          },
        });

        return {
          id: artifact.id,
          title: metadata.title,
          description: metadata.description,
          metadata,
          content: fullTranscript.trim(),
        };

      } catch (error) {
        console.error('Error generating podcast episode:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `Failed to generate podcast episode: ${error instanceof Error ? error.message : 'Unknown error'}` 
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
      const segment = metadata.segments.find(s => s.id === input.segmentId);
      
      if (!segment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Segment not found' });

      try {
        // Use new content or existing content
        const contentToSpeak = input.newContent || segment.content;
        const voice = input.voice || metadata.voice || 'nova';
        const speed = input.speed || metadata.speed || 1.0;

        // Generate new audio using Murf TTS
        const mp3Response = await fetch('https://api.murf.ai/v1/speech/generate', {
          method: 'POST',
          headers: {
            'api-key': process.env.MURF_TTS_KEY || '',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            text: contentToSpeak,
            voiceId: 'en-US-natalie',
          }),
        });

        if (!mp3Response.ok) {
          throw new Error(`Murf TTS error: ${mp3Response.status} ${mp3Response.statusText}`);
        }

                    // Parse the response to get the audio URL
            const mp3Data = await mp3Response.json();
            
            // Check for different possible response structures
            const audioUrl = mp3Data.audioFile || mp3Data.audioUrl || mp3Data.url || mp3Data.downloadUrl;
            
            if (!audioUrl) {
              console.error('No audio URL found in Murf response. Available fields:', Object.keys(mp3Data));
              throw new Error('No audio URL in Murf response');
            }

        // Download the actual audio file from the URL
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
          throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
        }

        // Upload to Google Cloud Storage
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
        const fileName = `segment_${segment.order}_${Date.now()}.mp3`;
        const uploadResult = await uploadToGCS(audioBuffer, fileName, 'audio/mpeg', false); // Keep private

        // Update segment data
        segment.content = contentToSpeak;
        segment.objectKey = uploadResult.objectKey; // Store object key
        
        // Recalculate duration
        const wordCount = contentToSpeak.split(' ').length;
        segment.duration = Math.ceil((wordCount / 150) * 60);

        // Recalculate start times for subsequent segments
        let currentTime = 0;
        for (const seg of metadata.segments) {
          if (seg.order < segment.order) {
            currentTime += seg.duration;
          } else if (seg.order === segment.order) {
            seg.startTime = currentTime;
            currentTime += seg.duration;
          } else {
            seg.startTime = currentTime;
            currentTime += seg.duration;
          }
        }

        // Update total duration
        metadata.totalDuration = currentTime;

        // Rebuild transcript
        const fullTranscript = metadata.segments
          .sort((a, b) => a.order - b.order)
          .map(s => `\n\n## ${s.title}\n\n${s.content}`)
          .join('');

        // Create new version
        const nextVersion = (latestVersion.version || 0) + 1;
        await ctx.db.artifactVersion.create({
          data: {
            artifactId: input.episodeId,
            version: nextVersion,
            content: fullTranscript.trim(),
            data: metadata,
            createdById: ctx.session.user.id,
          },
        });

        return {
          segmentId: input.segmentId,
          audioUrl: segment.audioUrl,
          duration: segment.duration,
          content: segment.content,
          totalDuration: metadata.totalDuration,
        };

      } catch (error) {
        console.error('Error regenerating segment:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `Failed to regenerate segment: ${error instanceof Error ? error.message : 'Unknown error'}` 
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
      
      return {
        segments: metadata.segments.map(s => ({
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
          voice: metadata.voice,
          speed: metadata.speed,
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
        // Parse episode data to get audio file paths
        const latestVersion = episode.versions[0];
        if (latestVersion) {
          const metadata = podcastMetadataSchema.parse(latestVersion.data);

          // Delete audio files from Google Cloud Storage
          for (const segment of metadata.segments || []) {
            if (segment.objectKey) {
              try {
                await deleteFromGCS(segment.objectKey);
              } catch (error) {
                console.error(`Failed to delete audio file ${segment.objectKey}:`, error);
              }
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

  // Get fresh signed URLs for an episode (doesn't create new version)
  getSignedUrls: authedProcedure
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
      
      const latestVersion = episode.versions[0];
      if (!latestVersion) throw new TRPCError({ code: 'NOT_FOUND', message: 'No version found' });

      const metadata = podcastMetadataSchema.parse(latestVersion.data);
      
      // Generate fresh signed URLs for all segments
      const segmentsWithUrls = await Promise.all(
        metadata.segments.map(async (segment) => {
          if (segment.objectKey) {
            try {
              const signedUrl = await generateSignedUrl(segment.objectKey, 24); // 24 hours
              return {
                id: segment.id,
                title: segment.title,
                audioUrl: signedUrl,
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
            startTime: segment.startTime,
            duration: segment.duration,
            order: segment.order,
          };
        })
      );

      return {
        segments: segmentsWithUrls,
      };
    }),


});
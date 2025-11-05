import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { v4 as uuidv4 } from 'uuid';
import inference from '../lib/inference.js';
import { uploadToSupabase, generateSignedUrl, deleteFromSupabase } from '../lib/storage.js';
import PusherService from '../lib/pusher.js';

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

// Podcast creation input schema
const podcastInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  userPrompt: z.string(),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('nova'),
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
  voice: z.string(),
  speed: z.number(),
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

      const metadata = podcastMetadataSchema.parse(latestVersion.data);

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
      
      // Validate Murf TTS API key
      if (!process.env.MURF_TTS_KEY) {
        throw new TRPCError({ 
          code: 'PRECONDITION_FAILED',
          message: 'Murf TTS API key is not configured. Please add MURF_TTS_KEY to your environment variables.' 
        });
      }
      
      try {
        // Emit podcast generation start notification
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_generation_start', { 
          title: input.podcastData.title 
        });

        const studyGuide = await ctx.db.artifact.findFirst({
          where: {
            workspaceId: input.workspaceId,
            type: ArtifactType.STUDY_GUIDE,
          },
          include: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
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

        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_info_start', {
          status: 'generating',
          id: newArtifact.id,
          message: BEGIN_PODCAST_GENERATION_MESSAGE,
        })

        const latestVersion = studyGuide?.versions[0];
        const studyGuideContent = latestVersion?.content || '';

        // Step 1: Structure the content into segments using inference API
        const structurePrompt = `You are a podcast content structuring assistant. Given a user prompt, create a complete podcast episode with engaging content and logical segments.
        
        Based on the user's prompt (and any existing study guide context for this workspace), generate a podcast episode that:
        - Addresses the user's request or topic
        - Is educational, informative, and engaging
        - Has natural, conversational language
        - Flows logically from one segment to the next
        
        Create segments that are:
        - 2-5 minutes each when spoken
        - Focused on specific topics or concepts
        - Include key takeaways for each segment
        - Use natural, conversational language suitable for audio

        ${input.podcastData.generateIntro ? 'Include an engaging introduction segment that hooks the listener.' : ''}
        ${input.podcastData.generateOutro ? 'Include a conclusion/outro segment that summarizes key points.' : ''}

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
        User Prompt: ${input.podcastData.userPrompt}
        
        If there is a study guide artifact in this workspace, incorporate its key points and structure to improve coherence. Use it only as supportive context, do not copy verbatim.
        Attached is the study guide:
        ${studyGuideContent}
        `;

        const structureResponse = await inference(structurePrompt);
        const structureContent: string = structureResponse.choices[0].message.content || '';

        let structuredContent;
        try {
          // Extract JSON from the response
          const jsonMatch = structureContent.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error('No JSON found in response');
          }
          structuredContent = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          // @todo: yk like delete the record if it fails...
          console.error('Failed to parse structure response:', structureContent);
          await PusherService.emitError(input.workspaceId, 'Failed to structure podcast content', 'podcast');
          throw new TRPCError({ 
            code: 'INTERNAL_SERVER_ERROR', 
            message: 'Failed to structure podcast content' 
          });
        }

        // Emit structure completion notification
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_structure_complete', { 
          segmentsCount: structuredContent.segments?.length || 0 
        });

        // Step 2: Generate audio for each segment
        const segments = [];
        const failedSegments = [];
        let totalDuration = 0;
        let fullTranscript = '';

        // Emit audio generation start notification
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_audio_generation_start', { 
          totalSegments: structuredContent.segments?.length || 0 
        });

        for (const [index, segment] of structuredContent.segments.entries()) {
          try {
            // Emit segment generation progress
            await PusherService.emitTaskComplete(input.workspaceId, 'podcast_segment_progress', { 
              currentSegment: index + 1,
              totalSegments: structuredContent.segments.length,
              segmentTitle: segment.title || `Segment ${index + 1}`,
              successfulSegments: segments.length,
              failedSegments: failedSegments.length,
            });

            await ctx.db.artifact.update({
              where: {
                id: newArtifact.id,
              },
              data: {
                generatingMetadata: {
                  currentSegment: index + 1,
                  totalSegments: structuredContent.segments.length,
                  segmentTitle: segment.title || `Segment ${index + 1}`,
                  message: `Generating audio for segment ${index + 1} of ${structuredContent.segments.length}...`,
                  successfulSegments: segments.length,
                  failedSegments: failedSegments.length,
                }
              }
            })

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


            // Upload to Supabase Storage
            const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
            const fileName = `workspace${workspace.id}/segment_${index + 1}.mp3`;
            const uploadResult = await uploadToSupabase(audioBuffer, fileName, 'audio/mpeg', false); // Keep private

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
            const errorMessage = audioError instanceof Error ? audioError.message : 'Unknown error';
            console.error(`❌ Error generating audio for segment ${index + 1}:`, {
              title: segment.title,
              error: errorMessage,
              stack: audioError instanceof Error ? audioError.stack : undefined,
            });
            
            // Track failed segment
            failedSegments.push({
              index: index + 1,
              title: segment.title || `Segment ${index + 1}`,
              error: errorMessage,
            });
            
            await PusherService.emitTaskComplete(input.workspaceId, 'podcast_segment_error', { 
              segmentIndex: index + 1,
              segmentTitle: segment.title || `Segment ${index + 1}`,
              error: errorMessage,
              successfulSegments: segments.length,
              failedSegments: failedSegments.length,
            });
            
            // Continue with other segments even if one fails
          }
        }
        
        console.log(`📊 Segment generation complete: ${segments.length} successful, ${failedSegments.length} failed`);
        if (failedSegments.length > 0) {
          console.error('Failed segments:', failedSegments);
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
        
        // Warn if some segments failed but continue
        if (failedSegments.length > 0) {
          await PusherService.emitTaskComplete(input.workspaceId, 'podcast_partial_success', { 
            successfulSegments: segments.length,
            failedSegments: failedSegments.length,
            totalAttempted: structuredContent.segments.length,
          });
        }

        // Emit audio generation completion notification
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_audio_generation_complete', { 
          totalSegments: segments.length,
          totalDuration: totalDuration
        });

        await ctx.db.artifact.update({
          where: {
            id: newArtifact.id,
          },
          data: {
            generatingMetadata: {
              message: `Preparing podcast summary...`,
            }
          }
        })

        // Step 2.5: Prepare segment audio array for frontend joining
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_audio_preparation_complete', { 
          totalSegments: segments.length
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

        Podcast Title: ${structuredContent.episodeTitle}
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
        await PusherService.emitTaskComplete(input.workspaceId, 'podcast_summary_complete', { 
          summaryGenerated: true
        });

        // Step 4: Create artifact and initial version
        const episodeTitle = structuredContent.episodeTitle || input.podcastData.title;
        
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
            generating: false,
          },
        });

        // Create segments in the database
        console.log(`💾 Creating ${segments.length} segments in database for artifact ${newArtifact.id}`);
        
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
              voice: input.podcastData.voice,
              speed: input.podcastData.speed,
            },
          })),
        });
        
        console.log(`✅ Successfully created ${createdSegments.count} segments in database`);

        // Create initial version with metadata (without segments array)
        const metadata = {
          title: episodeTitle,
          description: input.podcastData.description,
          totalDuration: totalDuration,
          voice: input.podcastData.voice,
          speed: input.podcastData.speed,
          summary: episodeSummary,
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
        await PusherService.emitError(input.workspaceId, `Failed to generate podcast episode: ${error instanceof Error ? error.message : 'Unknown error'}`, 'podcast');
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
      prompt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const episode = await ctx.db.artifact.findFirst({
        where: { 
          id: input.episodeId,
          type: ArtifactType.PODCAST_EPISODE,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          workspace: true,
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
      const segment = episode.podcastSegments.find(s => s.id === input.segmentId);
      
      if (!segment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Segment not found' });

      try {
        // Emit segment regeneration start notification
        await PusherService.emitTaskComplete(episode.workspaceId, 'podcast_segment_regeneration_start', { 
          segmentId: input.segmentId,
          segmentTitle: segment.title || 'Untitled Segment'
        });

        // get old content
        const oldContent = segment.content;
        
        const newContentPrompt = `
        You are a podcast content regenerating assistant. Given a user prompt, create a revised for a podcast segment.

        Old content: ${oldContent}
        New prompt: ${input.prompt}

        Return the new content only, no other text.

        Example:
        Old content: "This is the old content."
        New prompt: "Revise the content to be more engaging."
        New content: "This is the new content."

        Old content: "This is the old content."
        New prompt: "Revise the content to be more informative."
        New content: "This is the new content."

        Old content: "This is the old content."
        New prompt: "Revise the content to be more educational."
        New content: "This is the new content."
        `
        await ctx.db.podcastSegment.update({
          where: { id: segment.id },
          data: {
            generatingMetadata: {
              message: `Regenerating segment ${segment.title}...`,
            }
          }
        });
        const newContentResponse = await inference(newContentPrompt);
        const newContent = newContentResponse.choices[0].message.content || '';

        await ctx.db.podcastSegment.update({
          where: { id: segment.id },
          data: {
            generatingMetadata: {
              message: `Generating new audio for segment ${segment.title}...`,
            }
          }
        });
        // Generate new audio using Murf TTS
        const mp3Response = await fetch('https://api.murf.ai/v1/speech/generate', {
          method: 'POST',
          headers: {
            'api-key': process.env.MURF_TTS_KEY || '',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            text: newContent,
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

        await ctx.db.podcastSegment.update({
          where: { id: input.segmentId },
          data: {
            generatingMetadata: {
              message: `Downloading new audio for segment ${segment.title}...`,
            }
          }
        });
        // Download the actual audio file from the URL
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
          throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
        }

        await ctx.db.podcastSegment.update({
          where: { id: segment.id },
          data: {
            generatingMetadata: {
              message: `Uploading new audio for segment ${segment.title}...`,
            }
          }
        });
        // Upload to Supabase Storage
        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
        const fileName = `segment_${segment.order}_${Date.now()}.mp3`;
        const uploadResult = await uploadToSupabase(audioBuffer, fileName, 'audio/mpeg', false); // Keep private

        // Recalculate duration
        const wordCount = newContent.split(' ').length;
        const newDuration = Math.ceil((wordCount / 150) * 60);

        // Update segment in database
        await ctx.db.podcastSegment.update({
          where: { id: segment.id },
          data: {
            content: newContent,
            objectKey: uploadResult.objectKey,
            duration: newDuration,
          },
        });

        // Recalculate start times for all segments
        const allSegments = await ctx.db.podcastSegment.findMany({
          where: { artifactId: segment.artifactId },
          orderBy: { order: 'asc' },
        });

        let currentTime = 0;
        for (const seg of allSegments) {
          await ctx.db.podcastSegment.update({
            where: { id: seg.id },
            data: { startTime: currentTime },
          });
          currentTime += seg.id === input.segmentId ? newDuration : seg.duration;
        }

        // Update total duration in metadata
        metadata.totalDuration = currentTime;

        // Rebuild transcript
        const fullTranscript = allSegments
          .sort((a, b) => a.order - b.order)
          .map(s => `\n\n## ${s.title}\n\n${s.content}`)
          .join('');

        // Step: Update segment audio (no need to regenerate full episode)
        await PusherService.emitTaskComplete(episode.workspaceId, 'podcast_segment_audio_updated', { 
          segmentId: input.segmentId,
          totalSegments: allSegments.length
        });

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

        // Emit segment regeneration completion notification
        await PusherService.emitTaskComplete(episode.workspaceId, 'podcast_segment_regeneration_complete', { 
          segmentId: input.segmentId,
          segmentTitle: segment.title || 'Untitled Segment',
          duration: segment.duration
        });

        await ctx.db.artifact.update({
          where: { id: input.episodeId },
          data: {
            generating: false,
            generatingMetadata: {
              message: `Segment regeneration complete`,
            }
          }
        });

        return {
          segmentId: input.segmentId,
          audioUrl: null, // Will be generated fresh on next request
          duration: newDuration,
          content: newContent,
          totalDuration: metadata.totalDuration,
        };

      } catch (error) {
        console.error('Error regenerating segment:', error);
        await PusherService.emitError(episode.workspaceId, `Failed to regenerate segment: ${error instanceof Error ? error.message : 'Unknown error'}`, 'podcast');
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `Failed to regenerate segment: ${error instanceof Error ? error.message : 'Unknown error'}` 
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
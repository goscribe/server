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

// Meeting summary schema for structured data
const meetingSchema = z.object({
  title: z.string(),
  participants: z.array(z.string()),
  date: z.string(),
  duration: z.string().optional(),
  agenda: z.array(z.string()).optional(),
  transcript: z.string().optional(),
  notes: z.string().optional(),
});

export const meetingSummarize = router({
  // List all meeting summaries for a workspace
  listSummaries: authedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });
      
      return ctx.db.artifact.findMany({
        where: { 
          workspaceId: input.workspaceId, 
          type: ArtifactType.MEETING_SUMMARY 
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

  // Get a specific meeting summary
  getSummary: authedProcedure
    .input(z.object({ summaryId: z.string() }))
    .query(async ({ ctx, input }) => {
      const summary = await ctx.db.artifact.findFirst({
        where: { 
          id: input.summaryId,
          type: ArtifactType.MEETING_SUMMARY,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      if (!summary) throw new TRPCError({ code: 'NOT_FOUND' });
      return summary;
    }),

  // Upload and process audio/video file
  uploadFile: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      fileName: z.string(),
      fileBuffer: z.string(), // Base64 encoded file
      mimeType: z.string(),
      title: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

      // Validate file type
      const allowedTypes = ['audio/mpeg', 'audio/mp3', 'video/mp4', 'audio/wav', 'audio/m4a'];
      if (!allowedTypes.includes(input.mimeType)) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'Unsupported file type. Please upload MP3, MP4, WAV, or M4A files.' 
        });
      }

      try {
        // Create temporary file
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const fileId = uuidv4();
        const fileExtension = path.extname(input.fileName);
        const tempFilePath = path.join(tempDir, `${fileId}${fileExtension}`);
        
        // Write buffer to temporary file
        const fileBuffer = Buffer.from(input.fileBuffer, 'base64');
        fs.writeFileSync(tempFilePath, fileBuffer);

        // Transcribe audio using OpenAI Whisper
        const transcript = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempFilePath),
          model: 'whisper-1',
          response_format: 'text',
        });

        // Generate meeting summary using GPT
        const summaryResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: `You are a meeting summarizer. Given a meeting transcript, create a comprehensive summary that includes:
              1. Meeting title/topic
              2. Key participants mentioned
              3. Main discussion points
              4. Action items
              5. Decisions made
              6. Next steps
              Format the response as JSON with the following structure:
              {
                "title": "Meeting title",
                "participants": ["participant1", "participant2"],
                "keyPoints": ["point1", "point2"],
                "actionItems": ["action1", "action2"],
                "decisions": ["decision1", "decision2"],
                "nextSteps": ["step1", "step2"],
                "summary": "Overall meeting summary"
              }`
            },
            {
              role: 'user',
              content: `Please summarize this meeting transcript: ${transcript}`
            }
          ],
        });

        let summaryData;
        try {
          summaryData = JSON.parse(summaryResponse.choices[0]?.message?.content || '{}');
        } catch (parseError) {
          // Fallback if JSON parsing fails
          summaryData = {
            title: input.title || 'Meeting Summary',
            participants: [],
            keyPoints: [],
            actionItems: [],
            decisions: [],
            nextSteps: [],
            summary: summaryResponse.choices[0]?.message?.content || 'Unable to generate summary'
          };
        }

        // Create artifact in database
        const artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.MEETING_SUMMARY,
            title: summaryData.title || input.title || 'Meeting Summary',
            content: JSON.stringify({
              originalFileName: input.fileName,
              transcript: transcript,
              ...summaryData
            }),
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

        // Clean up temporary file
        fs.unlinkSync(tempFilePath);

        return {
          id: artifact.id,
          title: artifact.title,
          summary: summaryData,
          transcript: transcript,
        };

      } catch (error) {
        console.error('Error processing meeting file:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to process meeting file' 
        });
      }
    }),

  // Process meeting data from schema
  processSchema: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      meetingData: meetingSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId, ownerId: ctx.session.user.id },
      });
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

      try {
        // Create content for AI processing
        const meetingContent = `
          Meeting Title: ${input.meetingData.title}
          Participants: ${input.meetingData.participants.join(', ')}
          Date: ${input.meetingData.date}
          Duration: ${input.meetingData.duration || 'Not specified'}
          Agenda: ${input.meetingData.agenda?.join(', ') || 'Not provided'}
          Notes: ${input.meetingData.notes || 'Not provided'}
          Transcript: ${input.meetingData.transcript || 'Not provided'}
        `;

        // Generate enhanced summary using GPT
        const summaryResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: `You are a meeting summarizer. Given meeting information, create a comprehensive summary that includes:
              1. Key discussion points
              2. Action items
              3. Decisions made
              4. Next steps
              5. Important insights
              Format the response as JSON with the following structure:
              {
                "keyPoints": ["point1", "point2"],
                "actionItems": ["action1", "action2"],
                "decisions": ["decision1", "decision2"],
                "nextSteps": ["step1", "step2"],
                "insights": ["insight1", "insight2"],
                "summary": "Overall meeting summary"
              }`
            },
            {
              role: 'user',
              content: `Please analyze and summarize this meeting information: ${meetingContent}`
            }
          ],
        });

        let summaryData;
        try {
          summaryData = JSON.parse(summaryResponse.choices[0]?.message?.content || '{}');
        } catch (parseError) {
          // Fallback if JSON parsing fails
          summaryData = {
            keyPoints: [],
            actionItems: [],
            decisions: [],
            nextSteps: [],
            insights: [],
            summary: summaryResponse.choices[0]?.message?.content || 'Unable to generate summary'
          };
        }

        // Create artifact in database
        const artifact = await ctx.db.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            type: ArtifactType.MEETING_SUMMARY,
            title: input.meetingData.title,
            content: JSON.stringify({
              originalData: input.meetingData,
              ...summaryData
            }),
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
          summary: summaryData,
          originalData: input.meetingData,
        };

      } catch (error) {
        console.error('Error processing meeting schema:', error);
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: 'Failed to process meeting data' 
        });
      }
    }),

  // Update an existing meeting summary
  updateSummary: authedProcedure
    .input(z.object({
      summaryId: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const summary = await ctx.db.artifact.findFirst({
        where: { 
          id: input.summaryId,
          type: ArtifactType.MEETING_SUMMARY,
          workspace: { ownerId: ctx.session.user.id }
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      
      if (!summary) throw new TRPCError({ code: 'NOT_FOUND' });

      // Update artifact
      const updatedArtifact = await ctx.db.artifact.update({
        where: { id: input.summaryId },
        data: {
          title: input.title ?? summary.title,
          content: input.content ?? summary.content,
          updatedAt: new Date(),
        },
      });

      // Create new version if content changed
      if (input.content && input.content !== summary.content) {
        const latestVersion = summary.versions[0]?.version || 0;
        await ctx.db.artifactVersion.create({
          data: {
            artifactId: input.summaryId,
            version: latestVersion + 1,
            content: input.content,
          },
        });
      }

      return updatedArtifact;
    }),

  // Delete a meeting summary
  deleteSummary: authedProcedure
    .input(z.object({ summaryId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const summary = await ctx.db.artifact.findFirst({
        where: { 
          id: input.summaryId,
          type: ArtifactType.MEETING_SUMMARY,
          workspace: { ownerId: ctx.session.user.id }
        },
      });
      
      if (!summary) throw new TRPCError({ code: 'NOT_FOUND' });

      // Delete associated versions first
      await ctx.db.artifactVersion.deleteMany({
        where: { artifactId: input.summaryId },
      });

      // Delete the artifact
      await ctx.db.artifact.delete({
        where: { id: input.summaryId },
      });

      return true;
    }),

  // Get meeting versions/history
  getVersions: authedProcedure
    .input(z.object({ summaryId: z.string() }))
    .query(async ({ ctx, input }) => {
      const summary = await ctx.db.artifact.findFirst({
        where: { 
          id: input.summaryId,
          type: ArtifactType.MEETING_SUMMARY,
          workspace: { ownerId: ctx.session.user.id }
        },
      });
      
      if (!summary) throw new TRPCError({ code: 'NOT_FOUND' });

      return ctx.db.artifactVersion.findMany({
        where: { artifactId: input.summaryId },
        orderBy: { version: 'desc' },
      });
    }),
});
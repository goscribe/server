import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc.js';
import { aiSessionService } from '../lib/ai-session.js';

export const aiSession = router({
  // Initialize a new AI session
  init: authedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return aiSessionService.initSession(ctx.session.user.id, input.workspaceId);
    }),

  // Upload file to AI session
  uploadFile: authedProcedure
    .input(z.object({
      sessionId: z.string(),
      fileType: z.enum(['image', 'pdf']),
      // Note: File handling will need to be implemented based on your file upload strategy
      fileName: z.string(),
      fileContent: z.string(), // Base64 encoded content
    }))
    .mutation(async ({ ctx, input }) => {
      // Convert base64 to File object for the AI service
      const buffer = Buffer.from(input.fileContent, 'base64');
      const file = new File([buffer], input.fileName, {
        type: input.fileType === 'image' ? 'image/jpeg' : 'application/pdf',
      });

      await aiSessionService.uploadFile(input.sessionId, file, input.fileType);
      return { success: true };
    }),

  // Set instruction text
  setInstruction: authedProcedure
    .input(z.object({
      sessionId: z.string(),
      instructionText: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await aiSessionService.setInstruction(input.sessionId, input.instructionText);
      return { success: true };
    }),

  // Start LLM session
  startLLM: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await aiSessionService.startLLMSession(input.sessionId);
      return { success: true };
    }),

  // Get session by ID
  get: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = aiSessionService.getSession(input.sessionId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
      
      // Verify ownership
      if (session.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      
      return session;
    }),

  // List sessions for a workspace
  list: authedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return aiSessionService.getSessionsByUserAndWorkspace(ctx.session.user.id, input.workspaceId);
    }),

  // Delete session
  delete: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = aiSessionService.getSession(input.sessionId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
      
      // Verify ownership
      if (session.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      
      aiSessionService.deleteSession(input.sessionId);
      return { success: true };
    }),
});

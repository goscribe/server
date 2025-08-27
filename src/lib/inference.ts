import { TRPCError } from '@trpc/server';
import type { Context } from '../context.js';
import { aiSessionService } from './ai-session.js';

// AI generation service that integrates with external AI backend
export class InferenceService {
  constructor(private ctx: Context) {}

  // Generate flashcards from content using AI backend
  async generateFlashcards(workspaceId: string, content: string, count: number = 10) {
    // Verify workspace ownership
    const workspace = await this.ctx.db.workspace.findFirst({
      where: { id: workspaceId, ownerId: this.ctx.session.user.id },
    });
    if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

    // Initialize AI session
    const session = await aiSessionService.initSession(this.ctx.session.user.id, workspaceId);
    
    try {
      // Set instruction text
      await aiSessionService.setInstruction(session.id, content);
      
      // Start LLM session
      await aiSessionService.startLLMSession(session.id);
      
      // Generate flashcard questions
      const questionsContent = await aiSessionService.generateFlashcardQuestions(session.id, count, 'medium');
      
      // Parse the generated content and create flashcards
      const flashcards = await this.parseAndCreateFlashcards(workspaceId, questionsContent, count);
      
      return { artifact: flashcards.artifact, flashcards: flashcards.flashcards };
    } finally {
      // Clean up session
      aiSessionService.deleteSession(session.id);
    }
  }

  // Generate worksheet from content using AI backend
  async generateWorksheet(workspaceId: string, content: string, difficulty: 'EASY' | 'MEDIUM' | 'HARD' = 'MEDIUM') {
    // Verify workspace ownership
    const workspace = await this.ctx.db.workspace.findFirst({
      where: { id: workspaceId, ownerId: this.ctx.session.user.id },
    });
    if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

    // Initialize AI session
    const session = await aiSessionService.initSession(this.ctx.session.user.id, workspaceId);
    
    try {
      // Set instruction text
      await aiSessionService.setInstruction(session.id, content);
      
      // Start LLM session
      await aiSessionService.startLLMSession(session.id);
      
      // Generate worksheet questions
      const questionsContent = await aiSessionService.generateWorksheetQuestions(
        session.id, 
        difficulty === 'EASY' ? 5 : difficulty === 'MEDIUM' ? 8 : 12, 
        difficulty.toLowerCase() as 'easy' | 'medium' | 'hard'
      );
      
      // Parse the generated content and create worksheet
      const worksheet = await this.parseAndCreateWorksheet(workspaceId, questionsContent, difficulty);
      
      return { artifact: worksheet.artifact, questions: worksheet.questions };
    } finally {
      // Clean up session
      aiSessionService.deleteSession(session.id);
    }
  }

  // Generate study guide from content using AI backend
  async generateStudyGuide(workspaceId: string, content: string) {
    // Verify workspace ownership
    const workspace = await this.ctx.db.workspace.findFirst({
      where: { id: workspaceId, ownerId: this.ctx.session.user.id },
    });
    if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' });

    // Initialize AI session
    const session = await aiSessionService.initSession(this.ctx.session.user.id, workspaceId);
    
    try {
      // Set instruction text
      await aiSessionService.setInstruction(session.id, content);
      
      // Start LLM session
      await aiSessionService.startLLMSession(session.id);
      
      // Generate study guide
      const generatedContent = await aiSessionService.generateStudyGuide(session.id);
      
      // Create study guide artifact and version
      const artifact = await this.ctx.db.artifact.create({
        data: {
          workspaceId,
          type: 'STUDY_GUIDE',
          title: `Study Guide for ${workspace.title}`,
          createdById: this.ctx.session.user.id,
        },
      });

      const version = await this.ctx.db.artifactVersion.create({
        data: {
          artifactId: artifact.id,
          content: generatedContent,
          version: 1,
          createdById: this.ctx.session.user.id,
        },
      });

      return { artifact, version };
    } finally {
      // Clean up session
      aiSessionService.deleteSession(session.id);
    }
  }

  // Parse AI-generated flashcard content and create database records
  private async parseAndCreateFlashcards(workspaceId: string, content: string, count: number) {
    // Create flashcard set artifact
    const artifact = await this.ctx.db.artifact.create({
      data: {
        workspaceId,
        type: 'FLASHCARD_SET',
        title: `AI Generated Flashcards`,
        createdById: this.ctx.session.user.id,
      },
    });

    // Parse the AI-generated content (this is a simplified parser)
    // In production, you'd want more sophisticated parsing based on the AI output format
    const flashcards = [];
    for (let i = 0; i < count; i++) {
      const flashcard = await this.ctx.db.flashcard.create({
        data: {
          artifactId: artifact.id,
          front: `Question ${i + 1} from AI analysis`,
          back: `Answer ${i + 1} based on ${content.slice(0, 50)}...`,
          tags: ['ai-generated'],
          order: i,
        },
      });
      flashcards.push(flashcard);
    }

    return { artifact, flashcards };
  }

  // Parse AI-generated worksheet content and create database records
  private async parseAndCreateWorksheet(workspaceId: string, content: string, difficulty: string) {
    // Create worksheet artifact
    const artifact = await this.ctx.db.artifact.create({
      data: {
        workspaceId,
        type: 'WORKSHEET',
        title: `AI Generated Worksheet`,
        createdById: this.ctx.session.user.id,
      },
    });

    // Parse the AI-generated content (this is a simplified parser)
    // In production, you'd want more sophisticated parsing based on the AI output format
    const questionCount = difficulty === 'EASY' ? 5 : difficulty === 'MEDIUM' ? 8 : 12;
    const questions = [];
    
    for (let i = 0; i < questionCount; i++) {
      const question = await this.ctx.db.worksheetQuestion.create({
        data: {
          artifactId: artifact.id,
          prompt: `Practice problem ${i + 1}: ${content.slice(0, 50)}...`,
          answer: `Solution ${i + 1} with step-by-step explanation`,
          difficulty: difficulty as any,
          order: i,
          meta: { type: 'MCQ', choices: ['A', 'B', 'C', 'D'] },
        },
      });
      questions.push(question);
    }

    return { artifact, questions };
  }
}

// Factory function to create inference service
export function createInferenceService(ctx: Context) {
  return new InferenceService(ctx);
}

async function inference(prompt: string, tag: string) {
    try {
        const response = await fetch("https://proxy-ai.onrender.com/api/cohere/inference", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: prompt,
                model: "command-r-plus",
                max_tokens: 2000,
            }),
        });
        return response;
    } catch (error) {
        console.error('Inference error:', error);
        throw error;
    }
}

export default inference;

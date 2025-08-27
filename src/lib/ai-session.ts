import { TRPCError } from '@trpc/server';

// External AI service configuration
const AI_SERVICE_URL = 'https://txp-tckxn64wn5vtgip72-kzoemq8qw-custom.service.onethingrobot.com/upload';
const AI_RESPONSE_URL = 'https://txp-tckxn64wn5vtgip72-kzoemq8qw-custom.service.onethingrobot.com/last_response';

export interface AISession {
  id: string;
  workspaceId: string;
  status: 'initialized' | 'processing' | 'ready' | 'error';
  files: string[];
  instructionText?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AISessionService {
  private sessions = new Map<string, AISession>();

  // Initialize a new AI session
  async initSession(workspaceId: string): Promise<AISession> {
    const sessionId = `${workspaceId}`;
    
    const formData = new FormData();
    formData.append('command', 'init_session');
    formData.append('id', sessionId);

    // Retry logic for AI service
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 AI Session init attempt ${attempt}/${maxRetries} for workspace ${workspaceId}`);
        
        const response = await fetch(AI_SERVICE_URL, {
          method: 'POST',
          body: formData,
        });

        console.log(`📡 AI Service response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ AI Service error response:`, errorText);
          throw new Error(`AI service error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`📋 AI Service result:`, result);
        
        // If we get a response with a message, consider it successful
        if (!result.message) {
          throw new Error(`AI service error: No response message`);
        }

        const session: AISession = {
          id: sessionId,
          workspaceId,
          status: 'initialized',
          files: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        this.sessions.set(sessionId, session);
        console.log(`✅ AI Session initialized successfully on attempt ${attempt}`);
        return session;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        console.error(`❌ AI Session init attempt ${attempt} failed:`, lastError.message);
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`💥 All ${maxRetries} attempts failed. Last error:`, lastError?.message);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to initialize AI session after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
    });
  }

  // Upload file to AI session
  async uploadFile(sessionId: string, file: File, fileType: 'image' | 'pdf'): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const command = fileType === 'image' ? 'append_image' : 'append_pdflike';
    
    const formData = new FormData();
    formData.append('command', command);
    formData.append('file', file);

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`📋 Upload result:`, result);
      if (!result.message) {
        throw new Error(`AI service error: No response message`);
      }

      // Update session
      session.files.push(file.name);
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Set instruction text
  async setInstruction(sessionId: string, instructionText: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'set_instruct');
    formData.append('instruction_text', instructionText);

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`📋 Set instruction result:`, result);
      if (!result.message) {
        throw new Error(`AI service error: No response message`);
      }

      // Update session
      session.instructionText = instructionText;
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to set instruction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Start LLM session
  async startLLMSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'start_LLM_session');

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`📋 Start LLM result:`, result);
      if (!result.message) {
        throw new Error(`AI service error: No response message`);
      }

      // Update session
      session.status = 'ready';
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to start LLM session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Generate study guide
  async generateStudyGuide(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'generate_study_guide');

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      // Get the generated content from the response endpoint
      const contentResponse = await fetch(AI_RESPONSE_URL);
      if (!contentResponse.ok) {
        throw new Error(`Failed to retrieve generated content: ${contentResponse.status}`);
      }

      return (await contentResponse.json())['last_response'];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate study guide: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Generate flashcard questions
  async generateFlashcardQuestions(sessionId: string, numQuestions: number, difficulty: 'easy' | 'medium' | 'hard'): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'generate_flashcard_questions');
    formData.append('num_questions', numQuestions.toString());
    formData.append('difficulty', difficulty);

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      // Get the generated content from the response endpoint
      const contentResponse = await fetch(AI_RESPONSE_URL);
      if (!contentResponse.ok) {
        throw new Error(`Failed to retrieve generated content: ${contentResponse.status}`);
      }

      return (await contentResponse.json())['last_response'];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate flashcard questions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Generate worksheet questions
  async generateWorksheetQuestions(sessionId: string, numQuestions: number, difficulty: 'easy' | 'medium' | 'hard'): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'generate_worksheet_questions');
    formData.append('num_questions', numQuestions.toString());
    formData.append('difficulty', difficulty);

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      // Get the generated content from the response endpoint
      const contentResponse = await fetch(AI_RESPONSE_URL);
      if (!contentResponse.ok) {
        throw new Error(`Failed to retrieve generated content: ${contentResponse.status}`);
      }

      return (await contentResponse.json())['last_response'];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate worksheet questions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Analyse PDF
  async analysePDF(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'analyse_pdf');

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result.message || 'PDF analysis completed';
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to analyse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Analyse Image
  async analyseImage(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    const formData = new FormData();
    formData.append('command', 'analyse_img');

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result.message || 'Image analysis completed';
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to analyse image: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Get session by ID
  getSession(sessionId: string): AISession | undefined {
    return this.sessions.get(sessionId);
  }

  // Get sessions by user and workspace
  getSessionsByUserAndWorkspace(userId: string, workspaceId: string): AISession[] {
    return Array.from(this.sessions.values()).filter(
      session => session.workspaceId === workspaceId
    );
  }

  // Delete session
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  // Check if AI service is available
  async checkHealth(): Promise<boolean> {
    try {
      console.log('🏥 Checking AI service health...');
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: new FormData(), // Empty form data
      });
      
      console.log(`🏥 AI Service health check status: ${response.status}`);
      return response.ok;
    } catch (error) {
      console.error('🏥 AI Service health check failed:', error);
      return false;
    }
  }
}

// Global instance
export const aiSessionService = new AISessionService();

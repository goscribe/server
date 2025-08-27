import { TRPCError } from '@trpc/server';

// External AI service configuration
const AI_SERVICE_URL = 'https://txp-tckxn64wn5vtgip72wn5vtgip72-kzoemq8qw-custom.service.onethingrobot.com/upload';
const AI_RESPONSE_URL = 'https://txp-tckxn64wn5vtgip72wn5vtgip72-kzoemq8qw-custom.service.onethingrobot.com/last_response';

export interface AISession {
  id: string;
  userId: string;
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
  async initSession(userId: string, workspaceId: string): Promise<AISession> {
    const sessionId = `${userId}_${workspaceId}_${Date.now()}`;
    
    const formData = new FormData();
    formData.append('command', 'init_session');
    formData.append('id', sessionId);

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      if (result.status !== 'Session initialized successfully!') {
        throw new Error(`AI service error: ${result.status}`);
      }

      const session: AISession = {
        id: sessionId,
        userId,
        workspaceId,
        status: 'initialized',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.sessions.set(sessionId, session);
      return session;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to initialize AI session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
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
      if (!result.status.startsWith('Upload success:')) {
        throw new Error(`AI service error: ${result.status}`);
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
      if (result.status !== 'Instruction Text Reset Successful') {
        throw new Error(`AI service error: ${result.status}`);
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
      if (!result.status.startsWith('LLM session started:')) {
        throw new Error(`AI service error: ${result.status}`);
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

      return await contentResponse.text();
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

      return await contentResponse.text();
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

      return await contentResponse.text();
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate worksheet questions: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      session => session.userId === userId && session.workspaceId === workspaceId
    );
  }

  // Delete session
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}

// Global instance
export const aiSessionService = new AISessionService();

import { TRPCError } from '@trpc/server';
import { logger } from './logger.js';

// External AI service configuration
const AI_SERVICE_URL = 'https://7gzvf7uib04yp9-61016.proxy.runpod.net/upload';
const AI_RESPONSE_URL = 'https://7gzvf7uib04yp9-61016.proxy.runpod.net/last_response';

// Mock mode flag - when true, returns fake responses instead of calling AI service
const MOCK_MODE = process.env.DONT_TEST_INFERENCE === 'true';

export interface AISession {
  id: string;
  workspaceId: string;
  status: 'initialized' | 'processing' | 'ready' | 'error';
  files: string[];
  instructionText?: string;
  createdAt: Date;
  updatedAt: Date;
}

const IMITATE_WAIT_TIME_MS = 1000 * 10;

export class AISessionService {
  private sessions = new Map<string, AISession>();

  // Initialize a new AI session
  async initSession(workspaceId: string, user: string): Promise<AISession> {
    const sessionId = `${workspaceId}`;

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - return fake session
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Initializing AI session for workspace ${workspaceId}`);
      const session: AISession = {
        id: sessionId,
        workspaceId,
        status: 'initialized',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.sessions.set(sessionId, session);
      return session;
    }
    
    const formData = new FormData();
    formData.append('command', 'init_session');
    formData.append('session', sessionId);
    formData.append('user', user);

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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - simulate successful file upload
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Uploading ${fileType} file "${file.name}" to session ${sessionId}`);
      session.files.push(file.name);
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      return;
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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - simulate setting instruction
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Setting instruction for session ${sessionId}: "${instructionText.substring(0, 50)}..."`);
      session.instructionText = instructionText;
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      return;
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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - simulate starting LLM session
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Starting LLM session for ${sessionId}`);
      session.status = 'ready';
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
      return;
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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - return fake study guide
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Generating study guide for session ${sessionId}`);
      return `# Mock Study Guide

## Overview
This is a mock study guide generated for testing purposes. In a real scenario, this would contain comprehensive study material based on the uploaded content.

## Key Concepts
1. **Concept A**: This is a mock concept that would be derived from the uploaded materials
2. **Concept B**: Another mock concept with detailed explanations
3. **Concept C**: A third concept with examples and applications

## Summary
This mock study guide demonstrates the structure and format that would be generated by the AI service when processing uploaded educational materials.

## Practice Questions
1. What is the main topic covered in this material?
2. How do the key concepts relate to each other?
3. What are the practical applications of these concepts?

*Note: This is a mock response generated when DONT_TEST_INFERENCE=true*`;
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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - return fake flashcard questions
    if (MOCK_MODE) {
      logger.info(`🎭 MOCK MODE: Generating ${numQuestions} ${difficulty} flashcard questions for session ${sessionId}`);
      return JSON.stringify(Array.from({ length: numQuestions }, (_, i) => ({
          id: `mock-flashcard-${i + 1}`,
          question: `Mock question ${i + 1}: What is the main concept covered in this material?`,
          answer: `Mock answer ${i + 1}: This is a sample answer that would be generated based on the uploaded content.`,
          difficulty: difficulty,
          category: `Mock Category ${(i % 3) + 1}`
        })));
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
  async generateWorksheetQuestions(sessionId: string, numQuestions: number, difficulty: 'EASY' | 'MEDIUM' | 'HARD'): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'AI session not found' });
    }

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - return fake worksheet questions
    if (MOCK_MODE) {
      logger.info(`🎭 MOCK MODE: Generating ${numQuestions} ${difficulty} worksheet questions for session ${sessionId}`);
      return JSON.stringify({
        worksheet: {
          title: `Mock Worksheet - ${difficulty} Level`,
          questions: Array.from({ length: numQuestions }, (_, i) => ({
            id: `mock-worksheet-q${i + 1}`,
            question: `Mock worksheet question ${i + 1}: Based on the uploaded material, explain the key concept and provide examples.`,
            type: i % 2 === 0 ? 'short_answer' : 'essay',
            difficulty: difficulty,
            estimatedTime: difficulty === 'EASY' ? '2-3 minutes' : difficulty === 'MEDIUM' ? '5-7 minutes' : '10-15 minutes',
            points: difficulty === 'EASY' ? 5 : difficulty === 'MEDIUM' ? 10 : 15
          })),
          instructions: "This is a mock worksheet generated for testing purposes. Answer all questions based on the uploaded materials.",
          totalPoints: numQuestions * (difficulty === 'EASY' ? 5 : difficulty === 'MEDIUM' ? 10 : 15),
          estimatedTime: `${numQuestions * (difficulty === 'EASY' ? 3 : difficulty === 'MEDIUM' ? 6 : 12)} minutes`
        },
        metadata: {
          totalQuestions: numQuestions,
          difficulty: difficulty,
          generatedAt: new Date().toISOString(),
          isMock: true
        }
      });
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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - return fake PDF analysis
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Analysing PDF for session ${sessionId}`);
      return `Mock PDF Analysis Results:

Document Type: Educational Material
Pages: 15
Language: English
Key Topics Identified:
- Introduction to Machine Learning
- Data Preprocessing Techniques
- Model Training and Validation
- Performance Metrics

Summary: This mock PDF analysis shows the structure and content that would be extracted from an uploaded PDF document. The analysis includes document metadata, key topics, and a summary of the content.

Note: This is a mock response generated when DONT_TEST_INFERENCE=true`;
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

    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - return fake image analysis
    if (MOCK_MODE) {
      console.log(`🎭 MOCK MODE: Analysing image for session ${sessionId}`);
      return `Mock Image Analysis Results:

Image Type: Educational Diagram
Format: PNG
Dimensions: 1920x1080
Content Description:
- Contains a flowchart or diagram
- Shows a process or system architecture
- Includes text labels and annotations
- Educational or instructional content

Key Elements Identified:
- Process flow arrows
- Decision points
- Input/output elements
- Descriptive text

Summary: This mock image analysis demonstrates the type of content extraction that would be performed on uploaded images. The analysis identifies visual elements, text content, and overall structure.

Note: This is a mock response generated when DONT_TEST_INFERENCE=true`;
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
    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    // Mock mode - always return healthy
    if (MOCK_MODE) {
      console.log('🎭 MOCK MODE: AI service health check - returning healthy');
      return true;
    }

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

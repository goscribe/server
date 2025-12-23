import { TRPCError } from '@trpc/server';
import { logger } from './logger.js';
import { MarkScheme, UserMarkScheme } from '../types/index.js';

// External AI service configuration
// const AI_SERVICE_URL = 'https://7gzvf7uib04yp9-61016.proxy.runpod.net/upload';
// const AI_RESPONSE_URL = 'https://7gzvf7uib04yp9-61016.proxy.runpod.net/last_response';
const AI_SERVICE_URL = process.env.INFERENCE_API_URL + '/upload';
const AI_RESPONSE_URL = process.env.INFERENCE_API_URL + '/last_response';

console.log('AI_SERVICE_URL', AI_SERVICE_URL);
console.log('AI_RESPONSE_URL', AI_RESPONSE_URL);

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

const IMITATE_WAIT_TIME_MS = MOCK_MODE ?  1000 * 10 : 0;

export interface ProcessFileResult {
  status: 'success' | 'error';
  textContent: string | null;
  imageDescriptions: Array<{
    page: number;
    description: string;
    hasVisualContent: boolean;
  }>;
  comprehensiveDescription: string | null;
  pageCount: number;
  error?: string;
}

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

  // Process file (PDF/image) and return comprehensive text descriptions
  async processFile(
    sessionId: string,
    user: string,
    fileUrl: string,
    fileType: 'image' | 'pdf',
    maxPages?: number
  ): Promise<ProcessFileResult> {
    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    
    // Mock mode - return fake processing result
    if (MOCK_MODE) {
      logger.info(`🎭 MOCK MODE: Processing ${fileType} file from URL for session ${sessionId}`);
      const mockPageCount = fileType === 'pdf' ? 15 : 1;
      return {
        status: 'success',
        textContent: `Mock extracted text content from ${fileType} file. This would contain the full text extracted from the document.`,
        imageDescriptions: Array.from({ length: mockPageCount }, (_, i) => ({
          page: i + 1,
          description: `Page ${i + 1} contains educational content with diagrams and text.`,
          hasVisualContent: true,
        })),
        comprehensiveDescription: `DOCUMENT SUMMARY (${mockPageCount} ${mockPageCount === 1 ? 'page' : 'pages'})\n\nTEXT CONTENT:\nMock extracted text content...\n\nVISUAL CONTENT DESCRIPTIONS:\nPage-by-page descriptions of visual elements.`,
        pageCount: mockPageCount,
      };
    }

    const formData = new FormData();
    formData.append('command', 'process_file');
    formData.append('fileUrl', fileUrl);
    formData.append('fileType', fileType);
    if (maxPages) {
      formData.append('maxPages', maxPages.toString());
    }

    console.log('formData', formData);

    // Retry logic for file processing
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`📄 Processing ${fileType} file attempt ${attempt}/${maxRetries} for session ${sessionId}`);
        
        // Set timeout for large files (5 minutes)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

        const response = await fetch(AI_SERVICE_URL, {
          method: 'POST',
          body: formData,
          // signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`❌ File processing error response:`, errorText);
          throw new Error(`AI service error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        logger.info(`📋 File processing result: status=${result.status}, pageCount=${result.pageCount}`);

        if (result.status === 'error') {
          throw new Error(result.error || 'File processing failed');
        }

        return result as ProcessFileResult;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        logger.error(`❌ File processing attempt ${attempt} failed:`, lastError.message);
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          logger.info(`⏳ Retrying file processing in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(`💥 All ${maxRetries} file processing attempts failed. Last error:`, lastError?.message);
    return {
      status: 'error',
      textContent: null,
      imageDescriptions: [],
      comprehensiveDescription: null,
      pageCount: 0,
      error: `Failed to process file after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
    };
  }



  // Generate study guide
  async generateStudyGuide(sessionId: string, user: string): Promise<string> {
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
    formData.append('session', sessionId);
    formData.append('user', user);
    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result.markdown;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate study guide: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Generate flashcard questions
  async generateFlashcardQuestions(sessionId: string, user: string, numQuestions: number, difficulty: 'easy' | 'medium' | 'hard'): Promise<string> {
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
    formData.append('session', sessionId);
    formData.append('user', user);
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

      const result = await response.json();

      console.log(JSON.parse(result.flashcards))

      return JSON.parse(result.flashcards).flashcards;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate flashcard questions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Generate worksheet questions
  async generateWorksheetQuestions(sessionId: string, user: string, numQuestions: number, difficulty: 'EASY' | 'MEDIUM' | 'HARD'): Promise<string> {
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
    formData.append('session', sessionId);
    formData.append('user', user);
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

      const result = await response.json();

      console.log(JSON.parse(result.worksheet));

      return result.worksheet;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate worksheet questions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  async checkWorksheetQuestions(sessionId: string, user: string, question: string, answer: string, mark_scheme: MarkScheme): Promise<UserMarkScheme> {
    const formData = new FormData();

    formData.append('command', 'mark_worksheet_questions');
    formData.append('session', sessionId);
    formData.append('user', user);
    formData.append('question', question);
    formData.append('answer', answer);
    formData.append('mark_scheme', JSON.stringify(mark_scheme));

    const response = await fetch(AI_SERVICE_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log(result.marking);
    return JSON.parse(result.marking);
  }

  // Generate podcast structure
  async generatePodcastStructure(
    sessionId: string, 
    user: string, 
    title: string, 
    description: string, 
    prompt: string,
    speakers: Array<{ id: string; role: string; name?: string }>
  ): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    
    // Mock mode - return fake podcast structure
    if (MOCK_MODE) {
      logger.info(`🎭 MOCK MODE: Generating podcast structure for session ${sessionId}`);
      return {
        success: true,
        structure: {
          episodeTitle: `${title} - AI Generated Episode`,
          totalEstimatedDuration: "15 minutes",
          segments: [
            {
              title: "Welcome & Introduction",
              content: "HOST: Welcome to today's episode!\nGUEST: Thanks for having me!\nHOST: Let's dive into the topic.\nGUEST: Great! Let's start with the basics...",
              speaker: "dialogue",
              voiceId: speakers[0]?.id || "mock-voice-1",
              keyPoints: ["Introduction", "What to expect"],
              estimatedDuration: "3 minutes",
              order: 1
            },
            {
              title: "Main Discussion",
              content: "This is the main content section where we explore the key concepts in detail. We'll cover various aspects and provide practical examples.",
              speaker: "host",
              voiceId: speakers[0]?.id || "mock-voice-1",
              keyPoints: ["Key concept 1", "Key concept 2"],
              estimatedDuration: "8 minutes",
              order: 2
            },
            {
              title: "Conclusion & Takeaways",
              content: "HOST: Let's wrap up what we've learned today.\nGUEST: Yes, the main takeaway is...\nHOST: Thanks for joining us!\nGUEST: Thank you!",
              speaker: "dialogue",
              voiceId: speakers[0]?.id || "mock-voice-1",
              keyPoints: ["Summary", "Next steps"],
              estimatedDuration: "4 minutes",
              order: 3
            }
          ]
        }
      };
    }

    const formData = new FormData();
    formData.append('command', 'generate_podcast_structure');
    formData.append('user', user);
    formData.append('session', sessionId);
    formData.append('title', title);
    formData.append('description', description);
    formData.append('prompt', prompt);
    formData.append('speakers', JSON.stringify(speakers));

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI service error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate podcast structure: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // Generate podcast audio from text
  async generatePodcastAudioFromText(
    sessionId: string,
    user: string,
    podcastId: string,
    segmentIndex: number,
    text: string,
    speakers: Array<{ id: string; role: string; name?: string }>,
    voiceId?: string
  ): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, IMITATE_WAIT_TIME_MS));
    
    // Mock mode - return fake audio generation result
    if (MOCK_MODE) {
      logger.info(`🎭 MOCK MODE: Generating audio for segment ${segmentIndex} of podcast ${podcastId}`);
      const isDialogue = text.includes('HOST:') || text.includes('GUEST:');
      return {
        success: true,
        segmentIndex: segmentIndex,
        objectKey: `${user}/${sessionId}/podcasts/${podcastId}/segment_${segmentIndex}.mp3`,
        duration: 45 + Math.floor(Math.random() * 30), // Random duration between 45-75 seconds
        type: isDialogue ? 'dialogue' : 'monologue',
        ...(isDialogue && { partCount: 4 })
      };
    }

    const formData = new FormData();
    formData.append('command', 'generate_podcast_audio_from_text');
    formData.append('user', user);
    formData.append('session', sessionId);
    formData.append('podcast_id', podcastId);
    formData.append('segment_index', segmentIndex.toString());
    formData.append('text', text);
    formData.append('speakers', JSON.stringify(speakers));
    
    if (voiceId) {
      formData.append('voice_id', voiceId);
    }

    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI service error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate podcast audio: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
  


  async generatePodcastImage(sessionId: string, user: string, summary: string): Promise<string> {

    const formData = new FormData();
    formData.append('command', 'generate_podcast_image');
    formData.append('session', sessionId);
    formData.append('user', user);
    formData.append('summary', summary);
    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result.image_key;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to generate podcast image: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  async segmentStudyGuide (sessionId: string, user: string, studyGuide: string): Promise<{
    hint: string;
    content: string
  }[]> {
    // def generate_study_guide_segmentation(request):
    // user = request.form.get("user")
    // session = request.form.get("session")
    // study_guide = request.form.get("study_guide")

    // if not user or not session:
    //     return {"error": "Session not initialized."}, 400
    // if not study_guide:
    //     print("Study guide not provided.")
    //     return {"error": "Study guide not provided."}, 400
    
    // messages = generate_segmentation(study_guide)
    // return {"segmentation": messages}, 200  

    const formData = new FormData();
    formData.append('command', 'generate_study_guide_segmentation');
    formData.append('session', sessionId);
    formData.append('user', user);
    formData.append('study_guide', studyGuide);
    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }
      const result = await response.json();
      return result.segmentation;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to segment study guide: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
  async validateSegmentSummary(sessionId: string, user: string, segmentContent: string, studentResponse: string, studyGuide: string): Promise<{
    valid: boolean;
    feedback: string;
  }> {
    const formData = new FormData();
    formData.append('command', 'validate_segment_summary');
    formData.append('session', sessionId);
    formData.append('user', user);

    formData.append('segment_content', segmentContent);
    formData.append('student_response', studentResponse);
    formData.append('study_guide', studyGuide);
    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error(`AI service error: ${response.status} ${response.statusText}`);
      }
      const result = await response.json();
      return result.feedback;
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to validate segment summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

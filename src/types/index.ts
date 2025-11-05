import type { Prisma } from '@prisma/client';

/**
 * Common types for the application
 */
export type PrismaTransaction = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'
>;

/**
 * User types
 */
export interface UserSession {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export interface AuthContext {
  session: {
    user: UserSession;
  } | null;
  userId?: string;
}

/**
 * Artifact types
 */
export type ArtifactTypeEnum =
  | 'STUDY_GUIDE'
  | 'FLASHCARD_SET'
  | 'WORKSHEET'
  | 'MEETING_SUMMARY'
  | 'PODCAST_EPISODE';

export type DifficultyEnum = 'EASY' | 'MEDIUM' | 'HARD';

export type QuestionTypeEnum =
  | 'MULTIPLE_CHOICE'
  | 'TEXT'
  | 'NUMERIC'
  | 'TRUE_FALSE'
  | 'MATCHING'
  | 'FILL_IN_THE_BLANK';

/**
 * Worksheet types
 */
// Base mark scheme stored in question meta
export interface MarkSchemePoint {
  point: number;
  requirements: number;
}

export interface MarkScheme {
  points: MarkSchemePoint[];
  totalPoints: number;
}

// User progress mark scheme with achieved points and feedback
export interface UserMarkSchemePoint extends MarkSchemePoint {
  achievedPoints: number;
  feedback: string;
}

export interface UserMarkScheme {
  points: UserMarkSchemePoint[];
  totalPoints: number;
}

export interface WorksheetQuestionMeta {
  options?: string[];
  completed?: boolean;
  userAnswer?: string;
  completedAt?: Date | null;
  mark_scheme?: MarkScheme;
  userMarkScheme?: UserMarkScheme; // Merged from progress
}

export interface WorksheetQuestionProgressMeta {
  userMarkScheme?: UserMarkScheme;
}

export interface CreateWorksheetQuestionInput {
  prompt: string;
  answer?: string;
  type: QuestionTypeEnum;
  difficulty?: DifficultyEnum;
  order?: number;
  meta?: WorksheetQuestionMeta;
}

export interface UpdateWorksheetQuestionInput extends Partial<CreateWorksheetQuestionInput> {
  id: string;
}

/**
 * Flashcard types
 */
export interface CreateFlashcardInput {
  front: string;
  back: string;
  tags?: string[];
  order?: number;
}

export interface UpdateFlashcardInput extends Partial<CreateFlashcardInput> {
  id: string;
}

/**
 * File upload types
 */
export interface FileUploadResult {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
}

/**
 * Pagination types
 */
export interface PaginationInput {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Search types
 */
export interface SearchInput extends PaginationInput {
  query: string;
}

/**
 * Response types
 */
export type SuccessResponse<T = void> = {
  success: true;
  data: T;
  message?: string;
};

export type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};


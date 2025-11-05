import { z } from 'zod';
import { ValidationError } from './errors.js';

/**
 * Common validation schemas
 */
export const commonSchemas = {
  id: z.string().cuid(),
  email: z.string().email(),
  url: z.string().url(),
  pagination: z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().positive().max(100).default(20),
  }),
  search: z.object({
    query: z.string().min(1).max(200),
  }),
};

/**
 * Enums for type safety
 */
export const ArtifactType = z.enum([
  'STUDY_GUIDE',
  'FLASHCARD_SET',
  'WORKSHEET',
  'MEETING_SUMMARY',
  'PODCAST_EPISODE',
]);

export const Difficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);

export const QuestionType = z.enum([
  'MULTIPLE_CHOICE',
  'TEXT',
  'NUMERIC',
  'TRUE_FALSE',
  'MATCHING',
  'FILL_IN_THE_BLANK',
]);

/**
 * Validation helper that throws ValidationError
 */
export function validateSchema<T extends z.ZodType>(
  schema: T,
  data: unknown
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.message;
    throw new ValidationError(`Validation failed: ${errors}`);
  }
  return result.data;
}

/**
 * Sanitize string inputs
 */
export function sanitizeString(input: string, maxLength: number = 10000): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, ''); // Basic XSS prevention
}

/**
 * Validate ownership
 */
export function validateOwnership(ownerId: string, userId: string): void {
  if (ownerId !== userId) {
    throw new ValidationError('You do not have permission to access this resource');
  }
}


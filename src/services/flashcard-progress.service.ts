import type { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../lib/errors.js';

/**
 * SM-2 Spaced Repetition Algorithm
 * https://www.supermemo.com/en/archives1990-2015/english/ol/sm2
 */
export interface SM2Result {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date;
}

export class FlashcardProgressService {
  constructor(private db: PrismaClient) {}

  /**
   * Calculate next review using SM-2 algorithm with smart scheduling
   * @param quality - 0-5 rating (0=complete blackout, 5=perfect response)
   * @param easeFactor - Current ease factor (default 2.5)
   * @param interval - Current interval in days (default 0)
   * @param repetitions - Number of consecutive correct responses (default 0)
   * @param consecutiveIncorrect - Number of consecutive failures (for smart scheduling)
   * @param totalIncorrect - Total incorrect count (for context)
   */
  calculateSM2(
    quality: number,
    easeFactor: number = 2.5,
    interval: number = 0,
    repetitions: number = 0,
    consecutiveIncorrect: number = 0,
    totalIncorrect: number = 0
  ): SM2Result {
    // If quality < 3, determine if immediate review or short delay
    if (quality < 3) {
      // If no consecutive failures but has some overall failures, give short delay
      const shouldDelayReview = consecutiveIncorrect === 0 && totalIncorrect > 0;
      
      const nextReviewAt = new Date();
      if (shouldDelayReview) {
        // Give them a few hours to let it sink in
        nextReviewAt.setHours(nextReviewAt.getHours() + 4);
      }
      // Otherwise immediate review (consecutiveIncorrect > 0 or first failure)
      
      return {
        easeFactor: Math.max(1.3, easeFactor - 0.2),
        interval: 0,
        repetitions: 0,
        nextReviewAt,
      };
    }

    // Calculate new ease factor
    const newEaseFactor = Math.max(
      1.3,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );

    // Calculate new interval based on performance history
    let newInterval: number;
    if (repetitions === 0) {
      // First correct answer
      if (consecutiveIncorrect >= 2 || totalIncorrect >= 5) {
        // If they struggled a lot, start conservative
        newInterval = 1; // 1 day
      } else if (totalIncorrect === 0) {
        // Perfect card, never failed
        newInterval = 3; // 3 days (skip ahead)
      } else {
        // Normal case
        newInterval = 1; // 1 day
      }
    } else if (repetitions === 1) {
      newInterval = 6; // 6 days
    } else {
      newInterval = Math.ceil(interval * newEaseFactor);
    }

    // Calculate next review date
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);

    return {
      easeFactor: newEaseFactor,
      interval: newInterval,
      repetitions: repetitions + 1,
      nextReviewAt,
    };
  }

  /**
   * Infer confidence level based on consecutive incorrect attempts
   */
  inferConfidence(
    isCorrect: boolean,
    consecutiveIncorrect: number,
    timesStudied: number
  ): 'easy' | 'medium' | 'hard' {
    if (!isCorrect) {
      // If they got it wrong, it's obviously hard
      return 'hard';
    }

    // If they got it right but have high consecutive failures, it's still hard
    if (consecutiveIncorrect >= 3) {
      return 'hard';
    }

    if (consecutiveIncorrect >= 1) {
      return 'medium';
    }

    // If first time or low failure history, check overall performance
    if (timesStudied === 0 || timesStudied === 1) {
      return 'medium'; // Default for first attempts
    }

    // If they've studied it multiple times with no recent failures, it's easy
    return 'easy';
  }

  /**
   * Convert confidence to SM-2 quality rating
   */
  confidenceToQuality(confidence: 'easy' | 'medium' | 'hard'): number {
    switch (confidence) {
      case 'easy':
        return 5; // Perfect response
      case 'medium':
        return 4; // Correct after hesitation
      case 'hard':
        return 3; // Correct with difficulty
      default:
        return 4;
    }
  }

  /**
   * Record flashcard study attempt
   */
  async recordStudyAttempt(data: {
    userId: string;
    flashcardId: string;
    isCorrect: boolean;
    confidence?: 'easy' | 'medium' | 'hard';
    timeSpentMs?: number;
  }) {
    const { userId, flashcardId, isCorrect, timeSpentMs } = data;

    // Verify flashcard exists and user has access
    const flashcard = await this.db.flashcard.findFirst({
      where: {
        id: flashcardId,
        artifact: {
          workspace: {
            OR: [
              { ownerId: userId },
              { members: { some: { userId } } },
            ],
          },
        },
      },
    });

    if (!flashcard) {
      throw new NotFoundError('Flashcard');
    }

    // Get existing progress
    const existingProgress = await this.db.flashcardProgress.findUnique({
      where: {
        userId_flashcardId: {
          userId,
          flashcardId,
        },
      },
    });

    // Calculate new consecutive incorrect count
    const newConsecutiveIncorrect = isCorrect 
      ? 0 
      : (existingProgress?.timesIncorrectConsecutive || 0) + 1;

    // Auto-infer confidence based on performance
    const inferredConfidence = this.inferConfidence(
      isCorrect,
      newConsecutiveIncorrect,
      existingProgress?.timesStudied || 0
    );

    // Use provided confidence or inferred
    const finalConfidence = data.confidence || inferredConfidence;

    const quality = this.confidenceToQuality(finalConfidence);
    
    // Calculate total incorrect after this attempt
    const totalIncorrect = (existingProgress?.timesIncorrect || 0) + (isCorrect ? 0 : 1);
    
    const sm2Result = this.calculateSM2(
      quality,
      existingProgress?.easeFactor,
      existingProgress?.interval,
      existingProgress?.repetitions,
      newConsecutiveIncorrect,
      totalIncorrect
    );

    // Calculate mastery level (0-100)
    const totalAttempts = (existingProgress?.timesStudied || 0) + 1;
    const totalCorrect = (existingProgress?.timesCorrect || 0) + (isCorrect ? 1 : 0);
    const successRate = totalCorrect / totalAttempts;
    
    // Mastery considers success rate, repetitions, and consecutive failures
    const consecutivePenalty = Math.min(newConsecutiveIncorrect * 10, 30); // Max 30% penalty
    const masteryLevel = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          (successRate * 70) + // 70% weight on success rate
          (Math.min(sm2Result.repetitions, 10) / 10) * 30 - // 30% weight on repetitions
          consecutivePenalty // Penalty for consecutive failures
        )
      )
    );

    // Upsert progress
    return this.db.flashcardProgress.upsert({
      where: {
        userId_flashcardId: {
          userId,
          flashcardId,
        },
      },
      update: {
        timesStudied: { increment: 1 },
        timesCorrect: isCorrect ? { increment: 1 } : undefined,
        timesIncorrect: !isCorrect ? { increment: 1 } : undefined,
        timesIncorrectConsecutive: newConsecutiveIncorrect,
        easeFactor: sm2Result.easeFactor,
        interval: sm2Result.interval,
        repetitions: sm2Result.repetitions,
        masteryLevel,
        lastStudiedAt: new Date(),
        nextReviewAt: sm2Result.nextReviewAt,
      },
      create: {
        userId,
        flashcardId,
        timesStudied: 1,
        timesCorrect: isCorrect ? 1 : 0,
        timesIncorrect: isCorrect ? 0 : 1,
        timesIncorrectConsecutive: newConsecutiveIncorrect,
        easeFactor: sm2Result.easeFactor,
        interval: sm2Result.interval,
        repetitions: sm2Result.repetitions,
        masteryLevel,
        lastStudiedAt: new Date(),
        nextReviewAt: sm2Result.nextReviewAt,
      },
      include: {
        flashcard: true,
      },
    });
  }

  /**
   * Get user's progress on all flashcards in a set
   */
  async getSetProgress(userId: string, artifactId: string) {
    const flashcards = await this.db.flashcard.findMany({
      where: { artifactId },
    }) as any[];
    
    // Manually fetch progress for each flashcard
    const flashcardsWithProgress = await Promise.all(
      flashcards.map(async (card) => {
        const progress = await this.db.flashcardProgress.findUnique({
          where: {
            userId_flashcardId: {
              userId,
              flashcardId: card.id,
            },
          },
        });
        
        return {
          flashcardId: card.id,
          front: card.front,
          back: card.back,
          progress: progress || null,
        };
      })
    );

    return flashcardsWithProgress;
  }

  /**
   * Get flashcards due for review, non-studied flashcards, and flashcards with low mastery
   */
  async getDueFlashcards(userId: string, workspaceId: string) {
    const now = new Date();
    const LOW_MASTERY_THRESHOLD = 50; // Consider mastery < 50 as low

    // Get the latest artifact in the workspace
    const latestArtifact = await this.db.artifact.findFirst({
      where: {
        workspaceId,
        type: 'FLASHCARD_SET',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!latestArtifact) {
      return [];
    }

    // Get all flashcards from the latest artifact
    const allFlashcards = await this.db.flashcard.findMany({
      where: {
        artifactId: latestArtifact.id,
      },
      include: {
        artifact: true,
        progress: {
          where: {
            userId,
          },
        },
      },
    });

    console.log('allFlashcards', allFlashcards.length);

    const TAKE_NUMBER = (allFlashcards.length > 10) ? 10 : allFlashcards.length;
    
    // Get progress records for flashcards that are due or have low mastery
    const progressRecords = await this.db.flashcardProgress.findMany({
      where: {
        userId,
        OR: [
          {
            nextReviewAt: {
              lte: now,
            },
          },
          {
            masteryLevel: {
              lt: LOW_MASTERY_THRESHOLD,
            },
          },
          {
            timesStudied: {
              lt: 3,
            },
          }
        ],
        flashcard: {
          artifactId: latestArtifact.id,
        },
      },
      include: {
        flashcard: {
          include: {
            artifact: true,
          },
        },
      },
      take: TAKE_NUMBER,
    });

    console.log('TAKE_NUMBER', TAKE_NUMBER);
    console.log('TAKE_NUMBER - progressRecords.length', TAKE_NUMBER - progressRecords.length);
    console.log('progressRecords', progressRecords.map((progress) => progress.flashcard.id));
    
    // Get flashcard IDs that already have progress records
    const flashcardIdsWithProgress = new Set(
      progressRecords.map((progress) => progress.flashcard.id)
    );
    
    // Find flashcards without progress records (non-studied) to pad the results
    const nonStudiedFlashcards = allFlashcards
      .filter((flashcard) => !flashcardIdsWithProgress.has(flashcard.id))
      .slice(0, TAKE_NUMBER - progressRecords.length);
    
    // Create progress-like structures for non-studied flashcards
    const progressRecordsPadding = nonStudiedFlashcards.map((flashcard) => {
      const { progress, ...flashcardWithoutProgress } = flashcard;
      return {
        id: `temp-${flashcard.id}`,
        userId,
        flashcardId: flashcard.id,
        timesStudied: 0,
        timesCorrect: 0,
        timesIncorrect: 0,
        timesIncorrectConsecutive: 0,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        masteryLevel: 0,
        lastStudiedAt: null,
        nextReviewAt: null,
        flashcard: flashcardWithoutProgress,
      };
    });

    console.log('progressRecordsPadding', progressRecordsPadding.length);
    console.log('progressRecords', progressRecords.length);
    const selectedCards = [...progressRecords, ...progressRecordsPadding];

    // Build result array: include progress records and non-studied flashcards
    const results = [];

    // Add flashcards with progress (due or low mastery)
    for (const progress of progressRecords) {
      results.push(progress);
    }

    // Sort by priority: due first (by nextReviewAt), then low mastery, then non-studied
    // @todo: make an actual algorithm. research
    // results.sort((a, b) => {
    //   // Due flashcards first (nextReviewAt <= now)
    //   const aIsDue = a.nextReviewAt && a.nextReviewAt <= now;
    //   const bIsDue = b.nextReviewAt && b.nextReviewAt <= now;
    //   // if (aIsDue && !bIsDue) return -1;
    //   // if (!aIsDue && bIsDue) return 1;

    //   // Among due flashcards, sort by nextReviewAt
    //   if (aIsDue && bIsDue && a.nextReviewAt && b.nextReviewAt) {
    //     return a.nextReviewAt.getTime() - b.nextReviewAt.getTime();
    //   }

    //   // Then low mastery (lower mastery first)
    //   if (a.masteryLevel !== b.masteryLevel) {
    //     return a.masteryLevel - b.masteryLevel;
    //   }

    //   // Finally, non-studied (timesStudied === 0)
    //   if (a.timesStudied === 0 && b.timesStudied !== 0) return -1;
    //   if (a.timesStudied !== 0 && b.timesStudied === 0) return 1;

    //   return 0;
    // });

    return selectedCards.map((progress) => progress.flashcard);
  }

  /**
   * Get user statistics for a flashcard set
   */
  async getSetStatistics(userId: string, artifactId: string) {
    const progress = await this.db.flashcardProgress.findMany({
      where: {
        userId,
        flashcard: {
          artifactId,
        },
      },
    });

    const totalCards = await this.db.flashcard.count({
      where: { artifactId },
    });

    const studiedCards = progress.length;
    const masteredCards = progress.filter((p: any) => p.masteryLevel >= 80).length;
    const dueForReview = progress.filter((p: any) => p.nextReviewAt && p.nextReviewAt <= new Date()).length;

    const averageMastery = progress.length > 0
      ? progress.reduce((sum: number, p: any) => sum + p.masteryLevel, 0) / progress.length
      : 0;

    const totalCorrect = progress.reduce((sum: number, p: any) => sum + p.timesCorrect, 0);
    const totalAttempts = progress.reduce((sum: number, p: any) => sum + p.timesStudied, 0);
    const successRate = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 0;

    return {
      totalCards,
      studiedCards,
      unstudiedCards: totalCards - studiedCards,
      masteredCards,
      dueForReview,
      averageMastery: Math.round(averageMastery),
      successRate: Math.round(successRate),
      totalAttempts,
      totalCorrect,
    };
  }

  /**
   * Reset progress for a flashcard
   */
  async resetProgress(userId: string, flashcardId: string) {
    return this.db.flashcardProgress.deleteMany({
      where: {
        userId,
        flashcardId,
      },
    });
  }

  /**
   * Bulk record study session
   */
  async recordStudySession(data: {
    userId: string;
    attempts: Array<{
      flashcardId: string;
      isCorrect: boolean;
      confidence?: 'easy' | 'medium' | 'hard';
      timeSpentMs?: number;
    }>;
  }) {
    const { userId, attempts } = data;

    // Process attempts sequentially
    const results = [];
    for (const attempt of attempts) {
      const result = await this.recordStudyAttempt({
        userId,
        ...attempt,
      });
      results.push(result);
    }
    
    return results;
  }
}

/**
 * Factory function
 */
export function createFlashcardProgressService(db: PrismaClient) {
  return new FlashcardProgressService(db);
}


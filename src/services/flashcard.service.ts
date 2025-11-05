import type { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../lib/errors.js';
import type { CreateFlashcardInput, UpdateFlashcardInput } from '../types/index.js';

export class FlashcardService {
  constructor(private db: PrismaClient) {}
  async jsonToFlashcards(json: string) {
    const flashcards = JSON.parse(json);
    return flashcards.map((card: any) => ({
      front: card.front,
      back: card.back,
    }));
  }
  /**
   * List all flashcard sets for a workspace
   */
  async listFlashcardSets(workspaceId: string, userId: string) {
    return this.db.artifact.findMany({
      where: {
        workspaceId,
        type: 'FLASHCARD_SET',
        workspace: { ownerId: userId },
      },
      include: {
        flashcards: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Get a single flashcard set
   */
  async getFlashcardSet(setId: string, userId: string) {
    const flashcardSet = await this.db.artifact.findFirst({
      where: {
        id: setId,
        type: 'FLASHCARD_SET',
        workspace: { ownerId: userId },
      },
      include: {
        flashcards: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!flashcardSet) {
      throw new NotFoundError('Flashcard set');
    }

    return flashcardSet;
  }

  /**
   * Create a new flashcard set
   */
  async createFlashcardSet(data: {
    workspaceId: string;
    title: string;
    userId: string;
    flashcards?: CreateFlashcardInput[];
  }) {
    // Verify workspace ownership
    const workspace = await this.db.workspace.findFirst({
      where: {
        id: data.workspaceId,
        ownerId: data.userId,
      },
    });

    if (!workspace) {
      throw new NotFoundError('Workspace');
    }

    const { flashcards, ...setData } = data;

    return this.db.artifact.create({
      data: {
        workspaceId: data.workspaceId,
        type: 'FLASHCARD_SET',
        title: data.title,
        createdById: data.userId,
        flashcards: flashcards
          ? {
              create: flashcards.map((card, index) => ({
                ...card,
                order: card.order ?? index,
              })),
            }
          : undefined,
      },
      include: {
        flashcards: {
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Update a flashcard set
   */
  async updateFlashcardSet(data: {
    id: string;
    title?: string;
    userId: string;
    flashcards?: (CreateFlashcardInput & { id?: string })[];
  }) {
    const { id, flashcards, userId, ...updateData } = data;

    // Verify ownership
    const existingSet = await this.db.artifact.findFirst({
      where: {
        id,
        type: 'FLASHCARD_SET',
        workspace: { ownerId: userId },
      },
    });

    if (!existingSet) {
      throw new NotFoundError('Flashcard set');
    }

    // Handle flashcards update if provided
    if (flashcards) {
      // Delete existing flashcards
      await this.db.flashcard.deleteMany({
        where: { artifactId: id },
      });

      // Create new flashcards
      await this.db.flashcard.createMany({
        data: flashcards.map((card, index) => ({
          artifactId: id,
          front: card.front,
          back: card.back,
          tags: card.tags || [],
          order: card.order ?? index,
        })),
      });
    }

    return this.db.artifact.update({
      where: { id },
      data: updateData,
      include: {
        flashcards: {
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  /**
   * Delete a flashcard set
   */
  async deleteFlashcardSet(setId: string, userId: string) {
    const deleted = await this.db.artifact.deleteMany({
      where: {
        id: setId,
        type: 'FLASHCARD_SET',
        workspace: { ownerId: userId },
      },
    });

    if (deleted.count === 0) {
      throw new NotFoundError('Flashcard set');
    }

    return { success: true };
  }

  /**
   * Add a flashcard to a set
   */
  async addFlashcard(data: {
    setId: string;
    userId: string;
    flashcard: CreateFlashcardInput;
  }) {
    // Verify ownership
    const set = await this.db.artifact.findFirst({
      where: {
        id: data.setId,
        type: 'FLASHCARD_SET',
        workspace: { ownerId: data.userId },
      },
    });

    if (!set) {
      throw new NotFoundError('Flashcard set');
    }

    // Get the next order number
    const maxOrder = await this.db.flashcard.aggregate({
      where: { artifactId: data.setId },
      _max: { order: true },
    });

    return this.db.flashcard.create({
      data: {
        artifactId: data.setId,
        front: data.flashcard.front,
        back: data.flashcard.back,
        tags: data.flashcard.tags || [],
        order: data.flashcard.order ?? (maxOrder._max.order ?? 0) + 1,
      },
    });
  }

  /**
   * Update a flashcard
   */
  async updateFlashcard(data: {
    flashcardId: string;
    userId: string;
    updates: Partial<CreateFlashcardInput>;
  }) {
    // Verify ownership
    const flashcard = await this.db.flashcard.findFirst({
      where: {
        id: data.flashcardId,
        artifact: {
          type: 'FLASHCARD_SET',
          workspace: { ownerId: data.userId },
        },
      },
    });

    if (!flashcard) {
      throw new NotFoundError('Flashcard');
    }

    return this.db.flashcard.update({
      where: { id: data.flashcardId },
      data: data.updates,
    });
  }

  /**
   * Delete a flashcard
   */
  async deleteFlashcard(flashcardId: string, userId: string) {
    const flashcard = await this.db.flashcard.findFirst({
      where: {
        id: flashcardId,
        artifact: { workspace: { ownerId: userId } },
      },
    });

    if (!flashcard) {
      throw new NotFoundError('Flashcard');
    }

    await this.db.flashcard.delete({
      where: { id: flashcardId },
    });

    return { success: true };
  }
}

/**
 * Factory function to create flashcard service
 */
export function createFlashcardService(db: PrismaClient) {
  return new FlashcardService(db);
}


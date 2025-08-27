import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create/find a demo user
  const userEmail = 'demo@example.com';
  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      name: 'Demo User',
      image: null,
    },
  });

  // Create a workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: 'ws_demo_1' },
    update: {},
    create: {
      id: 'ws_demo_1',
      title: 'Demo Workspace',
      description: 'Seeded workspace with sample artifacts',
      ownerId: user.id,
    },
  });

  // Create a Worksheet artifact with diverse question types
  const worksheet = await prisma.artifact.create({
    data: {
      workspaceId: workspace.id,
      type: 'WORKSHEET',
      title: 'Sample Worksheet: Mixed Question Types',
      createdById: user.id,
      questions: {
        create: [
          {
            prompt: 'What is the capital of France?',
            answer: 'Paris',
            type: 'TEXT',
            order: 0,
          },
          {
            prompt: '2 + 2 = ?',
            answer: '4',
            type: 'NUMERIC',
            order: 1,
          },
          {
            prompt: 'Select the prime numbers',
            answer: '2',
            type: 'MULTIPLE_CHOICE',
            order: 2,
            meta: { options: ['1', '2', '4', '6'] },
          },
          {
            prompt: 'The earth is flat.',
            answer: 'False',
            type: 'TRUE_FALSE',
            order: 3,
            meta: { options: ['True', 'False'] },
          },
          {
            prompt: 'Match the country to its capital (type answers).',
            answer: '',
            type: 'MATCHING',
            order: 4,
            meta: { options: ['Japan ->', 'Germany ->', 'Canada ->'] },
          },
          {
            prompt: 'The chemical symbol for water is ____.',
            answer: 'H2O',
            type: 'FILL_IN_THE_BLANK',
            order: 5,
          },
        ],
      },
    },
    include: { questions: true },
  });

  // Create a Flashcard set artifact with a couple of cards
  const flashcardSet = await prisma.artifact.create({
    data: {
      workspaceId: workspace.id,
      type: 'FLASHCARD_SET',
      title: 'Sample Flashcards: Basics',
      createdById: user.id,
      flashcards: {
        create: [
          { front: 'HTTP Status 200', back: 'OK', order: 0 },
          { front: 'HTTP Status 404', back: 'Not Found', order: 1 },
        ],
      },
    },
    include: { flashcards: true },
  });

  // Add a simple study guide versioned artifact
  const studyGuide = await prisma.artifact.create({
    data: {
      workspaceId: workspace.id,
      type: 'STUDY_GUIDE',
      title: 'Sample Study Guide',
      createdById: user.id,
      versions: {
        create: [
          { content: '# Intro\nThis is a seeded study guide.', version: 1, createdById: user.id },
        ],
      },
    },
    include: { versions: true },
  });

  console.log('Seed complete:', {
    user: { id: user.id, email: user.email },
    workspace: { id: workspace.id, title: workspace.title },
    worksheet: { id: worksheet.id, title: worksheet.title, questions: worksheet.questions.length },
    flashcardSet: { id: flashcardSet.id, cards: flashcardSet.flashcards.length },
    studyGuide: { id: studyGuide.id, versions: studyGuide.versions.length },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });



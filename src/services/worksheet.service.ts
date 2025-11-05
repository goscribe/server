// import type { PrismaClient } from '@prisma/client';
// import { NotFoundError, ForbiddenError, ValidationError } from '../lib/errors.js';
// import type { 
//   QuestionTypeEnum, 
//   DifficultyEnum,
//   WorksheetQuestionMeta,
//   CreateWorksheetQuestionInput
// } from '../types/index.js';

// export class WorksheetService {
//   constructor(private db: PrismaClient) {}

//   /**
//    * List all worksheets for a workspace
//    */
//   async listWorksheets(workspaceId: string, userId: string) {
//     const worksheets = await this.db.artifact.findMany({
//       where: { 
//         workspaceId, 
//         type: 'WORKSHEET',
//         workspace: { ownerId: userId }
//       },
//       include: {
//         versions: {
//           orderBy: { version: 'desc' },
//           take: 1,
//         },
//         questions: {
//           orderBy: { order: 'asc' }
//         },
//       },
//       orderBy: { updatedAt: 'desc' },
//     });

//     // Merge user progress
//     const allQuestionIds = worksheets.flatMap(w => w.questions.map(q => q.id));
    
//     if (allQuestionIds.length === 0) {
//       return worksheets;
//     }

//     const progress = await this.db.worksheetQuestionProgress.findMany({
//       where: { 
//         userId, 
//         worksheetQuestionId: { in: allQuestionIds } 
//       },
//     });

//     const progressByQuestionId = new Map(
//       progress.map(p => [p.worksheetQuestionId, p])
//     );

//     return worksheets.map(worksheet => ({
//       ...worksheet,
//       questions: worksheet.questions.map(question => {
//         const userProgress = progressByQuestionId.get(question.id);
//         const existingMeta = this.parseMeta(question.meta);
        
//         return {
//           ...question,
//           meta: {
//             ...existingMeta,
//             completed: userProgress?.modified || false,
//             userAnswer: userProgress?.userAnswer,
//             completedAt: userProgress?.completedAt,
//           },
//         };
//       }),
//     }));
//   }

//   /**
//    * Get a single worksheet
//    */
//   async getWorksheet(worksheetId: string, userId: string) {
//     const worksheet = await this.db.artifact.findFirst({
//       where: {
//         id: worksheetId,
//         type: 'WORKSHEET',
//         workspace: { ownerId: userId },
//       },
//       include: {
//         questions: {
//           orderBy: { order: 'asc' }
//         },
//       },
//     });

//     if (!worksheet) {
//       throw new NotFoundError('Worksheet');
//     }

//     // Load user progress
//     const progress = await this.db.worksheetQuestionProgress.findMany({
//       where: {
//         userId,
//         worksheetQuestionId: { 
//           in: worksheet.questions.map(q => q.id) 
//         },
//       },
//     });

//     const progressByQuestionId = new Map(
//       progress.map(p => [p.worksheetQuestionId, p])
//     );

//     return {
//       ...worksheet,
//       questions: worksheet.questions.map(question => {
//         const userProgress = progressByQuestionId.get(question.id);
//         const existingMeta = this.parseMeta(question.meta);
        
//         return {
//           ...question,
//           meta: {
//             ...existingMeta,
//             completed: userProgress?.modified || false,
//             userAnswer: userProgress?.userAnswer,
//             completedAt: userProgress?.completedAt,
//           },
//         };
//       }),
//     };
//   }

//   /**
//    * Create a new worksheet
//    */
//   async createWorksheet(data: {
//     workspaceId: string;
//     title: string;
//     description?: string;
//     userId: string;
//     problems?: Array<{
//       question: string;
//       answer: string;
//       type: QuestionTypeEnum;
//       options?: string[];
//     }>;
//   }) {
//     // Verify workspace ownership
//     const workspace = await this.db.workspace.findFirst({
//       where: { 
//         id: data.workspaceId, 
//         ownerId: data.userId 
//       },
//     });

//     if (!workspace) {
//       throw new NotFoundError('Workspace');
//     }

//     const { problems, ...worksheetData } = data;

//     return this.db.artifact.create({
//       data: {
//         workspaceId: data.workspaceId,
//         type: 'WORKSHEET',
//         title: data.title,
//         createdById: data.userId,
//         questions: problems ? {
//           create: problems.map((problem, index) => ({
//             prompt: problem.question,
//             answer: problem.answer,
//             type: problem.type,
//             order: index,
//             meta: problem.options ? { options: problem.options } : undefined,
//           })),
//         } : undefined,
//       },
//       include: {
//         questions: {
//           orderBy: { order: 'asc' }
//         },
//       },
//     });
//   }

//   /**
//    * Update a worksheet
//    */
//   async updateWorksheet(data: {
//     id: string;
//     title?: string;
//     description?: string;
//     userId: string;
//     problems?: Array<{
//       id?: string;
//       question: string;
//       answer: string;
//       type: QuestionTypeEnum;
//       options?: string[];
//     }>;
//   }) {
//     const { id, problems, userId, ...updateData } = data;

//     // Verify ownership
//     const existingWorksheet = await this.db.artifact.findFirst({
//       where: {
//         id,
//         type: 'WORKSHEET',
//         workspace: { ownerId: userId },
//       },
//     });

//     if (!existingWorksheet) {
//       throw new NotFoundError('Worksheet');
//     }

//     // Handle questions update if provided
//     if (problems) {
//       // Delete existing questions
//       await this.db.worksheetQuestion.deleteMany({
//         where: { artifactId: id },
//       });

//       // Create new questions
//       await this.db.worksheetQuestion.createMany({
//         data: problems.map((problem, index) => ({
//           artifactId: id,
//           prompt: problem.question,
//           answer: problem.answer,
//           type: problem.type,
//           order: index,
//           meta: problem.options ? { options: problem.options } : undefined,
//         })),
//       });
//     }

//     return this.db.artifact.update({
//       where: { id },
//       data: updateData,
//       include: {
//         questions: {
//           orderBy: { order: 'asc' },
//         },
//       },
//     });
//   }

//   /**
//    * Delete a worksheet
//    */
//   async deleteWorksheet(worksheetId: string, userId: string) {
//     const deleted = await this.db.artifact.deleteMany({
//       where: { 
//         id: worksheetId, 
//         type: 'WORKSHEET', 
//         workspace: { ownerId: userId } 
//       },
//     });

//     if (deleted.count === 0) {
//       throw new NotFoundError('Worksheet');
//     }

//     return { success: true };
//   }

//   /**
//    * Update question progress for a user
//    */
//   async updateQuestionProgress(data: {
//     questionId: string;
//     userId: string;
//     completed: boolean;
//     answer?: string;
//   }) {
//     // Verify question ownership
//     const question = await this.db.worksheetQuestion.findFirst({
//       where: {
//         id: data.questionId,
//         artifact: {
//           type: 'WORKSHEET',
//           workspace: { ownerId: data.userId },
//         },
//       },
//     });

//     if (!question) {
//       throw new NotFoundError('Question');
//     }

//     // Upsert progress
//     return this.db.worksheetQuestionProgress.upsert({
//       where: {
//         worksheetQuestionId_userId: {
//           userId: data.userId,
//           worksheetQuestionId: data.questionId,
//         },
//       },
//       update: {
//         modified: data.completed,
//         userAnswer: data.answer,
//         completedAt: data.completed ? new Date() : null,
//       },
//       create: {
//         userId: data.userId,
//         worksheetQuestionId: data.questionId,
//         modified: data.completed,
//         userAnswer: data.answer,
//         completedAt: data.completed ? new Date() : null,
//       },
//     });
//   }

//   /**
//    * Helper to parse meta field safely
//    */
//   private parseMeta(meta: any): WorksheetQuestionMeta {
//     if (!meta) return {};
//     if (typeof meta === 'object') return meta;
//     try {
//       return JSON.parse(meta.toString());
//     } catch {
//       return {};
//     }
//   }
// }

// /**
//  * Factory function to create worksheet service
//  */
// export function createWorksheetService(db: PrismaClient) {
//   return new WorksheetService(db);
// }


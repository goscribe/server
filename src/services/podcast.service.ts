// import type { PrismaClient } from '@prisma/client';
// import { NotFoundError, ValidationError } from '../lib/errors.js';
// import { v4 as uuidv4 } from 'uuid';

// export interface PodcastSegmentData {
//   id: string;
//   title: string;
//   content: string;
//   objectKey: string;
//   startTime: number;
//   duration: number;
//   keyPoints: string[];
//   order: number;
// }

// export interface PodcastMetadata {
//   title: string;
//   description?: string;
//   totalDuration: number;
//   voice: string;
//   speed: number;
//   summary: {
//     executiveSummary: string;
//     learningObjectives: string[];
//     keyConcepts: string[];
//     followUpActions: string[];
//     targetAudience: string;
//     prerequisites: string[];
//     tags: string[];
//   };
//   generatedAt: string;
// }

// export class PodcastService {
//   constructor(private db: PrismaClient) {}

//   /**
//    * Create a podcast artifact in "generating" state
//    */
//   async createGeneratingArtifact(workspaceId: string, userId: string, initialMessage: string) {
//     const workspace = await this.db.workspace.findFirst({
//       where: { id: workspaceId, ownerId: userId },
//     });

//     if (!workspace) {
//       throw new NotFoundError('Workspace');
//     }

//     return this.db.artifact.create({
//       data: {
//         title: '----',
//         type: 'PODCAST_EPISODE',
//         generating: true,
//         generatingMetadata: {
//           message: initialMessage,
//         },
//         workspaceId,
//         createdById: userId,
//       },
//     });
//   }

//   /**
//    * Update generation progress
//    */
//   async updateGenerationProgress(
//     artifactId: string,
//     currentSegment: number,
//     totalSegments: number,
//     segmentTitle: string
//   ) {
//     return this.db.artifact.update({
//       where: { id: artifactId },
//       data: {
//         generatingMetadata: {
//           currentSegment,
//           totalSegments,
//           segmentTitle,
//           message: `Generating segment ${currentSegment} of ${totalSegments}`,
//         },
//       },
//     });
//   }

//   /**
//    * Finalize podcast artifact with segments and metadata
//    */
//   async finalizePodcast(data: {
//     artifactId: string;
//     title: string;
//     description?: string;
//     userId: string;
//     segments: PodcastSegmentData[];
//     metadata: PodcastMetadata;
//     fullTranscript: string;
//   }) {
//     const { artifactId, title, description, userId, segments, metadata, fullTranscript } = data;

//     // Use a transaction for atomic updates
//     return this.db.$transaction(async (tx) => {
//       // Update artifact
//       await tx.artifact.update({
//         where: { id: artifactId },
//         data: {
//           title,
//           description,
//           generating: false,
//           generatingMetadata: {},
//         },
//       });

//       // Create segments
//       await tx.podcastSegment.createMany({
//         data: segments.map((segment) => ({
//           artifactId,
//           title: segment.title,
//           content: segment.content,
//           startTime: segment.startTime,
//           duration: segment.duration,
//           order: segment.order,
//           objectKey: segment.objectKey,
//           keyPoints: segment.keyPoints,
//           meta: {
//             voice: metadata.voice,
//             speed: metadata.speed,
//           },
//         })),
//       });

//       // Create version
//       return tx.artifactVersion.create({
//         data: {
//           artifactId,
//           version: 1,
//           content: fullTranscript.trim(),
//           data: JSON.stringify(metadata),
//           createdById: userId,
//         },
//       });
//     });
//   }

//   /**
//    * Delete artifact and cleanup (for failed generations)
//    */
//   async cleanupFailedGeneration(artifactId: string) {
//     try {
//       await this.db.artifact.delete({
//         where: { id: artifactId },
//       });
//     } catch (error) {
//       console.error('Failed to cleanup artifact:', error);
//     }
//   }

//   /**
//    * Get podcast episode with segments
//    */
//   async getEpisode(episodeId: string, userId: string) {
//     const episode = await this.db.artifact.findFirst({
//       where: {
//         id: episodeId,
//         type: 'PODCAST_EPISODE',
//         workspace: { ownerId: userId },
//       },
//       include: {
//         versions: {
//           orderBy: { version: 'desc' },
//           take: 1,
//         },
//         podcastSegments: {
//           orderBy: { order: 'asc' },
//         },
//       },
//     });

//     if (!episode) {
//       throw new NotFoundError('Podcast episode');
//     }

//     const latestVersion = episode.versions[0];
//     if (!latestVersion) {
//       throw new NotFoundError('Podcast version');
//     }

//     return { episode, latestVersion };
//   }

//   /**
//    * Regenerate a segment with new content
//    */
//   async regenerateSegment(data: {
//     episodeId: string;
//     segmentId: string;
//     newContent: string;
//     newObjectKey: string;
//     newDuration: number;
//     userId: string;
//   }) {
//     const { episodeId, segmentId, newContent, newObjectKey, newDuration, userId } = data;

//     const { episode, latestVersion } = await this.getEpisode(episodeId, userId);

//     return this.db.$transaction(async (tx) => {
//       // Update segment
//       await tx.podcastSegment.update({
//         where: { id: segmentId },
//         data: {
//           content: newContent,
//           objectKey: newObjectKey,
//           duration: newDuration,
//         },
//       });

//       // Recalculate start times
//       const allSegments = await tx.podcastSegment.findMany({
//         where: { artifactId: episodeId },
//         orderBy: { order: 'asc' },
//       });

//       let currentTime = 0;
//       for (const seg of allSegments) {
//         await tx.podcastSegment.update({
//           where: { id: seg.id },
//           data: { startTime: currentTime },
//         });
//         currentTime += seg.id === segmentId ? newDuration : seg.duration;
//       }

//       // Update metadata
//       const metadata = latestVersion.data as unknown as PodcastMetadata;
//       metadata.totalDuration = currentTime;

//       // Rebuild transcript
//       const fullTranscript = allSegments
//         .sort((a, b) => a.order - b.order)
//         .map((s) => `\n\n## ${s.title}\n\n${s.content}`)
//         .join('');

//       // Create new version
//       const nextVersion = (latestVersion.version || 0) + 1;
//       return tx.artifactVersion.create({
//         data: {
//           artifactId: episodeId,
//           version: nextVersion,
//           content: fullTranscript.trim(),
//           data: JSON.stringify(metadata),
//           createdById: userId,
//         },
//       });
//     });
//   }

//   /**
//    * Delete episode and associated resources
//    */
//   async deleteEpisode(episodeId: string, userId: string) {
//     const episode = await this.db.artifact.findFirst({
//       where: {
//         id: episodeId,
//         type: 'PODCAST_EPISODE',
//         workspace: { ownerId: userId },
//       },
//       include: {
//         podcastSegments: true,
//       },
//     });

//     if (!episode) {
//       throw new NotFoundError('Podcast episode');
//     }

//     // Return object keys for deletion from storage
//     const objectKeys = episode.podcastSegments
//       .filter((s) => s.objectKey)
//       .map((s) => s.objectKey!);

//     // Delete in transaction
//     await this.db.$transaction(async (tx) => {
//       await tx.podcastSegment.deleteMany({
//         where: { artifactId: episodeId },
//       });

//       await tx.artifactVersion.deleteMany({
//         where: { artifactId: episodeId },
//       });

//       await tx.artifact.delete({
//         where: { id: episodeId },
//       });
//     });

//     return { objectKeys };
//   }

//   /**
//    * Update episode metadata
//    */
//   async updateEpisodeMetadata(data: {
//     episodeId: string;
//     title?: string;
//     description?: string;
//     userId: string;
//   }) {
//     const { episodeId, title, description, userId } = data;

//     const { episode, latestVersion } = await this.getEpisode(episodeId, userId);

//     const metadata = latestVersion.data as unknown as PodcastMetadata;

//     if (title) metadata.title = title;
//     if (description) metadata.description = description;

//     return this.db.$transaction(async (tx) => {
//       // Create new version
//       const nextVersion = (latestVersion.version || 0) + 1;
//       await tx.artifactVersion.create({
//         data: {
//           artifactId: episodeId,
//           version: nextVersion,
//           content: latestVersion.content,
//           data: JSON.stringify(metadata),
//           createdById: userId,
//         },
//       });

//       // Update artifact
//       return tx.artifact.update({
//         where: { id: episodeId },
//         data: {
//           title: title ?? episode.title,
//           description: description ?? episode.description,
//           updatedAt: new Date(),
//         },
//       });
//     });
//   }

//   /**
//    * Get study guide content for podcast generation
//    */
//   async getStudyGuideContent(workspaceId: string) {
//     const studyGuide = await this.db.artifact.findFirst({
//       where: {
//         workspaceId,
//         type: 'STUDY_GUIDE',
//       },
//       include: {
//         versions: {
//           orderBy: { version: 'desc' },
//           take: 1,
//         },
//       },
//     });

//     return studyGuide?.versions[0]?.content || '';
//   }
// }

// /**
//  * Factory function
//  */
// export function createPodcastService(db: PrismaClient) {
//   return new PodcastService(db);
// }


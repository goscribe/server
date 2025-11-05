// import type { PrismaClient } from '@prisma/client';
// import { NotFoundError } from '../lib/errors.js';

// export interface ReorderSegmentData {
//   id: string;
//   newOrder: number;
// }

// export class PodcastSegmentReorderService {
//   constructor(private db: PrismaClient) {}

//   /**
//    * Reorder podcast segments and recalculate start times
//    */
//   async reorderSegments(data: {
//     episodeId: string;
//     userId: string;
//     newOrder: ReorderSegmentData[];
//   }) {
//     const { episodeId, userId, newOrder } = data;

//     // Verify ownership
//     const episode = await this.db.artifact.findFirst({
//       where: {
//         id: episodeId,
//         type: 'PODCAST_EPISODE',
//         workspace: { ownerId: userId },
//       },
//       include: {
//         podcastSegments: {
//           orderBy: { order: 'asc' },
//         },
//       },
//     });

//     if (!episode) {
//       throw new NotFoundError('Podcast episode');
//     }

//     // Validate all segment IDs exist
//     const segmentIds = episode.podcastSegments.map((s) => s.id);
//     const invalidIds = newOrder.filter((item) => !segmentIds.includes(item.id));
    
//     if (invalidIds.length > 0) {
//       throw new Error(`Invalid segment IDs: ${invalidIds.map((i) => i.id).join(', ')}`);
//     }

//     // Validate order values are sequential
//     const orderValues = newOrder.map((item) => item.newOrder).sort((a, b) => a - b);
//     const expectedOrder = Array.from({ length: newOrder.length }, (_, i) => i + 1);
    
//     if (JSON.stringify(orderValues) !== JSON.stringify(expectedOrder)) {
//       throw new Error('Order values must be sequential starting from 1');
//     }

//     return this.db.$transaction(async (tx) => {
//       // Update each segment's order
//       for (const item of newOrder) {
//         await tx.podcastSegment.update({
//           where: { id: item.id },
//           data: { order: item.newOrder },
//         });
//       }

//       // Get all segments in new order
//       const reorderedSegments = await tx.podcastSegment.findMany({
//         where: { artifactId: episodeId },
//         orderBy: { order: 'asc' },
//       });

//       // Recalculate start times
//       let currentTime = 0;
//       for (const segment of reorderedSegments) {
//         await tx.podcastSegment.update({
//           where: { id: segment.id },
//           data: { startTime: currentTime },
//         });
//         currentTime += segment.duration;
//       }

//       // Update total duration in latest version
//       const latestVersion = await tx.artifactVersion.findFirst({
//         where: { artifactId: episodeId },
//         orderBy: { version: 'desc' },
//       });

//       if (latestVersion) {
//         const metadata = latestVersion.data as any;
//         if (metadata) {
//           metadata.totalDuration = currentTime;

//           // Create new version with updated metadata
//           await tx.artifactVersion.create({
//             data: {
//               artifactId: episodeId,
//               version: latestVersion.version + 1,
//               content: latestVersion.content,
//               data: metadata,
//               createdById: userId,
//             },
//           });
//         }
//       }

//       // Update artifact timestamp
//       await tx.artifact.update({
//         where: { id: episodeId },
//         data: { updatedAt: new Date() },
//       });

//       return {
//         totalDuration: currentTime,
//         segmentsReordered: reorderedSegments.length,
//       };
//     });
//   }
// }

// /**
//  * Factory function
//  */
// export function createPodcastSegmentReorderService(db: PrismaClient) {
//   return new PodcastSegmentReorderService(db);
// }


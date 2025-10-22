import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import { logger } from '../lib/logger.js';

/**
 * Members router for workspace member management
 * 
 * Features:
 * - Get workspace members
 * - Invite new members via email
 * - Accept invitations via UUID
 * - Change member roles
 * - Remove members
 * - Get current user's role
 */
export const members = router({
  /**
   * Get all members of a workspace
   */
  getMembers: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      // Check if user has access to this workspace
      const workspace = await ctx.db.workspace.findFirst({
        where: {
          id: input.workspaceId,
          OR: [
            { ownerId: ctx.session.user.id },
            { members: { some: { userId: ctx.session.user.id } } }
          ]
        },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            }
          },
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                }
              }
            }
          }
        }
      });

      if (!workspace) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Workspace not found or access denied' 
        });
      }

      // Format members with roles
      const members = [
        {
          id: workspace.owner.id,
          name: workspace.owner.name || 'Unknown',
          email: workspace.owner.email || '',
          image: workspace.owner.image,
          role: 'owner' as const,
          joinedAt: workspace.createdAt,
        },
        ...workspace.members.map(membership => ({
          id: membership.user.id,
          name: membership.user.name || 'Unknown',
          email: membership.user.email || '',
          image: membership.user.image,
          role: membership.role as 'admin' | 'member',
          joinedAt: membership.joinedAt,
        }))
      ];

      return members;
    }),

  /**
   * Get current user's role in a workspace
   */
  getCurrentUserRole: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.workspace.findFirst({
        where: { id: input.workspaceId },
        select: {
          ownerId: true,
          members: {
            where: { userId: ctx.session.user.id },
            select: { role: true }
          }
        }
      });

      if (!workspace) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Workspace not found' 
        });
      }

      if (workspace.ownerId === ctx.session.user.id) {
        return 'owner';
      }

      if (workspace.members.length > 0) {
        return workspace.members[0].role as 'admin' | 'member';
      }

      throw new TRPCError({ 
        code: 'FORBIDDEN', 
        message: 'Access denied to this workspace' 
      });
    }),

  /**
   * Invite a new member to the workspace
   */
  inviteMember: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      email: z.string().email(),
      role: z.enum(['admin', 'member']).default('member'),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user is owner or admin of the workspace
      const workspace = await ctx.db.workspace.findFirst({
        where: { 
          id: input.workspaceId,
          ownerId: ctx.session.user.id // Only owners can invite for now
        }
      });

      if (!workspace) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Workspace not found or insufficient permissions' 
        });
      }

      // Check if user is already a member
      const existingMember = await ctx.db.user.findFirst({
        where: { 
          email: input.email,
          OR: [
            { id: workspace.ownerId },
            { workspaceMemberships: { some: { workspaceId: input.workspaceId } } }
          ]
        }
      });

      if (existingMember) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'User is already a member of this workspace' 
        });
      }

      // Check if there's already a pending invitation
      const existingInvitation = await ctx.db.workspaceInvitation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          email: input.email,
          acceptedAt: null,
          expiresAt: { gt: new Date() }
        }
      });

      if (existingInvitation) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'Invitation already sent to this email' 
        });
      }

      // Create invitation
      const invitation = await ctx.db.workspaceInvitation.create({
        data: {
          workspaceId: input.workspaceId,
          email: input.email,
          role: input.role,
          invitedById: ctx.session.user.id,
        },
        include: {
          workspace: {
            select: {
              title: true,
              owner: {
                select: {
                  name: true,
                  email: true,
                }
              }
            }
          }
        }
      });

      logger.info(`🎫 Invitation created for ${input.email} to workspace ${input.workspaceId} with role ${input.role}`, 'WORKSPACE', {
        invitationId: invitation.id,
        workspaceId: input.workspaceId,
        email: input.email,
        role: input.role,
        invitedBy: ctx.session.user.id
      });

      // TODO: Send email notification here
      // await sendInvitationEmail(invitation);

      return {
        invitationId: invitation.id,
        token: invitation.token,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        workspaceTitle: invitation.workspace.title,
        invitedByName: invitation.workspace.owner.name || invitation.workspace.owner.email,
      };
    }),

  /**
   * Accept an invitation (public endpoint)
   */
  acceptInvite: publicProcedure
    .input(z.object({
      token: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Find the invitation
      const invitation = await ctx.db.workspaceInvitation.findFirst({
        where: {
          token: input.token,
          acceptedAt: null,
          expiresAt: { gt: new Date() }
        },
        include: {
          workspace: {
            select: {
              id: true,
              title: true,
              owner: {
                select: {
                  name: true,
                  email: true,
                }
              }
            }
          }
        }
      });

      if (!invitation) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Invalid or expired invitation' 
        });
      }

      // Check if user is authenticated
      if (!ctx.session?.user) {
        throw new TRPCError({ 
          code: 'UNAUTHORIZED', 
          message: 'Please log in to accept this invitation' 
        });
      }

      // Check if the email matches the user's email
      if (ctx.session.user.email !== invitation.email) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'This invitation was sent to a different email address' 
        });
      }

      // Check if user is already a member
      const isAlreadyMember = await ctx.db.workspace.findFirst({
        where: {
          id: invitation.workspaceId,
          OR: [
            { ownerId: ctx.session.user.id },
            { members: { some: { userId: ctx.session.user.id } } }
          ]
        }
      });

      if (isAlreadyMember) {
        // Mark invitation as accepted even if already a member
        await ctx.db.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() }
        });

        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'You are already a member of this workspace' 
        });
      }

      // Add user to workspace with proper role
      await ctx.db.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: ctx.session.user.id,
          role: invitation.role,
        }
      });

      // Mark invitation as accepted
      await ctx.db.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() }
      });

      logger.info(`✅ Invitation accepted by ${ctx.session.user.id} for workspace ${invitation.workspaceId}`, 'WORKSPACE', {
        invitationId: invitation.id,
        workspaceId: invitation.workspaceId,
        userId: ctx.session.user.id,
        email: invitation.email
      });

      return {
        workspaceId: invitation.workspaceId,
        workspaceTitle: invitation.workspace.title,
        role: invitation.role,
        ownerName: invitation.workspace.owner.name || invitation.workspace.owner.email,
      };
    }),

  /**
   * Change a member's role (owner only)
   */
  changeMemberRole: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      memberId: z.string(),
      role: z.enum(['admin', 'member']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user is owner of the workspace
      const workspace = await ctx.db.workspace.findFirst({
        where: { 
          id: input.workspaceId,
          ownerId: ctx.session.user.id
        }
      });

      if (!workspace) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Workspace not found or insufficient permissions' 
        });
      }

      // Check if member exists and is not the owner
      if (input.memberId === workspace.ownerId) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'Cannot change owner role' 
        });
      }

      const member = await ctx.db.workspaceMember.findFirst({
        where: { 
          workspaceId: input.workspaceId,
          userId: input.memberId
        }
      });

      if (!member) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Member not found in this workspace' 
        });
      }

      // Update the member's role
      const updatedMember = await ctx.db.workspaceMember.update({
        where: { id: member.id },
        data: { role: input.role },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      logger.info(`🔄 Member role changed for ${input.memberId} from ${member.role} to ${input.role} in workspace ${input.workspaceId}`, 'WORKSPACE', {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        oldRole: member.role,
        newRole: input.role,
        changedBy: ctx.session.user.id
      });

      return {
        memberId: input.memberId,
        role: input.role,
        memberName: updatedMember.user.name || updatedMember.user.email,
        message: 'Role changed successfully'
      };
    }),

  /**
   * Remove a member from the workspace (owner only)
   */
  removeMember: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
      memberId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user is owner of the workspace
      const workspace = await ctx.db.workspace.findFirst({
        where: { 
          id: input.workspaceId,
          ownerId: ctx.session.user.id
        }
      });

      if (!workspace) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Workspace not found or insufficient permissions' 
        });
      }

      // Check if trying to remove the owner
      if (input.memberId === workspace.ownerId) {
        throw new TRPCError({ 
          code: 'BAD_REQUEST', 
          message: 'Cannot remove workspace owner' 
        });
      }

      // Check if member exists
      const member = await ctx.db.workspaceMember.findFirst({
        where: { 
          workspaceId: input.workspaceId,
          userId: input.memberId
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            }
          }
        }
      });

      if (!member) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Member not found in this workspace' 
        });
      }

      // Remove member from workspace
      await ctx.db.workspaceMember.delete({
        where: { id: member.id }
      });

      logger.info(`🗑️ Member ${input.memberId} removed from workspace ${input.workspaceId}`, 'WORKSPACE', {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        removedBy: ctx.session.user.id
      });

      return {
        memberId: input.memberId,
        message: 'Member removed successfully'
      };
    }),

  /**
   * Get pending invitations for a workspace (owner only)
   */
  getPendingInvitations: authedProcedure
    .input(z.object({
      workspaceId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      // Check if user is owner of the workspace
      const workspace = await ctx.db.workspace.findFirst({
        where: { 
          id: input.workspaceId,
          ownerId: ctx.session.user.id
        }
      });

      if (!workspace) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Workspace not found or insufficient permissions' 
        });
      }

      const invitations = await ctx.db.workspaceInvitation.findMany({
        where: {
          workspaceId: input.workspaceId,
          acceptedAt: null,
          expiresAt: { gt: new Date() }
        },
        include: {
          invitedBy: {
            select: {
              name: true,
              email: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return invitations.map(invitation => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        invitedByName: invitation.invitedBy.name || invitation.invitedBy.email,
      }));
    }),

  /**
   * Cancel a pending invitation (owner only)
   */
  cancelInvitation: authedProcedure
    .input(z.object({
      invitationId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check if user is owner of the workspace
      const invitation = await ctx.db.workspaceInvitation.findFirst({
        where: { 
          id: input.invitationId,
          acceptedAt: null,
          workspace: {
            ownerId: ctx.session.user.id
          }
        }
      });

      if (!invitation) {
        throw new TRPCError({ 
          code: 'NOT_FOUND', 
          message: 'Invitation not found or insufficient permissions' 
        });
      }

      // Delete the invitation
      await ctx.db.workspaceInvitation.delete({
        where: { id: input.invitationId }
      });

      logger.info(`❌ Invitation cancelled for ${invitation.email} to workspace ${invitation.workspaceId}`, 'WORKSPACE', {
        invitationId: input.invitationId,
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        cancelledBy: ctx.session.user.id
      });

      return {
        invitationId: input.invitationId,
        message: 'Invitation cancelled successfully'
      };
    }),
});

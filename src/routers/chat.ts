import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../trpc";
import z from "zod";
import PusherService from "../lib/pusher";

const chat = router({
    getChannel: authedProcedure
        .input(z.object({ workspaceId: z.string().optional(), channelId: z.string().optional() }))
        .query(async ({ input, ctx }) => {
            if (!input.channelId && input.workspaceId) {
                const defaultChannel = await ctx.db.channel.create({
                    data: { workspaceId: input.workspaceId, name: "General" },
                });
                return defaultChannel;
            }
            const channel = await ctx.db.channel.findUnique({
                where: { id: input.channelId },
                include: { chats: true },
            });
            if (!channel) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
            }

            return channel;
        }),
    createChannel: authedProcedure
        .input(z.object({ workspaceId: z.string(), name: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const channel = await ctx.db.channel.create({
                data: { workspaceId: input.workspaceId, name: input.name },
            });
            // Notify via Pusher
            await PusherService.emitTaskComplete(input.workspaceId, "new_channel", {
                channelId: channel.id,
                workspaceId: input.workspaceId,
                name: input.name,
                createdAt: channel.createdAt,
            });
            return channel;
        }),
    postMessage: authedProcedure
        .input(z.object({ channelId: z.string(), message: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const channel = await ctx.db.channel.findUnique({
                where: { id: input.channelId },
            });
            if (!channel) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Channel not found" });
            }
            const chat = await ctx.db.chat.create({
                data: {
                    channelId: input.channelId,
                    userId: ctx.session.user.id,
                    message: input.message,
                },
            });
            // Notify via Pusher
            await PusherService.emitTaskComplete(input.channelId, "new_message", {
                chatId: chat.id,
                channelId: input.channelId,
                userId: ctx.session.user.id,
                message: input.message,
                createdAt: chat.createdAt,
            });
            return chat;
        }),
    editMessage: authedProcedure
        .input(z.object({ chatId: z.string(), message: z.string() }))
        .mutation(async ({ input, ctx }) => {   
            const chat = await ctx.db.chat.findUnique({
                where: { id: input.chatId },
            });
            if (!chat) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Chat message not found" });
            }
            if (chat.userId !== ctx.session.user.id) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Not your message to edit" });
            }
            const updatedChat = await ctx.db.chat.update({
                where: { id: input.chatId },
                data: { message: input.message },
            });
            // Notify via Pusher
            await PusherService.emitTaskComplete(chat.channelId, "edit_message", {
                chatId: chat.id,
                channelId: chat.channelId,
                userId: chat.userId,
                message: input.message,
                updatedAt: updatedChat.updatedAt,
            });
            return updatedChat;
        }),
    deleteMessage: authedProcedure
        .input(z.object({ chatId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const chat = await ctx.db.chat.findUnique({
                where: { id: input.chatId },
            });
            if (!chat) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Chat message not found" });
            }
            if (chat.userId !== ctx.session.user.id) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Not your message to delete" });
            }
            await ctx.db.chat.delete({
                where: { id: input.chatId },
            });
            // Notify via Pusher
            await PusherService.emitTaskComplete(chat.channelId, "delete_message", {
                chatId: chat.id,
                channelId: chat.channelId,
                userId: chat.userId,
                deletedAt: new Date().toISOString(),
            });
            return { success: true };
        }),
});
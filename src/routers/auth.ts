import { z } from 'zod';
import { router, publicProcedure, authedProcedure } from '../trpc.js';
import bcrypt from 'bcryptjs';
import { serialize } from 'cookie';
import crypto from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { supabaseClient } from '../lib/storage.js';

// Helper to create custom auth token
function createCustomAuthToken(userId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  
  const base64UserId = Buffer.from(userId, 'utf8').toString('base64url');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(base64UserId);
  const signature = hmac.digest('hex');
  return `${base64UserId}.${signature}`;
}

export const auth = router({
  updateProfile: publicProcedure
    .input(z.object({
      name: z.string().min(1),
    }))
    .mutation(async ({ctx, input}) => {
      const { name } = input;

      await ctx.db.user.update({
        where: {
          id: ctx.session.user.id,
        },
        data: {
          name: name,
        }
      });

      return {
        success: true,
        message: 'Profile updated successfully',
      };
    }),
  uploadProfilePicture: publicProcedure
    .mutation(async ({ctx, input}) => {
      const objectKey = `profile_picture_${ctx.session.user.id}`;
      const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
        .from('media')
        .createSignedUploadUrl(objectKey, { upsert: true }); // 5 minutes
      if (signedUrlError) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to generate upload URL: ${signedUrlError.message}` });
      }

      await ctx.db.fileAsset.create({
        data: {
          userId: ctx.session.user.id,
          name: 'Profile Picture',
          mimeType: 'image/jpeg',
          size: 0,
          bucket: 'media',
          objectKey: objectKey,
        },
      });

      return {
        success: true,
        message: 'Profile picture uploaded successfully',
        signedUrl: signedUrlData.signedUrl,
      };
    }),
  signup: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.user.findUnique({
        where: { email: input.email },
      });
      if (existing) {
        throw new Error("Email already registered");
      }

      const hash = await bcrypt.hash(input.password, 10);

      const user = await ctx.db.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: hash,
          emailVerified: new Date(), // skip verification for demo
        },
      });

      return { id: user.id, email: user.email, name: user.name };
    }),
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { email: input.email },
      });
      if (!user) {
        throw new Error("Invalid credentials");
      }

      const valid = await bcrypt.compare(input.password, user.passwordHash!);
      if (!valid) {
        throw new Error("Invalid credentials");
      }

      // Create custom auth token
      const authToken = createCustomAuthToken(user.id);

      const isProduction = (process.env.NODE_ENV === "production" || process.env.RENDER) as boolean;

      const cookieValue = serialize("auth_token", authToken, {
        httpOnly: true,
        secure: isProduction, // true for production/HTTPS, false for localhost
        sameSite: isProduction ? "none" : "lax", // none for cross-origin, lax for same-origin
        path: "/",
        domain: isProduction ? "server-w8mz.onrender.com" : undefined,
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      
      ctx.res.setHeader("Set-Cookie", cookieValue);


      return { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        token: authToken
      };
    }),
  getSession: publicProcedure.query(async ({ ctx }) => {
    // Just return the current session from context
    if (!ctx.session) {
      throw new Error("No session found");
    }

    const user = await ctx.db.user.findUnique({
      where: { id: (ctx.session as any).user.id },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return { 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
      } 
    };
  }),
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const token = ctx.cookies["auth_token"];

    if (!token) {
      throw new Error("No token found");
    }

    await ctx.db.session.delete({
      where: { id: token },
    });

    ctx.res.setHeader("Set-Cookie", serialize("auth_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0, // Expire immediately
    }));

    return { success: true };
  }),
});


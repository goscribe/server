// src/server/auth.ts
import { ExpressAuth } from "@auth/express";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "../lib/prisma";
import Google from "@auth/core/providers/google";
import Credentials from "@auth/core/providers/credentials";

export const authRouter = ExpressAuth({
    providers: [
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
      Credentials({
        name: "credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          if (
            credentials?.email === "demo@example.com" &&
            credentials?.password === "demo"
          ) {
            return { id: "1", email: "demo@example.com", name: "Demo User" };
          }
          return null;
        },
      }),
    ],
    adapter: PrismaAdapter(prisma),
    secret: process.env.AUTH_SECRET!,
    session: { strategy: "jwt" },
  })

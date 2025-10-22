import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import * as trpcExpress from '@trpc/server/adapters/express';

import { appRouter } from './routers/_app.js';
import { createContext } from './context.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

async function main() {
  const app = express();

  // Middlewares
  app.use(helmet());
  app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true, // allow cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie'],
    exposedHeaders: ['Set-Cookie'],
  }));

  // Custom morgan middleware with logger integration
  app.use(morgan('combined', {
    stream: {
      write: (message: string) => {
        logger.info(message.trim(), 'HTTP');
      }
    }
  }));
  
  app.use(compression());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  

  // Health (plain Express)
  app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'trpc-express', ts: Date.now() });
  });

  // tRPC mounted under /trpc
  app.use(
    '/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  app.listen(PORT, () => {
    logger.info(`Server ready on http://localhost:${PORT}`, 'SERVER');
    logger.info(`tRPC endpoint at http://localhost:${PORT}/trpc`, 'SERVER');
  });
}

main().catch((err) => {
  logger.error('Failed to start server', 'SERVER', undefined, err);
  process.exit(1);
});

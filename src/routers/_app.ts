import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { router } from '../trpc.js';
import { auth } from './auth.js';
import { workspace } from './workspace.js';
import { flashcards } from './flashcards.js';
import { worksheets } from './worksheets.js';
import { studyguide } from './studyguide.js';
import { aiSession } from './ai-session.js';
import { podcast } from './podcast.js';

export const appRouter = router({
  auth,
  workspace,
  flashcards,
  worksheets,
  studyguide,
  aiSession,
  podcast,
});

// Export type for client inference
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

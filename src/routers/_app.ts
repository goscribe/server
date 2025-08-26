import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { router } from '../trpc.js';
import { auth } from './auth.js';
import { workspace } from './workspace.js';

export const appRouter = router({
  auth,
  workspace
});

// Export type for client inference
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

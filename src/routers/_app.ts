import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { router } from '../trpc';
import { auth } from './auth';
import { workspace } from './workspace';

export const appRouter = router({
  auth,
  workspace
});

// Export type for client inference
export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

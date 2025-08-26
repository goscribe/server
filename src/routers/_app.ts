import { router } from '../trpc';
import { auth } from './auth';
import { workspace } from './workspace';

export const appRouter = router({
  auth,
  workspace
});

// Export type for client inference
export type AppRouter = typeof appRouter;

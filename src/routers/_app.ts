import { router } from '../trpc';
import { sampleRouter } from './sample';

export const appRouter = router({
  sample: sampleRouter,
});

// Export type for client inference
export type AppRouter = typeof appRouter;

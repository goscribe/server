import { z } from 'zod';
import { router, publicProcedure, authedProcedure } from '../trpc';

export const workspace = router({
  // Mutation with Zod input
  list: publicProcedure
    .query(async ({ ctx, input }) => {
    }),
    
  create: publicProcedure
    .input(z.object({
  
     }))
    .mutation(({ input }) => {
   
    }),
  get: publicProcedure
    .input(z.object({
        id: z.string().uuid(),
     }))
    .query(({ input }) => {
    }),
  update: publicProcedure
    .input(z.object({
        id: z.string().uuid(),
     }))
    .mutation(({ input }) => {
   
    }), 
    delete: publicProcedure
    .input(z.object({
        id: z.string().uuid(),
     }))
    .mutation(({ input }) => {
   
    }),
    upload: publicProcedure
    .input(z.object({
        file: z.string(),
     }))
    .mutation(({ input }) => {
   
    }),
    deleteFile: publicProcedure
    .input(z.object({
        fileId: z.string().uuid(),
     }))
    .mutation(({ input }) => {
   
    }),
});

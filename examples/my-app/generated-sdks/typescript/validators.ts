import { z } from 'zod';

export const GetApiUsersResponseSchema = z.array(z.any());

export const PostApiUsersRequestSchema = z.object({
  username: z.string(),
  role: z.any(),
});

export const PostApiUsersAvatarRequestSchema = z.object({
  userId: z.string(),
});

export const PostApiCheckoutRequestSchema = z.object({
  email: z.string().email(),
  name: z.string(),
  amount: z.number(),
  simulateFailure: z.boolean(),
});

export const GetPingResponseSchema = z.object({
  message: z.string(),
});


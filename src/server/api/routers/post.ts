import { type User } from "@clerk/nextjs/dist/api";
import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Redis } from "@upstash/redis"
import { Ratelimit } from "@upstash/ratelimit"

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { privateProcedure } from '../trpc';

const filterUserforClient = (user: User) => {
    return {
        id: user.id,
        username: user.username,
        profileImageUrl: user.profileImageUrl
    }
}


const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    analytics: true,
    limiter: Ratelimit.slidingWindow(3, "1m"),
})

// (3, "1m"), this is maximum of 3 requests per minutes

export const postsRouter = createTRPCRouter({
    getAll: publicProcedure.query(async ({ ctx }) => {
        const posts = await ctx.prisma.post
            .findMany({
                take: 100,
                orderBy: [
                    { createdAt: "desc" }
                ]
            });

        const users = (await clerkClient.users.getUserList({
            userId: posts.map((post) => post.authorId),
            limit: 100,
        })).map(filterUserforClient)
        return posts.map((post) => {
            const author = users.find((user) => user.id === post.authorId)
            if (!author || !author.username)
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Author for post not found"
                })
            return {
                post,
                author: {
                    ...author,
                    username: author.username
                },
            }
        }
        )
    }),
    //https://zod.dev/
    create: privateProcedure.input(
        z.object({
            content: z.string().emoji("Only emojis are allowed").min(1).max(280)
            //content: z.string().emoji().min(1).max(280)
        })).mutation(async ({ ctx, input }) => {
            const authorId = ctx.userId || "";
            const { success } = await ratelimit.limit(authorId)
            if (!success) throw new TRPCError({ code: "TOO_MANY_REQUESTS" })
            const post = await ctx.prisma.post.create({
                data: {
                    authorId,
                    content: input.content
                }
            })
            return post;
        })

});

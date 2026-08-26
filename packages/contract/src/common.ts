import { z } from "zod"

export const sampleUserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  realName: z.string().nullable(),
})

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(10),
  offset: z.coerce.number().int().min(0).default(0),
})

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    results: z.array(item),
    total: z.number().int().nonnegative(),
  })
}

export type SampleUser = z.infer<typeof sampleUserSchema>

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

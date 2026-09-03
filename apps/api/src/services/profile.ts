import { sessionUserSchema, userProfileSchema } from "@oj2/contract"
import { and, eq } from "drizzle-orm"

import { db, schema } from "../db"

export async function getUserProfileById(userId: number, showRealName: boolean) {
  const [row] = await db
    .select({ profile: schema.userProfile, user: schema.user })
    .from(schema.userProfile)
    .innerJoin(schema.user, eq(schema.userProfile.userId, schema.user.id))
    .where(and(eq(schema.user.id, userId), eq(schema.user.isDisabled, false)))
    .limit(1)

  if (!row) return null
  return userProfileSchema.parse({
    id: row.profile.id,
    user: sessionUserSchema.parse({
      id: row.user.id,
      username: row.user.username,
      email: row.user.email,
      adminType: row.user.adminType,
      problemPermission: row.user.problemPermission,
      createTime: row.user.createTime,
      lastLogin: row.user.lastLogin,
      isDisabled: row.user.isDisabled,
      className: row.user.className,
    }),
    realName: showRealName ? row.profile.realName : null,
    acmProblemsStatus: row.profile.acmProblemsStatus,
    avatar: row.profile.avatar,
    mood: row.profile.mood,
    acceptedNumber: row.profile.acceptedNumber,
    submissionNumber: row.profile.submissionNumber,
  })
}

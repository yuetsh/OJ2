import { userProfileSchema, type Quote } from "@oj2/contract"
import api from "utils/api"
import type { Profile, Tag } from "utils/types"

export function login(data: { username: string; password: string }) {
  return api.post("auth/login", data)
}

export function signup(data: {
  username: string
  email: string
  password: string
}) {
  return api.post("users", data)
}

export function logout() {
  return api.delete("auth/session")
}

export async function getProfile(
  username: string = "",
): Promise<Profile | null> {
  const response = await api.get<unknown>(
    username ? `profiles/${encodeURIComponent(username)}` : "me",
  )
  if (response === null) return null
  // 形状与契约一致，不再逐字段搬运；zod 解析仍保留，形状对不上要当场炸
  return userProfileSchema.parse(response) as Profile
}

export function getProblemTagList() {
  return api.get<Tag[]>("problem-tags")
}

export function getHitokoto() {
  return api.get<Quote>("quotes/random")
}

export function getClassUsernames(classroom: string) {
  return api.get<string[]>(
    `classes/${encodeURIComponent(classroom)}/usernames`,
  )
}

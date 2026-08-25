import { userProfileSchema } from "@oj2/contract"
import api2 from "utils/api2"
import type { ApiResponse } from "utils/api2"
import type { Profile, Tag } from "utils/types"

export function login(data: { username: string; password: string }) {
  return api2.post("auth/login", data)
}

export function signup(data: {
  username: string
  email: string
  password: string
}) {
  return api2.post("users", data)
}

export function logout() {
  return api2.delete("auth/session")
}

export async function getProfile(
  username: string = "",
): Promise<ApiResponse<Profile | null>> {
  const response = await api2.get<unknown>(
    username ? `profiles/${encodeURIComponent(username)}` : "me",
  )
  if (response.data === null) return { error: null, data: null }
  // 形状与契约一致，不再逐字段搬运；zod 解析仍保留，形状对不上要当场炸
  return {
    error: null,
    data: userProfileSchema.parse(response.data) as Profile,
  }
}

export function getProblemTagList() {
  return api2.get<Array<Tag & { problemCount: number }>>("problem-tags")
}

export function getHitokoto() {
  return api2.get("quotes/random")
}

export function getClassUsernames(classroom: string) {
  return api2.get(`classes/${encodeURIComponent(classroom)}/usernames`)
}

import { userProfileSchema, type Quote } from "@oj2/contract"
import api from "utils/api"
import { contract } from "utils/contract"
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
  const endpoint = username ? `profiles/${encodeURIComponent(username)}` : "me"
  const response = await api.get<unknown>(endpoint)
  if (response === null) return null
  // 形状与契约一致，不再逐字段搬运。走契约闸门而不是裸 parse()：原来这里是
  // `userProfileSchema.parse(response) as Profile`，`as` 把校验结果又断言回本地
  // 类型（Profile 把 user 收窄成 SessionUser、acmProblemsStatus 收窄成具体形状），
  // 形状对不上时页面白屏。现在记一条分歧日志后放行原始数据。
  return contract("GET /profiles/:username", userProfileSchema, response)
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

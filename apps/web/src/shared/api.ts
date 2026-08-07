import { userProfileSchema } from "@oj2/contract"
import api2 from "utils/api2"
import http from "utils/http"
import type { ApiResponse } from "utils/http"
import type { Profile, Tag } from "utils/types"

export function login(data: { username: string; password: string }) {
  return api2.post("auth/login", data)
}

export function signup(data: {
  username: string
  email: string
  password: string
}) {
  return http.post("register", data)
}

export function logout() {
  return api2.delete("auth/session")
}

export async function getProfile(
  username: string = "",
): Promise<ApiResponse<Profile | null>> {
  if (username) return http.get<Profile>("profile", { params: { username } })

  const response = await api2.get<unknown>("me")
  if (response.data === null) return { error: null, data: null }
  const profile = userProfileSchema.parse(response.data)
  return {
    error: null,
    data: {
      id: profile.id,
      user: {
        id: profile.user.id,
        username: profile.user.username,
        real_name: profile.realName ?? "",
        email: profile.user.email ?? "",
        admin_type: profile.user.adminType as Profile["user"]["admin_type"],
        problem_permission: profile.user.problemPermission,
        create_time: profile.user.createTime as unknown as Date,
        last_login: profile.user.lastLogin as unknown as Date,
        open_api: profile.user.openApi,
        is_disabled: profile.user.isDisabled,
        class_name: profile.user.className,
      },
      real_name: profile.realName ?? "",
      acm_problems_status: profile.acmProblemsStatus as Profile["acm_problems_status"],
      avatar: profile.avatar,
      blog: profile.blog as null,
      mood: profile.mood ?? "",
      github: profile.github ?? "",
      school: profile.school ?? "",
      major: profile.major ?? "",
      language: profile.language ?? "",
      accepted_number: profile.acceptedNumber,
      submission_number: profile.submissionNumber,
    },
  }
}

export function getProblemTagList() {
  return http.get<Tag[]>("problem/tags")
}

export function getHitokoto() {
  return http.get("hitokoto")
}

export function getClassUsernames(classroom: string) {
  return http.get("class_usernames", { params: { classroom: classroom } })
}

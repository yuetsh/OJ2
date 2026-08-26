import api from "utils/api"
import type {
  AchievementList,
  AchievementSummary,
  PendingAchievement,
} from "utils/types"

export function getAchievements(name?: string) {
  return api.get<AchievementList>("achievements", {
    params: name ? { username: name } : {},
  })
}

export function getAchievementSummary(name?: string) {
  return api.get<AchievementSummary>("achievements/summary", {
    params: name ? { username: name } : {},
  })
}

export function getPendingAchievements() {
  return api.get<PendingAchievement[]>("achievements/pending")
}

export function markAchievementsRead(ids: number[]) {
  return api.post("achievements/pending/read", { ids })
}

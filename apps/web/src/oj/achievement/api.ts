import api2 from "utils/api2"
import type {
  AchievementList,
  AchievementSummary,
  PendingAchievement,
} from "utils/types"

export function getAchievements(name?: string) {
  return api2.get<AchievementList>("achievements", {
    params: name ? { username: name } : {},
  })
}

export function getAchievementSummary(name?: string) {
  return api2.get<AchievementSummary>("achievements/summary", {
    params: name ? { username: name } : {},
  })
}

export function getPendingAchievements() {
  return api2.get<PendingAchievement[]>("achievements/pending")
}

export function markAchievementsRead(ids: number[]) {
  return api2.post("achievements/pending/read", { ids })
}

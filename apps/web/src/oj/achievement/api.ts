import api2 from "utils/api2"
import type {
  Achievement,
  AchievementSummary,
  PendingAchievement,
} from "utils/types"

export function getAchievements(name?: string) {
  return api2
    .get<any>("achievements", { params: name ? { username: name } : {} })
    .then((response) => ({
      ...response,
      data: {
        username: response.data.username,
        achievements: response.data.achievements.map(
          (item: any): Achievement => ({
            ...item,
            unlock_time: item.unlockTime,
            unlock_rate: item.unlockRate,
          }),
        ),
      },
    }))
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

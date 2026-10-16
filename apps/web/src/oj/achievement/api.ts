import api from "utils/api"
import type { AchievementList } from "utils/types"

export function getAchievements(name?: string) {
  return api.get<AchievementList>("achievements", {
    params: name ? { username: name } : {},
  })
}

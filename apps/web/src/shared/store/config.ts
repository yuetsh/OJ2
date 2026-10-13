import { getWebsiteConfig } from "shared/api"
import type { WebsiteConfig } from "utils/types"

export const useConfigStore = defineStore("config", () => {
  const config = ref<WebsiteConfig>({
    websiteName: "",
    submissionListShowAll: true,
    allowRegister: false,
    classList: [],
  })
  async function getConfig() {
    const res = await getWebsiteConfig()
    config.value = res
    document.title = res.websiteName
  }
  return {
    config,
    getConfig,
  }
})

import { getWebsiteConfig } from "oj/api"
import type { WebsiteConfig } from "utils/types"

export const useConfigStore = defineStore("config", () => {
  const config = ref<WebsiteConfig>({
    websiteBaseUrl: "",
    websiteName: "",
    websiteNameShortcut: "",
    websiteFooter: "",
    submissionListShowAll: true,
    allowRegister: false,
    classList: [],
    enableMaxkb: true,
  })
  async function getConfig() {
    const res = await getWebsiteConfig()
    config.value = res.data
    document.title = res.data.websiteName
  }
  return {
    config,
    getConfig,
  }
})

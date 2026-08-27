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
    // 默认 false：这是给 useMaxKB 用的开关，而 MaxKB 是第三方脚本。
    // 默认 true 的话，getConfig() 还没回来挂件就已经加载执行了，服务端配置说
    // 「关」也只能事后删标签，等于开关失效。宁可晚一个来回出现，也不要关不掉。
    enableMaxkb: false,
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

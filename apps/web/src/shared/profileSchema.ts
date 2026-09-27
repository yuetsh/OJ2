// 只给 shared/api.ts 的 getProfile 动态 import 用，见那边的注释。
// 单独一个模块而不是直接 import("@oj2/contract")：动态引入整个契约桶会让 rolldown
// 重排共享 chunk，把一批原本懒加载的页面依赖提进首屏预加载（实测首屏 703KB → 1811KB）。
export { userProfileSchema } from "@oj2/contract"

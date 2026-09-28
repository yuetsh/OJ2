import type { RouteLocationNormalizedLoaded } from "vue-router"

/**
 * 题目页的三种入口：题库（含课堂）、题单、比赛。同一个 detail.vue 挂在三条路由上。
 *
 * 入口之间的差异**只在这张表里判断**。原来散在各个组件里各查各的路由：同一件事
 * 在题单里是「禁用」、在比赛里是「隐藏」，加一处功能就得把每个组件翻一遍
 * （见 docs/specs/2026-09-28-problem-page-redesign-design.md 第 8 节）。
 */
export type ProblemEntry = "problem" | "problemset" | "contest"

export type ProblemDrawer = "info" | "reaction" | "submission"

export const DRAWER_TITLE: Record<ProblemDrawer, string> = {
  info: "统计",
  reaction: "点评",
  submission: "我的提交",
}

interface EntryRules {
  /** 页签行右侧的抽屉，按显示顺序 */
  drawers: readonly ProblemDrawer[]
  /** 标题下的「已解决 / 尝试过」 */
  statusTag: boolean
  /** 题面末尾的相似题推荐 */
  similar: boolean
  /** 通过之后给「这节课的下一题」 */
  lessonNext: boolean
  /** 通过之后 1.5 秒弹强制点评 */
  reviewAfterAccepted: boolean
  /** 通过之后 1.5 秒回题单 */
  backToProblemSet: boolean
  /** 举手求助 */
  help: boolean
  /**
   * 老师协作绑在这一页的编辑器上。房间只记了题号（`room.problemId` 是 displayId），
   * 比赛题的编号常是 1、2、3 —— 老师帮着学生做公开题 1 的时候打开比赛题 1，会绑上
   * 学生的文档、挂出协作条、禁掉语言选择
   */
  collab: boolean
  /**
   * 教师的「课堂统计」。统计接口按 displayId 在公开题库里找题（`submission-statistics.ts`），
   * 比赛题号拿过去查到的是另一道公开题，或者 404
   */
  classStats: boolean
  /**
   * 「看这道题所有人的提交」放进「⋯」（只给管理员角色）。它平时在「我的提交」抽屉底部，
   * 题单入口没有抽屉，老师就没地方点了
   */
  allSubmissionsInMenu: boolean
}

const RULES: Record<ProblemEntry, EntryRules> = {
  problem: {
    drawers: ["info", "reaction", "submission"],
    statusTag: true,
    similar: true,
    lessonNext: true,
    reviewAfterAccepted: true,
    backToProblemSet: false,
    help: true,
    collab: true,
    classStats: true,
    allSubmissionsInMenu: false,
  },
  // 题单里什么「以前的」都不给看：加入题单之前的提交、统计、点评都能拿来抄答案
  problemset: {
    drawers: [],
    statusTag: false,
    // 点进相似题就离开了题单
    similar: false,
    lessonNext: false,
    // 1.5 秒后要跳回题单页，弹了也会被冲掉
    reviewAfterAccepted: false,
    backToProblemSet: true,
    help: true,
    collab: true,
    classStats: true,
    allSubmissionsInMenu: true,
  },
  contest: {
    drawers: ["info", "submission"],
    statusTag: true,
    // 相似题接口按 displayId 在公开题库里找，比赛题的编号默认是 1/2/3，
    // 撞上同号公开题时反而会在比赛中把题库列给学生
    similar: false,
    lessonNext: false,
    reviewAfterAccepted: false,
    backToProblemSet: false,
    help: false,
    collab: false,
    classStats: false,
    allSubmissionsInMenu: false,
  },
}

export function problemEntryOf(route: RouteLocationNormalizedLoaded): ProblemEntry {
  if (route.name === "contest problem") return "contest"
  if (route.name === "problemset problem") return "problemset"
  return "problem"
}

/**
 * 当前入口和它的规则。跟着路由算、不在 setup 时取一次：三条路由之间是复用同一个页面的。
 */
export function useProblemPageContext() {
  const route = useRoute()
  return computed(() => {
    const entry = problemEntryOf(route)
    return {
      entry,
      contestId: entry === "contest" ? String(route.params.contestID ?? "") : "",
      problemSetId: entry === "problemset" ? String(route.params.problemSetId ?? "") : "",
      ...RULES[entry],
    }
  })
}

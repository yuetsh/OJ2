import type { RunnableLanguage, TrialRunRequest, TrialRunResponse } from "@oj2/contract"
import api from "./api"
import type { LANGUAGE } from "./types"

/**
 * 试运行：走本站判题机（`POST /trial-runs`，见 apps/api/src/judge/trial.ts），不算提交。
 * 和提交是同一台判题机、同一套编译命令，例子上跑出来的结果和提交一个口径。
 *
 * 原来走的是另一台 Judge0（C 是 GCC 9、参数也不同），2026-09 换掉了。
 */
export function trialRun(payload: TrialRunRequest) {
  return api.post<TrialRunResponse>("trial-runs", payload)
}

/** 判题机跑得了的语言。Flowchart、SQL 不是可执行代码 / 不走判题机，历史语言镜像里已经没有了 */
export function isRunnableLanguage(language: LANGUAGE): language is RunnableLanguage {
  return language === "C" || language === "C++" || language === "Python"
}

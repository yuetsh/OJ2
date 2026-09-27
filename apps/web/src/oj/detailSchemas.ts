// 只给 oj/api.ts 的 getProblem / getSubmission 动态 import 用。
// 静态 import 的话 zod 运行时会跟着 oj/api.ts 进首页（题目列表也从那个文件取函数）。
// 单独一个模块而不是直接 import("@oj2/contract")，理由同 shared/profileSchema.ts。
export { problemDetailSchema, submissionDetailSchema } from "@oj2/contract"

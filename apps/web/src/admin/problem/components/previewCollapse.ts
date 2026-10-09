/**
 * 出题页右栏「学生看到的样子」收没收起来。两张出题页（编程题、SQL 题）共用一个开关，
 * 记在本机：老师想专心写的时候收起来，下次打开还是收着的
 */
export function usePreviewCollapsed() {
  return useStorage("oj2:admin-problem-preview-collapsed", false)
}

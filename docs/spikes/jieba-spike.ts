#!/usr/bin/env bun
// 验证 @node-rs/jieba 能否替代 Python jieba
// 对照 flowchart/views/admin.py:65,191 的用法：add_word + cut
import { Jieba } from "@node-rs/jieba"
import { dict } from "@node-rs/jieba/dict"

const jieba = Jieba.withDict(dict)

const text = "输入两个整数并输出它们的和"
console.log("默认切词:", jieba.cut(text).join(" / "))

// 对应 jieba.add_word(_w, freq=9999)
// 注：@node-rs/jieba@2.0.1 没有 insertWord/addWord 方法（.d.ts 未导出），
// 改用 loadDict 加载一份自定义词条缓冲区，格式同 Python jieba 用户词典："词 词频"
jieba.loadDict(Buffer.from("两个整数 9999\n"))
console.log("加词后  :", jieba.cut(text).join(" / "))

const t0 = performance.now()
for (let i = 0; i < 1000; i++) jieba.cut(text)
console.log("1000 次切词耗时:", (performance.now() - t0).toFixed(0), "ms")

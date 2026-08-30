---
name: cordis_define_stringified_plugin_pitfall
description: flash 模型调用 cordis_define 时嵌套对象参数被双重编码成字符串导致 oneOf 校验失败的环境坑，DeepSeek 模型正常
type: project
---
规则：使用部分模型（如 flash）调用 `cordis_define` 时，嵌套对象参数（尤其 `plugin` 字段）可能被序列化成**双重编码的 JSON 字符串**（形如 `plugin: "{\"idPrefix\": \"clk\", \"kind\": \"new\"}"`），导致宿主端 oneOf 校验报 `must match exactly one oneOf branch (matched 0)`。

**Why:** 宿主在 `packages/core/tools/src/schema.ts:496-520` 提供了 `coerceStringifiedObjects` 兜底：只对以 `{` 开头并以 `}` 结尾的**单层**字符串化参数做 `JSON.parse` 解包；双重编码的字符串以 `"` 开头，不满足条件，原样返回字符串后进入 oneOf 校验（`tool-cordis/src/index.ts:159-184` 要求 `plugin` 必须是 object），于是两个分支全部匹配失败。这不是 harness 的 bug，也不是插件代码或前缀问题——同一份代码用 `dctr` 前缀成功、`dcnt`/`ping`/`clk` 失败，是模型侧工具调用参数序列化不稳定。DeepSeek 等主模型正确输出嵌套对象，故每次都能通过。

**How to apply:** 在 DemoStudio 中使用 flash 等轻量模型创建/修改插件时，若 `cordis_define` 连续报 oneOf matched 0，先检查工具调用 Payload 里 `plugin` 是否为字符串而非对象；如果是，建议切换到 DeepSeek 模型后重试，或让 flash 模型只准备代码、由主模型执行 `cordis_define` + `cordis_run`。`cordis_inspect_query` 的 `input` 参数也可能受同样问题影响（报 `"input" must be an object`）。

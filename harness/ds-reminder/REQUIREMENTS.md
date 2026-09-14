# @demostudio/ds-reminder 需求文档

回合末通用提醒插件：把"回合边界向模型注入提醒"的机制从 ds-memory / ds-experience 中提取收敛为一处。

## 背景

2026-09-13 前，ds-memory（`agent/turn-stopping` + `steer`）与 ds-experience（`turn/end` + `inject`）各自维护一套几乎相同的回合末提醒脚手架（pre-step 记回合号 + tools/result 登记保存 + 冷却 + 子 agent 门控），提醒文案硬编码在插件源码里。本次提取：机制收敛进本插件，文案改为 `.dsh/reminder/` 下的文本文件（文案是数据不是代码）。

## 功能需求

- **FR-1 提醒条目**：配置声明 N 条提醒，每条含 id、文本来源（file 相对 reminderDir / 内联 text 回退）、投递通道（steer=turn-stopping+agent.steer，回合多跑一步；inject=turn/end+agent.inject，入队下一回合）、skipTools、cooldownMs、enabled、summary。
- **FR-2 文案文件化**：注入前**实时读取**文本文件（改文件即生效，无需重编译/重启）；读取失败或空文件回退内联 text，再不行则本轮不注入且不消耗冷却水位。
- **FR-3 已保存跳过（各自只看自己）**：`agent/pre-step`（waterfall，await next() 原样返回）记当前回合号，`tools/result` 登记成功（!isError）的保存类工具发生在哪个回合；回合末某条提醒的 skipTools 命中当前回合即跳过该条——双写场景（memory_write + experience_save）互不抑制。
- **FR-4 fail-open**：未观测到回合号按"未保存"处理照常提醒。
- **FR-5 冷却**：按 agent × 提醒 记（默认 60s，WeakMap 随 Agent 回收）。
- **FR-6 门控**：子 agent（delegationDepth > 0）不注入；session 未登记 agent 时 warn 可见。
- **FR-7 通道按需注册**：只有被启用提醒需要的监听才注册（无 steer 条不注册 turn-stopping；无 inject 条不注册 session 登记与 session/event；skipTools 全空不注册 pre-step/tools-result）。
- **FR-8 配置健壮性**：schema 内层字段全 default（宽容校验），语义校验在运行时 normalize——无效条目 warn 丢弃，绝不阻塞装载；enabled: false / reminders: [] / 插件 enabled: false 均可关。

## 非目标

- 不做任何 LLM 调用（harness_no_llm_design）。
- 不提供工具、不注入 system prompt 段（提醒行为的"该做什么"指导仍在各业务插件的指导段里）。
- 不感知文件系统外的保存方式（直接用 write 工具改 .dsh/memory 不会被跳过判定识别——方向安全：多提醒，不漏提醒）。

## 验证

- `npm run test`：装配/配置面、双通道注入与契约、跳过判定全分支、冷却、门控、fail-open、文件读取/回退/热更新。
- 真实链路：junction 挂载 + profiles patch 后，**重启 agent** 生效（junction 代码随进程启动载入）。

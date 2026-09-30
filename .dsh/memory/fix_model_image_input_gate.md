---
name: fix_model_image_input_gate
description: glm-5.3-flash "does not support image input" 报错根因与修复：手工声明模型需补 input:[text,image]，重写会冲掉声明导致复发；落点 2026-09-30 起为活动 profile patch（内核 0.1.7 移除 settings.yaml），优先走供应商设置面板（prefix: harness）
type: project
prefix: [doc/editor/integration/agent_panel_system.md, doc/harness/harness_system.md]
---
**Problem:** 请求带图时报 `DSH RPC session.prompt error: Model "glm-5.3-flash" does not support image input.`，尽管 glm-5.3-flash 官方就是 VLM。2026-09-10 修复过一次，之后复发。

**Cause:** DSH 判定模型能否收图看的是该模型条目的 `input` 声明，不是模型真实能力。glm-5.3-flash 是手工声明条目，pi-ai 内置目录无同名条目（只有 glm-5v-turbo 带 image），`input` 缺省兜底为 `["text"]`。请求构建时 `dsh-llm-pi-ai\lib\index.js:1721` 的门禁 `containsImage && !model.input.includes("image")` 直接抛 LlmError。复发根因：声明文件会被重写（本次是默认模型切到 glm2 时 agent-default-model 段重新写入），手工补的 `input` 声明被冲掉。**落点变更（2026-09-30）：内核 0.1.7-rc.2 已移除 `~/.dsh/settings.yaml`，模型声明现落在活动 profile patch `~/.dsh/profiles/web/cordis.patch.yml` 的 `- id: llm-pi-ai` 覆盖条目（热加载仍生效）。**

**Solution:** 给每个 glm-5.3-flash 条目（zai、glm2 两个路由都要）补 `input: [text, image]`；patch 热加载，改完即生效无需重启。再遇此报错先查 `~/.dsh/profiles/web/cordis.patch.yml` 里 `models[].input` 是否还在。**优先走编辑器「供应商设置」面板**：每模型的上下文/视觉（input）可配，写回走 settings.mutate 而非手工改文件（实现见 doc/editor/integration/agent_panel_system.md §13）；启动管线对 home patch 已改合并保留（memory:dsh_settings_profile_patch_persistence），手工声明不再被启动覆盖。

**Applicable:** DSH 图像链路（配合 dsh_image_pipeline_anchors）；任何手工声明到 settings.yaml 的模型报"不支持 image input"时；settings.yaml 手工改动被工具/配置写入覆盖的场景。

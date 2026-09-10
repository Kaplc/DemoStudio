# 记忆索引

<!-- 由 @demostudio/ds-memory 维护；索引不是记忆，正文在各自文件中 -->

- [agent_window_log_pitfall](agent_window_log_pitfall.md) — Agent 独立窗口日志进不了主窗口/日志文件的根因与已落地修复（prefix: electron）
- [cordis_define_stringified_plugin_pitfall](cordis_define_stringified_plugin_pitfall.md) — flash 模型 cordis_define 嵌套参数双重编码导致 oneOf 失败的环境坑（prefix: harness）
- [ds_instructions_lazy_injection](ds_instructions_lazy_injection.md) — 指令注入时机：global step1 自动、其余前缀惰性（prefix: harness/ds-instructions）
- [ds_memory_end_of_turn_reminder](ds_memory_end_of_turn_reminder.md) — ds-memory 回合末提醒机制（turn-stopping + steer；本回合已保存过记忆/经验则跳过）（prefix: harness/ds-m…
- [ds_memory_no_auto_search](ds_memory_no_auto_search.md) — ds-memory 检索三通道 + prefix 表达式（&&/||，prefix: harness/ds-memory）
- [editor_mcp_roundtrip_pitfall](editor_mcp_roundtrip_pitfall.md) — 新增编辑器命令必须进主进程往返模式 if 列表（prefix: electron）
- [editor_tools_channel_choice](editor_tools_channel_choice.md) — 编辑器/游戏两层工具通道选择规则；editor_screenshot 已于 2026-09-10 按用户要求加回（PNG 落盘 logs/screenshots/，配…
- [harness_no_llm_design](harness_no_llm_design.md) — 用户决策：harness 插件不做隐性 LLM 调用（prefix: harness）
- [memory_write_manual_flow](memory_write_manual_flow.md) — memory_write 半自动：工具写 frontmatter+索引、正文 agent 手写；返回值禁显式 undefined 键（prefix: harness/ds-memory）
- [root_lint_script_broken](root_lint_script_broken.md) — root lint script broken：门禁用 tsc + vitest + playwright（沙箱关时 npx 可用，沙箱开时直连 node 二进制）（prefix: …
- [ds_experience_reminder_and_associate](ds_experience_reminder_and_associate.md) — ds-experience 回合末提醒 + prefix 联想（2026-09-09 与 ds-memory 同构，prefix: harness/ds-experience）
- [user_ui_no_icon_by_default](user_ui_no_icon_by_default.md) — UI 不加 icon/emoji，除非用户要求（prefix: / 全局）
- [memory_experience_channel_clarification](memory_experience_channel_clarification.md) — 用户纠正：记忆和经验现在不是冷/热通道之分，两者都是混合通道（prefix 自动注入 + 按需检索）
- [edit_tool_strips_utf8_bom](edit_tool_strips_utf8_bom.md) — edit/write 重写文件会抹掉 UTF-8 BOM，导致本仓带 BOM 源文件 diff 首行出现噪音（含补回命令）（prefix: src/engine || pro…
- [dsh_image_pipeline_anchors](dsh_image_pipeline_anchors.md) — DSH 图像→模型链路锚点：能力门禁/附件化/请求变体/base64 内联的关键包与行号，vision 类任务先查这条（prefix: harness/ds-editor…

# 记忆索引

<!-- 由 @demostudio/ds-memory 维护；索引不是记忆，正文在各自文件中 -->

- [agent_window_log_pitfall](agent_window_log_pitfall.md) — Agent 独立窗口日志进不了主窗口/日志文件的根因与已落地修复（prefix: electron）
- [cordis_define_stringified_plugin_pitfall](cordis_define_stringified_plugin_pitfall.md) — flash 模型 cordis_define 嵌套参数双重编码导致 oneOf 失败的环境坑（prefix: harness）
- [ds_instructions_lazy_injection](ds_instructions_lazy_injection.md) — 指令注入时机：global step1 自动、其余前缀惰性（prefix: harness/ds-instructions）
- [ds_memory_end_of_turn_reminder](ds_memory_end_of_turn_reminder.md) — ds-memory 回合末自动提醒机制（prefix: harness/ds-memory）
- [ds_memory_no_auto_search](ds_memory_no_auto_search.md) — ds-memory 检索三通道 + prefix 表达式（&&/||，prefix: harness/ds-memory）
- [editor_mcp_roundtrip_pitfall](editor_mcp_roundtrip_pitfall.md) — 新增编辑器命令必须进主进程往返模式 if 列表（prefix: electron）
- [editor_tools_channel_choice](editor_tools_channel_choice.md) — 通道选择：游戏层 emit_ai_event / 编辑器 UI editor_* CDP（prefix: harness/ds-editor-tools）
- [harness_no_llm_design](harness_no_llm_design.md) — 用户决策：harness 插件不做隐性 LLM 调用（prefix: harness）
- [memory_write_manual_flow](memory_write_manual_flow.md) — memory_write 返回指引不落盘，手动三步落盘（prefix: harness/ds-memory）
- [user_ui_no_icon_by_default](user_ui_no_icon_by_default.md) — UI 不加 icon/emoji，除非用户要求（prefix: / 全局）

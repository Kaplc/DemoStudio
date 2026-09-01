# 记忆索引

<!-- 由 @demostudio/ds-memory 维护；索引不是记忆，正文在各自文件中 -->

- [ds-plugin-mounting](ds-plugin-mounting.md) — DSH 插件挂载机制（junction+patch）、ds-sync 同步插件、启动链路与 ds-engine-tools 修复记录（原 ds-plugin，已改名）
- [e2e_mem_test_marker](e2e_mem_test_marker.md) — E2E 记忆测试标记，仅用于验证记忆提取链路，无业务含义
- [cordis_define_stringified_plugin_pitfall](cordis_define_stringified_plugin_pitfall.md) — flash 模型调用 cordis_define 时嵌套对象参数被双重编码成字符串导致 oneOf 校验失败的环境…
- [agent_window_log_pitfall](agent_window_log_pitfall.md) — Agent 窗口日志无法进入主窗口 Console 面板与日志文件的根因及修复方向
- [ds_instructions_lazy_injection](ds_instructions_lazy_injection.md) — ds-instructions 指令惰性注入机制：global.instructions.md 不会在会话开头自动出现，须等 Agent 读取匹配文件后才…
- [editor_screenshot_tool_removed](editor_screenshot_tool_removed.md) — 更新编辑器工具可用性：editor_emit/editor_click/editor_read 等已可用；editor_screenshot 仍禁用
- [demo_editor_emit_ai_event_channel](demo_editor_emit_ai_event_channel.md) — DemoStudio 编辑器操作应走 emit_ai_event 通道，editor_emit/editor_read/editor_clic…
- [ds_experience_no_auto_extract](ds_experience_no_auto_extract.md) — 经验插件移除自动提炼，改为 AI 自觉调用 experience_save
- [ds_memory_no_auto_search](ds_memory_no_auto_search.md) — 记忆插件移除自动检索注入，改为 agent 自觉调用 memory_search
- [ds_memory_search_no_llm](ds_memory_search_no_llm.md) — memory_search 改为纯文件读取，移除 LLM 调用
- [ds_experience_search_no_llm](ds_experience_search_no_llm.md) — experience_search 改为纯文件读取，harness 下无 LLM 调用
- [user_ui_no_icon_by_default](user_ui_no_icon_by_default.md) — UI 不加 icon/emoji，除非用户要求

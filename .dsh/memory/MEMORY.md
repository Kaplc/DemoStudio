# 记忆索引

<!-- 由 @demostudio/ds-memory 维护；索引不是记忆，正文在各自文件中 -->

- [ds-plugin-mounting](ds-plugin-mounting.md) — DSH 插件挂载机制（junction+patch）、ds-sync 同步插件、启动链路与 ds-engine-tools 修复记录（原 ds-plugin，已改名）
- [e2e_mem_test_marker](e2e_mem_test_marker.md) — E2E 记忆测试标记，仅用于验证记忆提取链路，无业务含义
- [cordis_define_stringified_plugin_pitfall](cordis_define_stringified_plugin_pitfall.md) — flash 模型调用 cordis_define 时嵌套对象参数被双重编码成字符串导致 oneOf 校验失败的环境…
- [agent_window_log_pitfall](agent_window_log_pitfall.md) — Agent 窗口日志无法进入主窗口 Console 面板与日志文件的根因及修复方向
- [ds_instructions_lazy_injection](ds_instructions_lazy_injection.md) — ds-instructions 指令惰性注入机制：global.instructions.md 不会在会话开头自动出现，须等 Agent 读取匹配文件后才…
- [editor_screenshot_tool_removed](editor_screenshot_tool_removed.md) — 更新编辑器工具可用性：editor_emit/editor_click/editor_read 等已可用；editor_screenshot 仍禁用
- [demo_editor_emit_ai_event_channel](demo_editor_emit_ai_event_channel.md) — DemoStudio 编辑器操作应走 emit_ai_event 通道，editor_emit/editor_read/editor_clic…

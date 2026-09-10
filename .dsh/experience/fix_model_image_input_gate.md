---
name: fix_model_image_input_gate
task_type: debug/config-fix
outcome: success
date: 2026-09-10
prefix: harness
---
## Summary

编辑器 agent 模型 glm-5.3-flash 的 read_image 被 DSH 门禁拦，根因是 ~/.dsh/settings.yaml 手工声明的模型条目缺 input 模态，补 `input: [text, image]` 后热生效修复并端到端验证。

## Lessons

有效路径：用真实报错文案 "declare image input" 作 grep 锚点定位门禁（dsh-tool-fs assertImageCapableRoute）→ 顺藤摸到模态来源链：settings.yaml llm-pi-ai.providers.<route>.models[].input，手工声明且 pi-ai 内置目录（@earendil-works/pi-ai/dist/providers/data/*.json）无同名条目时默认 ["text"] → 补声明 → 本会话直接 read_image 端到端验证（截图真实进模型）。踩坑：① 别轻信"该模型不支持视觉"的旧结论，先查上游官方文档确认模型真实能力（glm-5.3-flash 官方就归 vlm 分类），门禁拦截≠模型没能力，多半是声明缺失；② settings.yaml 热加载，改完立即生效，无需重启 agent/编辑器；③ pi-ai 显式 models 列表会替换整个内置目录，目录里的其它模型（如 glm-5v-turbo）不会自动可用，要用得在列表里显式补条目。

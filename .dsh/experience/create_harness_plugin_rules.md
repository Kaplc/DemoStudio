---
name: create_harness_plugin_rules
task_type: feature/instruction-setup
outcome: success
date: 2026-08-31
---
## Summary

探索 harness/ 下 8 个插件，归纳公共规范后创建 .dsh/instructions/harness.instructions.md，并在 web/headless 两个 profile 的 cordis.patch.yml 中为 ds-instructions 添加 harness 映射以支持自动注入。

## Lessons

有效做法：先 glob 目录全貌，再逐个读 README/package.json/src/index.ts 归纳插件职责与公共模式（命名、入口导出、Cordis API、红线），写成指令文件；落点是 .dsh/instructions/ 加上 cordis.patch.yml 映射。坑：ds-instructions 默认只映射 src/engine 和 src/projects，新增指令文件后必须同步在 web 和 headless 两个 profile 的 cordis.patch.yml 中都加映射，否则自动注入不生效。

## Effective Path

harness/ + .dsh/instructions/ + .dsh/profiles/*/cordis.patch.yml

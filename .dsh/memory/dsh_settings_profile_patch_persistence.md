---
name: dsh_settings_profile_patch_persistence
description: 内核 0.1.7+ 设置持久化落在活动 profile patch（settings.yaml 已移除）；editor.bat copy /Y 覆盖它导致供应商重启丢失，sync 脚本已改合并写入（dsh-patch-merge）
type: project
prefix: [scripts/sync-dsh-plugins.mjs, scripts/dsh-patch-merge.mjs, editor.bat]
---

**Problem:** 2026-09-30 用户报告：编辑器「供应商设置」添加的自定义第三方供应商，重启编辑器就丢失（DSH WebUI 添加的不丢）。
**Cause:** 编辑器面板与 WebUI 走**同一个** `settings.mutate` RPC；内核 0.1.7-rc.2 起 `~/.dsh/settings.yaml` 已移除（`SettingsForms.importLegacyDocument` 启动时改名 `.imported` 一次性迁移），用户设置持久化在**活动 profile patch** `~/.dsh/profiles/web/cordis.patch.yml` 顶层的 `- id: <ns>` config 覆盖条目（`llm-pi-ai` 供应商 / `agent-default-model` / `ui-settings-general` 都在这）。而 `editor.bat` 启动管线用 `copy /Y` 把项目侧生成的 patch **整文件覆盖**到 home 侧 → 内核写入的用户条目每次启动被抹掉。
**Solution:** `scripts/sync-dsh-plugins.mjs` 生成项目侧后用 `scripts/dsh-patch-merge.mjs` **合并写入** home 侧三份（web/headless profile patch + `~/.dsh/cordis.patch.yml`）：托管块（`ds-*`/`preset-*`/`session-query-sqlite`）整块换新，其余顶层条目原样保留；editor.bat 的 copy /Y 已删。合并幂等（SHA256 验证）。模态声明落点变化见 memory:fix_model_image_input_gate；改提醒条目步骤见 memory:reminder_skiptools_config_override（其第③步已简化）。
**Applicable:** 一切"编辑器/设置页改的配置重启就丢"类症状——先查内核写的是哪个文件、启动管线是否整文件覆盖它；手工配置 DSH 用户级设置直接改 `~/.dsh/profiles/web/cordis.patch.yml`（热加载）。


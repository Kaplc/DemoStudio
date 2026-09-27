---
name: reminder_skiptools_config_override
description: 踩坑：skipTools 改动需三步闭环（DEFAULT_REMINDERS + sync 脚本挂载块 + 手动复制 home 侧 patch）——应用内重启不跑 editor.bat，且 ds-sync 启动时会把 home 旧 profiles 回写项目侧
type: project
prefix: [harness/ds-reminder/src/index.ts, scripts/sync-dsh-plugins.mjs]
---

**Problem:** 2026-09-30 给 ds-reminder 的 DEFAULT_REMINDERS 加 `memory_reinforce`/`experience_reinforce` 到 skipTools，单测全绿但运行时不生效——提醒照发。两层原因叠加。
**Cause:** ① `scripts/sync-dsh-plugins.mjs` 的 ds-reminder 块**显式全量声明** reminders（含逐条 skipTools）；cordis config 全量替换（`config?.reminders ?? DEFAULT_REMINDERS`），DEFAULT_REMINDERS 只是未挂载时的兜底，改了 DEFAULT 不改挂载块 = 不生效。② 改完 sync 只更新了**项目侧** patch；用户用**应用内重启**（app.relaunch，不经过 editor.bat）→ editor.bat 的"生成项目侧 + 复制 home 侧"步骤没跑，且内核启动时 **ds-sync 把 `~/.dsh/profiles` home→项目 同步回写**（copyFileSync 保留 mtime）→ 项目侧新 patch 被旧 home 内容覆盖。junction 只覆盖 node_modules 插件代码（所以新工具在册），插件 **config 来自 home 侧 patch 的 insert 块**——旧 config 导致 skipTools 不生效。
**Solution:** 改 skipTools/加提醒条目**三步闭环**：① 改 `harness/ds-reminder/src/index.ts` 的 DEFAULT_REMINDERS（兜底 + 单测断言面）；② 改 `scripts/sync-dsh-plugins.mjs` 挂载块；③ `node scripts/sync-dsh-plugins.mjs` 后**手动复制项目侧 patch 到 home**（web/headless/root 三份，应用内重启不跑 editor.bat 必须手动），验证 `.dsh/profiles/{web,headless}/cordis.patch.yml`（root 的只含 agent-presets）与 `%USERPROFILE%\.dsh\profiles\` 同名文件**都**含新清单，再重启内核。走 editor.bat 完整重启则 ③ 自动完成。
**Applicable:** 一切 ds-reminder 提醒条目变更（skipTools/文案/冷却/新增条目）；凡"默认值 + 全量替换式 config"双源的插件配置；任何"改了项目侧 patch 但应用内重启后不生效"的场景——先查 ds-sync 是否把 home 旧文件同步回写了项目侧。


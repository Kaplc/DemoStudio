---
name: ds-plugin-mounting
description: DSH 插件挂载机制与 ds-memory/ds-sync 插件、profile 启动链路的完整结论
type: project
---
# DSH 插件挂载与 profile 机制（2026-08-30 验证结论）

## 插件挂载三要素（home 在 ~/.dsh）
1. **编译**：插件目录 `npm run build` 产出 `dist/`（如 `harness/ds-memory`、`harness/ds-sync`、`harness/ds-engine-tools`）
2. **junction**：`~/.dsh/profiles/{web,headless}/node_modules/@demostudio/<pkg>` 建 Junction 指向仓库插件目录（无需管理员）
3. **patch insert 行**：`~/.dsh/profiles/{web,headless}/cordis.patch.yml` 里 `- insert: [{id, name, config}]`

**关键**：profile 必须在 `~/.dsh/profiles/`（C 盘用户目录），项目内 `harness/profile/profiles/` 不会被 `dsh --profile` 发现（旧版 dsh.profile 自定义格式仅供已废弃的 dsh-service.mjs）。

## 已挂插件
- `@demostudio/ds-memory`：记忆系统（memoryDir 钉到 `E:/DemoStudio/.dsh/memory`）
- `@demostudio/ds-sync`：启动时把 home 的 `.agent-presets`/`skills`/`profiles`/`memory` 同步到项目 `.dsh`（sha1 内容比对，变化才写，跳过 node_modules）

## 启动链路（哪个 profile 生效）
- `editor.bat` → Electron → `electron/main.ts` `spawnDshAgent()` → 全局 npm dsh `--profile web --no-open`（端口 3080，后台内核）
- `dsh-source.bat` → 源码版 `pnpm dsh web`（浏览器 WebUI，端口 3080）
- `dsh --profile headless "任务"`：命令行无界面任务
- `editor/dsh-service.mjs` 是**已废弃旧链路**（headless + 9878 端口，代码无调用点）

## ds-engine-tools 修复记录（2026-08-30）
- 目录原名 `harness/ds-plugin`，2026-08-30 改为 `harness/ds-engine-tools`（与包名 @demostudio/ds-engine-tools 一致），junction 目标已同步更新
- 补了 `export const inject = ['tools']`（否则 ctx.tools 为 undefined）
- `ctx.effect()` 回调**无参**！必须闭包捕获 ctx：`ctx.effect(() => registerTools(ctx))`，不能用 `(inner) =>`（inner 是 undefined）
- DSH rc.2 的 `tools.register` 强制要求工具带 `output: { schema, render, presentationMeta? }` 字段，5 个引擎工具（inspect_scene 等）目前缺该字段，暂无法挂进标准 profile（demostudio-test 中已注释掉）

---
name: root_lint_script_broken
description: root lint script broken：门禁用 tsc + vitest + playwright（沙箱关时 npx 可用，沙箱开时直连 node 二进制；dev server 5173 被占时 e2e 用 E2E_BASE_URL=5174 指路）
type: project
prefix: [package.json, playwright.e2e.config.ts]
---




**Problem:** 按全局指令"每次修改后 lint 归零"执行 `npm run lint`，必然报 `'eslint' is not recognized`，无法完成 lint 门禁。

**Cause:** DemoStudio 根 checkout 的 node_modules 里没有 eslint（无 `.bin/eslint`、无包本体），`devDependencies` 也没有声明，且项目根不存在任何 eslint 配置文件（`.eslintrc*` / `eslint.config.*` 均无）——根 `package.json` 的 `lint` 脚本形同虚设。harness 子插件不受影响（各自用 oxlint 且已安装）。

**Solution:** 根项目改动的门禁 = 类型检查 + 单测（涉及运行时表现/交互再加 e2e），两套写法按沙箱状态选：
- **沙箱关闭（danger-full-access，常规态）**：`npx tsc --noEmit`、`npx vitest run`、`npm run test:e2e:warm`（= `playwright test -c playwright.e2e.config.ts warm`；前置：dev server 已在 :5173）。
- **沙箱开启（workspace-write 受限态）**：npx 必挂（`npx.ps1` 报 `StandardOutputEncoding is only supported when standard output is redirected`），外部 exe 接 PowerShell 管道（`… 2>&1 | Select-Object`）报"拒绝访问"，vitest/playwright 因 spawn 子进程 + 管道 EPERM —— 改直连本地二进制 `node node_modules/typescript/bin/tsc --noEmit` / `node node_modules/vitest/vitest.mjs run` / `node node_modules/@playwright/test/cli.js test -c playwright.e2e.config.ts warm`，并对该命令申请一次 `sandbox_permissions: danger-full-access`。
- **dev server 被占（2026-09-13 实测）**：并行实例把 vite 占在 ::1:5173（127.0.0.1 探测 DOWN 但 vite 报 in use）→ 自己 `npm run dev` 落 **5174**，e2e 前设 `E2E_BASE_URL=http://localhost:5174`。注意 `npm run dev` 会拉起完整第二个 electron 实例：其 DSH 引导 degraded（3080 被现有 GUI 占用）属预期噪声，vite 页面服务不受影响。
harness 插件改动用各插件目录的 `npm run lint`（oxlint）。若未来根项目装上 eslint，删除本条记忆。

**Applicable:** DemoStudio 根项目（src/、tests/、doc/）改动后的验证流程选择。

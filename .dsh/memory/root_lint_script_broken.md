---
name: root_lint_script_broken
description: root lint script is broken: eslint not installed, use tsc + vitest as gates
type: project
prefix: package.json
---

**Problem:** 按全局指令"每次修改后 lint 归零"执行 `npm run lint`，必然报 `'eslint' is not recognized`，无法完成 lint 门禁。

**Cause:** DemoStudio 根 checkout 的 node_modules 里没有 eslint（无 `.bin/eslint`、无包本体），`devDependencies` 也没有声明，且项目根不存在任何 eslint 配置文件（`.eslintrc*` / `eslint.config.*` 均无）——根 `package.json` 的 `lint` 脚本形同虚设。harness 子插件不受影响（各自用 oxlint 且已安装）。

**Solution:** 根项目改动后用 `npx tsc --noEmit`（类型检查）+ `npx vitest run`（单元测试）作为替代门禁；harness 插件改动用各插件目录的 `npm run lint`（oxlint）。若未来根项目装上 eslint，删除本条记忆。

**Applicable:** DemoStudio 根项目（src/、tests/、doc/）改动后的验证流程选择。

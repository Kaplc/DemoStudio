---
name: projects_root_unification_migration
task_type: refactor/migration
outcome: success
date: 2026-09-17
prefix: [electron/projectRoots.ts, src/editor/projects/registry.ts, doc-dev/projects-root-unification/plan.md]
---
## Summary

按 doc-dev/projects-root-unification/plan.md 完成 src/projects → projects/ 工程单根化迁移（约 60 文件），并追加把 registry.ts 迁至 src/editor/projects/、彻底删除 src/projects 目录；3 守卫单测 + e2e spec、doc/skills 同步，tsc/vitest 零回归，实机验证 6 工程发现与新模块路径。

## Lessons

1. dev server（vite watcher/electron）锁源码目录导致 git mv Permission denied——先 taskkill /T 杀 electron:dev 进程树再搬移。2. 块注释内路径通配（如 projects/*/project.json）的 */ 字面量会终止注释致 TS1127，写 *\/ 转义。3. 本仓 grep 按 path 圈目录有假阴性，核验"字面量已清零"必须 include 全仓搜索。4. 判定"测试失败是否既有基线"的正路：git diff 查测试依赖闭包 + 论证行为改动在测试环境下殊途同归；不要用 worktree+junction 对照——git worktree remove --force 跟随 junction 删空主仓 node_modules（规则见 memory:worktree_junction_remove_deletes_target）；恢复三步：npm ci + 手动补建 node_modules/@demostudio/ds-* 7 个 junction（mount_plugin 该场景会 skipped）+ 确认 ~/.dsh/cordis.patch.yml 未受影响。5. registry 搬家类实机验证最短路径：playwright-core connectOverCDP（端口从 electron PID 监听端口找）+ page.evaluate 里动态 import('/src/editor/projects/registry.ts') 断言导出——比抓 console 日志可靠（编辑器日志走 Console 面板 sink 不进 window.console，console 断言会假阴性）。6. 单文件模块搬家顺序：git mv → 自身相对 import 改 → src 消费方 → 跨根 import（工程 register.ts / main.ts 模板）→ 守卫测试收紧 → 文档链接，tsc+vitest 全量对比搬移前逐位一致即零回归。

## Effective Path

src/editor/projects/registry.ts（注册中心最终位置）；electron/projectRoots.ts（单根定标）；tests/projectsRootGuard.test.ts（守卫范式：零残留零豁免 + 高危常量源码锁）

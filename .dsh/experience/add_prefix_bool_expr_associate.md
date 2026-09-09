---
name: add_prefix_bool_expr_associate
task_type: feature
outcome: success
date: 2026-09-09
---
## Summary

给 ds-memory 的 prefix 自动联想加代码风格 &&/|| 多路径组合触发：解析层 parsePrefixExpr 产出 DNF（OR 组的 AND 项），求值层 evalPrefixGroups 纯函数 + WeakMap 会话累计实现 AND 跨读取集齐触发；单值/全局 / 完全向后兼容，存储与扫描层零改动。

## Lessons

1) 表达式语法让改动面最小：prefix 保持字符串字段，只动解析+匹配，frontmatter 解析器/存储/扫描全不用碰；DNF（先按 || 拆组再按 && 拆项）天然给出 && 高于 || 的优先级，且 AND 累计退化为"组内剩余项削减"。2) harness/ds-* 插件目录是 npm 管理（package-lock.json），跑 pnpm run 会触发 pnpm install 搬走 node_modules 到 .ignored 并因 esbuild build-script 策略失败——恢复用 npm ci，之后直接 npx tsc/vitest/oxlint 绕过 pnpm 包装器。3) 移除模块时注意 tests/ 下可能残留孤儿测试文件（selectMemories.test.ts 引用已删除的 src/selectMemories.ts，导致整个测试套件红），vitest 报"Failed to load url"时先查源文件是否存在。

## Effective Path

harness/ds-memory/src/memoryTypes.ts（parsePrefixExpr）、harness/ds-memory/src/associate.ts（evalPrefixGroups + andProgress）、tests/memoryTypes.test.ts、tests/associate.test.ts

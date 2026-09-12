---
name: add_prefix_bool_expr_associate
task_type: refactor/feature
outcome: success
date: 2026-09-12
prefix: [harness/ds-memory/src/associate.ts, harness/ds-experience/src/associate.ts, harness/ds-memory/src/memoryTypes.ts, harness/ds-experience/src/experienceTypes.ts]
---
## Summary

用户 2026-09-12 决策把记忆/经验插件的 prefix 联想从目录前缀+&&·||表达式改为具体文件数组精确匹配（读到列表任一文件即注入，原匹配方法删除），ds-memory/ds-experience 同构改造 + 测试/文档/记忆全量同步。本条前身为 2026-09-09 的 &&/|| 表达式路线（parsePrefixExpr DNF + evalPrefixGroups + WeakMap AND 累计 + 段级前缀匹配），该路线已被取代废弃。

## Lessons

1. "原来的匹配方法不用了"要落到删代码而非加开关并存：parsePrefixExpr/evalPrefixGroups/andProgress 三件套整体删除，matchTriggerFiles（任一命中即触发）+ parseTriggerFileList（方括号逗号数组/裸单值兼容、反斜杠归一、win32 忽略大小写）替代；目录条目在新语义下天然永不命中——旧 frontmatter 目录值静默失效不报错，属预期。2. 序列化恒写方括号 `prefix: [a.ts, b.md]`，解析兼容裸单文件；存储层（memoryStore 的 keep-old）零改动。3. hold 语义保留但载体变化：工具参数改数组后 hold = ["hold"] 或 []；index 标注/提醒文本用 formatTriggerFiles 逗号拼接。4. tsconfig exactOptionalPropertyTypes 坑：candidates 经 filter 过滤不保留 prefix 非空窄化，循环内取局部变量再判空，否则 TS2322。5. 联想器集成测试 10ms 异步等待在 vitest 并行负载下会抖（projectHits 是 void fire-and-forget 链），放宽到 50ms。6. 过渡期技巧：运行中进程还是旧 schema（prefix 为 string）时，传字面量方括号字符串 "[a.ts, b.md]" 落盘即新语法（旧 parsePrefixExpr 不含运算符直接放行）。7. 旧路线教训仍有效：两插件完全同构，改联想必须两侧 src+测试+文档+记忆四处同步（本次同步了 harness_system/data_flywheel_plan/test_cases/harness.instructions.md）；对同一文件连续 edit 撞 Win32 EIO 原样重试即可。8. 验证梯度：vitest 双侧（125+82）全绿 → tsc/oxlint 归零 → mount_plugin 重编译挂载 → node import dist 冒烟；运行中 agent 要重启编辑器才加载新 dist。

## Effective Path

harness/ds-memory/src/{memoryTypes,associate,tools}.ts + harness/ds-experience/src/{experienceTypes,associate,experienceTools,experienceStore}.ts；解析 parseTriggerFileList / 匹配 matchTriggerFiles / 序列化 prefix: [a.ts, b.md]

---
name: targeted_regression_first
description: 用户验证策略偏好（2026-09-27）：改动验证以定向回归（只跑改动域的 spec/单测）为准，定向绿即可交付；全量回归不必默认跑，按需或收尾再跑
type: feedback
prefix: [playwright.e2e.config.ts, package.json]
---

# 定向回归优先，全量按需

规则：改动验证以**定向回归**为准——只跑改动域的测试（改动文件的 vitest 单测 + 对应域的 e2e spec），定向绿即可交付；**全量回归不默认跑**，用户要求、大版本收尾或改动横切多个域时再跑。

**Why:** 2026-09-27 实装港泊/借站机制时助手默认跑 warm 全量 e2e（20+ spec，15 分钟+），用户两次叫停："只需要跑你自己新添加的功能"。动机：e2e 每用例冷启动 ~35s（断言只占 1~2s），游戏变大后全量时间线性恶化，用户明确关心这个扩展性成本。

**How to apply:** ①玩法/结算逻辑改动 → 先跑改动文件的 vitest（毫秒级，主门禁）；②e2e 用 playwright 路径过滤只跑对应 spec：`npx playwright test -c playwright.e2e.config.ts projects/warm-current/e2e/<spec>.ts`（前置 dev server，E2E_BASE_URL 指路，命令口径见 memory:root_lint_script_broken）；③测试分层写作方式（厚单测薄 e2e）让定向回归天然便宜；④全量留作收尾/用户点名时跑，跑之前先说明预计耗时。


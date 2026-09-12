---
name: grep_path_scope_false_negative
description: 本仓 grep 工具按 path 圈目录会静默漏报（tests 目录实测假阴性），核验「某符号不存在」必须用 include 全仓搜索交叉复查
type: project
prefix: [tests/warmCurrentSlotsAndDesign.test.ts, e2e/warm/slots_design.spec.ts]
---

**Problem:** 2026-09-11 核验两方案回归测试覆盖时，`grep` 带 `path: E:\DemoStudio\tests` 搜 `nodes`（文件 `tests/warm_ring_build.test.ts` 第 38/86 行明文含 `s.nodes`）与搜 `ringBuild|shipyard` 均返回 "No matches found"；同参数形式对 `E:\DemoStudio\e2e` 却正常命中。假阴性险些得出错误审计结论。

**Cause:** 根因未完全定位（目录圈定在该环境下选择性失效）；可复现事实：**path 圈目录的空结果不可信**。

**Solution:** 核验「某符号/测试不存在」类否定结论时，一律改用**全仓搜索 + `include` 文件名过滤**（如 `include: *.test.ts`），并先用一个已知存在的符号（如 `ringBuildRateOf`）验证搜索确实覆盖目标目录，再采信负结果；正结果不受影响，可放心用。

**Applicable:** 本仓任何「查某测试/符号/引用是否存在」的审计与覆盖核查场景，尤其 `tests/`、`e2e/` 目录。


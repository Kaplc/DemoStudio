---
name: add_memory_prefix_associate
task_type: feature
outcome: success
date: 2026-09-09
---
## Summary

用户要求记忆像人一样按工作内容自动联想：最终落地为 ds-memory 的 frontmatter prefix 路径联想——读取匹配路径文件时自动整篇注入记忆（每会话去重），并 e2e 验证通过。

## Lessons

**有效路径**：方案经过 3 轮收敛——用户最终拍板"和 ds-instructions 一样、路径写在 md 里、AI 维护、直接注入完整记忆只要去重"。先研究 ds-instructions（frontmatter prefix 自动扫描 + tools/pre-execute→result touch + agent/pre-step 注入）再照抄轻量版，是正确决策：注入消息 source 用 {kind:'plugin', form:'recall'}（form 是闭式枚举，'memory-associate' 编译不过，合法值有 instructions/catalog/snapshot/notice/relay/recall）。**踩坑**：(1) 旧记忆 ds_memory_no_auto_search 声称"不再监听 agent/pre-step"，实现新功能后必须同步更新它（记忆是时点观察，覆盖更新保留历史 Why）；(2) oxlint 对声明未用的 trackedTools 报 warning，要在 tools/result 里真正用它过滤工具；(3) createUserMessage 的 note 用对象展开会互相覆盖，多个 note 要合并数组 join；(4) memory_write 同名更新不带 prefix 时若直接 renderMemoryFile 会丢掉旧 prefix，需 duplicate?.prefix 兜底；(5) 测试路径构造别用 resolve('E:', ...)（驱动相对解析陷阱），用 tmpdir 相对根；(6) headless e2e 验证法：写一个 prefix 指向被测路径的标记记忆（不登记 MEMORY.md 索引），跑 `dsh --profile headless` 让 agent 读该路径并复述注入标题行，验证完删文件——比 mock 事件链便宜且覆盖整条链路；(7) mount_plugin 后新代码要重启 DSH 进程才生效（junction 指向仓库 dist，重启即加载）；(8) 项目里 ds-memory 的 selectMemories.test.ts 是孤儿测试（源码已删）属于既有已知红，别误当自己改坏的。

## Effective Path

harness/ds-memory/src/associate.ts（新模块）+ memoryTypes/store/scan/tools/index 五处小改 + tests/associate.test.ts

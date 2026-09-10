---
name: add_experience_reminder_and_prefix_associate
task_type: feature
outcome: success
date: 2026-09-10
---
## Summary

用户要求把经验插件同步成记忆插件同款架构：移植 ds-memory 的回合末提醒（turn/end 注入 60s 冷却经验提醒）与 prefix 路径自动联想（frontmatter 表达式命中读文件即注入全文，每会话去重），experience_save 增加 prefix 参数，重构 3 份过时测试并新增 associate 集成测试，最终 67/67 通过、lint 归零、编译挂载（重启 DSH 生效）。

## Lessons

有效路径：① 联想器不是从零写——ds-memory/src/associate.ts 逐段移植改插件名/数据源即可，纯函数（matchPrefix/evalPrefixGroups/parsePrefixExpr）直接复制，插件间不互相 import；② 冷→半热的界线是"确定性"：回合末提醒=纯文本注入 agent.inject，联想=纯 frontmatter 表达式匹配，都不碰 llm 服务，与 harness_no_llm_design 决策不冲突；③ 会话旧测试是隐藏雷：index/extractExperience/experienceTools 三份测试还测着已删除的"空闲提炼"机制（14 个常红用例），动手前先跑基线 npm test，能力移除过的插件务必同步翻新测试；④ mount_plugin 对已挂载插件 patch 步骤会 skip，新配置项走 schema 默认值即可，不必改 profile patch。
踩坑：① experience_save/memory_write 等工具调用报 "returned invalid output: value is not lossless JSON"——是宿主与运行中内核挂载的旧版插件输出序列化不兼容（当前内核 dist 未含本次新编译的 ds-memory 修复），与插件代码无关；绕法：memory_write 走手动三步落盘（write 文件 + MEMORY.md 索引 + 过时检查）；待编辑器重启加载新 dist 后自愈；② tmpdir 下测试 deriveProjectRoot 相对形态时注意 resolve(cwd, '.dsh', 'experience', '..', '..') 的层级，别按 cwd 直接上跳两级。
下次：给其他 ds-* 插件加同款提醒/联想，直接照本次 diff 抄 associate.ts 移植 + index.ts 装配 + fakeCtx 集成测试三件套。

## Effective Path

harness/ds-experience/src/{index,associate,experienceTypes,experienceStore,experienceTools}.ts; doc/harness/{harness_system,dsh_data_flywheel_plan,dsh_data_flywheel_test_cases}.md

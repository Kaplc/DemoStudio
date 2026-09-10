---
name: fix_tool_lossless_json_output
task_type: debug/build-fix
outcome: success
date: 2026-09-10
---
## Summary

修复 memory_write 报 "value is not lossless JSON"：根因是内核 lossless JSON 边界拒绝返回值中的显式 undefined 键（新建路径的 deduped_by/existing_file 必现）；顺手把 memory_write 改成用户定稿的半自动语义（工具直写 frontmatter+索引、正文提醒 agent 手写），同修 memory_search 与 experience_search 的同款隐患，补 round-trip 回归测试。

## Lessons

有效路径：① 根因定位先读内核类型声明（dsh-session json.d.ts "survives JSON round-trip losslessly"）再改代码，一次命中；② 回归测试直接抄内核语义：expect(JSON.parse(JSON.stringify(v))).toStrictEqual(v) —— toStrictEqual 会抓显式 undefined 键，toEqual 不会；③ 单测测不出宿主侧校验，这类边界必须补 round-trip 断言或实测调用。
踩坑：① 有另一个会话在并发改同一批文件——edit 前必须重读，改完立即测试，我的测试文件曾被对方按旧语义覆盖过一次（对方也在修 lossless，方案一致，最终以用户拍板的新语义为准整体覆盖）；② 手写测试构造"缺字段记录"时别用 writeMemory（description 必填、恒写索引行，缺参会崩在 renderIndexLine 的 hook.length），要直接手写最小 frontmatter 文件；③ 内核热加载只覆盖事件监听链路（经验联想器改完即生效），工具执行绑定仍是会话启动时的旧 dist——修工具 bug 后必须重启 DSH 才在线生效。
下次：工具返回值过 lossless 边界前自查一遍可选字段；改 DSH 插件工具后，验证闭环 = 单测 round-trip + 重启 + 真实调用。

## Effective Path

harness/ds-memory/src/{tools,memoryTypes,memoryStore}.ts; harness/ds-memory/tests/memoryWriteTool.test.ts; harness/ds-experience/src/experienceTools.ts

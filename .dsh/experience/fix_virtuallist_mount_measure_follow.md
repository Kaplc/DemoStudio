---
name: fix_virtuallist_mount_measure_follow
task_type: bugfix
outcome: success
date: 2026-09-21
prefix: [src/components/agent/VirtualList.tsx, tests/e2e/agent/tool-card-scroll-follow.spec.ts]
---
## Summary

修复"edit 工具落地后消息流不跟到最新"：VirtualList measureRef 静默预写吞掉 RO 首次通知致贴底读估算 spacer，改为 RO 单一写入者；先实现 measureRef 同步 bump 方案后发现打破 prepend 视口锚定，二轮换 RO 通知管道后双向绿

## Lessons

① 根因链：新节点按估算 100px 先提交 → measureRef 预写真实高度但不再触发任何状态 → RO 首次通知比对相等被吞 → offsets 不重算 → 贴底 rAF 落在假底，工具执行静默期无事件追平。低卡片时代过冲被钳制无害，diff 高卡片让缺口显形——"某类内容出现才坏"的滚动问题先查估算 vs 实测高度差。② 修法 B（沿用现有管道）：高度缓存唯一写入者=RO，挂载首测走 observe 首次通知 bump heightVersion → offsets 重算 → 贴底重吸附，与折叠/展开同路径；修法 A（measureRef 提交期 setState）实测打破 prepend 视口锚定（ghost-switch 用例4 塌回 scrollTop 0，禁用对照 2/2 红证实因果），微观机制未定案——结论沉淀见 memory:virtual_list_measure_ro_single_writer，别再试 A。③ e2e 直投 live 帧装置四坑：expect.poll(fn) 回调不收参数，模块级 helper 要闭包包一层 page；[data-vl-container] 页面里有多个（侧边栏等），断言消息流必须 .agent-panel__messages[data-vl-container]；内容不满一屏时距底恒 0，贴底断言会空转过——先 poll scrollHeight-clientHeight>阈值 确认可滚动；console 日志不落盘，从 trace.zip Expand-Archive 后 grep '"type":"console"' 还原时间线。④ tests/* 整目录 gitignore（约定不入库），新建测试文件 git status 不显示是正常的。⑤ ghost-switch"半截段"用例负载敏感（全套件并发下挂、隔离跑过，禁用修复也挂），属既有抖动，勿在不相关修复里追杀。

## Effective Path

src/components/agent/VirtualList.tsx（measureRef 只登记 observe）+ tests/virtualListMeasure.test.tsx + tests/e2e/agent/tool-card-scroll-follow.spec.ts + doc/editor/integration/agent_panel_system.md §19.2

---
name: header_session_title_display
task_type: debug/feature
outcome: success
date: 2026-09-10
prefix: src/components/agent || src/editor
---
## Summary

（已更新）头部会话标题实时刷新：用户反馈标题要重开面板才更新，根因是编辑器 handleMuxFrame 丢弃 DSH 的 session/projection 推送帧（WebUI 实时标题的同一机制）；补 projection 分支——mergeProjectionFrame 纯函数按 seq 水位 last-wins 合并进会话列表缓存并广播 sessionsUpdated 事件，blank→listed 走防抖全量，session/subscribed 截断水位；vitest 全分支（278 绿无新增红）+ CDP 后台监听抓到真实投影帧合并日志验证打通。

## Lessons

有效路径：① 排"不实时"问题先对照 WebUI 的帧清单——dsh-client-runtime/lib/client.js handleMuxEnvelope 里 session/projection|jobs|queue 与 session/event 并列，编辑器 handleMuxFrame 没接的帧是静默丢弃（无日志无报错），grep 帧类型一次定位；② 投影帧是扁平 {type,sessionId,key,value,seq}，seq 水位 last-wins（<=丢弃）+ session/subscribed 时截断高于 lastSeq 的水位（agent 重启基线回退场景），两处都对齐 WebUI projectionStore；③ 会话不在缓存不能硬造条目（blank 会话被 session.list 过滤，面板造出来会与权威列表打架）→ 走防抖全量刷新；④ 实测技巧：回合结束才推投影帧，Agent 自己无法在自己回合内观测——用 playwright CDP 挂 console 监听的后台脚本（job 150s 窗口），回合结束的日志落进后台作业，下一回合读输出即得实测证据（本次抓到 4 条合并日志含跨会话帧）；⑤ 用户报"要重开面板才刷新"= remount 触发全量刷新的典型症状，数据通道断在帧处理层而非渲染层；⑥ 本会话 AgentPanel.tsx 被并行 agent 会话改过（新增 UsageStatsPanel import）——编辑前必须重读锚点区域，old_string 用当前内容；edit 撞 EIO (Win32 1175) 原样重试即可（本次两文件各中一次，重试均过）。

## Effective Path

src/editor/AgentService.ts（mergeProjectionFrame + handleMuxFrame projection 分支）

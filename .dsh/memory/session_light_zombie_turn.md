---
name: session_light_zombie_turn
description: 会话状态灯"僵绿"根因（host 僵尸回合）与取证路径；2026-09-21 起输入框运行态恢复复用同一数据源，僵尸回合症状扩展为"切回会话输入框也显示运行中"
type: project
prefix: [src/editor/sessionStatusLights.ts, src/editor/AgentService.ts]
---

# 会话状态灯"僵绿"：host 僵尸回合是根因，编辑器只是忠实呈现（2026-09-21 取证定案）

**Problem:** 回合明明已结束（最终总结都渲染完了），侧边栏会话绿灯（running 呼吸灯）不灭，一晚上多个会话同时僵绿。

**Cause:** 状态灯只由三处驱动：mux `turn/start`→亮、`turn/end`→灭、`session.list` 行内 running 种子→亮（"只种开不清"）。2026-09-20 深夜实例（会话 session-644c23aa"Agent面板添加加速时速表"）：00:11:35 收到一条 mux `turn/start` 帧，之后该会话**再无任何事件、DSH 落盘 session.jsonl 的 mtime 停在 00:11:33（turn/end 时刻）**——host 侧宣布开回合后从未收尾（僵尸回合，疑似当晚 session.list 过载风暴拖垮 host 单进程的副产品）。没有 turn/end 帧、流从未重建（stream-reopened 清灯路径零次触发），种子只补亮不清 → 永久绿灯。**编辑器侧行为完全符合设计，灯如实反映了 host 的"回合未闭合"状态。**

**Solution:** 取证三步（30 分钟内可定案）：① console log grep `sessionStatus:`——applyStatusAction 每次变灯都落日志，还原目标会话灯的完整生命周期；② 看是否出现批量 turn-started（同毫秒多行 = session.list 种子批；单行间隔秒级 = 真实帧）；③ 对比 DSH 会话文件 mtime（`~/.dsh/sessions/--E-DemoStudio--/<sessionId>/session.jsonl.zstd`）与编辑器收到的最后回合边界——文件停在 turn/end 时刻而之后有 turn/start 帧 = host 僵尸回合实锤。临时消除：重启编辑器/等流重建。

**WebUI 权威做法（2026-09-21 读 DSH 包定案）：运行态根本不从 turn 事件推导**。host 侧 `dsh-agent-loop` 的 `ReactLoopAgent.setPhase` 在 agent 状态机每次变迁时 emit `agent/status`（status = idle|running，由 phase.kind 派生，invariant 禁 no-op 转移）；`dsh-host-apiproxy` 监听后经独立 `/api/events.host` 流推 `host/session-status {sessionId, running}`；客户端 `recordMutation({kind:'status'})` 幂等更新列表行 + `session.handleRunning` 更新每会话 running 位。turn/end 丢了也无所谓——状态机下一次变迁（完成/abort/crash/teardown→idle）必补 running:false，天然自愈僵尸。流打开时不补快照，初始态同样来自 session.list。锚点：api-proxy.js:3186、dsh-client-runtime client.js:8410、agent-loop/lib/index.js:388。

**根治已落地（2026-09-21，用户选定"对齐 WebUI"方向）**：编辑器已接 `/api/events.host`——main 进程 `connectHostWs` 桥（dsh-host-frame IPC，与 mux 桥同构）+ AgentService `connectHostStream`/`handleHostFrame`；新归约动作 `host-idle` 只清 running 不覆盖 error 灯；`hostIdleConfirmed` 集合过滤陈旧 session.list 种子（权威 idle 的会话不得被快照复活灯）；mux turn 推导保留作兜底。实现要点与坑见经验:wire_dsh_host_events_stream。

**Applicable:** src/editor/sessionStatusLights.ts、AgentService 的 handleMuxFrame session/event 分支与 listSessions 种子；一切"灯不灭/通知不消"类问题先分辨"编辑器没清"还是"host 没发结束信号"。

**2026-09-21 影响面扩展：** 输入框运行态恢复（`resumePendingTurnFromPage`，doc §19.2）开始复用状态灯表做 ghost 缓冲盲区的运行态兜底——`sessionStatuses[sid]==='running'` 时切回该会话输入框也显示运行中（停止按钮可见）。僵尸回合的症状因此从"灯僵绿"扩展为"切回该会话输入框误显示运行中"，两者共享数据源、一致地反映 host 回合未闭合；诊断"输入框为什么显示运行中"时先按上面三步查僵尸。

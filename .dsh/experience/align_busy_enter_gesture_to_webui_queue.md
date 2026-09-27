---
name: align_busy_enter_gesture_to_webui_queue
task_type: feature/gesture-alignment
outcome: success
date: 2026-09-27
prefix: [src/components/agent/InputBox.tsx, tests/e2e/agent/send-queue-edit.spec.ts]
---
## Summary

运行中 Enter 从立即 steer 改为排队待发送、Ctrl/Cmd+Enter 才插话（对齐 DSH WebUI ComposerSubmissionPolicy 默认 busyEnter=queue），只改 InputBox 手势路由并复用既有本地队列 drain，单测 8 例 + e2e 5 例 + 回滚判别全过

## Lessons

1. WebUI 参考锚点：dsh-client-ui-conversation/lib/client.js grep `BUSY_ENTER_BEHAVIORS`——ComposerSubmissionPolicy.resolve(running, gesture, steeringAvailable)：未运行/不可 steer 一律 queue；普通 Enter=偏好值（默认 busyEnter=queue，存 Host user-settings ui-conversation.busyEnter）；加速键=偏好取反（默认→steer）。WebUI 队列是 host 权威（session/queue 帧 + updateQueue({kind:'steer'}) 单条插话 + 队列 dock 每行插话按钮），编辑器是本地队列——对齐手势语义即可，不必搬 host 队列。2. 编辑器已有全套本地队列（入队/turnEnd 接管/drain 空闲分支发送/撤回重编），本次真改动只有 InputBox.onKeyDown 一处分支 + 提示文案；AgentPanel.handleSend 的 send/steer 分流原样复用。3. 坑：单测/e2e 用 getByTitle **精确匹配**按钮 title（'排队发送：当前回合完成后自动发送'、'发送 (Enter)'）——改 title 文案会打红既有用例；本次队列按钮 title 原样保留，手势提示放 placeholder 与运行中发送按钮 title（'插话引导 AI (Ctrl+Enter)'，无测试依赖）。4. 回滚判别器选对用例：旧行为（Enter 恒 submit）下只有「运行中 Enter=排队」1 例红；空内容守卫/Shift 换行/按钮点击用例旧行为下也绿，不能当判别器。

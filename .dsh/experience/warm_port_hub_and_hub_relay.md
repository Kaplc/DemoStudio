---
name: warm_port_hub_and_hub_relay
task_type: feature/gameplay-systems
outcome: success
date: 2026-09-27
prefix: [projects/warm-current/gameplay/systems/TransportComponent.ts, projects/warm-current/gameplay/core/helpers.ts, projects/warm-current/gameplay/core/balance.ts, tests/warmPortHub.test.ts, projects/warm-current/e2e/port_hub.spec.ts]
---
## Summary

为暖流计划实装两项航线深度机制：①中转站借站补给（forward 星→地线段距 relay ≤300px 往返油耗 ×0.8，多站取最优不叠加，routeNetPerTrip/departShip 同口径）；②地球港泊位（portBerths=2，卸货占泊、满泊 waitPort FIFO 排队、tickBerthQueue 唯一放行口、N 船≠N 倍收益）；balance 配置 + 拖线浮层折后预览 + 方案文档/模块 02/11/README 同步 + vitest 16 例与 e2e 4 用例全绿。

## Lessons

有效路径：①"到达闸门"类状态机改动把放行收口成单写者（到港分支只记时间，tickBerthQueue 每帧首唯一放行），到港/卸货/排队全部状态派生（不建独立容器），存档/快照零迁移。②测试时间断言用 runUntil 轮询到目标态而非赌步数；fixture 要懂派生口径——占泊船必须 mission+return+卸货中才占泊，普通 unloading 船 timer=0 首帧就卸完变飞船。③【e2e 两大坑】simState.events 挂在组件（mode.simState.events）不在 state 上；且 EventFeedbackComponent.drain() 每帧清空 events——e2e 断言提示一律走 captureConsole 收 Logger console 行，事后读 events 必为空。④edit 抹 BOM 再次实锤：helpers.ts HEAD 有 BOM 被抹，改完按 memory:edit_tool_strips_utf8_bom 字节级对比补回。⑤验证耗时账：e2e 每用例冷启动 ~35s、断言 ~1s——定向回归只跑改动 spec（playwright 路径过滤，port_hub 4 用例 2.5min）对比全量 20+ spec 15min+；仿真逻辑断言下沉 vitest（16 例 81ms）是最大提速层。全量回归会话中被用户叫停：定向绿即可交付，全量按需再跑。

## Effective Path

projects/warm-current/gameplay/systems/TransportComponent.ts（tickBerthQueue/unloadsAtEarth） || projects/warm-current/gameplay/core/helpers.ts（hubRelayMultForSegment/distPointSegment） || tests/warmPortHub.test.ts || projects/warm-current/e2e/port_hub.spec.ts

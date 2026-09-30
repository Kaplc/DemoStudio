# DSH 内核适配层（Editor Dialect Gateway）设计方案

> **一句话定位**：把「编辑器怎么说话」（编辑器方言）与「DSH 内核怎么说话」（线上协议）解耦——内核破坏性升级时，改动 100% 收敛在 `electron/dsh/` 适配层目录，`src/editor/AgentService.ts`、`src/components/agent/*`、`src/types/agent.ts` 零改动。
>
> **状态**：✅ 已实施（2026-09-30）。P0–P5 全部落地：适配层 12 模块 + 可插拔 profiles（dsh017/dsh011）+ 契约测试 29 例 + 采集脚本 + 范式文档（[`doc/harness/dsh_kernel_adapter.md`](../harness/dsh_kernel_adapter.md)）。实施时按用户决策强化为「**多版本适配器可插拔**」：升级=新增适配器文件+registry 一行；回滚=registry 按安装版本自动切回旧适配器；未知版本回落最新档案。与方案的两处实施差异：①能力档案未按 profiles/ 目录拆分，registry + adapters/ 平铺（一文件一内核代际，可插拔语义不变）；②eventMap 归一化采用**加法式**（wire 字段保留 + 方言字段提升），渲染层既有防御式收窄零改动，仅 `extractDiffsFromResultData` 一个新收口点。

---

## 1. 背景与痛点实录

运行内核 = 全局 npm 安装的 `@deepseek-ai/dsh`，升级不受本仓控制（用户侧一键更新）。0.1.1 → 0.1.7-rc.2 升级（2026-09-29）三波破坏实录：

| 波次 | 破坏 | 波及面 |
|---|---|---|
| ① 协议面 | web 鉴权强制化（无 cookie 全 401）、RPC 改名（`session.list` 404 → `session/list{_request}`）、WS 合流（`events.mux`+`events.host` → `remote.mux` 单连接多路复用） | main.ts 探活/RPC/两条 WS 桥全断，面板恒 degraded |
| ② 数据面 | `assistant/chunk` 会话事件消失（v4 会话格式），流式增量挪进进程内 assistant-stream 瞬态帧，需 `session.follow` 流订阅 | 实时正文/思考卡不上屏；瞬态帧被渲染层 seq 去重闸吞掉 |
| ③ 生态面 | 插件 SDK/预设/依赖树迁移（persona text→prefix、workflow-ptc、JsonValue 迁包、cordis 家族版本漂移） | 9 插件 failed to import、预设装载重写 |

修复时改动散落：`electron/main.ts` 多处 + `src/editor/AgentService.ts` 多处 + 测试。**问题本质：编辑器多处代码直接知道内核形状，内核一动就处处要改。**

## 2. 现状盘点：适配雏形已存在，但散装

### 2.1 main.ts 里已有的「翻译散片」（好底子，未成体系）

| 散片 | 位置 | 吸收了什么 |
|---|---|---|
| 鉴权桥 | `readDshLaunchUrl`(main.ts:528) / `ensureDshAuthCookie`(:535) / `dshAuthHeaders`(:552)，401 自动重换(:1156-1161) | 0.1.7 cookie 鉴权 |
| RPC 翻译表 | `DSH_RPC_TRANSLATIONS`(:1059) + `translateDshRpc`(:1129) + `dsh-rpc` handler(:1139) | 方法改名 + args 信封整形 + 响应 reshape（history→page、models→modelCatalog 归一等） |
| 流桥 | remote.mux 桥(:1172-1449)：`$events`→host 帧翻译、单活跃会话 `session/follow`→旧 `session/event|subscribed` 帧、assistant-stream 瞬态帧翻译 | 0.1.7 WS 合流 + 瞬态流 |
| host 桥 | `connectHostWs`(streamBridge) | host 状态机流（0.1.1 legacy 专用；0.1.7+ 端点已随 WS 合流移除，按适配器 `hostStream` capability 守卫不连——否则内核对未注册 upgrade 直接 destroy，客户端陷入 "socket hang up" 5s 重连死循环，2026-09-30 修复） |
| 双路由应答 | `dsh-respond`(:1499) | 新旧应答端点 |
| 双版本探活 | `probeDshAlive`(:496)（settings/describe 新信封 → session.list 旧信封） | 升级窗口期两代内核并存 |
| 版本工具 | `electron/dshKernelVersion.ts`（归一化/语义比较/校验纯函数）+ `dsh-list-versions`(:873) / `dsh-check-update`(:894) / `dsh-switch-version`(:918) | 版本管理 |

### 2.2 渲染层仍泄漏的内核知识（要收口的清单）

| 泄漏点 | 位置 | 风险 |
|---|---|---|
| wire 形状直接收窄 | `AgentService.handleSessionEvent`（:1900）对 `meta.diffs`、`usage` 字段、`contextPressure` 投影、`text-delta`/`reasoning-delta` 词表的防御式解析 | 内核改字段名/结构 → 渲染层改代码 |
| `transient:true` 旁路约定 | 渲染层 `consumeSessionEvent` 的 seq 闸旁路 + 桥侧标记——**两端的共谋约定** | 约定散落两处，无单一权威定义 |
| 裸透传 fallback | `translateDshRpc` 的 `.`→`/` 兜底(:1132-1134)：未登记的方言 RPC 静默透传 | 内核改名时**不报编译错、只报运行时 404**——正是 0.1.7 `session.list` 404 的教训 |
| cordis preset fallback | `session.create` 失败后带 `agentPreset:'cordis'` 重试（AgentService 两处） | 预设语义变化 → 渲染层改 |
| capability 语义硬编码 | 渲染层对 `origin==='subagent'` 过滤、blank 会话语义等 | 内核会话模型变化 → 渲染层改 |

> 方言方法**名**本身（`session.list` 等 20 个）已经稳定——这是好基础；要收口的是 payload/响应**形状**与旁路约定。

## 3. 目标与非目标

**目标**

1. 内核破坏性升级时，代码改动收敛在 `electron/dsh/`（+ 契约 fixtures）；编辑器渲染层零改动。
2. 升级有可执行 SOP：装新内核 → 契约测试红 → 只改适配层 → 契约绿 → 定向 e2e 绿。
3. 内核版本切换（含回滚旧版）由能力档案（profile）支持，多版本并存不炸。

**非目标**

- 不做全内核代理：只覆盖编辑器用到的方言面（~20 RPC + 8 类帧 + 事件子集）。
- 不内嵌/魔改内核包（内核内唯一的 `[DemoStudio-compat]` 补丁例外，已有独立记录与重打流程）。
- 不追平 WebUI 全部能力。

## 4. 总体架构：三层 + 冻结方言

```
┌─ 编辑器（只认方言，永不 import 内核形状）──────────────────┐
│ AgentPanel → AgentService ← src/types/agent.ts（方言 DTO） │
└──────────────┬───────────────────────────────────────────┘
               │ IPC（不变）：dsh-rpc / dsh-mux-frame / dsh-host-frame
               │            dsh-respond / dsh-status
┌──────────────┴───────────────────────────────────────────┐
│ electron/dsh/  适配层（全仓唯一懂内核的地方）                  │
│  gateway.ts   DshGateway 接口 + 方言类型定义（权威）           │
│  auth.ts      cookie 桥                                     │
│  lifecycle.ts probe/spawn/claim/健康状态机                    │
│  rpcMap.ts    方言 RPC 目录 → 线上方法（全量显式登记）           │
│  streamBridge.ts 线上流端点 → 方言帧（mux/host）               │
│  eventMap.ts  wire 会话事件 → 方言事件归一化（meta/usage/投影）  │
│  capabilities.ts + profiles/<ver>.ts  能力档案                 │
└──────────────┬───────────────────────────────────────────┘
               │ HTTP /api/* + WS 流端点（按 profile 选择）
        DSH 内核（任意版本）
```

### 4.1 编辑器方言（Editor Dialect）= 冻结契约

方言是适配层与编辑器之间的**唯一接口**，五要素：

1. **RPC 目录**：~20 个方言方法（`session.list/create/prompt/cancel/history`、`commands.list/execute`、`settings.describe/mutate`、`credentials.*`、`agentPreset.list`、`session.models/selectModel`、`skill.list`、`workspace.archiveSession`）。规则：**方言名永不改、语义签名 additive-only**；改名/改形发生在适配层。
2. **帧词汇**：mux 8 类帧（`session/event|subscribed`、`question|approval × requested|resolved`、`session/projection`、`host/session-*`）+ `transient` 瞬态事件约定（**权威定义落在本层**，桥负责打标、渲染层负责旁路，两边引用同一常量）。
3. **会话事件 schema**：编辑器消费的事件子集的 DTO 化（`tool/result` 的 `diffs` 是方言字段而非内核 `meta.diffs` 原形——归一化在 eventMap）。
4. **能力标志**：渲染层逻辑分支只读能力名（`hasAssistantStream`、`authRequired`、`hostStreamAvailable`…），**永不读内核版本号**。
5. **`DIALECT_VERSION` 常量**：方言自身演进时递增，`dsh-status` 上报，契约测试按版本组织。

## 5. 适配层模块划分（electron/dsh/）

| 文件 | 职责 | 从哪来 |
|---|---|---|
| `gateway.ts` | `DshGateway` 接口 + 方言 RPC/帧/事件/DTO 全量类型（权威定义） | 新写，类型从 `src/types/agent.ts` 对齐搬入（渲染层保留自己的 import 路径不变） |
| `auth.ts` | cookie 桥（读 launch URL → 换 cookie → 附头 → 401 重换） | main.ts:528-560 机械搬迁 |
| `lifecycle.ts` | `probeDshAlive`/`bootstrapDSH`/`onDshChildExited` 健康状态机 | main.ts:496/744 机械搬迁 |
| `rpcMap.ts` | 翻译表**全量收口**：方言目录每方法一条显式登记（wireMethod/toArgs/reshape）；**删除 `.`→`/` 裸透传**，未登记方法直接 throw | main.ts:1059-1136 扩展 |
| `streamBridge.ts` | 流端点选择（0.1.1 `events.mux`/`events.host` ↔ 0.1.7 `remote.mux`）+ 帧翻译（含瞬态打标、单活跃会话 follow、cursor 簿记） | main.ts:1172-1497 搬迁 |
| `eventMap.ts` | wire 会话事件 → 方言事件归一化：tool `meta.diffs`→方言 `diffs`、usage 采样字段、modelCatalog 归一、投影键白名单 | 从 `AgentService` 的防御式收窄上收（渲染层改调方言字段） |
| `capabilities.ts` | 能力标志定义 + `pickProfile(kernelVersion)`（semver 匹配，未知版本回落最新档案 + warn） | 新写（复用 `dshKernelVersion.ts` 纯函数） |
| `profiles/0.1.7.ts` 等 | 每内核大版本的档案：翻译表补丁、流端点、鉴权开关、能力值 | 新写（0.1.1/0.1.7 两档案从升级战役实录逆向） |

`main.ts` 只保留：IPC 注册（thin handler 委托 `electron/dsh/*`）+ 窗口/启动编排。**验收：main.ts 不再出现任何内核 wire 字面量（方法名/帧类型/字段名）。**

## 6. 版本探测与能力档案

```
bootstrapDSH
  ├─ 读全局包 package.json version（dsh-list-versions 同路径）
  ├─ compareVersions → pickProfile() 选中 profiles/<ver>.ts
  │    未知版本 → 最新档案 + console.warn('[dsh-adapter] 未验证内核版本 x.y.z，按最新档案运行')
  ├─ 日志输出能力矩阵（一眼看出当前内核走哪套翻译）
  └─ dsh-status 附带 { kernelVersion, dialectVersion, capabilities }
        → AgentService.connect() 拿到后存快照；渲染层分支只读 capabilities
```

- 渲染层分支规范：`if (capabilities.hasAssistantStream)` ✅；`if (kernelVersion >= '0.1.7')` ❌（渲染层不再出现版本号）。
- profile 不可用时（旧内核缺新能力）：能力置 false，渲染层走既有降级路径（如流式退化为 message 级刷新——0.1.7 回退分支已在）。

## 7. 契约测试：让「只改适配层」真正成立的安全网

翻译代码没有测试护栏时，"只改适配层"只是愿望——内核改了什么根本不知道，只能实机踩。三层护栏：

1. **Golden 契约测试**（`tests/contract/dsh/<profile>/`，vitest 纯函数、秒级）：
   - 每方言 RPC 一对 fixture：**wire 载荷 →（translateDshRpc）→ 期望方言请求**；**wire 响应 →（reshape）→ 期望方言响应**。
   - 每类帧一条：wire 流值 →（streamBridge 翻译）→ 期望方言帧。
   - 素材现成：0.1.1/0.1.7 双方的真实载荷在升级战役中已全部拿过（`session.list` vs `session/list{_request}`、`history` vs `page{address,throughSeq,maxMessages}`、follow snapshot/cursor、`AssistantStreamFrame`、`$events` emit 帧）。
2. **真内核冒烟**（现有 `tests/e2e/agent/` 承担）：起真内核 → connect → prompt → 断言方言事件流形状。契约 fixture 防「翻译写错」，冒烟防「内核和 fixture 都变了而没人知道」。
3. **fixture 采集脚本**（`scripts/capture-dsh-fixtures.mjs`）：从 `~/.dsh/sessions/*/*.jsonl.zstd`（多帧 zstd 循环解，方法已有）+ `dsh-agent.log` 抽真实载荷生成 fixture 骨架，升级时先采集后修翻译。

**升级 SOP**（内核再出破坏性更新时照此执行）：

```
1. npm i -g @deepseek-ai/dsh@<new>（npmmirror，走既有 dsh-switch-version）
2. 起编辑器，看 dsh-agent.log + console log 定位失联面（探活/401/404/WS 端点）
3. capture-dsh-fixtures 采集新协议真实载荷 → 新增 profile fixtures → 契约测试红
4. 只改 electron/dsh/（新档案/改翻译表/改流桥/改 eventMap）→ 契约绿
5. 定向回归：tests/e2e/agent 相关 spec → 绿
6. 交付。编辑器渲染层零 diff 即达标；确需扩方言时走 additive-only + DIALECT_VERSION+1
```

## 8. 分阶段迁移（每阶段独立可交付、可暂停）

| 阶段 | 内容 | 验收 | 风险 |
|---|---|---|---|
| P0 冻结方言 | 方言 spec 文档（RPC 目录/帧词汇/事件 DTO/能力名单/`DIALECT_VERSION`）落 `doc/harness/`；类型对齐 | 文档 + 类型齐，零代码行为变更 | 无 |
| P1 机械搬迁 | main.ts:496-560、1059-1520 原样移入 `electron/dsh/{auth,lifecycle,rpcMap,streamBridge}.ts`，main.ts 留 thin handler | 现有测试全绿、实机面板全功能 | 低（纯搬家） |
| P2 收口 | rpcMap 全量显式登记、删裸透传（未登记 throw）；`eventMap` 上收 AgentService 内的 wire 收窄（diffs/usage/投影），渲染层改读方言字段 | grep main.ts/AgentService 无内核 wire 字面量残留；tsc + vitest 绿 | 中（渲染层有 touches，一次性偿还） |
| P3 能力档案 | `capabilities.ts` + `profiles/`、版本探测接线、`dsh-status` 扩展、渲染层 3 处版本相关分支改读能力 | 换装 0.1.1/0.1.7 双内核实测均可用 | 中 |
| P4 契约测试 | fixtures + 契约套件 + 采集脚本 | 契约全绿；人为篡改翻译表能变红 | 低 |
| P5 文档 | `doc/harness/dsh_kernel_adapter.md` 范式文档 + 本方案升级 SOP 转正；README 索引更新 | 文档巡检过 | 无 |

## 9. 风险与边界

- **语义级变化翻译吸收不了**：如 host 僵尸回合（宣布 turn/start 后永不收尾）——这是内核行为缺陷不是协议形状，适配层只能在能力层暴露（`authoritativeRunning`），渲染层既有双源兜底（host 流 + mux 推导）已覆盖。
- **删裸透传是刻意 fail-loud**：新面板功能忘登记 RPC 会启动即 throw——优于线上 404。登记成本 = 翻译表加一行。
- **多内核并存回滚**：profiles 多档案天然支持；但 v4 会话文件旧内核读不了属内核自身限制，不在适配层范围（升级固有语义，已有记录）。
- **流桥单活跃会话语义保持**：388 会话全跟压垮内核事件循环是实测教训，适配层继续只跟 history/prompt 驱动的当前会话，不引入会话级订阅。
- **`agentservice_stub_surface_sync` 同构坑**：P2 给渲染层加能力快照等新公开面时，5 个 hoisted 桩要同步补方法（既有记忆已录）。

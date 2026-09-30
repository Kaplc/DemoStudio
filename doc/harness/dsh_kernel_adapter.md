# DSH 内核适配层（Editor Dialect Gateway）

> **一句话定位**：`electron/dsh/` 是全仓**唯一**懂 DSH 内核线上协议的地方——每个内核大版本一个可插拔适配器文件，运行时按安装的内核版本自动选择；内核破坏性升级或回滚，编辑器渲染层零改动。
>
> **什么时候会用到你**：内核升级后面板失联（401/404/WS 断）要写新适配器时；给面板加需要新 RPC/新帧的功能时；排查「某条 RPC 独立失败但其他功能正常」时。
>
> 代码位置：`electron/dsh/`（12 个模块）。设计方案与升级战役实录见 [`doc/dev/dsh_kernel_adapter_plan.md`](../dev/dsh_kernel_adapter_plan.md)。

---

## 1. 先记住这张图

```
┌─ 编辑器（只认「编辑器方言」，永不 import 内核形状）──────────────┐
│ AgentPanel → AgentService ← src/types/agent.ts / electron.d.ts  │
└──────────────┬─────────────────────────────────────────────────┘
               │ IPC 不变：dsh-rpc / dsh-mux-frame / dsh-host-frame / dsh-status
┌──────────────┴─────────────────────────────────────────────────┐
│ electron/dsh/  适配层                                            │
│  registry.ts  适配器注册表 + selectAdapterForKernel()            │
│  adapters/    dsh017.ts（现行）/ dsh011.ts（legacy）← 每代一文件  │
│  rpcProxy.ts  dsh-rpc 执行器（翻译→fetch→reshape→会话激活）        │
│  streamBridge.ts 流桥（remote.mux / events.mux → 方言帧）         │
│  eventMap.ts  会话事件加法归一化（meta.diffs → 方言 diffs）         │
│  lifecycle.ts 进程状态机（probe/spawn/认领/自愈/重启编排）           │
│  auth.ts cursor.ts kernel.ts context.ts gateway.ts              │
└──────────────┬─────────────────────────────────────────────────┘
               │ HTTP /api/* + WS 流端点（路径来自适配器）
        DSH 内核（全局 npm 安装，版本任意/可回退）
```

**铁律**：`main.ts` 只剩 IPC 薄委托与启动编排（grep 不到任何内核 wire 字面量——拼接脚本用「禁用符号断言」验证过）；渲染层只读方言名与能力名，**永不读内核版本号**。

## 2. 编辑器方言（冻结契约）

方言 = 编辑器与适配层之间的唯一接口，五要素（权威定义 [`electron/dsh/gateway.ts`](../../../electron/dsh/gateway.ts)，`DIALECT_VERSION = 1`）：

| 要素 | 内容 | 演进规则 |
|---|---|---|
| RPC 目录 | `session.list/create/prompt/cancel/history/models/selectModel`、`settings.describe/mutate`、`credentials.describe/set/unset`、`agentPreset.list`、`skill.list`、`workspace.archiveSession`、`commands/list`、`$events/result`（透传族） | 方法名永不改、签名 additive-only；改名/改形在适配器 |
| 帧词汇 | mux：`session/event|subscribed`、`server-request`（瀑布 approval/question × request/resolved）、`session/projection`；host：`host/session-added|removed|status`、`host/agent-error`、`host/remote-event` | 同上 |
| 会话事件 schema | 渲染层消费的事件子集 + `transient` 瞬态约定（assistant-stream 翻译产物，绝不带 seq） | additive-only |
| 能力标志 | `authRequired / assistantStream / hostStream / projection / contextPressure` | 渲染层分支只读能力名 |
| DIALECT_VERSION | 方言自身演进时递增，dsh-status 上报 | 契约测试按版本组织 |

## 3. 可插拔适配器：新增 / 回退 / 未知的 三种剧本

一个内核代际的全部协议知识 = 一个文件（`adapters/<id>.ts`）：翻译表（toArgs 产**完整线上载荷**，含 `{args}` 信封）+ 流模式 + 端点 + 能力 + 版本谓词。

| 剧本 | 动作 | 编辑器 |
|---|---|---|
| **内核升级出破坏性更新** | 复制 `dsh017.ts` → `dsh018.ts`，改差异；`registry.ts` 登记一行（新版本在前） | **零改动** |
| **内核回滚**（`npm i -g @deepseek-ai/dsh@0.1.1-rc.2`） | 什么都不做——bootstrap 时 `selectAdapterForKernel(安装版本)` 自动选中 `dsh011` | **零改动** |
| **未知版本**（没写适配器就升了） | 回落最新适配器 + `console.warn`，`dsh-status.adapterExact=false` 供 UI 提示 | 零改动（可提示「未验证」） |

版本谓词的坑：semver 预发布 < 正式版（`0.1.7-rc.2 < 0.1.7`），代际边界必须比 `'0.1.7-0'` 而不是 `'0.1.7'`，否则自家 rc 版被判给 legacy（契约测试第一版抓出来的真 bug）。

## 4. 关键机制速查

| 机制 | 位置 | 要点 |
|---|---|---|
| 适配器选择 | `registry.selectAdapterForKernel` | bootstrapDSH 开头调用（读全局包 package.json 版本）；同时同步鉴权模式 |
| RPC 翻译 | `adapters/dsh017.ts` 表 | **fail loud**：未登记的方言方法 throw（0.1.7 `session.list` 404 的教训——静默透传把协议漂移拖到运行时）；`$events/result`、`commands/list` 是渲染层直发线格式的透传族 |
| 响应重排 | 各条目 `reshape` | history→page 的 `records→events` 顺带做事件归一化，实时/历史两路形状一致 |
| 会话激活 | `rpcProxy` | prompt/history 请求前 + create 响应后激活 follow 会话（原 toArgs/reshape 内嵌副作用的等价搬迁，适配器保持纯函数） |
| 流桥 | `streamBridge.translateFollowItem / translateEventsItem` | **纯函数**（契约测试直测）：follow snapshot/event/瞬态帧翻译；$events 的 waterfall/cancel/emit → 方言帧；副作用在 apply 层 |
| 瀑布登记 | streamBridge `_muxClientId/_muxRemoteEvents` | WS 断开时未决议瀑布按 resolved 清场（重连后网关用新 eventId 重放） |
| 事件归一化 | `eventMap.normalizeSessionEvent` | **只增不改**：`meta.diffs → data.diffs`，wire 字段保留，渲染层 `extractDiffsFromResultData` 方言字段优先、缺失回落 meta |
| cursor 簿记 | `cursor.ts` | 独立模块避免 adapters↔streamBridge 循环；page 的 throughSeq 不许超过它 |
| 鉴权 | `auth.ts` | `authRequired=false` 时全链路直通（适配器回退 0.1.1 零分支）；401 自动重换 cookie |
| 契约测试 | `tests/contract/dshAdapter.contract.test.ts` | 29 例：翻译表/注册表/流翻译/归一化全 golden；升级时先加新内核 fixtures 看红 |

## 5. 内核升级 SOP（下次破坏性更新照此执行）

```
1. npm i -g @deepseek-ai/dsh@<new>（npmmirror；dsh-switch-version 已封装）
2. 起编辑器，看 dsh-agent.log + console log 定位失联面（探活/401/404/WS 端点/帧形状）
3. node scripts/capture-dsh-fixtures.mjs --type tool/result,... 采集新内核真实载荷
   （~/.dsh/sessions 的 session*.jsonl.zstd 多帧 zstd，按 magic 28 B5 2F FD 逐帧解）
4. 新增 adapters/<ver>.ts + registry 登记 → 契约测试加新 fixtures → 红
5. 只改 electron/dsh/ → 契约绿
6. 定向回归 tests/e2e/agent → 绿 → 交付（达标判据：渲染层零 diff）
```

## 6. 踩坑清单（都有代码或战役依据）

1. **裸透传是协议漂移的隐身衣**：0.1.7 改名时旧 fallback `.`→`/` 静默透传，404 到运行时才发现。适配器 fail-loud 后新方法忘登记会启动即报错——这是刻意的，登记成本一行。
2. **semver 预发布边界**：见 §3，比 `'0.1.7-0'` 不比 `'0.1.7'`。
3. **ESM let 导出不可变写**：`_dshRestartCount` 等状态机的写入口收拢为 `resetSelfHealCounters()`，main.ts 的 IPC/MCP 全部薄委托（原来三处重复的重启编排收敛为 `restartDshAgent(source)`）。
4. **适配器必须纯函数**：会话激活这类副作用放 rpcProxy/streamBridge 的应用层，否则 adapters↔streamBridge 循环引用（cursor 簿记独立成模块同理）。
5. **transient 瞬态帧绝不带 seq**：cursor 与渲染层 `_lastSeq` 锁步恒相等，带序号会被 seq 去重闸 100% 吞掉（2026-09-29 思考卡流式全灭根因）；帧自带 `revision` 做连续性校验。
6. **单活跃会话 follow**：388 会话全跟会把内核事件循环压垮（实测教训）；follow 只跟 history/prompt 驱动的当前会话，全局运行灯由 $events 的 api-session/status 保障。
7. **多会话并行改动**：适配层抽取当天 main.ts 被并行会话三次改动（瀑布应答实装正是其中之一）——行级拼接必须带哨兵校验 + 禁用符号断言，拼接前重读锚点。

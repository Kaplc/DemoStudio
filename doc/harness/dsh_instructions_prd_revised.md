# dsh-instructions 插件需求文档（修订版）

## 1. 背景与目标

DemoStudio 的 Agent 使用 DSH 内核。Agent 读取项目文件后，需要自动获得该文件所属代码区域的开发规范，以便后续分析和修改遵循项目约定。

本插件 `@demostudio/dsh-instructions` 为 DemoStudio 提供一套补充性的目录指令机制：

```text
src/engine/...   -> .dsh/instructions/engine.instructions.md
src/projects/... -> .dsh/instructions/project.instructions.md
```

插件只负责 DemoStudio 专用的 `.dsh/instructions/*.instructions.md` 文件，不处理 `AGENTS.md`、`CLAUDE.md` 或 `.github/instructions`。DSH 已有的 `@deepseek-ai/dsh-agent-instructions` 继续负责通用工作区指令，两者不读取同一类文件。

## 2. 现有能力与兼容边界

DSH 已内置 `@deepseek-ai/dsh-agent-instructions`，并支持：

- `agent/pre-step` 消息注入
- 成功文件工具后的指令刷新
- 文件版本/digest 去重
- session 恢复与 Agent 重建
- `agent-instructions` ContextCard 来源

因此本插件不能简单复制一套通用 `AGENTS.md` loader。它只实现 DemoStudio 的“路径前缀到自定义指令文件”的映射。

当前 `game-editor` preset 已挂载官方 `agent-instructions`；本插件应使用独立的插件名和文件命名空间，避免重复读取同一内容。

本插件虽然只增加 DemoStudio 专用的路径映射，但其生命周期能力必须达到官方实现的可靠性要求。不能因为文件名规则更简单，就省略 session、压缩、版本、并发或持久化处理。

实现原则：生命周期直接遵循 DSH 官方 `agent-instructions` 的处理顺序和状态语义。自定义插件只实现“路径映射”和“指令文件加载”，不另造一套简化的注入生命周期，也不依赖官方插件的私有函数。

### 2.1 能力范围决策

```text
官方 agent-instructions
  -> AGENTS.md / CLAUDE.md 的通用工作区指令

dsh-instructions
  -> .dsh/instructions/*.instructions.md 的 DemoStudio 专用目录指令
```

两者可以同时挂载，但不能读取同一文件，也不能互相覆盖对方的状态。官方插件已经解决的生命周期问题，本插件需要遵循相同的行为约定。

本插件应复用的官方生命周期为：

```text
tools/result 成功
  -> execution token 向外层汇总
  -> 当前 step 结束
  -> projection 串行化并读取最新指令
  -> reconcile Agent inbox 与 session surface
  -> agent/pre-step 等待 projection
  -> 将 durable instruction message 放入下一次请求
```

## 3. 成功标准

1. Agent 成功读取 `src/engine/Entity.ts` 后，下一次模型请求包含 `engine.instructions.md`。
2. Agent 成功读取 `src/projects/snake/SnakePawn.ts` 后，下一次模型请求包含 `project.instructions.md`。
3. 同一 session 中，同一指令文件且内容 digest 未变化时只注入一次。
4. 指令文件内容发生变化后，下一次相关文件读取会注入更新后的内容。
5. 不同 Agent 或不同 session 的去重状态互不影响。
6. 文件不存在、路径无法解析、读取失败或工具执行失败时，不影响原始工具执行。
7. ContextCard 能显示注入内容，并显示指令来源与指令文件路径。
8. Agent 重启、session 恢复和上下文压缩后，指令状态仍然正确。
9. 指令文件修改、删除或替换后，模型能收到对应的更新或移除通知。
10. 并发工具、嵌套工具和 step 边界不会造成重复、乱序或错误注入。
11. 指令文件读取遵循 DSH `ctx.fs` 的路径、沙箱和版本策略。
12. 指令消息具备大小限制、版本校验和 durable message 记录。

## 4. 非目标

- 不修改 DSH 源码。
- 不修改 `dsh-memory`、`dsh-engine-tools` 或官方 `dsh-agent-instructions` 源码。
- 不解析 `.github/instructions/*.md` 的 `applyTo` glob。
- 不解析 frontmatter `paths` 条件。
- 不监听 shell 命令中的目录变化；只跟踪结构化文件工具调用。
- 不修改工具参数，也不修改工具结果。
- 不把指令内容追加到当前工具结果；只在后续模型请求前作为 user message 注入。

## 5. 路径映射

### 5.1 显式映射

默认映射如下，匹配使用路径前缀，最长匹配优先：

| 文件路径前缀 | 指令文件 |
|---|---|
| `src/engine` | `.dsh/instructions/engine.instructions.md` |
| `src/projects` | `.dsh/instructions/project.instructions.md` |

不能使用简单的字符串 `includes` 匹配。例如 `src/engine2/a.ts` 不得匹配 `engine`。

### 5.2 路径规范化

路径处理必须：

- 支持相对路径、绝对路径和 Windows `\\` 分隔符。
- 基于配置的 `projectRoot` 解析相对路径。
- 使用 `resolve` 和 `relative` 检查路径是否位于项目根内。
- 拒绝或忽略 `..` 越过项目根的路径。
- 对路径前缀和大小写采用平台一致的比较规则。
- 不根据用户提供的目录名直接拼接任意文件路径。

### 5.3 项目根

插件不得把 `process.cwd()` 固定当作 DemoStudio 项目根。编辑器启动 DSH 时 cwd 可能是 `harness/dsh-source`。

配置必须支持：

```yaml
projectRoot: 'E:/DemoStudio'
instructionsDir: 'E:/DemoStudio/.dsh/instructions'
```

没有显式配置时，才允许使用 session cwd 的项目根探测结果作为兜底。

## 6. 工具事件设计

### 6.1 支持的工具

第一版只跟踪：

- `read`，参数 `file_path`
- `read_image`，参数 `file_path`（如果该工具已启用）

是否跟踪 `write`、`edit` 必须由配置决定；默认关闭，因为本需求的触发条件是“读取文件”。

### 6.2 不在 pre-execute 中确认成功

`tools/pre-execute` 发生在工具执行前，只能记录候选调用，不能认为文件已经成功读取。工具可能随后被拒绝、取消或执行失败。

流程必须是：

```text
tools/pre-execute
    -> 记录 execution token 与候选路径
工具实际执行
    -> tools/result
    -> 仅 result.isError === false 时确认 touch
agent/pre-step
    -> 加载、去重并注入指令
```

失败、拒绝、取消的工具调用不得触发注入。

### 6.3 嵌套和并发工具

`tools/result` 可能收到 `run_code` 等复合工具产生的嵌套调用。实现必须：

- 通过 execution token 的 `parent` 关系向外层汇总 touch。
- 只在外层执行完成后提交投影。
- 同一步并行读取多个目录时合并为一条指令消息。
- 指令顺序稳定，按映射声明顺序或路径排序。
- 工具结果事件结束后再修改 inbox，避免在打开的 step 中抢占当前输入。

## 7. 状态与去重

### 7.1 状态结构

Agent 相关的临时状态使用 WeakMap 隔离：

```ts
interface PendingState {
  paths: Set<string>
}

interface InstructionCacheEntry {
  absolutePath: string
  mtimeNs: string
  size: number
  content: string
  digest: string
}
```

但“是否已经注入”不能只使用 `WeakSet<Agent>`。成功标准是 session 级别，必须至少以以下组合判断：

```text
session + instructionPath + contentDigest
```

### 7.2 消息级去重

注入前需要检查：

1. 当前 session 的可见历史中是否已有相同插件来源、相同路径、相同内容的指令消息。
2. Agent inbox 中是否已有相同消息。
3. 当前待注入批次中是否已经包含该路径和 digest。

文件内容变化后 digest 变化，允许再次注入。更新消息必须明确说明新内容替代旧内容，避免模型同时采用两个版本。

### 7.3 Agent/session 生命周期

- Agent 被销毁后，WeakMap 状态自动释放。
- Agent 重建并恢复同一 session 时，必须从 session 历史恢复去重判断。
- session clear 或新建 session 后，必须重新注入当前适用指令。
- 指令文件删除后，不能继续把旧内容当作当前有效指令；至少要清理缓存并发送移除通知，或在下一次注入时明确声明已移除。
- 上下文压缩后，必须根据压缩后的可见 surface 重新核对当前指令；如果旧指令已不可见，应重新注入当前版本。
- durable message 写入失败时不得提前提交“已注入”状态，避免模型未看到指令但后续永久跳过。

### 7.4 更新与移除语义

同一路径的新 digest 不应简单地当作一条无上下文的新消息。注入正文必须明确其语义：

- `set`：首次出现的指令。
- `replace`：同一路径内容已变化，新内容替代旧内容。
- `remove`：文件已删除或不再适用，旧指令不再有效。

更新和移除事件都必须进入 durable session，使恢复后的 Agent 能重建当前有效状态。

### 7.5 官方生命周期对齐要求

实现必须采用与 DSH 官方 `agent-instructions` 等价的生命周期边界：

1. `tools/pre-execute` 只登记 execution token 和候选路径，不确认读取成功。
2. `tools/result` 只接受成功结果；失败、取消和拒绝不产生指令 touch。
3. 嵌套工具通过 `parent` token 向外层汇总，不能在子工具结果阶段直接注入。
4. 当前 step 打开时只累计 touch，等 `step/end` 后再进行异步 projection。
5. 同一 Agent 的 projection 必须串行化，多个并发结果必须合并后再 reconcile。
6. `agent/pre-step` 必须等待该 Agent 尚未完成的 projection，再计算本次进入的消息。
7. reconcile 时同时检查 Agent inbox 和 session surface，执行新增、替换、移除或复用。
8. durable message 成功进入 session 前，不得提交新的“已注入”版本状态。
9. Agent 重建、session 恢复和压缩后，必须以 session 可见状态重新对账，不能只依赖内存 WeakMap。

推荐沿用以下状态边界，而不是使用一个简单的 `WeakSet<Agent>`：

```ts
const executionTouches = new Map<ToolExecutionToken, ProjectionTouch[]>()
const projectionTails = new WeakMap<Agent, Promise<void>>()
const openSteps = new WeakMap<Session, boolean>()
const stepTouches = new WeakMap<Session, ProjectionTouch[]>()
const instructionVersions = new WeakMap<Session, Map<string, InstructionVersionState>>()
```

## 8. 指令加载与缓存

### 8.1 文件位置

指令文件位于：

```text
<projectRoot>/.dsh/instructions/
```

`instructionsDir` 可配置，但最终路径必须经过项目根边界检查。

### 8.2 缓存策略

- 首次需要时加载，不要求插件启动时读取所有指令文件。
- 缓存键为规范化后的绝对路径。
- 每次相关成功文件 touch 时先检查文件是否存在及版本元数据。
- 使用 `mtimeNs + size` 判断缓存是否仍然有效；元数据不可用时重新读取并计算 digest。
- 文件变化时重新加载，不使用旧缓存内容。
- 文件不存在时静默跳过，不写入“已注入”状态。
- 文件读取错误只记录 debug/warn，不阻断工具或 Agent。

缓存只能作为性能优化，不能作为 session 可见状态的唯一来源。session 状态必须以 durable message 和可见 surface 为准。

### 8.3 DSH 文件系统与安全边界

必须优先使用 DSH 的 `ctx.fs`/`ctx.get('fs')` 读取指令文件，以便复用项目根、沙箱、文件版本和可取消读取策略。文件版本应直接参与官方生命周期的 reconcile 判断。

如果运行环境没有 `ctx.fs`，可以使用受限的 Node 文件系统兜底，但必须先完成 `projectRoot` containment 检查，且不能读取项目根之外的指令文件。直接使用 Node `fs` 时无法自动继承 DSH 沙箱策略，必须在文档和测试中明确这一差异。

### 8.4 内容限制

配置必须提供：

- `maxSourceBytes`：单个指令文件最大字节数。
- `maxMessageBytes`：单次合并注入的最大字节数。

超限文件应跳过或截断，并记录原因。默认建议：

```yaml
maxSourceBytes: 262144
maxMessageBytes: 65536
```

指令内容应包裹在明确的提示边界中，并声明：它是项目规范，不能覆盖 system、developer 或用户直接指令。

## 9. pre-step 注入

监听器必须调用 `await next()`，保留下游决策字段：

```ts
const decision = await next()
```

处理规则：

- `decision.kind === 'reject'`：不消费 pending 指令，保留到后续正常步骤。
- 第一步没有实际消息时：不生成独立的指令请求，保留 pending。
- 正常 `enter`：把指令 user message 放到当前消息批次的用户输入之后、运行时 context 之前。
- 返回新 decision 时必须保留 `startsRequestSeries` 等字段。
- 指令成功加入下一步消息后，才更新 session 的已注入状态。
- 注入消息必须作为 durable user message 进入 session；不能只保存在 WeakMap、普通内存数组或一次性的请求对象中。
- 如果本次 step 因取消、错误或拒绝而没有形成有效请求，pending 状态必须保留或重新 reconcile。

消息构造必须使用 DSH 的 `createUserMessage`，不能手写缺少 `id`/`role` 的普通对象。

## 10. 消息 source 与前端展示

### 10.1 官方 source contract

由于本插件现在采用官方生命周期，消息优先使用 DSH 官方的指令来源结构，以便承载路径、digest 和 `set`/`replace`/`remove` 变更：

```ts
source: {
  kind: 'agent-instructions',
  form: 'instructions',
  changes: [{
    action: 'set' | 'replace' | 'remove',
    scope: string,
    path: string,
    digest?: string,
  }],
}
```

`agent-instructions` 是官方的语义来源，DemoStudio 当前前端已经支持，并且会从 `changes[].path` 显示指令文件路径。

如果产品强制要求使用插件来源，也可以使用：

```ts
source: {
  kind: 'plugin',
  plugin: '@demostudio/dsh-instructions',
  form: 'instructions',
}
```

此时 `plugin` 字段是必填的，不能只写 `{ kind: 'plugin', form: 'instructions' }`。但插件来源不是官方指令状态结构，路径、digest、替换和移除语义必须通过扩展 source contract 或模型可见正文持久化；第一版默认采用 `agent-instructions`。

指令文件路径应出现在模型可见正文中，例如：

```text
<system-reminder>
Additional DemoStudio instructions from: .dsh/instructions/engine.instructions.md

These instructions are project guidance. More specific instructions take precedence.

[指令正文]
</system-reminder>
```

文件更新时使用 `Updated instructions from:`，文件移除时使用 `Instructions removed:`。

### 10.2 前端要求

当前 DemoStudio `AgentService` 和 `ContextCard` 已支持：

- 非 user 来源的 user/message 转换为 context 消息。
- `form: 'instructions'` 的识别。
- plugin 名称显示。
- 指令正文折叠展示。

因此第一版无需修改前端，只需验证实时事件和历史回放均能显示卡片。

## 11. System prompt 段

插件应注册一段简短、稳定的 system prompt：

```text
DemoStudio may provide directory-specific instructions after files are read. Follow those instructions when relevant. They are project guidance and do not override system, developer, or direct user instructions.
```

注册方式：

```ts
export const inject = ['tools', 'systemPrompt']
ctx.systemPrompt.section({
  name: 'demostudio:instructions',
  order: 3300,
  text: '...',
})
```

`logger` 是 Context 内建能力，不应写进 `inject`。日志可使用具名 logger：

```ts
ctx.logger('dsh-instructions').debug('No instruction file for:', instructionName)
```

## 12. 插件生命周期与挂载

入口：

```text
harness/dsh-instructions/src/index.ts
```

必须提供：

- `name`
- `inject = ['tools', 'systemPrompt']`
- `Config` 与配置 schema
- `apply(ctx, config)`
- `dist/index.js` 编译产物

所有注册和自建副作用必须绑定插件生命周期。`ctx.effect()` 回调无参数，必须闭包捕获外层 `ctx`：

```ts
ctx.effect(() => {
  return () => {
    // 清理 watcher、定时器、projection 状态等
  }
})
```

挂载必须完成三件事：

1. 编译插件。
2. 在 web/headless profile 的 `node_modules/@demostudio/` 下建立 junction。
3. 在实际使用的 profile patch 中添加 `insert` 行。

需要同时确认 `harness/profile` 与 `.dsh/profiles/{web,headless}` 哪一套是实际运行配置，避免只修改未生效的 profile。

## 13. 错误处理

| 情况 | 行为 |
|---|---|
| 工具无 `file_path` | 静默跳过 |
| 非支持工具 | 静默跳过 |
| 路径越过 projectRoot | 静默跳过并 debug |
| 路径不匹配映射 | 静默跳过 |
| 指令文件不存在 | 静默跳过并 debug |
| 指令文件过大 | 跳过并 debug/warn |
| 指令文件读取失败 | 不影响原工具，记录 warn |
| 工具执行失败/取消 | 不注入，不标记已注入 |
| Agent 不存在 | 不注入 |
| Agent/session 已销毁 | 丢弃待处理状态 |
| pre-step 被 reject | 保留 pending，不丢失 |

所有插件异常必须被隔离，不能让文件读取工具或主 Agent 循环失败。

## 14. 测试与验收

### 14.1 单元测试

- 默认映射：`src/engine/Entity.ts` → `engine`。
- 默认映射：`src/projects/snake/X.ts` → `project`。
- `src/engine2/X.ts` 不匹配。
- 相对路径、绝对路径、Windows 反斜杠路径。
- `..` 越界路径被拒绝。
- 缺少 `file_path` 或非字符串参数被忽略。
- 不支持的工具被忽略。
- 文件不存在时无异常。
- 文件内容变化后 digest 变化并重新注入。
- 文件内容未变化时不重复注入。
- 同一步多个目录读取合并为一条消息。
- 工具失败、拒绝、取消时不注入。
- pre-step reject 后 pending 不丢失。
- Agent/session 隔离。
- Agent 重建恢复 session 后不重复注入。
- session clear 后可以再次注入。
- 上下文压缩使旧指令离开可见 surface 后，当前指令会重新出现。
- 指令文件修改后产生 `replace` 语义的 durable 消息。
- 指令文件删除后产生 `remove` 语义的 durable 消息。
- durable message 持久化失败时不会错误更新去重状态。
- `ctx.fs` 沙箱拒绝项目外路径时，插件不会绕过策略读取文件。

### 14.2 集成测试

至少验证：

1. 启动 headless profile。
2. 调用真实 `read` 工具读取 `src/engine` 文件。
3. 等待下一次模型请求。
4. 检查请求消息含 `engine.instructions.md` 的内容。
5. 再次读取同目录文件，确认没有重复消息。
6. 修改指令文件后再次读取，确认出现更新内容。
7. 通过 DemoStudio 前端检查 ContextCard 的 instructions 和路径展示。

### 14.3 官方生命周期与边界测试矩阵

以下测试是 P0/P1，不能只依赖 Agent 最终回答判断。应同时检查工具结果、session durable event、下一次请求消息、inbox 和 ContextCard 投影。

#### 生命周期顺序

- `tools/pre-execute` 只记录候选，不产生注入。
- 成功 `tools/result` 后才产生 touch。
- 失败、拒绝、取消和 aborted signal 不产生 touch。
- 当前 step 未结束时不修改最终注入状态。
- `step/end` 后才执行 projection。
- `agent/pre-step` 会等待同一 Agent 的未完成 projection。
- 同一 Agent 的多个 projection 按顺序串行执行。
- durable message 写入失败时不提交版本和去重状态。
- 插件 dispose 后不再响应工具结果，也不残留 projection。

#### 嵌套与并发

- 单层 `parent` token 能正确汇总到外层。
- 多层嵌套 token 能正确汇总到根调用。
- 外层失败时，子调用成功也不能注入。
- 同一步并行读取 `engine` 和 `project` 时只生成一条合并消息。
- 并行读取同一目录多次时只生成一份指令。
- 两个 Agent 并发读取时状态、projection 和 inbox 完全隔离。
- projection 期间 Agent 被销毁时不写入已销毁 Agent。

#### session、恢复与压缩

- Agent 重启后恢复相同 session，不重复注入相同 path/digest。
- 恢复时旧指令已变化，会产生 `replace` 更新。
- 恢复时旧指令已删除，会产生 `remove` 更新。
- 新建 session 不继承旧 session 的去重状态。
- session clear 后能重新注入当前指令。
- 上下文压缩移除旧指令后，当前版本会重新出现。
- 压缩期间发生文件 touch，压缩完成后不会丢失更新。
- 历史回放、实时事件和下一次模型请求看到的指令内容一致。

#### 文件系统与版本

- `ctx.fs` 返回文件不存在、目录目标、沙箱拒绝和 provider unavailable 时行为正确。
- `ctx.fs` 返回新版本号时会刷新缓存。
- 文件修改但路径不变时产生 `replace`。
- 文件删除后产生 `remove`，文件重新出现后可再次 `set`。
- 读取过程中版本变化不会提交不一致内容。
- Node fallback 不能读取 projectRoot 外的指令文件。
- 符号链接、断开的符号链接和链接到项目外的文件符合安全策略。

#### 映射与缓存

- `src/engine/X.ts` 匹配 `engine`。
- `src/engine2/X.ts` 不匹配 `engine`。
- `src/projects/snake/X.ts` 匹配 `project`。
- 重叠前缀使用最长前缀映射。
- 相对路径、绝对路径、反斜杠路径和路径大小写符合平台规则。
- `..` 越过 projectRoot 时被忽略。
- 相同内容但不同路径是否合并，按明确的产品规则验证，不能隐式决定。
- 缓存命中时不重复读取正文，版本变化时必须重新读取。
- 文件不存在后创建、删除后恢复都能突破旧缓存状态。

#### 内容、消息和前端

- 空文件不注入或按约定生成空指令消息。
- 单文件刚好达到、超过 `maxSourceBytes` 时行为正确。
- 合并消息刚好达到、超过 `maxMessageBytes` 时行为正确。
- UTF-8 多字节内容按字节而不是 JavaScript 字符数限制。
- 指令正文中的 `<\/system-reminder>` 等控制文本不会破坏消息边界。
- 消息 source 包含完整的 `kind`、`form`、路径和变更语义。
- `set`、`replace`、`remove` 均能在实时 ContextCard 和历史回放中正确展示。
- ContextCard 展示的正文与模型实际收到的正文一致。

#### 插件组合与回归

- 与官方 `agent-instructions` 同时挂载时不读取同名文件、不重复注入。
- 与 `dsh-memory` 同时挂载时，两个 `agent/pre-step` listener 都保留各自消息和 `startsRequestSeries`。
- 与 `dsh-engine-tools` 同时挂载时不改变其工具注册和执行结果。
- HMR 重挂后 listener、缓存、projection 和定时器没有重复注册。
- web 和 headless profile 都能加载同一编译产物并通过测试。

#### 测试方法约束

- 不以 Agent 自己回答“我看到了指令”作为唯一证据。
- 必须检查 session 中实际写入的 durable `user/message`。
- 必须检查下一次 LLM 请求的 messages，而不是只检查工具结果。
- 必须检查失败路径下原始工具仍正常返回。
- 所有并发测试都要使用可控的 deferred promise，稳定复现不同完成顺序。
- 所有临时 workspace、session、Agent 和 watcher 都必须在测试结束时 dispose。

## 15. 实现检查清单

- [ ] 明确 `projectRoot` 与 `instructionsDir`。
- [ ] 使用显式路径映射和最长前缀匹配。
- [ ] 只在 `tools/result` 成功后确认文件 touch。
- [ ] 处理 `file_path`，而不是只处理 `path`。
- [ ] 处理 execution token、嵌套调用和并发调用。
- [ ] 使用 session + path + digest 去重。
- [ ] 支持文件变化、删除和恢复。
- [ ] 支持 Agent 重启、session 恢复和上下文压缩后的状态重建。
- [ ] pre-step reject/cancel 不丢 pending。
- [ ] 使用 `createUserMessage` 和官方 `agent-instructions` source contract。
- [ ] 限制指令文件和注入消息大小。
- [ ] 使用 `ctx.fs` 或明确受限的安全兜底读取。
- [ ] 使用版本校验和 durable message，不把 WeakMap 当作持久状态。
- [ ] 正确处理并发工具、嵌套工具和 step 边界。
- [ ] `ctx.effect` 回调无参数并清理所有副作用。
- [ ] web/headless 实际 profile 均完成编译、junction、patch 挂载。
- [ ] 不与官方 `agent-instructions` 读取同名文件。
- [ ] 完成单元测试、headless 集成测试和 ContextCard 回放测试。

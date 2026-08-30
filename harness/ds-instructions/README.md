# @demostudio/ds-instructions

DemoStudio 目录指令插件：Agent 成功读取映射路径（如 `src/engine/**`、`src/projects/**`）下的文件后，把对应的 `.dsh/instructions/*.instructions.md` 项目规范作为 durable user message 自动注入下一次模型请求。

对应需求文档：`doc/harness/dsh_instructions_prd_revised.md`。

## 用法

```text
.dsh/instructions/
├── engine.instructions.md    # ← src/engine/** 读取后注入
└── project.instructions.md   # ← src/projects/** 读取后注入
```

挂载（已完成）：`~/.dsh/profiles/{web,headless}/node_modules/@demostudio/ds-instructions` junction → 仓库 `harness/ds-instructions`；两个 profile 的 `cordis.patch.yml` 已插入：

```yaml
- insert:
    - id: ds-instructions
      name: '@demostudio/ds-instructions'
      config:
        projectRoot: 'E:/DemoStudio'
```

`projectRoot` 必须显式配置：编辑器以 `harness/dsh-source` 为 cwd 拉起内核，cwd 推导会把根算错。未配置时才回退到 session cwd 的 `.git` 标记向上探测。

## 配置（cordis.patch.yml）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；false 时不注册任何 section/监听 |
| `projectRoot` | session cwd 探测 | 项目根（绝对路径），相对路径解析与 containment 基准 |
| `instructionsDir` | `<projectRoot>/.dsh/instructions` | 指令目录；必须位于项目根内，越界则整体禁用注入 |
| `mappings` | `src/engine → engine.instructions.md`、`src/projects → project.instructions.md` | 前缀映射，**最长前缀优先、段级边界匹配**（`src/engine2` 不命中 `src/engine`） |
| `trackedTools` | `['read', 'read_image']` | 触发注入的结构化文件工具；write/edit 默认关闭（触发条件是"读取"） |
| `maxSourceBytes` | `262144` | 单个指令文件字节上限，超限跳过 |
| `maxMessageBytes` | `65536` | 单次合并注入消息字节上限，超限省略/截断 |

## 行为

- **触发**：`tools/result` 且 `!isError`、agent 存在、signal 未取消时确认 touch；pre-execute 只登记候选。失败/拒绝/取消/无主的调用不注入；**外层失败时嵌套子调用的成功读取也一并丢弃**（PRD §14.3，与官方插件在此处语义不同——官方会保留嵌套成功）。
- **嵌套/并发**：`run_code` 等复合工具的嵌套读取通过 execution token 的 `parent` 链向外层汇总，外层完成后才投影；打开的 step 内只累计，`step/end` 后按 Agent 串行 projection；同一步多个目录合并为一条消息（映射声明序 → 路径序稳定排序）。
- **去重**：`session + instructionPath + contentDigest`；判定状态永远从 session durable 事件（可见 surface 上的 `agent-instructions` user/message）重新推导，WeakMap/缓存只是读取优化。durable message 未落地前不提交"已注入"，注入会在下一次 pre-step 重试（自愈）。
- **变更语义**：首次 → `set`（`Additional DemoStudio instructions from: <路径>`）；内容变化 → `replace`（`Updated instructions from:`，正文声明替代旧内容）；删除/清空/超限 → `remove`（`Instructions removed:`）；恢复后可再次 `set`。离线修改/删除也会在下一次 pre-step 对账时被发现。
- **恢复**：Agent 重建/session 恢复从 durable 历史重建去重状态，不重复注入；上下文压缩移除旧指令后自动重新注入当前版本。
- **消息形态**：`createUserMessage` + `<system-reminder>` 边界（正文中的 `</system-reminder>` 转义），source 为官方契约 `{ kind: 'agent-instructions', form: 'instructions', changes: [{ action, scope, path, digest }] }`；DemoStudio 前端（AgentService 实时 + 历史回放）已支持，无需改动。

## 与官方 `@deepseek-ai/dsh-agent-instructions` 的共存

官方插件负责 `AGENTS.md`/`CLAUDE.md` 通用工作区指令，本插件只读 `.dsh/instructions/*.instructions.md`，不读取同名文件。本插件的 scope 编码为 `<指令目录>\u0000<文件名>`（官方 `candidateScopeKey` 同构）：官方 reconcile 会把我们的 scope 当作普通指令 scope 探测同一文件，digest 一致时保持静默，双方状态互不覆盖（有回归测试覆盖）。

实现上刻意不使用 agent inbox：官方 `syncInbox` 会按 `agent-instructions` 来源统一改写 inbox pending 消息，双方共用会互相覆盖；本插件把待注入目标放在 Agent 级 WeakMap（`pendingDeliveries`），在 pre-step 直接 splice 进 decision.messages，durable 性由循环的 step 提交保证。

## 文件系统与安全边界（§8.3）

- 优先使用 DSH `ctx.get('fs')`（可选获取，不声明静态 inject），复用 provider 的沙箱、版本与可取消策略；文件版本参与 reconcile。
- provider 缺席时退化为受限 Node 兜底：指令文件 realpath 后必须位于项目根内（断链视为不存在、指向项目外的链接拒绝读取）。**Node 兜底不继承 DSH 沙箱策略**，这是与 `ctx.fs` 模式的明确差异。
- `mtimeNs + size` 判断缓存有效性；版本一致不重读正文，变化必须重读。缓存只是性能优化，不是注入状态。

## 与 PRD 的已知差异

1. **外层失败丢弃嵌套成功**（见上）——PRD §14.3 明确要求，官方实现相反。
2. **投影产物不进 inbox**（见上）——PRD §7.5 说"reconcile Agent inbox 与 session surface"，本插件改为 reconcile"Agent 级 pending 目标集 + 可见 surface"，避免与官方插件的 inbox 所有权冲突。

## 开发

```bash
cd harness/ds-instructions
npm run build        # tsc → dist/
npm test             # vitest：80 个测试（单元 + 生命周期 + 共存 + 全链路 e2e）
npm run lint         # oxlint
npx dsh --profile headless --dump-config   # 验证 profile 组合包含本插件
```

真机冒烟（编辑器内核占用 9878 端口时需临时禁用 web 与 ds-engine-tools，见 `chatPlugin.ts` 的固定端口）：

```bash
printf -- '- id: web\n  disabled: true\n- id: tool-web\n  disabled: true\n- id: web-search-deepseek\n  disabled: true\n- id: ds-engine-tools\n  disabled: true\n' > .dsh/tmp-disable-web.yml
dsh --profile headless --patch E:/DemoStudio/.dsh/tmp-disable-web.yml "使用 read 工具读取 E:/DemoStudio/src/engine/Logger.ts，然后引用引擎规范中的探针字符串"
```

---
name: skl-create-dsh-plugin
slug: create-dsh-plugin
description: '创建 DemoStudio DSH 插件（harness/ds-<短名>/，@demostudio/ds-* Cordis 插件包）。使用时机：用户要求新建/创建 DSH 插件或插件工具，如"创建一个插件"、"新建 dsh 插件"、"写一个工具插件"、"给 agent 加个 XX 工具"、"插件里加个工具"。流程：脚手架结构 → src/index.ts 入口（name/inject/Config/apply）→ 工具/事件注册 → 编译 → junction 挂载 → patch 配置 → 验证。规则与 doc/harness/dsh_plugin_install.md 及 ds-memory/ds-engine-tools 现有插件模式一致。'
argument-hint: '插件功能描述，如"一个项目文件索引工具插件"、"记忆搜索工具"、"XX 系统管理工具"'
---

# 创建 DSH 插件

本 skill 用于在 DemoStudio 仓库 `harness/` 下创建新的 DSH（Cordis）插件包。插件以 `@demostudio/ds-*` 命名，编译后通过 junction 挂载到 `~/.dsh/profiles/{web,headless}`，供编辑器 agent 与命令行任务加载。

> ⚠️ 本 skill **只负责创建/修改插件包本体**（harness/ds-<短名>/ 下的源码）。挂载/卸载/验证工具已有 `ds-plugin-manager` 插件提供（mount_plugin / unmount_plugin）。**不负责**：修改 `~/.dsh/profiles/*/cordis.patch.yml` 挂载点之外的项目代码（游戏/引擎逻辑 → 对应引擎/projects skill）。

## 1. 何时使用

- 用户要求创建新的 DSH 插件（"创建一个插件"、"新建 dsh 插件"）
- 用户要求在现有插件里加工具/事件监听（"加个工具"、"监听 XX 事件"）
- 用户要求给 agent 增加能力（工具、system prompt 段、事件监听）

## 2. 插件基础（先读这些）

动手前先读（按需）：

- `doc/harness/dsh_plugin_install.md` — 安装与加载机制（junction/patch 原理）
- `doc/harness/harness_system.md` — Harness 工程总览（插件清单、职责）
- 现有插件作为模板：`harness/ds-memory/`（工具+systemPrompt+事件监听最全）、`harness/ds-engine-tools/`（纯工具，鸭子类型注册）、`harness/ds-instructions/`（纯工具+pre-step 监听）

### 2.1 插件包结构

```
harness/ds-<短名>/              # 短名：kebab-case，如 ds-memory
├── package.json                # name/main/scripts/dsh.bundle.patch/dependencies
├── tsconfig.json               # 需要 "types": ["node"]（node:* 模块导入）
├── cordis.patch.yml            # bundle patch 占位（一般写 []）
├── src/
│   ├── index.ts                # 入口：导出 name/inject/Config/apply
│   └── tools/<toolName>.ts     # 每个工具一个文件（可选）
└── dist/                       # tsc 编译产物，DSH 加载的就是它
```

### 2.2 package.json 要点

```jsonc
{
  "name": "@demostudio/ds-<短名>",      // 命名规范：@demostudio/ds-*（kebab-case）
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit", "lint": "oxlint src", "test": "vitest run" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "0.1.1-rc.2",   // 版本与全局 npm dsh 同版本（当前 0.1.1-rc.2）
    "@deepseek-ai/dsh-agent": "0.1.1-rc.2",   // 用到 agent 事件/类型才需要
    "@deepseek-ai/schemastery": "^3.18.1"     // Config schema
  }
}
```

### 2.3 src/index.ts 入口模板

```ts
export const name = '@demostudio/ds-<短名>'

/** 本插件访问的 Cordis 服务（未声明 inject 的服务键会被 ctx Proxy 拒绝）。
 * logger 是 Context 内建属性，不走 inject。 */
export const inject = ['tools']

/** 插件配置（cordis.yml 可配置项）。 */
export interface Config {
  enabled?: boolean
  // ...你的配置字段
}

/** Loader 配置 schema：默认值在此声明，代码内另有 DEFAULT_* 兜底。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  // ...
})

/** 注册即副作用：section/tools/事件监听全部挂插件 fiber（卸载自动回滚）。 */
export function apply(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return
  // ctx.tools.register(...) / ctx.systemPrompt.section(...) / ctx.on('agent/pre-step', ...)
}
```

## 3. 创建步骤

1. **确定插件名与职责**：短名 kebab-case（如 `ds-file-index`），一句话描述职责
2. **建目录脚手架**：`harness/ds-<短名>/`，复制 `ds-memory` 的 tsconfig/package.json 结构（去掉不需要的依赖）
3. **写入口 `src/index.ts`**：`name` / `inject` / `Config` / `apply`
4. **写工具/事件**：`src/tools/*.ts` 用 `defineTool`（见 §4）
5. **安装依赖并编译**：`npm install` → `npm run build` → `npm run lint` 归零
6. **写测试（可选但推荐）**：`vitest run` 通过
7. **挂载**：用 `mount_plugin` 工具（directory 传 `harness/ds-<短名>`），或手动三步（§5）
8. **验证**：`--dump-config` 看配置树 + 新会话问 agent 工具是否存在（§6）

## 4. 工具定义

DSH rc.2 的 `tools.register` **强制要求 `output: { schema, render, presentationMeta? }`**（旧工具缺该字段无法挂标准 profile）。用 `defineTool`：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export const myTool = defineTool({
  name: 'my_tool',                                  // 语义化小写下划线
  description: '一句话描述做什么、何时用',
  parameters: {
    query: { type: 'string', required: true, description: '参数说明' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { /* 结果结构 */ } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  execute: async (args) => {
    // 实现；异常时返回 { ok:false, message } 结构而非 throw
  },
})
```

## 5. 挂载三要素（build → junction → patch）

**推荐用 `mount_plugin` 工具一键完成**（自动 build → junction → patch → 验证）：

```
mount_plugin directory=harness/ds-<短名> [config={...}] [forceBuild=true]
```

手动三步（与 ds-plugin-manager 等价，迁移脚本也这么写）：

```powershell
# ① 编译（每次改源码后重跑；junction 指向目录，改代码只需 rebuild）
cd E:\DemoStudio\harness\ds-<短名>; npm run build

# ② junction（web + headless 各一份；无需管理员权限）
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\@demostudio\ds-<短名>" -Target "E:\DemoStudio\harness\ds-<短名>"

# ③ patch（~/.dsh/profiles/{web,headless}/cordis.patch.yml 各加一行）
# - insert:
#     - id: ds-<短名>
#       name: '@demostudio/ds-<短名>'
#       config: { ... }   # 可选，交给 Config schema 校验
```

## 6. 验证

```sh
# 1. 配置树里有这一行且能解析
dsh web --dump-config | grep ds-<短名>

# 2. 新会话问 agent "你有 <tool_name> 工具吗" → 应答 YES

# 3. 工具调用冒烟：给一个真实参数跑一次，确认返回符合 output.schema
```

## 7. 常见坑（已踩过）

| 坑 | 说明 |
|---|---|
| **junction 嵌套错位** | `mount_plugin`/`unmount_plugin` 曾经误传完整包名（`@demostudio/x`），junction 内部再拼前缀 → 生成 `@demostudio/@demostudio/<pkg>` 嵌套目录，Node 解析失败 → 内核启动崩溃（degraded）。已修复（传 entryId + `stripScope()` 防御）。**排查**：`logs/dsh-agent.log` 是崩溃第一现场；`Get-ChildItem ...node_modules\@demostudio -Force` 看有无嵌套目录 |
| **必须导出 `inject`** | 否则 `ctx.tools` 是 undefined；logger 是内建属性不能 inject（写了会 boot 失败） |
| **`ctx.effect()` 回调无参** | 必须闭包捕获：`ctx.effect(() => registerTools(ctx))`，不能 `(inner) =>`（inner 是 undefined） |
| **tools.register 缺 output** | rc.2 强制要求 `output: { schema, render, presentationMeta? }`，缺了无法挂标准 profile |
| **apply 内访问未声明 ctx 属性** | ctx 是 Proxy，访问未 inject 属性抛 "cannot get property X without inject"；引擎上下文走 `globalThis.__dshEngineCtx` 而非 ctx |
| **改代码不重编译** | DSH 加载的是 `dist/`（junction 只是指针），改源码必须 `npm run build` 才生效 |
| **bundle patch 为空数组** | 空数组不贡献配置行，必须以 insert 挂载（patch 写 `[]` 占位即可） |
| **编辑器 cwd 问题** | 编辑器以 `harness/dsh-source` 为 cwd 拉起内核，涉及项目路径的 config 必须显式写绝对路径（如 `projectRoot: 'E:/DemoStudio'`） |
| **PowerShell 编码** | `Add-Content` 默认 ANSI 乱码；追加 UTF-8 用 `[System.IO.File]::AppendAllText` + `UTF8Encoding($false)` |

## 8. 相关文件

- **插件文档**：`doc/harness/dsh_plugin_install.md`（安装机制）、`doc/harness/harness_system.md`（工程总览）
- **模板插件**：`harness/ds-memory/`（最全）、`harness/ds-engine-tools/`（纯工具）、`harness/ds-instructions/`（pre-step 监听）
- **挂载工具**：`harness/ds-plugin-manager/`（mount_plugin / unmount_plugin）
- **故障日志**：`logs/dsh-agent.log`（内核崩溃/插件加载失败第一现场）
- **插件记忆**：仓库记忆 `/memories/repo/dsh-plugin-system.md`（开发要点与踩坑全记录）

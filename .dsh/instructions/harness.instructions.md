---
prefix: harness
---
# Harness 插件开发规范

> 本指令在 Agent 读取 `harness/` 目录下文件时自动注入。

## 插件清单

| 目录 | 包名 | 职责 |
|---|---|---|
| `ds-instructions` | `@demostudio/ds-instructions` | 目录指令注入（读文件后自动注入 .dsh/instructions/*.md） |
| `ds-memory` | `@demostudio/ds-memory` | 跨会话持久记忆（write/search/forget/review + 回合末自动提取） |
| `ds-feedback` | `@demostudio/ds-feedback` | 用户纠正规则飞轮（rule_propose/rule_apply + 常驻规则段注入） |
| `ds-experience` | `@demostudio/ds-experience` | 做事轨迹经验库（episode + history_search/read + 回合末自动提炼） |
| `ds-sync` | `@demostudio/ds-sync` | home→项目根 .dsh 同步（记忆/skills/presets/profiles） |
| `ds-engine-tools` | `@demostudio/ds-engine-tools` | 引擎特化工具集（inspectScene/spawnEntity/runScenario 等） |
| `ds-plugin-manager` | `@demostudio/ds-plugin-manager` | 插件管理器（mount/unmount/列表） |
| `profile/` | — | DSH Profile 配置（bundles 清单 + persona + skills） |
| `vscode-ext/` | — | VS Code 扩展（命令面板 + 侧边栏聊天 + 状态栏） |

## 命名与目录结构

- 包名：`@demostudio/ds-<短名>`（kebab-case）
- 目录：`harness/ds-<短名>/`
- 入口：`src/index.ts` → 编译产出 `dist/index.js`
- 配置 schema：`src/config.ts`（可选，复杂插件单独文件）
- 工具定义：`src/tools/<toolName>.ts`（每个工具一个文件）

## 入口文件必须导出

```typescript
// src/index.ts
export const name = '@demostudio/ds-<短名>'

/** 声明依赖的 Cordis 服务键（未声明的属性通过 ctx 访问会抛 inject 错误） */
export const inject = ['tools', 'systemPrompt'] // 按需声明

/** 配置 schema（可选；cordis.patch.yml 的 config 字段会经过此 schema 校验） */
export const Config: z<Config> = z.object({ ... })

/** 插件入口：注册工具、system prompt 段、事件监听 */
export function apply(ctx: Context, config?: Config): void { ... }
```

## Cordis API 模式

- **注册工具**：`ctx.tools.register(tool)` — tool 需有 `name`、`description`、`parameters`（JSON Schema）、`execute`
- **注入 system prompt 段**：`ctx.systemPrompt.section({ name, order, text })`
- **监听事件**：`ctx.on('agent/pre-step', ...)`、`ctx.on('tools/result', ...)`、`ctx.on('session/event', ...)`
- **生命周期清理**：`ctx.effect(() => () => { /* 卸载清理 */ })`
- **日志**：`ctx.logger('插件名')` 或 `ctx.logger?.info(...)`

## 关键红线

- **不要通过 `ctx.<属性>` 访问未在 `inject` 中声明的属性** — Cordis Proxy 会抛 "cannot get property X without inject"
- **工具实现不依赖 DSH 内部 API** — 只通过 `ctx.tools` / `ctx.systemPrompt` 等声明式接口
- **子 agent（delegationDepth > 0）不做检索注入/后台提取** — 上下文归属父 agent
- **事件处理器失败不能阻塞对话** — try/catch 兜底，降级放行
- **插件卸载必须清理所有副作用** — 定时器、WeakMap、event listener

## package.json 规范

```json
{
  "name": "@demostudio/ds-<短名>",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint src tests",
    "test": "vitest run"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

- `dsh.bundle.patch` 指向本插件的 `cordis.patch.yml`（声明 id、name、config 默认值）
- 依赖统一使用 `@deepseek-ai/cordis@^4.0.1` + 对应 `@deepseek-ai/dsh-*@0.1.1-rc.2`
- devDependencies 固定：`@types/node@^22`、`oxlint@^1`、`typescript@^5.6.3`、`vitest@^3`

## cordis.patch.yml 模式

```yaml
- insert:
    - id: ds-<短名>
      name: '@demostudio/ds-<短名>'
      config:
        # 插件配置默认值
```

## 工具定义模板

```typescript
import type { Tool } from '@deepseek-ai/dsh-tools'

export const myTool: Tool = {
  name: 'my_tool',
  description: '工具描述（AI 可见）',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '参数说明' },
    },
    required: ['param1'],
  },
  async execute(args: { param1: string }, ctx?: unknown) {
    // 实现逻辑
    return { content: [{ type: 'text', text: '结果' }] }
  },
}
```

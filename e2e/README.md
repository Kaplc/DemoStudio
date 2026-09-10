# e2e — 多项目 E2E 回归框架

所有项目的端到端回归跑在同一个框架上：一条命令从「编辑器首页」自动引导到「游戏运行中」，断言走通用 `ai.*` 事件，失败自动落盘游戏运行时证据。

> 系统设计与实现细节见 [`doc/testing/e2e_framework.md`](../doc/testing/e2e_framework.md)。

## 跑测试

```powershell
# 前置：dev server 已启动（npm run dev）；多实例端口递增时用环境变量指路
npm run test:e2e          # 全部用例
npm run test:e2e:fish     # 只跑 ClashMaster（fish）
npm run test:e2e:warm     # 只跑 WarmCurrent

# 指定 dev server 端口（5173 被占用递增时）
$env:E2E_BASE_URL = "http://localhost:5174"; npm run test:e2e

# 看 HTML 报告
npx playwright show-report playwright-report/e2e
```

产物：

| 产物 | 位置 |
|---|---|
| 终端实时输出 | list reporter |
| HTML 报告 | `playwright-report/e2e/` |
| JSON 报告（机器可读） | `test-results/e2e-report.json` |
| 失败现场（截图 + trace） | `test-results/e2e/<spec>/` |
| 游戏运行时证据（失败时自动 attach） | 同上 `attachments/`：`game-console.log` / `game-state.json` / `game-hud.json` / `game-final.png` |

## 写一条新用例

```ts
// e2e/<项目>/smoke.spec.ts（每个项目一个文件夹，如 e2e/fish/、e2e/warm/）
import { test, expect } from '../framework/fixtures'

test.use({ project: 'fish' })   // projects.ts 里注册的项目 id，默认 fish

test('示例：主菜单开始按钮存在', async ({ game }) => {
  const start = await game.findHUD((n) => n.name === 'StartButton')
  expect(start.length).toBeGreaterThan(0)
})
```

`game` 提供的方法：`state()` / `hud()` / `hudFlat()` / `findHUD(pred)` / `waitHUD(pred, timeout)` / `outline()` / `clickActor(target)`（自动吸收 500ms 点击冷却）/ `gm(command, args)`。用例失败时四件套证据自动进报告，不用手写任何取证代码。

## 新项目接入（三步）

1. 确认工程卡显示名：`src/projects/<项目>/register.ts` 里 `ProjectModule.name`；
2. 在 [`framework/projects.ts`](./framework/projects.ts) 的 `PROJECTS` 加一条 `{ id, cardName, description }`；
3. 按上面的模板写冒烟用例（建议先覆盖：主菜单 → 核心场景切换 → 关键 HUD 节点 → `gm('help')` 通断）。

不需要暴露项目私有调试桥，不需要改框架代码。

## 已知坑（写用例前必读）

- 启动按钮是 `"▶ Launch"`（MenuBar），**别用 `hasText: '▶'` 定位**——大纲折叠箭头和 agent 面板箭头都是 '▶'；
- `page.evaluate` 的**字符串**按纯 JS 求值，写 TS 语法直接 SyntaxError；
- `ai.getHUD` / `ai.getSceneOutline` 回执是 `{ ok, hud|outline: 数组 }` 包一层，`ai.getState` 是裸快照——框架已抹平，直接用 `game.*` 即可；
- Launch 会触发整页重载，浏览器模式下偶发被打回首页——boot 已自动重试 ×2，用例里不用处理。

更多细节与踩坑依据：[`doc/testing/e2e_framework.md`](../doc/testing/e2e_framework.md)。

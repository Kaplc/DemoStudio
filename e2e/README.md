# e2e — 引擎功能测试 + 多项目 E2E 回归框架

根 `e2e/` 目录 = **引擎/编辑器功能测试** + **测试框架本体**（Playwright 启动入口）；各游戏项目的回归用例住在各自工程里：`projects/<项目>/e2e/`。一条命令从「编辑器首页」自动引导到「游戏运行中」，断言走通用 `ai.*` 事件，失败自动落盘游戏运行时证据。

> 系统设计与实现细节见 [`doc/testing/e2e_framework.md`](../doc/testing/e2e_framework.md)。

## 目录结构

```
e2e/                          # 引擎/编辑器层 + 测试框架（npm run test:e2e 跑这里）
  framework/                  #   框架本体（fixtures / session / ai / projects 自动扫描）
  agent/ home/ perf/          #   引擎功能用例（agent 面板 / 首页 / 性能分析器）
projects/<项目>/e2e/           # 项目回归用例（框架自动扫描 projects/*/e2e/*.spec.ts）
  fish/e2e/  warm-current/e2e/  demo2d|arena|hoi4|hello/e2e/
```

## 跑测试

**没有全量入口**——按 2026-09-22 约定，跑测试必须指定引擎或具体项目目录，不混跑：

```powershell
# 前置：dev server 已启动（npm run dev）；多实例端口递增时用环境变量指路
npm run test:e2e                          # 引擎/编辑器层（根 e2e/ 全部用例）
npm run test:e2e:project -- projects/fish # 指定项目目录（通用入口，可多个目录）
npm run test:e2e:fish                     # 快捷方式：ClashMaster（fish）
npm run test:e2e:warm                     # 快捷方式：WarmCurrent（warm-current）

# 指定 dev server 端口（5173 被占用递增时）
$env:E2E_BASE_URL = "http://localhost:5174"; npm run test:e2e

# 看 HTML 报告
npx playwright show-report playwright-report/e2e
```

| 层 | 位置 | Playwright project | 入口 |
|---|---|---|---|
| 引擎/编辑器 | 根 `e2e/` | `engine`（testDir `./e2e`） | `npm run test:e2e` |
| 游戏项目 | `projects/<项目>/e2e/` | `projects`（testDir `./projects` + e2e 目录正则） | `npm run test:e2e:project -- projects/<项目>` |

## 新项目接入：零注册

框架**自动扫描**，新项目不用改任何框架/配置代码：

1. 在 `projects/<新项目>/e2e/` 下写 spec（文件夹没有就建一个）：

```ts
// projects/<新项目>/e2e/smoke.spec.ts
import { test, expect } from '../../../e2e/framework/fixtures'

test.use({ project: '<新项目>' })   // id = projects/ 下的文件夹名，自动解析工程卡名

test('示例：主菜单开始按钮存在', async ({ game }) => {
  const start = await game.findHUD((n) => n.name === 'StartButton')
  expect(start.length).toBeGreaterThan(0)
})
```

2. 跑：`npm run test:e2e:project -- projects/<新项目>`。

`project` id = **文件夹名**；工程卡显示名（cardName）由框架读 `projects/<id>/register.ts` 的 `ProjectModule.name` 自动获得（文本提取——register.ts 用了 `import.meta.glob` 等 vite 专属能力，不能在 Playwright 进程里 import，见 [framework/projects.ts](./framework/projects.ts) 头注释）。特殊情况可 `registerProject()` 静态覆盖。

> 这条"零注册"链路本身有回归锁：[tests/e2eFrameworkAutoScan.test.ts](../tests/e2eFrameworkAutoScan.test.ts) 会真实复制 hello 工程为新项目 → 确认 vite glob 纳入 → spawn playwright 实跑全绿 → 清理（dev server 不在线时自动跳过实跑段）。

`game` 提供的方法：`state()` / `hud()` / `hudFlat()` / `findHUD(pred)` / `waitHUD(pred, timeout)` / `outline()` / `clickActor(target)`（自动吸收 500ms 点击冷却）/ `gm(command, args)`。用例失败时四件套证据自动进报告，不用手写任何取证代码。

## 已知坑（写用例前必读）

- 启动按钮是 `"▶ Launch"`（MenuBar），**别用 `hasText: '▶'` 定位**——大纲折叠箭头和 agent 面板箭头都是 '▶'；
- `page.evaluate` 的**字符串**按纯 JS 求值，写 TS 语法直接 SyntaxError；
- `ai.getHUD` / `ai.getSceneOutline` 回执是 `{ ok, hud|outline: 数组 }` 包一层，`ai.getState` 是裸快照——框架已抹平，直接用 `game.*` 即可；
- Launch 会触发整页重载，浏览器模式下偶发被打回首页——boot 已自动重试 ×2，用例里不用处理；
- 新项目文件夹 `projects/<id>/e2e/` 建好后**即可被扫描**，无需重启什么；但编辑器侧发现新工程本身需整页刷新（`import.meta.glob`，见 `src/editor/projects/registry.ts`）。

更多细节与踩坑依据：[`doc/testing/e2e_framework.md`](../doc/testing/e2e_framework.md)。

---
name: add_tool_card_diff_view
task_type: feature
outcome: success
date: 2026-09-11
prefix: [src/components/agent/toolDiff.ts, src/editor/AgentService.ts, harness/dsh-source/packages/client/ui-tool/lib/types/client/tool/models/diff-card-model.d.ts]
---
## Summary

给编辑器 agent 面板的 write/edit 工具卡片实现 diff 视图（行号 + 红绿行 + 自动展开）：先从 DSH 包与会话日志挖出 meta.diffs 数据源，再做纯函数对齐层 + AgentService 双路径接线 + ToolCard/CSS，vitest 53 例 + 无副作用 e2e（合成 history 存根）全绿，并用真实 Chromium 截图取证。

## Lessons

**有效路径（复用性最高的部分）**
1. 参考实现的正确挖法：用户给的参考图未必来自 DSH WebUI。先按包名定位（`dsh-tool-fs` 找 write/edit 的 `presentResult`、`dsh-client-ui-tool` 的 `diff-card-model.d.ts` 找渲染契约），再解前端 bundle：`node -e "require('fs').readFileSync(bundle).indexOf(...)"` 取 2KB 上下文即可读出压缩后的 `DiffBlock` 逻辑（本次据此确认 WebUI 的 DiffBlock **没有行号**、hunk 里也没有 oldStart——所以行号必须自己算）。
2. 事件数据源查 result 的 `meta` 而不是事件正文：`tool/result` 的 `data.meta.diffs`。验证形状用 DSH 会话日志：`.dsh/sessions/*/session.jsonl.zstd` 多帧拼接，`node:zlib` 的 `zstdDecompressSync` 只解第一帧且不报错 → 按 magic `28 B5 2F FD` 扫描循环解，一次拿到真实记录（比读源码猜字段快）。
3. 接线只有 4 处但**必须两路都接**：`handleSessionEvent` 的 tool/result（实时）与 `loadHistory` 的 fold（历史）——漏后者 = "实时有 diff、切换会话就没了"。这对任何"给工具卡片加展示数据"的需求都成立。
4. e2e 无副作用存根模式（本次最大收获）：`addInitScript` 里替换 `window.fetch`，按 `body.method` 返回合成 `session.list`（含目标 sessionId）+ `session.history`（合成 tool/call + tool/result + meta.diffs + turn 边界），再写 localStorage 会话映射命中 `recovering` 路径 → 面板自动连接并 fold 出工具卡片，全程不碰真 DSH；行号锚定用的 `electronAPI.readTextFile` 也页面内 stub（只暴露这一个字段，AgentService 仍判为浏览器模式，不会改走 IPC）。2 条用例 3s 跑完，比"起真会话跑真 edit"稳得多。
5. 绝对行号只能 best-effort 锚定：hunk 无起始行号 → 读当前文件、按 `newText`（纯删除退 `oldText`）`indexOf` 定位，**CRLF 必须 `\r\n→\n` 归一**（DSH diff 基线是 LF、文件是 CRLF，不归一则永远命中不了），同文件多 hunk 要游标顺序推进，失败一律回退 1 起始且不阻塞渲染。

**踩的坑**
6. `navigator.clipboard?.writeText(x).then(...)` 在 jsdom/无剪贴板环境直接 TypeError（optional chain 只护到 `clipboard`，`.then` 落在 undefined 上）→ 必须整段守卫 `if (!clip?.writeText) return`。
7. `vi.fn(() => Promise.resolve())` 让 `mock.calls[0][0]` 过不了 tsc（空元组），写成 `vi.fn(async (_text: string) => {})` 才能取参数——vitest 3 类型严格。
8. Vite dev server 只监听 `::1:5173`：`fetch('http://127.0.0.1:5173')` 失败但 `http://localhost:5173` 200（见记忆 ps_probe_localhost_false_timeout），别据此判断"dev server 没起"。
9. 本会话 `edit` 两次撞 `ReplaceFileW EIO (Win32 1175)`，原样重试即过（同记忆里的既有教训）。
10. 编辑器 CDP（9222）两次 connectOverCDP 超时，实机 UI 取证做不了 → 退化为"Playwright 真实 Chromium 渲染同一页面并截图"；另外当前模型读不了图（read_image 报模型未声明图像输入），因此视觉验收最终靠 e2e 的 computedStyle 精确 RGB 断言兜底——**能断言的别只截图**。
11. 用户三轮追加反馈（不折叠 / 行号配色带符号 / edit 卡片自动展开）说明这类 UI 需求一次说不全：先把纯函数层与数据接线做扎实，样式与交互都是小改，别把折叠/展开逻辑焊死在纯函数里（本次 `buildDiffRows` 与折叠解耦，去折叠只删了组件里 10 行）。

## Effective Path

src/components/agent/toolDiff.ts + ToolCard.tsx（DiffBody）；src/editor/AgentService.ts 的 extractDiffsFromMeta（实时 + 历史 fold 两处接线）；tests/e2e/agent/tool-card-diff.spec.ts（合成 history 存根）

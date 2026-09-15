---
name: e2e_synthetic_key_event_pitfalls
description: e2e 验证"页面 JS 接管按键"的两个派发机制坑（window.dispatchEvent 塌缩 capture/bubble；trusted 按键捕获阶段微任务先于 bubble 执行）与正确判别器写法
type: project
prefix: [e2e/agent/f5-refresh.spec.ts]
---

# e2e 合成/真实键盘事件的派发机制坑（判别"页面 JS 接管按键"类特性）

**Problem:** e2e 验证"页面 JS 接管 F5/按键"类特性（如 AgentPanel F5 刷新兜底）时，判别器两处读错值：①合成事件在捕获阶段抢先 `preventDefault`，面板 handler 仍照常触发；②trusted（CDP `page.keyboard`）按键的判别器用"捕获监听 + 微任务落值"读 `defaultPrevented`，读到 handler 生效前的旧值 `'false'`。另：headless Chromium 下 F5 **没有**浏览器默认刷新，禁用 handler 后 `waitForEvent('load')` 会挂满整个用例级超时（240s），回归反馈极慢。

**Cause:** ①`window.dispatchEvent(e)` 直接把事件派发在 target（window）上，capture/bubble 之分**塌缩成注册顺序**——捕获阶段监听排不到已挂载 handler 前面；②trusted keydown 派发中，捕获阶段监听里排队的微任务会在 bubble 阶段**之前**执行（探针实测日志序：rec-capture → microtask 写值 → bubble handler preventDefault）；③headless 无浏览器 chrome 层，F5 重载加速器不存在。

**Solution:** ①合成事件派到 `document.body`（配 `bubbles: true`）走真实传播路径；②判别器在面板挂载后**从测试里再注册一个排在最后的 `once` 冒泡监听**，同一派发内同步读 `defaultPrevented` 终值写 sessionStorage（跨重载存活），断言 `'true'` 证明重载来自被测 handler；③`waitForEvent('load')` 显式给 `{ timeout: 15_000 }`。

**Applicable:** e2e/agent/*.spec.ts 及一切"验证页面 JS 接管按键/拦浏览器默认行为"的 Playwright 用例（落地范本：e2e/agent/f5-refresh.spec.ts，机制说明 doc/editor/integration/agent_panel_system.md §15.2）。

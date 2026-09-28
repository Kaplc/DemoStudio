# editor.css 的 --dsw-alias-* 令牌缺失：无 fallback 的 var() 静默失效（2026-09-30 定案）

**Problem:** 供应商设置面板「保存配置」primary 按钮完全无样式（透明背景 + 无边框 + 白字），number 输入框风格突兀。computedStyle 探针实测：`--dsw-alias-accent` / `--dsw-alias-status-error` / `--dsw-alias-interactive-bg-subtle` / `--dsw-alias-bg-subtle` 在 `:root` 全部未定义（raw 为空串）。

**Cause:** editor.css 的 DSH 令牌块（`:root`）只定义了部分别名，面板样式按 DSH WebUI 令牌名书写时引入了 17 个从未定义的 `--dsw-alias-*`。CSS 自定义属性未定义且无 fallback → 声明 invalid at computed-value time → 非继承属性回 initial（背景透明、border 消失）、继承属性回继承值——**不报错、devtools 无警告，纯静默**。

**Solution:** 2026-09-30 已在 `:root` 状态色区块补齐全部 17 个缺失令牌（accent/focus 族统一映射 `--dsw-alias-state-info-primary` #6BA8FF；status-* 映射 state-*-primary；bg/fill 族映射 layer 阶与 rgba 白阶）。排查方法：① 令牌差集一行 PowerShell（正则提取 `var(--dsw-alias-*` 使用集 vs `--dsw-alias-*:` 定义集比差）；② 无副作用 e2e stub 页 + `getComputedStyle` 探针拿真实计算值（primary `rgba(0,0,0,0)` + `0px none` 即实锤），别靠截图猜。

**Applicable:** src/styles/editor.css 一切 `var(--dsw-alias-*)` 消费处；任何"组件没风格/透明/无焦点色"类 UI 问题先查令牌定义差集再查选择器。新增令牌引用时确认 `:root` 有定义或自带 fallback。

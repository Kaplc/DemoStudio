---
name: gameplay_edit_stale_module_cache
description: 改 gameplay TS 后 Stop→Launch 重开游戏仍跑旧代码的根因（vite 动态 import 模块缓存）与验证/解法
type: project
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, playwright.e2e.config.ts]
---

**Problem:** 改了 `projects/*/gameplay` 的 TS 后在编辑器里 Stop→Launch 重开游戏，跑的仍是旧代码（旧行为/旧日志行），"改动画没生效"；2026-09-14 实测同一流程先造成一次假阳性验证、后一次假阴性（日志指纹才拆穿）。

**Cause:** 编辑器页面（localhost:5173 vite dev）生命周期内，游戏 Launch 经动态 import 加载 gameplay 模块；页面模块图已缓存的模块 URL 不变（无时间戳查询），浏览器直接复用旧实例，vite 不会为"页面模块图之外的动态 import"推送更新。Stop/Launch 只重建 World，不刷新模块图。

**Solution:** 改 gameplay 代码后要让游戏吃到新代码：**刷新编辑器页面**（CDP `page.reload()`，会退回工程选择页需重新打开工程+Launch；或重启编辑器）再验证。**验证生效用日志指纹**——新代码特有的一行 log（如取景日志带"斜视角"后缀）而非只看画面。e2e 不受影响（playwright 自起独立页面，天然最新）。

**Applicable:** warm/hoi4/fish 所有项目 gameplay 热改后的运行时验证；任何"编辑器内重开游戏测新代码"的场景。


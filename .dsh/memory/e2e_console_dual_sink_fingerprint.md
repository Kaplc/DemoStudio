**Problem:** e2e 用 console 日志指纹断言（收集 `page.on('console')` 行 + `count(substr)`）时，绝对数断言（如 `expect(count).toBe(1)`）必然失败——实际计数是 2。
**Cause:** 游戏侧 Logger 每个日志事件落 console 两条：真实 sink 一条 + `[MockGameLog:info]` 前缀的 sink 一条（2026-09-17 e2e 诊断输出实锤）。
**Solution:** 指纹断言一律用「与基线差值」：操作前记 before 计数，操作后断言 `> before`（应重建）或 `=== before`（应零重算）；诊断信息嵌进 expect 自定义消息——spec 内 console.log 在 playwright list reporter 下不可见。
**Applicable:** 所有 e2e spec 的 console 日志指纹断言（warm/holo_contour.spec.ts 等）。

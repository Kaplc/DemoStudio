---
name: warm_atmosphere_asset_mounted
description: 地球大气归属决策（2026-09-10）：AtmosphereComponent 由 earth.blueprint.json 资产声明，setupCloseup 不再运行时挂载（prefix: projects/warm-current）
type: project
prefix: projects/warm-current
---

# 地球大气归属：蓝图资产声明（2026-09-10 用户决策）

规则：AtmosphereComponent 由 `projects/warm-current/asset/blueprints/stars/earth.blueprint.json` 显式声明（用户在 Inspector 调参后随资产保存），`EarthActor.setupCloseup()` 只负责 bumpMap，**不再运行时挂载大气**。

**Why:** 运行时硬编码挂载与蓝图保存的全量写回撞车——蓝图实例 + setupCloseup 各挂一个，双层辉光 + AObject 重复组件告警。用户明确选择"资产挂组件"（参数在编辑器里所见即所得）。

**How to apply:** 改地球大气颜色/强度/锐度/壳倍率 → 改蓝图或在 Inspector 调（保存生效）；不要往 setupCloseup 里加回大气挂载。其他天体未声明大气 = 无大气。观察增益（×1.8）读的是蓝图实例，baseIntensity 随资产值走。回归锁：e2e earth_closeup"大气恰好一个"断言。


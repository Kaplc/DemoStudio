---
name: warm_atmosphere_asset_mounted
description: 地球大气+云层均由 earth.blueprint.json 资产声明（2026-09-10 大气 / 2026-09-12 云层），setupCloseup 只挂 bump+海洋粗糙度，运行时零外观挂载（prefix: projects/warm-current）
type: project
prefix: projects/warm-current
---

# 地球外观组件归属：蓝图资产声明（大气 2026-09-10 / 云层 2026-09-12 用户决策）

规则：AtmosphereComponent（2026-09-10）与 CloudLayerComponent（2026-09-12 群星观感改版：受光 Lambert + alphaMap + 真云图 earth_clouds.png，spin 错速自转）均由 `projects/warm-current/asset/blueprints/stars/earth.blueprint.json` 显式声明，`EarthActor.setupCloseup()` 只负责 bumpMap + 海洋粗糙度贴图（applyEarthOceanRoughness 异步派生），**不再运行时挂载任何外观组件**。

**Why:** 运行时硬编码挂载与蓝图保存的全量写回撞车——蓝图实例 + setupCloseup 各挂一个，双层辉光 + AObject 重复组件告警。用户明确选择"资产挂组件"（参数在编辑器里所见即所得）。云层 2026-09-10 曾因无真云图（程序化兜底=灰斑）被砍，2026-09-12 拿到 NASA 系真图后按同一约定回归。

**How to apply:** 改大气/云层参数 → 改蓝图或在 Inspector 调（保存生效）；不要往 setupCloseup 里加回外观挂载。其他天体未声明 = 无大气/云层。观察增益（×1.8）读蓝图实例。回归锁：e2e earth_closeup"大气/云层各恰好一个"断言。


---
name: warm_planets_removed_earth_moon_scope
description: 2026-09-29 用户决策（两步）：warm 其他星球先从蓝图台移除；随后太阳也移除、地球冻结不公转——蓝图台=纯地月系工作台；第几幕剧情已废弃正在重做，幕解锁内容不要做兼容保全
type: project
prefix: [projects/warm-current/gameplay/systems/OrbitBlueprintComponent.ts, projects/warm-current/gameplay/systems/MapHitTestComponent.ts, projects/warm-current/gameplay/map/StarMapRenderComponent.ts]
---

规则（2026-09-29 两步决策）：warm-current 轨道蓝图台（唯一太阳系全景入口）先移除其他星球只留太阳/地/月，随后**太阳也移除、地球冻结不公转**——`helpers.starPosAt('earth')` 恒返回布局位（地月相对几何/运输经济零变化，月球照常绕冻结地球公转），绕日环整体退场（吸附只剩月球绕地环），取景中心改冻结地球。水星/金星/火星/木星/土星/天王星/海王星/木卫二从显示、吸附、命中三处退场，统一收口 `OrbitBlueprintComponent.BLUEPRINT_BODIES`（= earth/moon）。仿真 `tryPlaceOnOrbit(…,'sun',…)` 能力保留（旧档兼容），仅蓝图台不再产出。不做幕解锁门控。

**Why:** 用户原话"其他星球可以直接移除了不需要显示……什么游戏剧情都不要了，这些第几幕的已经重新制作了"＋"移除太阳，地球不需要公转"——第几幕剧情内容已废弃、正在重新制作，火星补给线/木卫二采矿等幕解锁玩法不再是保全对象；蓝图台定位为地球中心的规划工作台。

**How to apply:** 后续 warm 会话遇到幕解锁（unlockAct）、火星任务（startMarsMission）、木卫二/火星资源星相关内容时，不要做兼容性保全或假设它们仍在蓝图台可达；改到 BLUEPRINT_BODIES 消费点（OrbitBlueprintComponent 吸附 / MapHitTestComponent 命中 / StarMapRenderComponent 渲染）或 starPosAt 冻结分支时保持同源口径。细节见 doc/game/modules/13-轨道蓝图台.md。

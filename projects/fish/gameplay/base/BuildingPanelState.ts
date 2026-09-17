/**
 * BuildingPanelState — 建筑 UI 面板的 buildingId 静态暂存
 *
 * 背景：UI widget 经 spawnUIActor/spawnAnchoredWidget 生成后，UIScriptComponent
 * 的脚本实例要等下一帧 UIManager.commitSpawn → BeginPlay 才创建——spawn 后立即
 * getComponent(UIScriptComponent).instance 是 null，无法像 TipsScript.show 那样
 * 同步传参。所以面板打开前把 buildingId 写到这里的静态字段，脚本 onStart 时消费。
 *
 * 实例数语义（重要）：
 *  - BuildingInfoState：信息牌全局最多一张（GameMode 互斥），单值安全。
 *  - BuildingUpgradeState：升级面板全局最多一张，消费即清。
 *  - 收集泡泡可多实例并存（多矿同时达标），矿种不落这里——脚本点击时只传自身
 *    actor 引用，GameMode 用 collectBubbles 映射反查建筑（见 collectFromBubble）。
 *
 * clearClashBase 会防御性复位这些字段（场景销毁时残留清零，双保险）。
 */

/** 建筑信息牌（building_info.widget.json）当前展示的建筑类型 id */
export const BuildingInfoState = { currentBuildingId: '' }

/** 建筑升级面板（building_upgrade.widget.json）待展示的建筑类型 id */
export const BuildingUpgradeState = { pendingBuildingId: '' }

# 方案测试用例：场景阴影（Shadow Mapping 参数补全 + Blob 假阴影）

> 状态：方案草案 v1（2026-09-04，与 [plan.md](./plan.md) 同步产出）｜ 全部待实现
> 编号体系：TC-S*（Shadow）。P0 = LightComponent 阴影参数与真阴影链路；P1 = ShadowBlobComponent；P2 = 性能与打磨。

## 一、测试策略

| 阶段 | 内容 | 前置 |
|---|---|---|
| 基线（改造前） | 记录 fish_level1 当前"开 castShadow 但无可见阴影"的现状证据（TC-S1 以 FAIL 形态存在） | 无 |
| P0 目标 | LightComponent 阴影参数落地后，真阴影在 ClashMaster 可见且可编辑 | P0 实现 |
| P1 目标 | ShadowBlobComponent 三项行为断言（跟随/贴地/排序） | P1 实现 |

真阴影"可见性"以两条路径联合判定：① shadow camera 数学断言（frustum 覆盖范围，纯单测）；② 编辑器/e2e 视口像素采样（地面出现非均色暗斑）。

## 二、P0：LightComponent 阴影参数

### TC-S1 大地图阴影截断复现与修复 【P0】

- **步骤**：单测构造 DirectionalLight（three r170 默认），断言 `shadow.camera.right - left === 10`（±5 缺省）；再经 LightComponent 设 `shadowExtent: 40`，断言四边 ±40 且 `shadow.camera` 矩阵已更新（`updateProjectionMatrix` 后投影无异常）。
- **预期**：缺省 ±5 证实"48×48 地图阴影截断"根因；设 40 后 frustum 覆盖 80×80 ⊇ 地图。

### TC-S2 shadowMapSize 生效时机 【P0】

- **步骤**：① 首帧渲染前设 `shadowMapSize: 2048`，断言 `shadow.mapSize.x === 2048`；② 首帧渲染**后**再改 1024，断言实现已对旧 `shadow.map` 执行 dispose（下一帧生效）。
- **预期**：两条路径均生效，运行中改不产生"改了没反应"。

### TC-S3 bias/normalBias/radius 透传 【P0】

- **步骤**：LightComponent 设 `shadowBias: -0.0005, shadowNormalBias: 0.02, shadowRadius: 3`。
- **预期**：`light.shadow.bias/normalBias/radius` 逐值相等。

### TC-S4 light.target 显式化 + 全场景目检 【P0】

- **步骤**：① 单测：挂 LightComponent 后 `owner.root` 子树包含 `light.target`，EndPlay 后移除；② 编辑器打开 fish_level1 / fish_base / FishMenu / beach_house 蓝图预览，目检光照方向与改造前一致（KeyLight @ [15,25,10] 照向原点）。
- **预期**：target 挂树且随 Actor；既有场景光照无视觉回归。

### TC-S5 资产链路贯通 【P0】

- **步骤**：fish_level1 KeyLight properties 写入 `"shadowExtent": 40, "shadowMapSize": 2048`，走 SceneLoader 加载；对 `componentChecker` 分别喂合法/非法值（`shadowExtent: "big"`、`shadowMapSize: 999`）。
- **预期**：运行时 `light.shadow.camera.right === 40`；lint 对非法类型报错、对未知字段按现行容错规则。

## 三、P1：ShadowBlobComponent

### TC-S6 跟随与参数 【P0】

- **步骤**：Actor 挂 ShadowBlobComponent（radius 1.5, opacity 0.35），移动 Actor 位移；改 radius/opacity。
- **预期**：blob mesh 为 owner.root 子节点随动（零每帧代码）；`mesh.scale` 与材质 opacity 同步；EndPlay 后 blob 移除、材质 clone 已 dispose、共享贴图/几何仍存活。

### TC-S7 双朝向贴地 【P0】

- **步骤**：① ClashMaster 场景（XZ 地面）缺省 `normal:[0,1,0]`；② FishMenu 场景（XY 世界）设 `normal:[0,0,1]`。
- **预期**：两种朝向下 blob 均平贴地面（法线朝向断言 + 视口感官），offset 沿法线抬升。

### TC-S8 排序与 z-fight 【P1】

- **步骤**：blob 与地面共面附近（offset 0.02），相机拉远/拉近扫过；blob 与单位 sprite 重叠区域观察。
- **预期**：无 z-fighting 条纹；blob 永远绘制在地面之上、单位之下（`depthWrite:false` + renderOrder），单位脚下暗斑不被 sprite 切穿。

## 四、P2：性能与打磨

### TC-S9 帧率基线矩阵 【P2】

- **步骤**：同场景分别以 ① 真阴影（2048 directional）② 全单位 blob ③ 双开 ④ 全关，各跑 100 单位战斗 30s 采样平均帧率（dev server :5173 + e2e 现有实例属性桩模式）。
- **预期**：数据落档本文件；blob 单轨相对全关帧耗 ≤5%、真阴影单轨 ≤15%（超出则触发 P2 降级策略评审：mapSize 降档/关投影）。

### TC-S10 lint：basic 材质 + receiveShadow 警告 【P2】

- **步骤**：构造 `kind:"basic"` 且 `receiveShadow:true` 的场景资产喂 assetLint。
- **预期**：warn"basic 材质不接收阴影"，不 block 编译。

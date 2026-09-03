# 方案：场景阴影（Shadow Mapping 参数补全 + Blob 假阴影双轨）

> 状态：方案草案 v1（2026-09-04）｜ 验收用例：[test-cases.md](./test-cases.md)
> 关联：`doc/engine/rendering_system.md`、`doc/engine/entity_system.md`（组件注册）、`doc-dev/ui-world-space/plan.md`（互不阻塞）

---

## 一、目标与非目标

**目标**：让场景（以 fish/ClashMaster 为主战场）出现阴影，覆盖两类真实需求：

1. **真阴影（Shadow Mapping）**：建筑/地形在阳光方向下投射动态阴影——现有资产链已就位（见 §2.1），只差引擎参数暴露，属于"补全"而非"新建"。
2. **Blob 假阴影**：单位/兵种脚下的贴地椭圆暗斑——unlit 材质场景（FishMenu 等）、性能敏感的单位群、卡通风格控制的通用手段。

**非目标**：
- 不做全场景 unlit→lit 材质体系迁移（FishMenu 现有平涂色块风格不动，牵一发动全身的调色专项不立项）；
- 不做 planar projection 投影 shader（见 D5 否决）；
- 不做多级 shadow cascade / CSM（俯视角 RTS 单级 shadow map 足够，见 D5）；
- 不做烘焙光照贴图（场景布局会变，收益不成立）。

## 二、现状链路（2026-09-04 实测）

### 2.1 已经就位的部分（阴影"半套基础设施"）

| 环节 | 现状 | 位置 |
|---|---|---|
| 渲染器 | 4 处 WebGLRenderer 全部 `shadowMap.enabled + PCFSoftShadowMap` | `SceneViewport.ts:205`、`ScenePreviewManager.ts:122`、`BlueprintPreviewManager.ts:130`、`SceneRendererComponent.ts:142` |
| 灯光组件 | `LightComponent` 支持 5 种灯 + `castShadow`，已注册内置组件，Inspector 可编辑 | `rendering/LightComponent.ts:32,88`、`tools/registerBuiltinComponents.ts:563` |
| mesh 阴影标记 | SceneLoader 资产路径默认 `castShadow/receiveShadow = true`，schema/lint 有字段 | `asset/SceneLoader.ts:227-228`、`asset/SceneAsset.ts:31-32`、`assetLint/checkers/componentChecker.ts:174` |
| **fish 战斗场景灯光** | **已声明** KeyLight（directional, castShadow: **true**, @ [15,25,10], intensity 1.2）+ AmbientLight(0.7)，BattleGround 为 48×48 **standard** 材质 | `fish/asset/fish_level1.scene.json` |

### 2.2 三个缺口（为什么现在看不见阴影）

1. **引擎缺口（直接根因）**：`LightComponent` 只暴露 `castShadow` 布尔，未暴露任何 `light.shadow.*` 参数。three r170 的 DirectionalLight shadow camera 默认正交范围 **±5**、mapSize **512²**——fish 地图 48×48，阴影被整体截断到原点附近一小块，等于不可见。
2. **材质两态**：接收阴影要求受光材质。SceneLoader 资产路径默认 `MeshStandardMaterial`（`SceneLoader.ts:207-220`，可接收✓）；但**代码侧组件默认全是 `MeshBasicMaterial`**（`BoxMeshComponent.ts:68` 等，unlit，`receiveShadow` 无效）；`SpriteComponent` 也是 Basic（`SpriteComponent.ts:38`，能投影✗不接收）。FishMenu 场景 mesh 全部 `kind:"basic"`。
3. **场景朝向二态**：FishMenu 是 XY 平面世界（Z 为深度，地面 plane_1 @ z=-3）；ClashMaster 是 XZ 地面（Y 向上，Townhall @ [0,0,-8]）。任何"贴地"逻辑（blob 影）不能写死轴向。

### 2.3 隐坑备忘（现状已存在，方案需一并规整）

- `DirectionalLight.target` 默认是不在场景树上的 Object3D（世界原点、matrixWorld 恒单位阵）。fish KeyLight 恰好想照向原点所以"碰巧能工作"；shadow camera 的朝向依赖 light→target 连线，一旦灯光不在原点对侧或需要偏移目标就出错。**LightComponent 应显式创建 target 并 add 进 owner.root。**

## 三、核心架构决策

### D1：双轨总路线——真阴影补全为主（P0），blob 为辅（P1）

判断依据：ClashMaster 场景的灯、地面材质、castShadow 标记**全部已在资产里**，真阴影离"能用"只差 shadow camera 参数暴露——这是全方案性价比最高的一步，先做先见效。blob 服务的是真阴影覆盖不了的区域（unlit 场景、单位群、风格化）。两轨独立交付、互不依赖。

### D2：LightComponent 补阴影参数（P0 核心）

新增 options + getter/setter + Inspector + 资产 schema + lint 五处同步：

| 参数 | 类型/缺省 | 落点 |
|---|---|---|
| `shadowExtent` | number，缺省 0 = 不改（保持 three 默认 ±5） | directional/spot：`shadow.camera.left/right/top/bottom = ±extent` + `updateProjectionMatrix()` |
| `shadowMapSize` | number（512/1024/2048），缺省不改 | `shadow.mapSize.set(n,n)`（**须在首帧渲染前设置**，运行中改需 `shadow.map.dispose()`） |
| `shadowBias` / `shadowNormalBias` | number，缺省不改 | 防痤疮/漏光的基本旋钮 |
| `shadowRadius` | number，缺省不改 | PCF 软硬程度 |

同步链：`LightComponentOptions`（`LightComponent.ts:24`）→ `getEditableProperties()`（:158，加 number 输入）→ `SceneAsset.ts` LightComponent properties 声明 → `componentChecker.ts:174` 字段校验 → `registerBuiltinComponents.ts:563` 工厂透传。

**light.target 规整**：LightComponent 构造时创建 `light.target` 并 `owner.root.add(light.target)`（跟随 Actor 移动，语义=灯光 Actor 照向自身锚点方向，EndPlay 一并移除）。

**fish 落地**：`fish_level1.scene.json` 的 KeyLight properties 加 `"shadowExtent": 40, "shadowMapSize": 2048`——真阴影立即可见，零代码改动。

### D3：ShadowBlobComponent（P1，引擎渲染域新组件）

`src/engine/rendering/ShadowBlobComponent.ts`，挂在单位/建筑 Actor 上，构造一个贴地半透明椭圆 mesh：

- **贴图零资产依赖**：模块级懒加载单例——256² canvas 程序化径向渐变（中心 rgba(0,0,0,α) → 边缘全透明），CanvasTexture；与 `SpriteComponent.getSharedGeo()` 同模式（`SpriteComponent.ts` 共享几何惯例）。
- **几何/材质**：共享 `PlaneGeometry(1,1)`；材质 per-instance clone（透明贴图共享、`opacity` 独立），`transparent + depthWrite:false`，renderOrder 高于地面——避免 z-fight 与排序错乱。
- **贴地语义（对应 §2.2 缺口 3）**：options `normal: [x,y,z]`（局部贴地法线，缺省 `[0,1,0]` 即 XZ 地面；FishMenu 用 `[0,0,1]`）、`offset`（沿法线抬升，缺省 0.02，防与地面 z-fighting）、`radius`（缩放 mesh）、`opacity`（缺省 0.35）。
- **跟随免费**：blob mesh 挂 `owner.root` 子节点，位移/旋转随 Actor，零每帧成本；`EndPlay` 只 dispose 材质 clone（几何/贴图单例共享不释放）。
- **接线**：`registerBuiltinComponents.ts` 注册（资产可声明）+ `componentChecker` 字段校验 + Inspector（radius/opacity/normal）。
- **性能底线**：普通 mesh 方案支撑数百单位无压力（每 blob 1 draw call，透明合批不合并但顶点极小）；单位上千再评估 InstancedMesh，本期不做。

### D4：材质两态的现实约束（文档化 + lint 兜底）

真阴影接收面必须受光材质——这条规则今天只在 SceneLoader 默认值里"隐式成立"。落地两条：

1. 渲染系统文档明示一张对照表：Basic（投影✓/接收✗）、Standard（✓/✓）、接收面必须 standard/lambert；
2. assetLint 加一条 warn：`material.kind:"basic"` 且 `receiveShadow:true` → "basic 材质不接收阴影"（防"设了字段没效果"类工单）。

### D5：否决路线（明确记录）

- **Planar projection 阴影**（自定义把 mesh 压平到地面平面的 shader）：无内置支持，工作量 ≈ 维护一套自定义材质管线，收益被 blob（更便宜）与 shadow map（更真实）两面夹死，否决。
- **CSM/多级阴影**：俯视角固定主光场景，单张 2048 directional 覆盖 100×100 世界绰绰有余，CSM 的复杂度（分割、 blending、跨级抖动）无对应收益，否决。
- **全场景 unlit→lit 强推**：FishMenu 的平涂色块是既定美术风格，换受光材质等于重调全场景配色，且 Basic→Standard 有实际性能增量，另立专项才可议，本方案不做。

## 四、落地顺序

| 阶段 | 内容 | 交付判据 |
|---|---|---|
| **P0 真阴影补全** | LightComponent 五参数 + target 规整 + schema/lint/Inspector 同步；fish_level1 KeyLight 加 `shadowExtent:40, shadowMapSize:2048` | test-cases TC-S1~S4 全绿：ClashMaster 里建筑在地面出现动态阴影、大地图无截断 |
| **P1 Blob 假阴影** | ShadowBlobComponent + 注册/lint/Inspector；FishMenu 试点（sprite 脚下 `normal:[0,0,1]` blob） | TC-S5~S7 全绿：blob 跟随移动、双朝向贴地正确、无 z-fight 条纹 |
| **P2 打磨（按需）** | 性能矩阵（单位群真阴影 vs blob 帧率对照）、basic+receiveShadow lint warn、移动端降级策略（mapSize 档位/关投影） | TC-S8 基线数据落档 |

P0 与 P1 无依赖可并行；P2 依赖 P0/P1 交付后实测。

## 五、风险与对策

- **shadow map 每帧 depth pass 成本**：只允许主光投影（Ambient/Hemisphere 本就无投影）；fish 单位会动，`shadow.autoUpdate=false` 不适用，不改；低端机走 P2 的 mapSize 档位降级。
- **shadow map 运行中改 mapSize 无效**：`mapSize` 必须在首帧前或伴随 `shadow.map.dispose()` 生效——Inspector 编辑路径要处理（dispose 触发重建），单测覆盖。
- **blob 重叠加深与渐变色带**：多单位扎堆处暗斑叠加变黑（COC 同款，先接受）；8bit alpha 渐变在深色地面上可能出现色带，必要时贴图加 dither，P1 先观察。
- **双朝向心智成本**：`normal` 参数与两个场景朝向的对应关系写进组件 doc 注释与渲染文档，避免"blob 立起来了"类误用。
- **light.target 规整的行为变更**：此前依赖"target 隐式在原点"的场景（若有）在 target 显式化后光照方向可能变化——改造后全场景过一遍编辑器视口目检（test-cases TC-S4 的一部分）。

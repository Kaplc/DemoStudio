# 方案：钢铁雄心4（HOI4）类大战略游戏在 DemoStudio 落地

> 状态：调研 + 方案草案 v1（2026-09-05）｜ 验收用例：[test-cases.md](./test-cases.md)
> 关联：`doc/projects/gameplay_code_standard.md`、`doc/engine/ui/`、`doc/editor/ui/ui_widget_html_manual.md`、`doc/dev/external_project_roots.md`

---

## 一、调研：HOI4 系统拆解

### 1.1 游戏形态

钢铁雄心4（Paradox, 2016）是 WWII 题材**大战略游戏**：玩家以国家为单位，在一张按省份切分的地图上，通过"经济→军备→战争"循环推进。核心特征：

- **时间驱动**：暂停 + 5 档变速，模拟以**游戏小时**为最小步进，日/月滚动结算；
- **地图即棋盘**：数千个省份（陆地/海洋），组成为州（state）、战略区域；地图模式（政治/地形/补给等）实时重染色；
- **面板密集型 UI**：顶栏常驻 + 十余个全屏/半屏面板（生产、科研、国策树、外交、编制设计……）+ 地图上的单位计数器（NATO 符号）；
- **数据驱动内容**：国家、国策树、科技、装备、事件全部是可配置数据（原作即如此，mod 社区规模巨大）。

核心循环：`民用工厂建造/贸易 → 军工厂生产线造装备 → 人力+装备部署成师 → 师沿省份移动/进攻 → 战斗消耗组织度和装备 → 占领带来胜利点 → 和平会议分赃`。

### 1.2 系统清单（按重要性排序）

| # | 系统 | 机制要点（参考值） |
|---|------|------|
| 1 | **时间** | 1936-1-1 起，小时 tick；暂停+5 速；日结算（政治点、建造、国策进度）、时结算（战斗、移动、组织度恢复） |
| 2 | **地图** | 省份多边形 + 地形类型（平原/森林/山地/城市…）；州含人口、胜利点、建筑位；地图模式重染色；边界线 |
| 3 | **国家内政** | 政治点（约 +2/天）、稳定度/战争支持度、征兵法/经济法/贸易法、顾问/民族精神 |
| 4 | **国策树（Focus）** | 每国一棵树，单国策 70 天；前置/互斥分支；效果：民族精神、科研加成、战争借口、工厂、事件 |
| 5 | **科研** | 多槽位并行，固定天数+提前惩罚；加成卡抵扣；陆军学说等长线分支 |
| 6 | **生产建造** | 民厂建造（建筑队列、单项目上限 15 厂）、军厂生产线（产出效率随时间爬升）、6 种资源（钢/铝/油/钨/铬/橡胶）、缺资源降产出 |
| 7 | **陆军** | 师 = 编制模板（1–25 营 + 支援连）；属性：组织度/血量/软硬攻/突破/防御/装甲/穿透/宽度；培训度；将军（24 师/军长 5 军）加成 |
| 8 | **陆战** | 按省开战、按小时结算；战斗宽度（基础 90，多方向进攻加宽，自调参数）；攻方突破 vs 守方防御，溢出转组织度/血量伤害；地形/堑壕/计划/补给修正 |
| 9 | **补给** | 补给中心+铁路+摩托化（NSB 后）；断补给：攻防/组织恢复惩罚、损耗 |
| 10 | **外交** | 阵营、制造战争借口（天数）、保证独立、租借、志愿队；世界紧张度 |
| 11 | **事件/决议** | 条件触发弹窗（图+选项）、决议列表；国策/外交大量复用此通道 |
| 12 | **和平会议** | 胜利点计分→吞并/傀儡/放 satellites |
| 13 | **AI 国家** | 内政/科研/生产/国策/前线分配/外交一组带权重的决策器 |
| 14 | **海/空军** | 空域任务+空优对陆战加成；舰队/船设计/海侵。**体量大，建议裁剪（见 §3）** |
| 15 | **情报/抵抗/占领** | 情报机构、驻军/顺从度。**裁剪** |

### 1.3 与 DemoStudio 的能力映射

引擎摸底结论（2026-09-05，详见各文件路径）：**框架层几乎全中，缺口集中在"地图、时间、AI"三件新事**。

| HOI4 需求 | DemoStudio 现状 | 结论 |
|---|---|---|
| 工程骨架 | 双根：内置 `src/projects/<name>`（fish 样板）+ 外部根 `projects/<name>`（hello 样板，`d44ae0a` 已实施）；ProjectModule 契约同构 | ✅ **定案走外部根 `projects/hoi4`**（见 D1） |
| 数据驱动（国家/科技/装备/国策…） | 配置表 `*.config.json`/`*.table.json`，自由 JSON + transform + 热重载（`ConfigRegistry`） | ✅ 直接用；大表加载后自行建索引（`find/filter` 是线性扫描） |
| 面板 UI（顶栏/生产/科研/国策树） | HTML 源→widget 编译器 + UIText/UIImage/Button/Layout/Mask/ScrollList（对象池+虚拟化）/ProgressBar/Tooltip，`data-script` 绑定行为，模态 `hitTest:'block'` | ✅ 强项，正是这套 UI 的舒适区 |
| 地图上的省名/单位标记 | `UIWorldAnchorComponent`（world/screen 双模式，`spawnAnchoredWidget`） | ✅ 直接用 |
| RTS 地图相机 | `CameraRigComponent`：滚轮缩放(min/max)/平移(边界)/屏幕边缘平移 | ✅ 直接用 |
| 地图点击选省 | `PhySys.screenToRay` + 平面求交（fish 同款）；UI 层射线优先 | ✅ 但见 D2：改用**省份 ID 贴图查表**更稳 |
| 时间系统（暂停+5 速+小时 tick） | 只有 rAF dt 和 GameState 阶段；fish 是墙钟计时（不可暂停） | ⚠️ **需新建** GameTime（D3） |
| 省份地图渲染/地图模式 | 无 RTT、无 shader 辅助；但 `CanvasUIComponent` 的 Canvas2D→CanvasTexture 增量重绘已验证可用 | ⚠️ **需新建** MapRenderer（D2，Canvas 方案） |
| 省份图寻路 | `NavGrid`/`AStar` 是栅格版，不适用 | ⚠️ 邻接表 + A*，逻辑量小，自写 |
| 战斗解算 | 无（fish 战斗为回合制塔防形态，不可复用） | ⚠️ 自写，纯函数化（可单测） |
| 国家 AI | `AIModule`/AgentPanel 是**编辑器的 AI 助手**，与游戏 AI 无关 | ⚠️ 自写带权重决策器 |
| 存档 | `SaveSlotComponent` KV + 显式 flush，fish 有 `data/save.json` 实例 | ✅ 直接用（整局状态整理成 ~10 个 KV 键） |
| 本地化 | 无 i18n | ⚠️ 表内直接中文（fish 同款），字段留 `name`/`name_en` |
| 音频 | 引擎无音频 | ❌ 本期不做 |
| 调试/测试 | GM 控制台（`*.gm.ts` 自动注册）、debug bridge、vitest、Playwright e2e、ui-snapshot golden | ✅ 直接用 |

---

## 二、范围裁剪

**目标**：做出 HOI4 的"可玩核心循环"demo——选国家、攒经济、造装备、部署师、在地图上推进战线、触发事件、打赢后简单分赃。**引擎层（时间/地图/战斗框架）做成可复用能力，内容层（一棵国策树、十几个国家）点到为止。**

**非目标（本期明确不做）**：
- 海军（船设计/舰队/海侵/运输船）、空军全程（最多保留"空优 buff"一个修正位）；
- 情报机构、抵抗/占领深度、租借/志愿队细节；
- 与原作数值/内容的 1:1 复刻；**红线：不导入任何原游戏资产/数据文件（版权），所有内容自制**；
- 多人联机、音频、本地化体系。

**内容规模（demo 量级）**：1 张自制简化区域地图（约 200–400 省、40–60 州），8–12 个国家（1 个玩家国 + 若干 AI），1 棵通用国策树 + 玩家国专属分支，步兵/装甲约 10 种营、6–8 种支援连、约 40 项科技、20+ 事件。

---

## 三、核心架构决策

### D1：新工程 `projects/hoi4`（外部工程根目录）

**定案（2026-09-05 用户拍板）**：工程建在仓库根 `projects/hoi4`（外部工程根），不是 `src/projects/` 内置轨。依据：外部根支持已实施并验证（`d44ae0a`，`doc/dev/external_project_roots.md`），`projects/hello` 是最小样板——`register.ts` 与内置工程共用同一套 `ProjectModule` 契约，经 `import.meta.glob('/projects/*/register.ts')` 自动并入注册表，工程发现/资产链/assetLint/类型检查双根兼容。价值：demo 全程不污染内置案例库，且随手魔改 fish 复制件的工作流一致。

```text
projects/hoi4/                   # 外部工程根（样版对照 projects/hello）
  project.json                   # { name, renderMode:"2d", main:"projects/hoi4/index.ts",
                                 #   defaultScene:"projects/hoi4/asset/map/map.scene.json" }
  register.ts                    # ProjectModule：GameMode + GM 命令（照抄 hello 契约）
  index.ts                       # Hoi4GameInstance
  asset/
    map/                         # ★ 地图资产：provinces.png(ID图)、terrain.png、map.json(省/州元数据+邻接表)
    config/                      # countries/states/terrains/buildings/resources/techs/equipments/
                                 # battalion_types/support_types/division_templates/focuses/events/laws/country_ai
    blueprints/ui/               # 全部面板 widget（见 D7 清单）
  gameplay/
    core/                        # ★ 纯逻辑核心：不 import THREE，可 vitest
      GameTime.ts  ProvinceGraph.ts  CountryState.ts  Economy.ts
      Production.ts  Combat.ts  FocusSystem.ts  TechSystem.ts
      EventSystem.ts  Diplomacy.ts  CountryAI.ts  Hoi4State.ts(整局状态+序列化)
    map/                         # MapRenderer(Canvas纹理)  MapInput(选省/框选)  UnitCounters
    base/                        # Hoi4GameMode  *.script.ts(UI行为)
  data/                          # 存档（.gitignore 已有 projects/*/data/ 规则）
  devdocs/
```

**外部根的既有约束（直接接受，非阻塞）**：
- 新增工程后需重启 dev server（eager glob）；`create-project` 流程本身会触发刷新。
- `project.json` 的 `main`/`defaultScene` 用 `projects/hoi4/...` 全路径（对照 hello）。
- tsconfig include 已含 `"projects"`（tsc 全量覆盖）；`.gitignore` 已有 `projects/*/data/`。
- Mock 浏览器调试模式走双前缀路径翻译（已实现）；外部工程 assetLint 按 folder 定位天然兼容。
- **P0 首个验证项**：在外部根跑通第一个 widget 的 `ui_compile` + 资产预览 + 游戏内 spawnUIActor 全链路（MCP/ui-compiler 脚本的路径前缀适配已随 `d44ae0a` 落地，但 fish 全在 `src/projects/`，外部根 widget 链路尚无实战案例，先证后量）。

**分层铁律**：`gameplay/core/` 纯 TS、确定性（传入 dt 与随机种子）、零渲染依赖；地图/UI 只是 core 的视图。战斗解算、经济结算因此全部可单测（fish 的 battle 桥 + vitest 双保险）。

### D2：地图 = 单平面 + Canvas2D 分层纹理 + 省份 ID 图拾取

HOI4 式地图的本质是"可重染色的行政区划图"，不需要真 3D。方案：

- **数据**：`map.json` 存省/州元数据（中心点、邻接、地形、VP、建筑位）；**省份 ID 图**（每个省一种颜色，颜色值=省 id 编码）+ 地形图两张 PNG。
- **渲染**：一个 `PlaneMesh`，纹理来自离屏 Canvas（8192×4096 上限，CanvasTexture）。三层 canvas：地形底图 / 政治色图 / 边界线图，地图模式切换=按省重刷政治层（建省→像素索引表，重染 O(改动省数) 而非全图）。
- **拾取**：屏幕→地图 UV（相机矩阵反算），查 ID 图 `ImageData`（启动时读入内存一次）得省 id。不依赖 raycast/物理，零精度问题。
- **单位计数器**：省级聚合，`UIWorldAnchorComponent`（screen 模式）挂在省中心点，NATO 符号用小 widget 或 `CanvasUIComponent` 绘制；省名标签画进独立 canvas 层（**不用** troika 逐省建 mesh，数千文本会爆 draw call/内存）。
- 备选（否决记录）：GPU shader 染色 + RTT——引擎无 shader 辅助/RTT 先例，为 demo 引入自定义 shader 管线不值；先 Canvas，性能不足再升级。

### D3：GameTime——暂停 + 5 速的小时步进器

```ts
// gameplay/core/GameTime.ts（示意）
// speedLevels: 每现实秒推进的游戏小时数 = [1, 2, 4, 8, 16]，暂停 = 0
class GameTime {
  hour = 0;                      // 距 1936-1-1 00:00 的整小时数
  speed = 1; paused = true;
  advance(realDt: number, onHour: () => void, onDay: () => void) {
    if (this.paused) return;
    this.acc += realDt * SPEEDS[this.speed];
    while (this.acc >= 1) { this.acc -= 1; this.hour++; onHour(); if (this.hour % 24 === 0) onDay(); }
  }
  // 序列化：hour + speed 即可（确定性重放的基础）
}
```

- 驱动点：`Hoi4GameMode.Tick(dt)`（fish 的 `GameInstance.tick` 同款位置），**禁止** `Date.now()` 式墙钟计时（fish 生产计时器的教训）。
- 结算频率分层：时结算（战斗/移动/组织恢复）、日结算（PP/建造/国策/科研推进、AI 深思）、月结算（稳定度漂移等）。AI 按国家错峰（`hour % n === countryIdx`），避免同帧全量。

### D4：战斗解算 = 每战一实例，纯函数推进

- 开战条件：师下达进入敌省命令 → 若省内有敌师 → 创建 `Battle`（攻守双方师列表、省地形、时长）。
- 每小时：`width = 基础90 + 每额外进攻方向 +30`（配置化）；双方按宽度上限投入师；`攻击 = Σ软攻×(1-敌硬度) + 硬攻×敌硬度`，对比守方 `防御×修正`、攻方 `突破×修正`，溢出部分按系数转为守方组织度伤害，组织度按小比例转血量/装备损失；组织度先归零一方撤退。
- 修正表统一为一个 `Modifiers` 结构：地形、堑壕（每小时+，上限可配）、将军技能、计划加成、补给、空优（预留位）。
- 全部在 `core/Combat.ts` 纯函数；数值全走 `combat_params.config.json`（宽度/伤害系数/堑壕上限等），方便 GM 台调参对拍。

### D5：数据资产设计（配置表清单与关键形态）

| 表 | 形态 | 要点 |
|---|---|---|
| `countries.table.json` | 行=国家 | 意识形态、颜色、首都省、初始 PP/稳定/战争支持、AI 权重 |
| `map.json` + `states.table.json` | 省=ID 图颜色；州=行 | 省：邻接表、地形、中心点、海岸标记；州：人口/VP/建筑位/所属国 |
| `focuses.table.json` | 行=国策 | `days:70, prereq[], mutually_exclusive[], effects[], ai_will_do`——效果用小型效果 DSL（`{type:'pp', amount:120}` / `{type:'research_bonus', tag:'land_doctrine', ...}`），core 内解释执行 |
| `techs.table.json` | 行=科技 | 分类、天数、前置、效果（装备解锁/加成） |
| `equipments` / `battalion_types` / `support_types` / `division_templates` | 表 | 营=造价/属性/宽度；模板=营数组（师设计器的数据源） |
| `buildings.config.json` / `terrains.config.json` / `laws.config.json` / `resources.config.json` | 单例 | 建造时长/槽位、地形修正、法律阶梯 |
| `events.table.json` | 行=事件 | `trigger{...} options[{effects}]`，弹窗 UI 通用化 |
| `combat_params.config.json` / `ai_weights.config.json` | 单例 | **所有调参出口**，GM/对拍用 |

本地化：不建 i18n 体系，表内 `name` 直接中文（fish 同款）。

### D6：AI 国家 = 每日一思考的带权重决策器

单文件 `CountryAI.ts`，策略按优先级排队（focus 选择→科研→生产配比→建造→师部署→前线分配→宣战门槛），全部查 `ai_weights.config.json`。不追求原作水平，追求"会玩、不犯法（不卡死）"。前线分配 MVP：边境省放防守师，兵力优势省发起进攻；**不做** battle plan 绘制。

### D7：UI 资产清单（widget 全部 HTML 源 + `data-script` 绑定 core）

| Widget | 内容 | 控件要点 |
|---|---|---|
| `topbar` | 日期/速度/暂停、PP、人力、三厂计数、稳定/战争支持 | 常驻，speed 按钮组 |
| `province_panel` | 点省侧栏：地形/VP/建筑位/该省师 | 世界锚定（screen 模式跟随省中心） |
| `construction` / `production` / `research` / `focus_tree` / `diplomacy` / `recruit_deploy` / `laws` / `decisions` | 全屏面板 | ScrollList 列表 + QueueProgressBar；国策树 = 绝对定位节点 + 分支连线（连线用线段 mesh 或节点内箭头，见风险 R3） |
| `division_designer` | 编制设计 | 拖拽 MVP：点击加减营 |
| `event_popup` | 事件弹窗 | 模态 `hitTest:'block'`（fish `uiModalOpen` 同款） |
| `battle_popup` | 战斗面板 | 双方进度条（组织度条） |
| `unit_counter` / `province_label` | 地图计数器/省名 | world-anchored；省名进 canvas 层 |

---

## 四、分期实施计划

> 原则：每期结束都是"可启动、可演示"的状态；期数只是顺序，P0–P2 是硬骨头。

| 期 | 内容 | 验收 |
|---|---|---|
| **P0 地图与时间**（骨架期） | 外部根工程骨架（projects/hoi4，含最小竖切验证：widget ui_compile→lint→预览→游戏内 spawn 全链）、GameTime、地图渲染（地形+政治两模式）、选省（ID 图拾取）、顶栏、省面板、相机接入 | 能打开地图、选国选省、看到政治色随开局数据渲染、时间可暂停/变速流动、省面板数据正确 |
| **P1 内政经济** | 建造队列、军厂生产线+效率爬坡、资源、贸易法/经济法（简化）、法律切换 PP 消耗；`construction`/`production`/`laws` 三面板 | 挂机一个月：能造出建筑、装备有库存、缺资源会降产出，数值与配置表一致 |
| **P2 军事** | 师模板+编制设计器、训练部署（人力/装备扣减）、师移动（邻接 A*、逐省行军）、陆战解算、堑壕/补给惩罚（补给 MVP：首都辐射距离）、战斗面板、单位计数器 | 能部署一个师、平推无主之地、对 AI 省开战打一场完整战斗并占领；战斗数值可由 GM 台对拍 |
| **P3 内容层** | 通用+专属国策树、科研、事件/决议、外交 MVP（阵营/借口/宣战）、国策树与外交面板 | 一局能从 1936 走到 1938：国策在跑、科技在研、事件在弹、能找借口开战 |
| **P4 AI 与闭环** | CountryAI 全量、和平会议简化版（VP 占领→吞并/傀儡）、胜败判定、存档读档全量接入 | 8 国局：AI 国家会内政会打仗；玩家投降/获胜都能走完和平流程；存档-读档往返无损 |
| **P5 打磨** | 地图模式扩展（地形/补给/资源）、tooltip 全面化、性能优化、平衡性调参 | e2e 全绿、1 分钟 5 速不卡帧（预算见 §5） |

工程量粗估：P0≈2–3 周，P1≈2 周，P2≈3–4 周，P3≈3 周，P4≈3 周（单人；AI 辅助下可显著压缩，量级供排期参考）。

---

## 五、风险与验证

| # | 风险 | 对策 |
|---|---|---|
| R1 | 省份重染色/边界重绘的实时成本 | 省→像素索引预计算，只刷脏省；边界层按州批量重绘；纹理上限 8192²，超出则降地图密度 |
| R2 | 大表线性扫描（邻接查询在战斗/寻路里高频） | 载入时一次性建 `Map<id, row>` 与邻接 `Map<id, Set<id>>`（fish 已验证该模式） |
| R3 | 国策树连线的绘制（widget 无画线控件） | MVP 用绝对定位节点+CSS 三角/短横（编译器子集内）；不够再上 `CanvasUIComponent` 整树绘制（P3 决策点） |
| R4 | UI 文本量（面板+地图标签） | 地图标签进 canvas 层（不建 troika mesh）；面板文本正常走 UIText，ScrollList 虚拟化兜底 |
| R5 | 墙钟混入导致暂停失效 | 硬性规范：core/ 内禁 `Date.now/performance.now`，code review + lint 关注；计时一律过 GameTime |
| R6 | 战斗/经济数值难调 | 全参数走 `combat_params`/`ai_weights` 配置 + GM 台实时改+热重载；纯函数对拍脚本 |
| R7 | 版权红线 | 只参考机制与公开 wiki 数值概念，所有文本/美术/数据文件原创；不反编译原游戏 |
| R8 | 外部根（projects/hoi4）资产链无实战先例——widget 编译/预览/游戏启动全在 `src/projects/` 内置轨验证过 | P0 首周先跑最小竖切（空地图场景 + 1 个 widget 的 ui_compile→lint→预览→spawnUIActor 全链）再铺开内容；新增工程后记得重启 dev server |

**测试策略**（与引擎既有设施对齐）：
- **vitest**：`core/` 全量——GameTime 步进/暂停、A* 最短路、战斗解算（给定输入断言组织度曲线）、经济月结、存档序列化往返；
- **GM 台**：`hoi4.speed/tick(24h)/war(a,b)/add_pp/give_equipment/occupy(prov)`，`stepTicks(n)` 同款单步驱动（FishGameInstance 有先例）；
- **Playwright e2e**：启动→选国→3 速挂机 1 游戏月→开面板→部署→宣战→战斗弹窗出现（`tests/e2e/hoi4/`）；
- **ui-snapshot**：各面板 golden 截图回归。

---

## 六、参考来源

- [HOI4 Wikipedia（游戏形态）](https://en.wikipedia.org/wiki/Hearts_of_Iron_IV)
- [Paradox Wiki: Production](https://hoi4.paradoxwikis.com/Production)（民厂产出 4→5、军厂 3.5→4.5 等参考值）
- [Paradox Wiki: National focus](https://hoi4.paradoxwikis.com/National_focus)（70 天/前置/互斥/效果模型）
- [Paradox Wiki: Land battle](https://hoi4.paradoxwikis.com/Land_battle) / [Land units](https://hoi4.paradoxwikis.com/Land_units)（1–25 营、宽度/组织度模型）
- 注：wiki 站有反爬拦截，以上数值为搜索摘要+通识，方案内一律按"自调参数"落地，不承诺与原作逐值一致。

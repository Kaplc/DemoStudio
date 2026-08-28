---
name: skl-create-config-asset
description: '创建 DemoStudio 配置表资产（asset/config/*.config.json 单例配置 与 *.table.json 数据表）。使用时机：用户要求新建/编辑配置文件，如 "写鱼种配置"、"加一个炮台等级表"、"新建 troop 数据表"、"配置数值调整"。规则与 ConfigRegistry/DataTable 加载机制及项目 ConfigLoader 注册流程一致（半自动：路径由 glob 推导，transform/默认值手动）。'
argument-hint: '配置表名称或用途描述'
---

# 创建配置表资产（*.config.json / *.table.json）

## 何时使用
- 用户要求新建配置资产文件（`asset/config/` 下的 `.config.json` 或 `.table.json`）
- 修改现有配置的数值/条目（鱼种、炮台等级、Boss、兵种表等）
- 与场景/蓝图资产不同：配置表**不走 AssetRegistry 自动注册**，但由 `asset/config/index.ts` 的 glob **半自动注册**（路径/name 自动推导，默认值与 transform 手动）

## 两种配置形态（由 ConfigRegistry 统一加载）

| 形态 | 后缀 | 结构 | 加载 API | 读取 API |
|------|------|------|----------|----------|
| 单例配置 | `*.config.json` | 一份整体配置对象 | `loadConfig<T>(name, path, transform?)` | `getConfig<T>(name)`（必返回） |
| 数据表 | `*.table.json` | UE 风格键值行表 `{ "行名": 行数据 }` | `loadTable<Row>(name, path, transform?)` | `getTable<Row>(name)`（可能 undefined） |

## 文件位置与命名
- 路径：`src/projects/<project>/asset/config/<描述>.config.json` 或 `<描述>.table.json`
- 阶段独用配置可放 `gameplay/{mode}/config/`（如 `gameplay/game/config/`）
- 示例：`cannon.config.json`、`fish.config.json`、`boss.config.json`、`school.config.json`、`troop.table.json`
- 配置名由文件名推导：`{project}.{文件名}`（`cannon.config.json` → `fish.cannon`）

## ⚠️ 关键约定

1. **半自动注册（新增文件无需改 ConfigLoader）**：`asset/config/index.ts` 用 `import.meta.glob` 自动扫描所有 `.config.json` / `.table.json`，配置名与加载路径自动推导：
   ```typescript
   // src/projects/<project>/asset/config/index.ts
   import type { ConfigGlobModules } from '@/engine'
   export const configGlob: ConfigGlobModules = {
     configModules: import.meta.glob('./**/*.config.json'),
     tableModules: import.meta.glob('./**/*.table.json'),
   }
   ```
   配置加载器（继承 `ConfigLoaderBase`）的 `init()` 中只需注册**代码相关**部分：
   ```typescript
   // src/projects/<project>/<Project>ConfigLoader.ts
   this.registerDefaults('fish.cannon', DEFAULT_CANNON_CONFIG)                    // 同步 fallback（手动）
   this.registerConfigTransform<GameConfig>('fish.eatfish', (raw) => ({ ... }))   // 归一化（手动）
   this.registerTableTransform<TroopType>('fish.troop', (row) => ({ ... }))       // 行归一化（手动）
   this.registerGlob(configGlob.configModules, configGlob.tableModules)          // 自动注册（必须最后）
   ```
   - **顺序要求**：`registerDefaults` / `registerConfigTransform` / `registerTableTransform` 必须在 `registerGlob` **之前**（加载为 fire-and-forget 异步，读取期间 transform 已就绪）
   - `gameplay/{mode}/config/` 下的阶段独用配置不在 glob 范围内，仍需手动 `loadConfig`/`loadTable`
2. **`_` 前缀键是注释**：顶层以 `_` 开头的键（如 `_comment`）加载时会被 `stripMeta` 剔除，**不影响数据**。可用 `_comment` 写字段说明文档
3. **类型 + 默认值双同步**：每个配置表对应 `gameplay/common/types.ts` 中的接口（如 `CannonConfig`）与 `DEFAULT_*_CONFIG` 常量。JSON 结构必须与接口一致；改 JSON 时同步更新接口/默认值
4. **浅合并语义**：`loadConfig` 与默认值合并是**浅合并**——JSON 中出现的键整体替换默认值（数组整体替换，**不做元素级合并**）。因此数组（如 `levels`、`fishTypes`）要么在 JSON 中写全，要么完全依赖默认值
5. **transform 钩子**：需运行时归一化的字段（如 `color: "#rrggbb"` → 数字、拷贝数组）用 `registerConfigTransform`/`registerTableTransform` 注册，JSON 里写原始可读形式
6. **读取行为**：`getConfig` 已加载缓存 → 默认值 → 抛错（未注册属编程错误）；`getTable` 未加载返回 `undefined`（消费方用 `if` 守卫）
7. **DataTable 不可变**：构造后无 mutation API，热更新由 `ConfigRegistry.reload` 整体替换

## 单例配置示例（*.config.json）

```json
{
  "_comment": "炮台等级配置（ConfigRegistry 加载）。被 FishCannon 用于发射消耗、威力与冷却。\n字段含义：\n  initialLevel = 初始炮等级；\n  cost = 单发消耗金币；power = 威力（扣鱼 hp）；\n  captureBonus = 捕获率加成倍数；\n  netRadius = 网碰撞半径；netSpeed = 网飞行速度；\n  fireCooldown = 连射冷却（秒，越小射越快）。",
  "initialLevel": 1,
  "levels": [
    { "level": 1, "name": "I 型炮", "cost": 1, "power": 1, "captureBonus": 1.0, "netRadius": 0.8, "netSpeed": 18, "fireCooldown": 0.28 },
    { "level": 2, "name": "II 型炮", "cost": 2, "power": 3, "captureBonus": 1.3, "netRadius": 1.1, "netSpeed": 20, "fireCooldown": 0.22 }
  ]
}
```

结构完全自定义，由 TS 接口决定：
```typescript
export interface CannonConfig {
  initialLevel: number
  levels: CannonLevel[]          // 数组必须整体写全（浅合并不会逐元素合并）
}
```

## 数据表示例（*.table.json）

```json
{
  "_comment": "FishMaster 兵种数据表（DataTable 行表）。键=兵种 id，值=兵种属性。\n字段含义：\n  name = 显示名；housing = 占用兵营空间；cost = 训练费用；\n  hp = 生命值；dps = 每秒伤害；target = 目标类型（ground/both）；\n  color = 主体颜色 #rrggbb（加载时 transform 归一化为数字）。",
  "barbarian": {
    "name": "野蛮人",
    "housing": 1,
    "cost": 25,
    "trainTime": 20,
    "hp": 45,
    "dps": 8,
    "range": 0.5,
    "speed": 16,
    "target": "ground",
    "preferred": "any",
    "size": [0.8, 1.1, 0.8],
    "flying": false,
    "color": "#e53935"
  },
  "archer": {
    "name": "弓箭手",
    "housing": 1,
    "cost": 50,
    "trainTime": 25,
    "hp": 20,
    "dps": 7,
    "range": 3.5,
    "speed": 24,
    "target": "both",
    "preferred": "any",
    "size": [0.7, 1.0, 0.7],
    "flying": false,
    "color": "#8e24aa"
  }
}
```

规则：
- 行名（键）唯一，对应一条记录（兵种/物品/敌人/关卡/原型等）
- 每行结构一致，字段与 TS 行类型（如 `TroopType`）一致
- 行名用 snake_case 英文标识符（`barbarian`、`archer`），显示名放 `name` 字段

## 创建步骤
1. 确认形态：整体配置对象 → `.config.json`；键值行表 → `.table.json`
2. 确定配置名（`{project}.{文件名}` 自动推导）与 TS 接口（`gameplay/common/types.ts` 中定义或扩展）
3. 在 `asset/config/` 创建 JSON，顶层写 `_comment` 说明字段含义
4. 若该配置有默认值，在 types.ts 中定义 `DEFAULT_*_CONFIG`（与 JSON 同结构）
5. 在项目 ConfigLoader（继承 `ConfigLoaderBase`）的 `init()` 中：
   - `registerDefaults(name, DEFAULT)`（有默认值时）
   - `registerConfigTransform(name, fn)` / `registerTableTransform(name, fn)`（需归一化时）
   - `registerGlob(configGlob.configModules, configGlob.tableModules)`（**已有则无需重复**）
6. 阶段独用配置（`gameplay/{mode}/config/`）用 `loadConfig`/`loadTable` 手动加载
7. 消费方按需 `getConfig` / `getTable` 读取

## 完成检查
- [ ] 文件在 `asset/config/`（或阶段 `gameplay/{mode}/config/`），后缀为 `.config.json` / `.table.json`
- [ ] `asset/config/index.ts` 的 glob 已覆盖新文件（`**` 通配，一般无需改）
- [ ] 顶层 `_` 前缀键只有注释（不参与数据）
- [ ] JSON 结构与 `gameplay/common/types.ts` 中接口一致
- [ ] 数组字段整体写全（浅合并不做元素级合并）
- [ ] 数据表行名唯一、每行结构一致
- [ ] ConfigLoader 中 `registerDefaults`/transform 注册在 `registerGlob` 之前
- [ ] 需要归一化的字段（如颜色 `#rrggbb`）有对应 transform 钩子

## 参考
- 加载机制：`src/engine/tools/ConfigRegistry.ts`（stripMeta/mergeConfig/loadConfig/loadTable/registerGlob）、`src/engine/tools/ConfigLoaderBase.ts`（加载器基类）、`src/engine/tools/DataTable.ts`（行表类）
- 扫描入口：`src/projects/fish/asset/config/index.ts`、`src/projects/eatfish/asset/config/index.ts`
- 注册示例：`src/projects/fish/FishConfigLoader.ts`、`src/projects/eatfish/EatFishConfigLoader.ts`
- 类型/默认值：`src/projects/fish/gameplay/common/types.ts`
- 现有资产：`src/projects/fish/asset/config/`（cannon/fish/boss/school/troop）、`src/projects/eatfish/asset/config/`（eatfish.config.json / fish.table.json）

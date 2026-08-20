---
name: skl-create-config-asset
description: 创建 DemoStudio 配置表资产（asset/config/*.config.json 单例配置 与 *.table.json 数据表）。使用时机：用户要求新建/编辑配置文件，如"写鱼种配置"、"加一个炮台等级表"、"新建 troop 数据表"、"配置数值调整"。
---

# 创建配置表资产（*.config.json / *.table.json）

## 何时使用
- 用户要求新建配置资产文件（`asset/config/` 下的 `.config.json` 或 `.table.json`）
- 修改现有配置的数值/条目

## 两种配置形态

| 形态 | 后缀 | 结构 | 加载 API | 读取 API |
|------|------|------|----------|----------|
| 单例配置 | `*.config.json` | 整体配置对象 | `loadConfig<T>(name, path, transform?)` | `getConfig<T>(name)` |
| 数据表 | `*.table.json` | 键值行表 | `loadTable<Row>(name, path, transform?)` | `getTable<Row>(name)` |

## 文件位置与命名
- 路径：`src/projects/<project>/asset/config/<描述>.config.json`
- 配置名：`{project}.{文件名}`（`cannon.config.json` → `fish.cannon`）

## 半自动注册

`asset/config/index.ts` 用 `import.meta.glob` 自动扫描：

```typescript
export const configGlob: ConfigGlobModules = {
  configModules: import.meta.glob('./**/*.config.json'),
  tableModules: import.meta.glob('./**/*.table.json'),
}
```

配置加载器中注册顺序：
1. `registerDefaults(name, DEFAULT)` — 同步 fallback
2. `registerConfigTransform(name, fn)` — 归一化
3. `registerGlob(...)` — **最后调用**

## ⚠️ 关键约定

1. **`_` 前缀键是注释**：加载时被 `stripMeta` 剔除
2. **类型 + 默认值双同步**：JSON 结构与 TS 接口一致
3. **浅合并语义**：数组整体替换，不做元素级合并
4. **读取行为**：`getConfig` 必返回；`getTable` 未加载返回 `undefined`

## 完成检查
- [ ] 文件在 `asset/config/`，后缀为 `.config.json` / `.table.json`
- [ ] 顶层 `_` 前缀键只有注释
- [ ] JSON 结构与 types.ts 中接口一致
- [ ] 数组字段整体写全
- [ ] ConfigLoader 中注册顺序正确

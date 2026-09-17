# 工程根目录（单根）

本目录是 DemoStudio 的**工程根**（工程单根：全部游戏工程位于仓库根 projects/，
2026-09-17 单根化迁移后原内置案例根已删除，见 doc-dev/projects-root-unification/plan.md）。

- 内置案例与用户自建工程同轨：fish / demo2d / arena / warm-current / hoi4 / hello 全在本目录
- 本目录下的每个子目录是一个独立工程，经 src/editor/projects/registry.ts 的
  import.meta.glob 自动发现并并入注册表，无需修改编辑器代码
- 新建工程（create-project）默认落盘到本目录

## 工程结构

projects/<Name>/ 固定结构：project.json（元数据，路径用仓库根相对 projects/ 前缀）、
index.ts（入口 re-export）、register.ts（ProjectModule 注册模块）、<Name>GameInstance.ts（游戏实例）、
gameplay/（GameMode/Pawn/PlayerController，七角色规范）、asset/（场景/蓝图资产，
index.ts 相对 glob 自动注册）。

projects/hello/ 是最小可运行参照工程，新工程可复制它起步。
背景沿革见 doc/dev/external_project_roots.md（双轨机制已退役，保留作历史）。

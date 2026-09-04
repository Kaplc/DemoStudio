# 外部工程根目录

本目录是 DemoStudio 的**外部工程根**（仓库根下 projects/），与内置案例根 src/projects/ 双轨并存。

- 内置案例（fish/snake/eatfish/demo2d/racing）全部保留在 src/projects/，零迁移零回归
- 本目录下的每个子目录是一个独立工程，经 src/projects/registry.ts 的
  import.meta.glob 自动发现并并入注册表，无需修改内置代码
- 新建工程（create-project）默认落盘到本目录

## 工程结构

projects/<Name>/ 固定结构：project.json（元数据，路径用仓库根相对 projects/ 前缀）、
index.ts（入口 re-export）、register.ts（ProjectModule 注册模块）、<Name>GameInstance.ts（游戏实例）、
gameplay/（GameMode/Pawn/PlayerController，七角色规范同内置工程）、asset/（场景/蓝图资产，
index.ts 相对 glob 自动注册）。

projects/hello/ 是最小可运行参照工程，新工程可复制它起步。
详见 doc/dev/external_project_roots.md。
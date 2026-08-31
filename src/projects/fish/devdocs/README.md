# ClashMaster 功能规划文档索引

> 本目录（`src/projects/fish/devdocs/`）存放 fish（ClashMaster）项目自身的功能规划文档，按系统分子目录，每个模块一份独立文档。
> 系统级实现文档见仓库根目录 `doc/`（项目总览：`doc/projects/clash_master.md`，战斗系统：`doc/projects/battle_system.md`）。

## 文档目录

| 系统 | 模块文档 | 优先级 | 状态 |
|---|---|---|---|
| 基地经营 | [建筑升级](base/building-upgrade.md) | P0 | 已实现 |
| 基地经营 | [资源产出与收集](base/resource-collection.md) | P0 | 已实现 |
| 基地经营 | [兵种升级（实验室与研究）](base/troop-upgrade.md) | P0 | 已实现 |
| 基地经营 | [障碍物清除与装饰品商店](base/obstacle-decor.md) | P3 | 部分实现（障碍物已做，装饰品商店未做） |
| 单位与战斗 | [兵种专属技能（炸弹人/治疗师）](battle/troop-abilities.md) | P1 | 已实现 |
| 单位与战斗 | [战斗时限](battle/battle-timer.md) | P2 | 已实现 |
| 单位与战斗 | [法术系统](battle/spell.md) | P2 | 已实现 |
| 单位与战斗 | [英雄系统](battle/hero.md) | P2 | 规划中 |
| 成长与进度 | [星级战绩评价](progression/star-rating.md) | P1 | 已实现 |
| 成长与进度 | [关卡进度解锁](progression/level-unlock.md) | P1 | 已实现 |
| 经济 | [宝石货币](economy/gem.md) | P2 | 已实现（含宝石商店） |
| 社交 | [部落与援军](social/clan.md) | P3 | 规划中（依赖后端） |
| 社交 | [联机 PvP 与防守战报](social/pvp.md) | P3 | 规划中（依赖后端） |
| 周边 | [新手引导](meta/tutorial.md) | P3 | 规划中 |
| 周边 | [音频系统](meta/audio.md) | P3 | 规划中 |
| 周边 | [成就与每日任务](meta/achievement.md) | P3 | 已实现 |

## 总体路线

见 [roadmap.md](roadmap.md)（四批迭代计划、里程碑与模块依赖关系）。

## 文档约定

- 每个模块文档固定结构：现状与差距 / 设计方案（使用方法）/ 工作流程（mermaid）/ 边界条件 / 验收标准 / 关联。
- 优先级含义：P0 经营闭环 / P1 玩法体验 / P2 系统深度 / P3 生态扩展。
- 模块实现完成后：将状态改为「已实现」，回写实际工作流程与踩坑；系统级行为文档沉淀到仓库 `doc/` 下并更新 `doc/README.md` 索引。

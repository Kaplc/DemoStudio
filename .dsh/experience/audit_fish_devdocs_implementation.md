---
name: audit_fish_devdocs_implementation
task_type: audit/review
outcome: success
date: 2026-08-31
---
## Summary

遍历 src/projects/fish/devdocs 下所有文档，逐篇 grep 对应关键词核验代码实现，输出已实现/未实现功能清单及原因。

## Lessons

有效路径：先用 glob 枚举所有文档，再按文档逐个 read，之后用文档中的功能关键词（如 upgrade/produce/hero/gem）grep 代码定位实现，最后对照总结。踩坑：文档状态字段滞后（仍写规划中），实际代码已实现，必须以代码为准；文档标题与代码命名不一致时（如 hero 对应多个文件、obstacle 对应 ObstacleSystem），需尝试多个关键词避免误判。下次做同类审计时先建文档-关键词映射表，再批量核查，避免重复读文件。

## Effective Path

src/projects/fish/devdocs/**/* 文档逐一 read + 按关键词 grep src/projects/fish/*.ts

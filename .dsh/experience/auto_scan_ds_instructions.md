---
name: auto_scan_ds_instructions
task_type: feature
outcome: success
date: 2026-08-31
---
## Summary

用户抱怨 ds-instructions 插件每次新增指令都要手动改 cordis.patch.yml 映射，助手改为自动扫描 .dsh/instructions/*.instructions.md，用 frontmatter 声明 prefix，移除手动 mappings 并跑通全部 80 个测试。

## Lessons

先读插件源码梳理 config/state/index 数据流再动手；方案上给用户二选一（frontmatter 指定 prefix vs 文件名推导）避免返工；实现时注意自动扫描映射要与显式 mappings 合并（bindRootConfig），Node 兜底路径也要同步支持；config.ts 里需要复用的常量（如 DEFAULT_INSTRUCTIONS_DIR）要 export 供前端引用，否则 build 报错；每步改完立即 build + test 验证，最后更新指令文件 frontmatter 并回滚各 profile 的手动映射配置。

## Effective Path

harness/ds-instructions/src/config.ts + 新建 src/frontmatter.ts + state.ts/index.ts 集成 + .dsh/instructions/*.md 加 frontmatter + 移除 profiles 下 cordis.patch.yml 手动 mappings

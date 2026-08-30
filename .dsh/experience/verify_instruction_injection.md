---
name: verify_instruction_injection
task_type: debug
outcome: success
date: 2026-08-31
---
## Summary

用户要求检查 harness 指令是否被注入，读取源文件和指令文件，发现 cordis.patch.yml 配置变更需要重启 DSH 内核才生效，当前会话未注入。

## Lessons

DSH 指令注入的配置变更需要重启内核才生效；下次遇到注入不生效先确认是否重启过内核，再检查指令文件内容。

## Effective Path

重启 DSH 内核后再次读取验证注入

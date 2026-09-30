---
name: dsh_kernel_update_path
description: DSH 内核更新唯一可靠路径是 npmmirror 全局 npm 安装（GitHub 直连 fetch 会超时）；2026-09-29 已实装并升级内核到 0.1.7-rc.2
type: project
prefix: [electron/dshKernelVersion.ts]
---

# DSH 内核更新路径与环境网络约束（2026-09-29 定案）

**Problem:** KernelUpdateModal 点"更新到 0.1.7-rc.2"报 `git checkout 0.1.7-rc.2 pathspec did not match`；且即使 checkout 成功运行内核也不会变。

**Cause:** 三层叠加：① 运行内核 = 全局 npm 的 `@deepseek-ai/dsh`（launcher 只用 `npm root -g` 的 CLI），`harness/dsh-source` 构建产物从不参与运行；② 本机到 github.com 直连极慢——`git fetch --tags` 120s 超时，本地 tag 最高只有 `dsh-v0.1.2-alpha.1`；③ 远程 tag 命名 `dsh-v<ver>` 而 npm 版本号无前缀，npm 版本号当 tag 名必 pathspec 不匹配。

**Solution:** 2026-09-29 重写 `dsh-switch-version`（electron/main.ts）：先杀 agent 释放文件句柄 → `npm install -g @deepseek-ai/dsh@<ver> --registry=https://registry.npmmirror.com`（实测 1 分钟）→ 读全局 package.json 校验 → bootstrap 重启；失败自愈回滚重启。版本比较/校验纯函数在 electron/dshKernelVersion.ts。运行版本展示读全局包而非 dsh-source git tag。回滚命令 `npm i -g @deepseek-ai/dsh@0.1.1-rc.2`。

**Applicable:** 一切"更新/切换 DSH 内核"需求；本机网络约束（**GitHub 直连基本不可用，包/源获取一律走 npmmirror 镜像**，git clone/fetch GitHub 的方案直接排除）。内核 0.1.7-rc.2 于 2026-09-29 安装落盘，agent 重启后生效；junction 插件在 `~/.dsh/profiles` 不受全局重装影响。

**2026-09-29 补充（升级后编辑器失联取证 + 真正根因）：** 0.1.7-rc.2 对编辑器有**三个破坏性变化**，升级后面板恒 degraded：① web 鉴权强制化——全部 /api/* 无 cookie 返回 401（含探活），URL `?token=` 只在 `GET /` 换 cookie（`dsh-auth-<key>=v1.…`，30 天、HttpOnly、Host 必须 127.0.0.1、cookie 跨内核重启有效，token 每次启动变、从 dsh-agent.log 的 `dsh web:` 行提取）；② RPC 方法改名——`session.list` 404（`settings/describe` 仍通、信封协议不变）；③ WS 事件流 `/api/events.mux` → `/api/remote.mux`。无鉴权开关。

**5 插件 "failed to import" 的真正根因不是 0.1.7**：是 `npm i -g` 无锁重装把 cordis 家族按 `^` 范围重新解析到了新版本（cordis 4.0.1→4.0.4、hmr 1.0.16→1.0.19、include 1.0.6→1.0.9、loader 1.0.2→1.0.5、timer 1.1.3→1.1.6、group 1.0.1→1.0.4；证据=npm cacache index 两次安装波的版本+时间戳）。漂移后的 loader/include/hmr 让插件激活静默失败——"failed to import" 是常量字符串非真实报错（fiber undefined 即上报它）；0.1.1 下还会在 boot 末尾崩：`watchUserPatches` 要求 hmr 服务，自动创建 cordis-plugin-hmr 却不产出服务。修复=物理钉回 6 包原始版本（npmmirror CDN tgz 覆盖 `npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下对应目录，home 层 `~/.dsh/profiles/node_modules` 是指向内核树的符号链接自动跟随）。**`patchReload: "live"` 字段在 0.1.1 下必须从 profile package.json 删除（repo+home 两份），0.1.7 才支持**。回滚 0.1.1 后面板/9 插件全恢复，编辑器 10s 探活自动认领 lifecycle=running，全程无需重启编辑器。**教训：switch-version 流程永远不锁传递依赖，每次"同版本"重装都是不同的树；重升 0.1.7 前必须先做编辑器鉴权/API/WS 适配 + 处理 cordis 家族兼容**。诊断手法：MCP 9877 dsh-status 看 lifecycle/port；curl 带 cookie 实测 API；npm 日志只留当天、版本取证走 `_cacache/index-v5`。


**2026-09-29 终章（0.1.7 全量适配完成，面板+9插件+预设+e2e 全绿）：** 编辑器适配三层全落地 electron/main.ts：① 鉴权桥（readDshLaunchUrl 从 dsh-agent.log 提 token → ensureDshAuthCookie 换 30 天 cookie → dshAuthHeaders 附到所有出站请求；401 自动重换一次）；② probeDshAlive 双版本探测（settings/describe+args 信封 → session.list 旧信封，401 触发重换）；③ RPC 翻译层 DSH_RPC_TRANSLATIONS（session.list→session/list{_request}、create→{request}、prompt 补 requestId、models→modelCatalog 归一 {groups,current}、history→page{address,throughSeq=cursor,maxMessages=1e4}→{events:records}、skill.list→skills/list）；④ remote.mux 流桥（$events 网关通知→host 帧翻译 + **单活跃会话** session/follow 流→session/event/subscribed 帧翻译；388 会话全跟会把内核事件循环压垮——只跟 history/prompt 驱动的当前会话；follow 时序两坑：WS 未 OPEN 不登记 map 否则 open 补开被 guard 挡死、cursor 等待超时要删流直开 muxOpenFollow 而非 setActiveSession 幂等挡路）；⑤ dsh-respond 双路由（$events/result 与旧 /api/respond）。**内核包内一处永久兼容补丁**：dsh-session-format-v0-to-v1 的「summary requires notice form」throw 改 delete（0.1.1 时代 recall 注入带 summary 会让全部旧会话拒绝读取；[DemoStudio-compat] 标记，内核重装后需重打）。**旧会话（0.1.1 创建）resume 必失败**（会话日志存旧插件树快照：persona text/worker-thread），只读可看、续写需新会话——升级固有语义。**模型目录变化**：DeepSeek-V41-Flash→deepseek-flash；llm-pi-ai 的 zai/glm 组静默缺席（apiKeyEnv 0.1.7=credential-ref 但 zai 记录 id 大写不符 lowercase-hyphenated 约束），deepseek-official 主力可用。

**game-editor 预设 0.1.7 迁移**（.dsh/presets/game-editor/agent.cordis.yml）：persona 的 text→prefix(必填)+suffix；workflow-worker-thread→workflow-ptc(provider:spawn)。**预设装载机制重写**（scripts/sync-dsh-plugins.mjs）：0.1.7 移除 dsh-agent-presets 目录扫描器，预设=cordis 组合里的 '@deepseek-ai/dsh-agent-preset' 条目（registry 内置无需注册）；**patch 语义铁律：顶层条目=override 已有 id，新增必须 insert:**；**内联组合的缩进必须 ≥ config.plugins 键缩进**（4 空格会让整个 plugins 序列归属上一级 insert、静默变 null——YAML 序列缩进低于父键即不属于该键）。

**插件 SDK 迁移清单**（9 插件 deps 0.1.1→0.1.7-rc.2+cordis^4.0.4，API 漂移全录）：MessageSourceMap 删共享 'plugin' kind→merge-extensible（ds-memory/ds-experience/ds-reminder 各declare自有kind，compact 保留 plugin kind）；session.events 集合移除→snapshotEvents()（@deprecated 但可用，event.seq 自带）；JsonValue 从 dsh-session 迁 dsh-util-values；agent/status 监听器须返回 Promise<undefined>|undefined；测试侧：Session header 必填 isSeeded、Inbox 不再导出（stub 字面量）、CallId 构造器删除（恒等 stub）、AgentLoop 多注入 sessionProjections（测试补 plugin 装载）、surfaceOp replace 字段 start/end→startSeq/endSeq、loop 请求 system prompt 进 messages 首条（adapter 无 .system 字段）。

**测试终态**：插件 9 套件 433 测试全绿；agent 渲染层 121 测试=114 过+7 既有失败（agentLiveCardRace/agentPartialAdopt/agentStatusRows，stash 对照证明与升级无关）；root tsc 全绿。诊断手法沉淀：内核加载失败真因看 `[LOADER-DEBUG]` 式打桩（dsh-app-boot 的 "failed to import" 是常量非报错）；`dsh --dump-config` 看最终组合；`typert gateway: ... args fields do not match` 逐字读报错拿参数形状。

**2026-09-30 适配层落地（内核更新改法的结构性变化）：** 上述散装在 main.ts 的适配知识已收编为 `electron/dsh/` 可插拔适配层（registry + adapters/dsh017|dsh011 + rpcProxy + streamBridge + eventMap + 契约测试 29 例）。**此后内核破坏性更新/回滚 = 新增或自动选中对应 adapters/<ver>.ts 文件，编辑器渲染层零改动**；升级 SOP 与方言契约见 doc/harness/dsh_kernel_adapter.md（capture-dsh-fixtures.mjs 采集真实载荷 → 契约测试红 → 只改适配层）。main.ts 已零内核 wire 字面量（拼接脚本禁用符号断言保证）；注意 dsh-respond IPC 已被瀑布应答（$events/result 经 dsh-rpc 透传）取代。

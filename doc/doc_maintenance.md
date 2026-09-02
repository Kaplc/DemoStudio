# 文档维护智能体提示词

> **一句话定位**：这是一份给 AI 智能体（也可给人）执行的 `doc/` 目录**维护作业规范**——定义文档体系怎么组织、改完代码后怎么同步、以及怎么校验文档没腐坏。
>
> **什么时候会用到你**：改完代码要同步文档时、定期巡检文档是否失真时、发现文档与代码不符要修时、新增功能要建文档时。
>
> 代码位置：`doc/`（全库）、`.github/skills/skl-write-doc/SKILL.md`（写作规范）、`.github/agents/ag-doc-writer.agent.md`（编写智能体）、`.github/agents/ag-doc-maintainer.agent.md`（维护智能体）

---

## 1. 先记住这几个文件

| 文件 | 一句话职责 | 你要改它的场景 |
|---|---|---|
| [README.md](./README.md) | **文档唯一索引**：6 个模块 43 篇的落点表 | 新增/删除/移动任何文档后（**必改**） |
| [system_overview.md](./system_overview.md) | 子系统全量统计与架构索引 | 子系统数量/构成变化时 |
| [.github/skills/skl-write-doc/SKILL.md](../.github/skills/skl-write-doc/SKILL.md) | **写作规范**：新范式模板（§3.1/§3.2）+ 完成检查清单（§7） | 规范本身要演进时 |
| [.github/agents/ag-doc-writer.agent.md](../.github/agents/ag-doc-writer.agent.md) | 写文档的智能体（新建/重写单篇） | 规范变了要同步它 |
| [.github/agents/ag-doc-maintainer.agent.md](../.github/agents/ag-doc-maintainer.agent.md) | 维护文档的智能体（巡检/同步/修断链） | 规范变了要同步它 |

**关键心智模型**：`doc/` 是**代码的一面镜子**，不是独立作品。代码是事实来源（single source of truth），文档只能追代码，**永远不许改代码迁就文档**。发现不符，一律改文档。

---

## 2. 文档体系长什么样

### 2.1 目录与归属

```mermaid
flowchart TD
    R["doc/README.md<br/>唯一索引"] --> O["system_overview.md<br/>架构总览"]
    R --> E["engine/ 12 篇<br/>src/engine/"]
    R --> ED["editor/ 14 篇<br/>src/editor/ + src/components/"]
    R --> P["projects/ 4 篇<br/>src/projects/"]
    R --> H["harness/ 9 篇<br/>DSH 集成"]
    R --> T["testing/ 3 篇<br/>Playwright"]
    ED --> C["core/ 4"]
    ED --> B["blueprint/ 2"]
    ED --> A["asset/ 2"]
    ED --> U["ui/ 4"]
    ED --> I["integration/ 2"]
```

**归属铁律**：文档放哪由**它描述的源码目录**决定，不看主题相似度。

| 源码位置 | 文档落点 |
|---|---|
| `src/engine/`、`src/components/engine/` | `doc/engine/` |
| `src/editor/`、`src/components/`（React 面板） | `doc/editor/<子目录>` |
| `src/projects/` | `doc/projects/` |
| `editor/`（Python MCP）、`harness/`、`scripts/` | `doc/harness/` |
| 测试/调试方法 | `doc/testing/` |

编辑器二级子目录：`core`（核心与视口）、`blueprint`（蓝图与撤销）、`asset`（预览与检查）、`ui`（面板与 UI 增强）、`integration`（外部集成）。

### 2.2 现状基线（2026-09-02）

6 个模块共 **43 篇**：总览 1 / 引擎 12 / 编辑器 14 / 项目 4 / Harness 9 / 测试 3。

---

## 3. 维护的四类作业

维护不是"有空整理一下"，是四类可命名的作业。接到任务先判断是哪一类，再走对应流程。

| 作业 | 触发 | 核心动作 | 验收 |
|---|---|---|---|
| **A. 代码同步** | 改了被文档描述的代码 | 定位受影响文档 → 核对事实 → 改文档 | 文档无过时描述 |
| **B. 巡检** | 定期 / 大版本后 | 跑 §4 校验脚本 → 修断链 → 抽查失真 | 断链 0，抽样准确率达标 |
| **C. 范式升级** | 旧范式文档要改造 | 按新范式整体重写（不是补章节） | 通过 §6 检查清单 |
| **D. 新增文档** | 新功能无文档 | 用 `ag-doc-writer` 建 + 更新 README | 索引已登记 |

---

## 4. 作业 B：巡检怎么跑（可执行）

这是唯一能自动化的一类，也是发现腐坏最有效的手段。

### 4.1 断链与链接校验脚本

把下面这段存成临时脚本跑（Windows PowerShell），它会检查两类链接：

- **MD 断链**：`doc/` 下所有指向 `.md` 的相对链接，目标文件是否存在
- **源码链接失效**：指向 `.ts` / `.tsx` / `.mjs` / `.js` 的跨目录相对链接，目标源码文件是否存在

> **⚠️ 手册类文档注意**：脚本会先剥离代码块（``` 围栏）再检测，避免把文档里的示例代码误报成断链。你自己新增校验逻辑时也要这样做——本手册 §7 边界条件表就含示例，不剥离会误报。

```powershell
$ErrorActionPreference='Stop'
$ws='E:\DemoStudio'
$root=Join-Path $ws 'doc'
$bad=@()
foreach($f in Get-ChildItem $root -Recurse -Filter *.md){
  $dir=$f.DirectoryName
  $t=[IO.File]::ReadAllText($f.FullName)
  # 先剥离代码块：文档里的示例代码常含 .md 链接占位，不剥离会误报
  # 注意：` 在 PowerShell 双引号里是转义符，反引号要用字符类 [`] 或 chr(96) 表示
  $t=[regex]::Replace($t,'(?s)[' + [char]96 + ']{3}.*?[' + [char]96 + ']{3}','')
  # markdown 文档链接
  foreach($mm in [regex]::Matches($t,'\]\(([^)\s]+?\.md)(#[^)\s]*)?\)')){
    $tg=$mm.Groups[1].Value
    if($tg -match '^(https?:|mailto:)'){continue}
    $full=[IO.Path]::GetFullPath((Join-Path $dir $tg))
    if(-not (Test-Path -LiteralPath $full)){ $bad += ("MD  {0} -> {1}" -f $f.FullName.Substring($ws.Length+1),$tg) }
  }
  # 源码链接（.ts/.tsx/.mjs/.js）
  foreach($mm in [regex]::Matches($t,'\]\(([^)\s]+?\.(ts|tsx|mjs|js))(#L\d+)?\)')){
    $tg=$mm.Groups[1].Value
    if($tg -match '^(https?:)'){continue}
    $full=[IO.Path]::GetFullPath((Join-Path $dir $tg))
    if(-not (Test-Path -LiteralPath $full)){ $bad += ("SRC {0} -> {1}" -f $f.FullName.Substring($ws.Length+1),$tg) }
  }
}
"=== broken links: $($bad.Count) ==="
$bad | Select-Object -First 40
```

**跑完必须处理到 `0`**。脚本用完删除，不要留在仓库里。

### 4.2 新范式合规检查

校验每篇文档是否具备新范式五要素（开篇三问 / 先记住这几个文件 / 关键方法速查 / 流程影响 / 踩坑清单）：

```powershell
Get-ChildItem (Join-Path $root 'editor') -Recurse -Filter *.md | ForEach-Object {
  $rel=$_.FullName.Substring($root.Length+1).Replace('\','/')
  $t=[IO.File]::ReadAllText($_.FullName)
  $ok = $t.Contains('**一句话定位**') -and $t.Contains('先记住这') -and `
        $t.Contains('关键方法速查') -and $t.Contains('流程影响') -and $t.Contains('踩坑清单')
  "{0} {1}" -f $(if($ok){'OK  '}else{'MISS'}),$rel
}
```

### 4.3 抽查：机器查不出的失真

断链能自动化，**事实失真不能**。每轮巡检至少抽查 3~5 篇，逐条核对：

1. **调用链是否还成立**——文档写的 `A.method()` 现在还有调用方吗？（见 §5.1 死代码坑）
2. **行号是否漂移**——「关键方法速查」里的 `文件:行号` 还准吗
3. **类名/导出形式**——是类还是模块级导出函数？（见 §5.1 张冠李戴坑）
4. **边界条件表与正文是否打架**——旧文档常有"正文说支持、边界表说不支持"

抽查方法：文档里每个反引号包裹的类名/方法名，用 `grep_search` 在 `src/` 下搜一遍。搜不到的，要么是过时了，要么是文档写错了。

---

## 5. 踩坑清单（都是真踩过的）

**1. 把死代码写成主链路**

现象：文档描述的调用链 `BlueprintEditorService.commitPreviewTransform` 全仓无调用方，真实链路是 `BlueprintPreviewManager.commitPreviewEdit`。
原因：代码演进删了调用方，文档没跟着删，后人把文档当事实来源继续引用。
规则：**写调用链前必须 grep 确认调用方存在**。搜不到调用方的方法，不能写进主链路。

**2. 沿袭旧文档的"红线结论"，实际早已废弃**

现象：要求「CLI 与 TS 编译器双边同步映射规则」，但 `ui-compiler-cli.mjs` 已变成 45 行的 esbuild 启动器，根本没有第二份实现；真正需同步的是 `fnv1a` 在 `compile.ts` 与 `uiSourceSync.ts` 的两份副本。
规则：**红线结论（"必须同步 X 和 Y"）要验证 X 和 Y 现在长什么样**，不能照抄。

**3. 类名/机制张冠李戴**

现象：`SelectionManager` 被写成类并调用 `SelectionManager.select()`，实际是模块级导出函数；`PreviewSceneManager` 被说成定义在 `asset/ScenePreviewManager.ts`，实际在 `SceneViewport.ts`。
规则：描述一个东西的存在形式（类/函数/文件位置）前，先 `read_file` 看一眼定义处。

**4. 边界条件表与正文自相矛盾**

现象：`ui_source_format_system.md` 称不支持 CSS 变量和 `@media`，实际两者都已实现。
规则：边界条件表写完，回头对照正文的功能描述，检查有没有互斥。

**5. 重建索引时把旧范式模板写进新规范**

现象：改完范式后，`ag-doc-writer.agent.md` 和 SKILL.md 里仍残留旧八章模板段落，导致后续智能体产出旧范式文档。
规则：**范式变更后，全局 grep 旧关键词**（"概述"、"核心类/模块"、"使用方法"）清扫所有规范文件与 agent 定义。

**6. 只补章节不做范式升级**

现象：旧文档补一节"流程影响"就当完成，结果结构仍是"概述→核心类表格→…"，新人还是看不懂。
规则：旧范式文档改造必须**整体重写**，不是追加章节。重写前必须重读源码——靠旧文档推不出代码细节。

---

## 6. 完成检查清单

任何文档作业收尾前逐项自查：

- [ ] 链接：跑过 §4.1 脚本，断链 **0**
- [ ] 事实：文档里每个类名/方法名都能在 `src/` 下 grep 到
- [ ] 代码：贴的代码片段都是从 `read_file` 真实抄来的，没改写逻辑、没发明 API
- [ ] 行号：「关键方法速查」的 `文件:行号` 已核对未漂移
- [ ] 索引：新增/删除/移动文档后，`doc/README.md` 对应表格已同步，且格式照搬现有行
- [ ] 统计：篇数变化已同步 README 末尾「统计」段
- [ ] 范式：新写/重写的文档通过 §4.2 五要素检查
- [ ] 无空话：没有"本模块负责协调各模块"这类无信息量表述，没有纯 API 罗列
- [ ] 无模糊词：没有"可能/大概/应该"，所有断言有源码依据
- [ ] 临时文件：校验脚本等临时产物已删除

---

## 7. 边界条件

| 条件 | 行为 | 怎么应对 |
|---|---|---|
| 文档与代码冲突 | **一律改文档**，代码是事实来源 | 若怀疑代码有 bug，另开议题，不在文档任务里改代码 |
| 无法确认某 API 现状 | 不得凭印象写 | `read_file` / `grep_search` 查证；仍不确定就标注"未确认"并列出待查项 |
| 文档描述的功能已被删除 | 删除对应文档或整节 | 同步更新 README 索引与统计 |
| 一篇文档塞了多个系统 | 如 `input_physics_script_system.md` 含输入/物理/脚本三个系统 | 改造时拆分独立成文，更新索引 |
| 规范文件与文档现状不一致 | 以代码事实为准更新规范 | 同步检查所有 agent 定义文件是否残留旧说法 |
| 巡检脚本要落盘 | 只能放 `cache/` 等临时目录，用完删除 | 不提交到仓库，避免污染 |
| 篇数/分类变化 | README 统计段与模块表都要改 | 两处一起改，否则索引自相矛盾 |

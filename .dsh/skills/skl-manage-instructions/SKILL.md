---
name: skl-manage-instructions
slug: manage-instructions
description: '管理 DemoStudio 目录指令文件（.dsh/instructions/*.instructions.md）。使用时机：用户要求创建/更新/查看目录指令，如"创建引擎开发规范"、"更新项目指令"、"查看有哪些指令"、"给 src/projects 添加指令"。指令文件会在 Agent 读取对应路径文件时自动注入，提供项目特定的开发规范和指导。'
argument-hint: '指令类型和内容描述，如"引擎开发规范"、"项目开发指导"、"渲染系统规范"'
---

# 管理目录指令文件

本 skill 用于管理 `.dsh/instructions/` 目录下的指令文件。这些指令文件由 `ds-instructions` 插件使用，当 Agent 读取映射路径下的文件时，会自动注入对应的指令文件内容。

> ⚠️ 本 skill **只管理目录指令文件**（创建/更新/查看）。**不负责**：
> - 插件本身的配置修改 → 需要编辑 `cordis.patch.yml`
> - 系统级指令（AGENTS.md/CLAUDE.md）→ 由官方插件管理
> - 其他类型的文件创建 → 使用对应的 asset 创建 skill

## 1. 何时使用

- 用户要求创建新的目录指令（"创建引擎开发规范"、"给 src/projects 添加指令"）
- 用户要求更新现有的目录指令（"更新引擎规范"、"修改项目指令"）
- 用户要求查看现有的目录指令（"查看有哪些指令"、"列出所有指令文件"）
- 用户要求删除目录指令（"删除某个指令文件"）

## 2. 指令文件基础知识

### 2.1 目录结构

```
.dsh/instructions/
├── engine.instructions.md    # ← src/engine/** 读取后注入
├── project.instructions.md   # ← src/projects/** 读取后注入
└── custom.instructions.md    # ← 自定义映射路径读取后注入
```

### 2.2 默认映射规则

| 映射路径 | 指令文件 | 触发条件 |
|----------|----------|----------|
| `src/engine/**` | `engine.instructions.md` | Agent 读取引擎代码时 |
| `src/projects/**` | `project.instructions.md` | Agent 读取项目代码时 |

### 2.3 指令文件格式

指令文件是 Markdown 格式，内容会在 Agent 读取对应路径文件时自动注入。建议格式：

```markdown
# <指令标题>

- 关键规则 1
- 关键规则 2
- 关键规则 3

## 详细说明

（可选的详细说明部分）
```

### 2.4 注入行为

- **触发时机**：Agent 成功读取映射路径下的文件后
- **注入方式**：作为 durable user message 注入下一次模型请求
- **去重机制**：session + 指令文件路径 + 内容摘要，避免重复注入
- **变更语义**：
  - 首次注入：`set`（新增指令）
  - 内容变化：`replace`（替换旧指令）
  - 删除/清空：`remove`（移除指令）

## 3. 创建指令文件

### 3.1 创建步骤

1. **确定映射路径**：确认指令要关联的代码路径（如 `src/engine`、`src/projects`）
2. **确定文件名**：根据映射路径命名指令文件（如 `engine.instructions.md`）
3. **编写内容**：编写清晰、具体的开发规范和指导
4. **保存文件**：将文件保存到 `.dsh/instructions/` 目录

### 3.2 创建示例

假设要为引擎开发创建规范：

```bash
# 1. 创建指令文件
# 文件路径：.dsh/instructions/engine.instructions.md

# 2. 编写内容
```

指令文件内容示例：

```markdown
# 引擎开发规范

- 引擎代码遵循 TypeScript strict 模式
- 修改引擎代码前先阅读对应模块的现有实现
- 组件添加新字段要同步更新资产和资产检查器
- 使用 logger.info/warn/error 记录关键流程

## 命名约定

- 类名：PascalCase
- 方法名：camelCase
- 常量：UPPER_SNAKE_CASE

## 代码组织

- 每个模块一个文件
- 导出接口和类型放在文件顶部
- 实现细节放在底部
```

### 3.3 验证创建

创建后，可以通过以下方式验证：

1. **检查文件存在**：确认文件已保存到 `.dsh/instructions/` 目录
2. **测试注入**：让 Agent 读取对应路径下的文件，观察是否注入了指令
3. **查看日志**：检查控制台是否有 `[ds-instructions]` 相关日志

## 4. 更新指令文件

### 4.1 更新步骤

1. **读取现有文件**：查看当前指令文件内容
2. **修改内容**：根据需求更新指令内容
3. **保存文件**：覆盖保存或追加内容
4. **验证更新**：确认更新已生效

### 4.2 更新示例

假设要更新引擎开发规范：

```bash
# 1. 读取现有文件
read_file .dsh/instructions/engine.instructions.md

# 2. 修改内容（添加新规则）
# 在现有内容基础上添加：
# - 新增规则：使用 Prettier 格式化代码

# 3. 保存文件
write_file .dsh/instructions/engine.instructions.md <更新后的内容>
```

### 4.3 更新注意事项

- **内容变更会触发 replace 语义**：Agent 会在下一次请求时收到更新后的指令
- **删除内容会触发 remove 语义**：Agent 会收到指令已移除的通知
- **保持格式一致**：建议保持 Markdown 格式的一致性

## 5. 查看指令文件

### 5.1 查看所有指令文件

```bash
# 列出 .dsh/instructions/ 目录下的所有文件
list_dir .dsh/instructions/
```

### 5.2 查看特定指令文件内容

```bash
# 查看引擎指令文件内容
read_file .dsh/instructions/engine.instructions.md
```

### 5.3 查看映射配置

```bash
# 查看 ds-instructions 插件配置
read_file harness/ds-instructions/src/config.ts
```

## 6. 删除指令文件

### 6.1 删除步骤

1. **确认文件**：确认要删除的指令文件
2. **备份内容**（可选）：如果需要，先备份文件内容
3. **删除文件**：删除指令文件
4. **验证删除**：确认文件已删除，Agent 不再注入该指令

### 6.2 删除示例

```bash
# 删除指令文件
delete_file .dsh/instructions/custom.instructions.md
```

### 6.3 删除注意事项

- **删除会触发 remove 语义**：Agent 会收到指令已移除的通知
- **不会影响其他指令**：删除一个指令文件不会影响其他指令文件
- **可以重新创建**：删除后可以随时重新创建指令文件

## 7. 高级用法

### 7.1 自定义映射路径

如果需要为其他路径创建指令，需要修改 `ds-instructions` 插件配置：

1. **编辑配置文件**：修改 `cordis.patch.yml` 中的 `mappings` 配置
2. **添加映射规则**：添加新的路径前缀到指令文件的映射
3. **重启插件**：重启 DSH 内核使配置生效

示例配置：

```yaml
- insert:
    - id: ds-instructions
      name: '@demostudio/ds-instructions'
      config:
        projectRoot: 'E:/DemoStudio'
        mappings:
          - prefix: 'src/engine'
            file: 'engine.instructions.md'
          - prefix: 'src/projects'
            file: 'project.instructions.md'
          - prefix: 'src/editor'
            file: 'editor.instructions.md'
```

### 7.2 指令文件最佳实践

1. **保持简洁**：指令文件应该简洁明了，避免过长
2. **具体明确**：提供具体的规则和示例，避免模糊描述
3. **分层组织**：使用标题和列表组织内容，便于阅读
4. **定期更新**：随着项目发展，定期更新指令内容
5. **避免冲突**：确保指令之间不冲突，保持一致性

### 7.3 调试指令注入

如果指令没有按预期注入，可以：

1. **检查文件路径**：确认指令文件在正确的目录下
2. **检查文件名**：确认文件名与映射配置一致
3. **检查内容**：确认文件内容不为空且格式正确
4. **查看日志**：检查控制台是否有错误信息
5. **测试触发**：让 Agent 读取对应路径下的文件，观察注入情况

## 8. 常见问题

### Q1: 指令文件没有被注入

**可能原因**：
- 文件路径不在映射规则中
- 文件名与映射配置不一致
- 文件内容为空
- 插件未启用或配置错误

**解决方法**：
- 检查映射配置
- 确认文件名正确
- 检查文件内容
- 查看插件日志

### Q2: 指令注入重复

**可能原因**：
- 去重机制失效
- 内容变更触发 replace 语义

**解决方法**：
- 检查去重逻辑
- 确认内容是否频繁变更

### Q3: 指令内容过长

**可能原因**：
- 单个指令文件内容过多
- 超过字节上限限制

**解决方法**：
- 精简指令内容
- 拆分为多个指令文件
- 调整字节上限配置

## 9. 相关文件和目录

- **指令目录**：`.dsh/instructions/`
- **插件源码**：`harness/ds-instructions/`
- **配置文件**：`harness/ds-instructions/src/config.ts`
- **插件文档**：`harness/ds-instructions/README.md`
- **现有指令示例**：`.dsh/instructions/engine.instructions.md`

## 10. 快速参考

### 创建指令文件

```bash
# 创建新指令文件
create_file .dsh/instructions/<文件名>.instructions.md <内容>
```

### 更新指令文件

```bash
# 更新现有指令文件
replace_string_in_file .dsh/instructions/<文件名>.instructions.md <旧内容> <新内容>
```

### 查看指令文件

```bash
# 列出所有指令文件
list_dir .dsh/instructions/

# 查看特定指令文件
read_file .dsh/instructions/<文件名>.instructions.md
```

### 删除指令文件

```bash
# 删除指令文件
delete_file .dsh/instructions/<文件名>.instructions.md
```

---

**提示**：本 skill 专注于管理指令文件本身。如果需要修改插件配置或了解插件工作原理，请参考 `harness/ds-instructions/README.md` 文档。

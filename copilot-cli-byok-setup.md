# Copilot CLI BYOK 自定义模型配置

> BYOK（Bring Your Own Key）— 使用自有 API Key 接入第三方模型，替代 GitHub Copilot 默认模型。

---

## 目录

- [快速概览](#快速概览)
- [1. 安装 Copilot CLI](#1-安装-copilot-cli)
- [2. 配置环境变量](#2-配置环境变量)
  - [方式一：PowerShell 配置文件（推荐）](#方式一powershell-配置文件推荐)
  - [方式二：Windows 注册表（全局生效）](#方式二windows-注册表全局生效)
  - [方式三：当前会话临时使用](#方式三当前会话临时使用)
- [3. 验证配置](#3-验证配置)
- [4. 环境变量说明](#4-环境变量说明)
- [5. 模型要求](#5-模型要求)
- [6. 日常使用](#6-日常使用)
- [7. 安全提示](#7-安全提示)
- [8. 常见问题](#8-常见问题)
- [9. 卸载与重置](#9-卸载与重置)

---

## 快速概览

```powershell
# 一行安装
npm install -g @githubnext/github-copilot-cli

# 设置环境变量（当前会话）
$env:COPILOT_PROVIDER_BASE_URL = "https://opencode.ai/zen/go/v1"
$env:COPILOT_PROVIDER_TYPE = "openai"
$env:COPILOT_PROVIDER_API_KEY = "sk-你的密钥"
$env:COPILOT_MODEL = "deepseek-v4-flash"
$env:COPILOT_PROVIDER_MAX_PROMPT_TOKENS = "400000"
$env:COPILOT_PROVIDER_MAX_OUTPUT_TOKENS = "32768"

# 启动
copilot
```

---

## 1. 安装 Copilot CLI

```powershell
npm install -g @githubnext/github-copilot-cli
```

> **前置条件**：需要安装 [Node.js](https://nodejs.org/)（>= 18.x）。安装后请确保 `npm` 在 PATH 中。

验证安装：

```powershell
copilot --version
```

---

## 2. 配置环境变量

> 配置生效优先级：**当前会话 > PowerShell 配置文件 > 注册表**（高优先级覆盖低优先级）。

### 方式一：PowerShell 配置文件（推荐）

写入 `C:\Users\Kaplc\Documents\WindowsPowerShell\profile.ps1`（如文件不存在则新建）：

```powershell
# ── Copilot CLI 自定义模型 ──────────────────────────────
$env:COPILOT_PROVIDER_BASE_URL      = "https://opencode.ai/zen/go/v1"
$env:COPILOT_PROVIDER_TYPE          = "openai"
$env:COPILOT_PROVIDER_API_KEY       = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
$env:COPILOT_MODEL                  = "deepseek-v4-flash"
$env:COPILOT_PROVIDER_MAX_PROMPT_TOKENS  = "400000"
$env:COPILOT_PROVIDER_MAX_OUTPUT_TOKENS  = "32768"
```

**优点**：每次打开 PowerShell 自动生效  
**缺点**：仅对 PowerShell 生效（CMD / Git Bash 等无效）

### 方式二：Windows 注册表（全局生效）

```powershell
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_BASE_URL",      "https://opencode.ai/zen/go/v1", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_TYPE",          "openai", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_API_KEY",       "sk-xxxxxxxxxxxxxxxxxxxxxxxx", "User")
[Environment]::SetEnvironmentVariable("COPILOT_MODEL",                  "deepseek-v4-flash", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_MAX_PROMPT_TOKENS", "400000", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_MAX_OUTPUT_TOKENS", "32768", "User")
```

> ⚠️ **注意**：注册表方式需要**重启终端**（或重启电脑）才能生效。  
> 存储位置：`HKEY_CURRENT_USER\Environment`

**优点**：所有程序/终端全局生效  
**缺点**：需重启终端，修改不够灵活

### 方式三：当前会话临时使用

```powershell
$env:COPILOT_PROVIDER_BASE_URL      = "https://opencode.ai/zen/go/v1"
$env:COPILOT_PROVIDER_TYPE          = "openai"
$env:COPILOT_PROVIDER_API_KEY       = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
$env:COPILOT_MODEL                  = "deepseek-v4-flash"
$env:COPILOT_PROVIDER_MAX_PROMPT_TOKENS  = "400000"
$env:COPILOT_PROVIDER_MAX_OUTPUT_TOKENS  = "32768"
```

**优点**：即设即用，适合临时测试  
**缺点**：关闭终端后失效

---

## 3. 验证配置

### 检查环境变量

```powershell
# 查看关键配置是否生效
echo "BASE_URL: $env:COPILOT_PROVIDER_BASE_URL"
echo "MODEL:    $env:COPILOT_MODEL"
echo "TYPE:     $env:COPILOT_PROVIDER_TYPE"
```

### 测试 Copilot CLI

```powershell
# 启动交互模式
copilot

# 或单次查询测试
copilot -p "你是什么模型？"
```

### 检查 Copilot CLI 状态

```powershell
copilot --diagnose
```

> 该命令会输出当前生效的配置信息，便于排查问题。

---

## 4. 环境变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `COPILOT_PROVIDER_BASE_URL` | ✅ 是 | — | API 端点 URL（如 OpenAI 兼容接口地址） |
| `COPILOT_PROVIDER_TYPE` | ❌ 否 | `openai` | 提供商类型：`openai` / `azure` / `anthropic` |
| `COPILOT_PROVIDER_API_KEY` | ❌ 否 | — | API Key（使用本地 Ollama 等无需此值） |
| `COPILOT_MODEL` | ✅ 是 | — | 使用的模型名称 |
| `COPILOT_PROVIDER_MAX_PROMPT_TOKENS` | ❌ 否 | — | 最大输入 token 数（建议与模型上下文窗口匹配） |
| `COPILOT_PROVIDER_MAX_OUTPUT_TOKENS` | ❌ 否 | — | 最大输出 token 数 |
| `COPILOT_PROVIDER_API_VERSION` | ❌ 否 | — | API 版本（仅 Azure 类型需要） |

---

## 5. 模型要求

| 要求 | 说明 |
|------|------|
| **Tool Calling** | 必须支持 function calling / tool use |
| **Streaming** | 必须支持 SSE streaming 响应 |
| **上下文窗口** | 建议 ≥ 128K tokens |
| **OpenAI 兼容 API** | 提供与 OpenAI API 格式兼容的接口 |

### 推荐模型示例

| 模型 | 提供商 | 上下文 | 备注 |
|------|--------|--------|------|
| `deepseek-v4-flash` | DeepSeek / OpenCode | 1M | 高性价比，速度快 |
| `deepseek-chat` | DeepSeek | 128K | 稳定可靠 |
| `gpt-4o` / `gpt-4o-mini` | OpenAI | 128K | 官方标准方案 |
| `claude-sonnet-4-20250514` | Anthropic | 200K | 代码理解优秀（需 `anthropic` 类型） |
| `gemini-2.5-flash` | Google | 1M | 性价比高 |

---

## 6. 日常使用

### 启动交互模式

```powershell
copilot
```

### 指定模型启动

```powershell
copilot --model deepseek-v4-flash
```

### 交互模式内切换模型

在交互界面中输入：

```
/model
```

然后按提示输入新模型名称。

### 常用命令

```powershell
copilot -p "你的问题"       # 单次提问
copilot --model xxx -p "问题"  # 指定模型单次提问
copilot --diagnose          # 诊断当前配置
copilot --help              # 查看所有可用选项
```

---

## 7. 安全提示

> 🔐 **API Key 安全**
>
> - 不建议将含真实 API Key 的配置提交到 Git 仓库
> - 将 `profile.ps1` 加入 `.gitignore` 或使用环境变量托管工具（如 Windows Credential Manager）
> - 注册表方式存储的 API Key 以明文保存在注册表中，注意访问权限
> - 建议为 Copilot CLI 使用**独立的受限 API Key**（如仅允许特定模型、设置用量上限）

---

## 8. 常见问题

### Q: 启动提示 "No provider configured"

**原因**：未设置 `COPILOT_PROVIDER_BASE_URL` 或 `COPILOT_MODEL`。  
**解决**：按上方方式配置环境变量后重试。

### Q: 报错 "401 Unauthorized"

**原因**：API Key 无效或已过期。  
**解决**：检查 `COPILOT_PROVIDER_API_KEY` 是否正确，重新生成 Key。

### Q: 报错 "Model not found" 或 "404"

**原因**：模型名称不正确，或当前 API 端点不支持该模型。  
**解决**：确认 `COPILOT_MODEL` 拼写正确；检查 API 提供商是否支持该模型。

### Q: 如何查看当前生效的所有配置？

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -like "COPILOT*" } | Format-Table
```

### Q: 如何临时使用不同的模型而不修改配置？

```powershell
copilot --model gpt-4o -p "你好"
```

### Q: 如何清除当前会话的环境变量？

```powershell
Remove-Item Env:COPILOT_PROVIDER_BASE_URL, Env:COPILOT_MODEL
```

---

## 9. 卸载与重置

### 卸载 Copilot CLI

```powershell
npm uninstall -g @githubnext/github-copilot-cli
```

### 清除环境变量

#### 从 PowerShell 配置中移除

编辑 `profile.ps1`，删除对应行。

#### 从注册表中移除

```powershell
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_BASE_URL", $null, "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_TYPE", $null, "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_API_KEY", $null, "User")
[Environment]::SetEnvironmentVariable("COPILOT_MODEL", $null, "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_MAX_PROMPT_TOKENS", $null, "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_MAX_OUTPUT_TOKENS", $null, "User")
```

---

> **参考链接**
> - [GitHub Copilot CLI 官方文档](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line)
> - [BYOK 配置指南](https://docs.github.com/en/copilot/managing-copilot/managing-copilot-as-an-individual-subscriber/managing-your-copilot-settings#enabling-copilot-to-use-a-third-party-model)

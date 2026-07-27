# Copilot CLI BYOK 自定义模型配置

## 1. 安装 Copilot CLI

```powershell
npm install -g @githubnext/github-copilot-cli
```

## 2. 配置环境变量

### 方式一：PowerShell 配置文件（推荐）

写入 `C:\Users\Kaplc\Documents\WindowsPowerShell\profile.ps1`：

```powershell
# Copilot CLI - 自定义模型
$env:COPILOT_PROVIDER_BASE_URL = "https://opencode.ai/zen/go/v1"
$env:COPILOT_PROVIDER_TYPE = "openai"
$env:COPILOT_PROVIDER_API_KEY = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
$env:COPILOT_MODEL = "deepseek-v4-flash"
$env:COPILOT_PROVIDER_MAX_PROMPT_TOKENS = "400000"
$env:COPILOT_PROVIDER_MAX_OUTPUT_TOKENS = "32768"
```

### 方式二：Windows 注册表（全局生效）

```powershell
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_BASE_URL", "https://opencode.ai/zen/go/v1", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_TYPE", "openai", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_API_KEY", "sk-xxxxxxxxxxxxxxxxxxxxxxxx", "User")
[Environment]::SetEnvironmentVariable("COPILOT_MODEL", "deepseek-v4-flash", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_MAX_PROMPT_TOKENS", "400000", "User")
[Environment]::SetEnvironmentVariable("COPILOT_PROVIDER_MAX_OUTPUT_TOKENS", "32768", "User")
```

> 注册表方式需要**重启终端**或重启电脑才能生效。路径：`HKEY_CURRENT_USER\Environment`

### 方式三：当前会话临时使用

```powershell
$env:COPILOT_PROVIDER_BASE_URL = "https://opencode.ai/zen/go/v1"
$env:COPILOT_PROVIDER_TYPE = "openai"
$env:COPILOT_PROVIDER_API_KEY = "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
$env:COPILOT_MODEL = "deepseek-v4-flash"
$env:COPILOT_PROVIDER_MAX_PROMPT_TOKENS = "400000"
$env:COPILOT_PROVIDER_MAX_OUTPUT_TOKENS = "32768"
```

## 3. 验证配置

运行以下命令检查环境变量是否生效：

```powershell
echo $env:COPILOT_PROVIDER_BASE_URL
echo $env:COPILOT_MODEL
```

启动 Copilot CLI 交互模式：

```powershell
copilot
```

或单次查询测试：

```powershell
copilot -p "你是什么模型？"
```

## 4. 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `COPILOT_PROVIDER_BASE_URL` | 是 | API 端点 URL |
| `COPILOT_PROVIDER_TYPE` | 否 | 提供商类型：`openai`（默认）/ `azure` / `anthropic` |
| `COPILOT_PROVIDER_API_KEY` | 否 | API Key（本地 Ollama 不需要） |
| `COPILOT_MODEL` | 是 | 模型名 |
| `COPILOT_PROVIDER_MAX_PROMPT_TOKENS` | 否 | 最大输入 token 数 |
| `COPILOT_PROVIDER_MAX_OUTPUT_TOKENS` | 否 | 最大输出 token 数 |

## 5. 模型要求

- 支持 **tool calling（function calling）**
- 支持 **streaming**
- 建议至少 **128k** 上下文窗口

## 6. 切换模型

```powershell
# 临时切换
copilot --model deepseek-v4-flash

# 交互模式内切换
/model
```

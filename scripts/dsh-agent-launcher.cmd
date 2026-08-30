@echo off
REM ─── DSH Agent 独立启动器 ───
REM 用法: dsh-agent-launcher.cmd <nodePath> <cliPath> <cwd> <logFile> <envNodeEnv> <envEnginePort>
REM
REM 设计目的: 通过中间层 cmd.exe 启动 node 进程后立即退出，
REM 使 DSH agent 成为孤儿进程（被系统收养），从而脱离 Electron 进程树。
REM 这样 vite-plugin-electron 的 treeKillSync(taskkill /T /F) 不会连带杀死 DSH。
REM
REM 进程链: Electron → cmd.exe(本脚本) → start /b → node(DSH agent)
REM         本脚本退出后 node 成为孤儿 → taskkill /T 杀不到

set "NODE_PATH=%~1"
set "CLI_PATH=%~2"
set "CWD=%~3"
set "LOG_FILE=%~4"
set "NODE_ENV=%~5"
set "DSH_ENGINE_PORT=%~6"

cd /d "%CWD%"
start "" /b "%NODE_PATH%" "%CLI_PATH%" --profile web --no-open > "%LOG_FILE%" 2>&1

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\e2e\fish\full-flow.spec.ts >> FishMaster 全流程 >> 主菜单 → 直接进入捕鱼关卡（ai.switchScene）→ Esc 暂停菜单
- Location: tests\e2e\fish\full-flow.spec.ts:112:7

# Error details

```
Error: browserType.launch: Executable doesn't exist at C:\Users\Kaplc\AppData\Local\ms-playwright\chromium_headless_shell-1234\chrome-headless-shell-win64\chrome-headless-shell.exe
╔════════════════════════════════════════════════════════════╗
║ Looks like Playwright was just installed or updated.       ║
║ Please run the following command to download new browsers: ║
║                                                            ║
║     npx playwright install                                 ║
║                                                            ║
║ <3 Playwright Team                                         ║
╚════════════════════════════════════════════════════════════╝
```
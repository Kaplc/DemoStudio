/**
 * 侧边栏聊天 WebviewView Provider。
 *
 * M2 实装：
 * - 加载 React 聊天 UI（dist-webview/chat.js，由 esbuild.webview.js 构建）
 * - 与 extension host 双向通信（用户消息上行 / 内核事件下行）
 * - 安全：CSP nonce + localResourceRoots 限制
 */
import * as vscode from 'vscode'

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'dsh.chat'

  private view?: vscode.WebviewView

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview'),
      ],
    }
    webviewView.webview.html = this.getChatHtml(webviewView.webview)
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg))
  }

  /** 向下行事件流（KernelAdapter → ChatView → React UI） */
  postMessage(message: unknown): void {
    try {
      this.view?.webview.postMessage(message)
    } catch (e) {
      this.outputChannel.appendLine(`[chat] postMessage failed: ${e}`)
    }
  }

  /** 用户消息通过 vscode.commands 回到 extension.ts，由 kernel 转发到 adapter */
  private async handleMessage(message: { type: string; text?: string; lang?: string; code?: string; command?: string }): Promise<void> {
    if (message.type === 'userMessage' && message.text) {
      this.outputChannel.appendLine(`[chat] user: ${message.text}`)
      vscode.commands.executeCommand('dsh.sendUserMessage', message.text)
    } else if (message.type === 'command' && message.command) {
      // 状态栏按钮触发的命令（如重启内核、检查更新）
      this.outputChannel.appendLine(`[chat] command: ${message.command}`)
      vscode.commands.executeCommand(message.command).catch((err) => {
        this.outputChannel.appendLine(`[chat] command failed: ${err}`)
      })
    } else if (message.type === 'applyCode' && message.code) {
      this.outputChannel.appendLine(`[chat] applyCode: ${message.lang ?? 'text'} (${message.code.length} chars)`)
      // M2 占位：把代码片段透出到 OutputChannel（用户可复制）；M3 实装 vscode.workspace.fs 写入
      this.outputChannel.appendLine('--- BEGIN APPLIED CODE ---')
      this.outputChannel.appendLine(message.code)
      this.outputChannel.appendLine('--- END APPLIED CODE ---')
    }
  }

  private getChatHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce()
    const csp = webview.cspSource
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview', 'chat.js'))
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist-webview', 'chat.css'))
    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${csp} 'unsafe-inline'; img-src ${csp} data:; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri.toString()}">
  <title>DSH Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`
  }

  private getNonce(): string {
    let text = ''
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length))
    return text
  }
}

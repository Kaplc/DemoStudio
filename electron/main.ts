/**
 * DemoStudio Electron 主进程
 * 管理窗口生命周期、IPC 通信、原生菜单
 */
import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

const isDev = !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 864,
    minWidth: 1024,
    minHeight: 600,
    title: 'DemoStudio Editor',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    show: false,
  })

  // 构建原生菜单
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-action', 'new-project'),
        },
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-action', 'open-project'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-action', 'save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu-action', 'save-as'),
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Project',
      submenu: [
        {
          label: 'Launch Game',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('menu-action', 'launch-game'),
        },
        {
          label: 'Stop Game',
          accelerator: 'Shift+F5',
          click: () => mainWindow?.webContents.send('menu-action', 'stop-game'),
        },
        { type: 'separator' },
        {
          label: 'Project Settings',
          click: () => mainWindow?.webContents.send('menu-action', 'project-settings'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Console',
          accelerator: '`',
          click: () => mainWindow?.webContents.send('menu-action', 'toggle-console'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About DemoStudio',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About DemoStudio',
              message: 'DemoStudio Editor v4.0.0',
              detail: '基于 Three.js + Electron + React 的游戏编辑器',
            })
          },
        },
      ],
    },
  ]

  // macOS 应用菜单
  if (process.platform === 'darwin') {
    menuTemplate.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)

  // 加载应用
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── IPC 处理器 ───

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    name: app.name,
    platform: process.platform,
    isDev,
  }
})

ipcMain.handle('open-file-dialog', async (_event, options: Electron.OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(mainWindow!, options)
  return result
})

ipcMain.handle('save-file-dialog', async (_event, options: Electron.SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(mainWindow!, options)
  return result
})

ipcMain.handle('show-message-box', async (_event, options: Electron.MessageBoxOptions) => {
  const result = await dialog.showMessageBox(mainWindow!, options)
  return result
})

// ─── 应用生命周期 ───

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

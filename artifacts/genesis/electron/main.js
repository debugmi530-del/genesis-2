const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

app.commandLine.appendSwitch('enable-features', 'WebGPU,WebGPUDeveloperFeatures')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  const indexPath = path.join(__dirname, '../dist/public/index.html')
  win.loadFile(indexPath)

  win.once('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  ipcMain.on('toggle-fullscreen', () => {
    win.setFullScreen(!win.isFullScreen())
  })

  ipcMain.on('quit-game', () => {
    app.quit()
  })

  return win
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

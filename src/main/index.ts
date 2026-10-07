import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import dgram from 'node:dgram'
import fs from 'node:fs'
import icon from '../../resources/icon.png?asset'

const PORT = 41234
const BROADCAST_ADDR = '255.255.255.255'

interface UserProfile {
  userId: string
  username: string
}

let myProfile: UserProfile | null = null
let mainWindow: BrowserWindow | null = null
let socket: dgram.Socket | null = null
let profilePath = ''

function loadProfile(): UserProfile | null {
  try {
    if (profilePath && fs.existsSync(profilePath)) {
      const data = fs.readFileSync(profilePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Error al leer profile.json:', err)
  }
  return null
}

function createWindow(): void {
  const preloadMjs = join(__dirname, '../preload/index.mjs')
  const preloadJs = join(__dirname, '../preload/index.js')
  const resolvedPreload = fs.existsSync(preloadMjs) ? preloadMjs : preloadJs

  mainWindow = new BrowserWindow({
    width: 1050,
    height: 700,
    minWidth: 800,
    minHeight: 550,
    show: false,
    autoHideMenuBar: true,
    icon: icon,
    webPreferences: {
      preload: resolvedPreload,
      contextIsolation: true,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (is.dev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupLanNetwork(): void {
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString())

      // 1. Ignorar paquetes emitidos por nosotros mismos
      if (myProfile && data.senderId === myProfile.userId) return

      // 2. Si es presencia (descubrimiento de contactos), se lo mandamos a Svelte
      if (data.type === 'presence') {
        mainWindow?.webContents.send('lan-packet-received', {
          ...data,
          ip: rinfo.address
        })
      }

      // 3. Si es un mensaje privado (direct_chat), SOLO lo procesamos si está dirigido a nuestro ID
      if (data.type === 'direct_chat' && myProfile && data.targetId === myProfile.userId) {
        mainWindow?.webContents.send('lan-packet-received', {
          ...data,
          ip: rinfo.address
        })
      }
    } catch {
      // Ignorar paquetes ajenos a la app
    }
  })

  socket.bind(PORT, () => {
    socket?.setBroadcast(true)
    if (myProfile) announcePresence()
  })

  // Latido cada 3 segundos anunciando que seguimos conectados en la Wi-Fi
  setInterval(() => {
    if (myProfile) announcePresence()
  }, 3000)
}

function announcePresence(): void {
  if (!myProfile) return
  broadcast({
    type: 'presence',
    senderId: myProfile.userId,
    username: myProfile.username
  })
}

function broadcast(payload: object): void {
  if (!socket) return
  const message = Buffer.from(JSON.stringify(payload))
  socket.send(message, 0, message.length, PORT, BROADCAST_ADDR)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron.lanchat')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  autoUpdater.on('checking-for-update', () => {
    console.log('Buscando actualizaciones...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('Nueva version encontrada: ', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('La aplicacion esta en la ultima version.')
  })

  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`Descargando actualizacion: ${Math.round(progressObj.percent)}%`)
  })

  autoUpdater.on('update-downloaded', () => {
    console.log('Actualizacion lista para instalarse.')
  })

  if (!is.dev) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Error al comprobar actualizaciones.', err)
    })
  }

  profilePath = join(app.getPath('userData'), 'profile.json')
  myProfile = loadProfile()

  // Retorna el perfil actual a Svelte
  ipcMain.handle('get-profile', () => myProfile)

  // Crea y guarda el usuario en disco la primera vez
  ipcMain.handle('create-profile', (_, username: string) => {
    const newProfile: UserProfile = {
      userId: Math.random().toString(36).substring(2, 9),
      username: username.trim()
    }

    try {
      fs.writeFileSync(profilePath, JSON.stringify(newProfile, null, 2), 'utf-8')
    } catch (e) {
      console.error('Error guardando profile.json:', e)
    }

    myProfile = newProfile
    announcePresence()
    return myProfile
  })

  // Enviar mensaje privado a un contacto específico en la Wi-Fi
  ipcMain.on('send-direct-message', (_, { targetId, text }: { targetId: string; text: string }) => {
    if (!myProfile) return
    broadcast({
      type: 'direct_chat',
      senderId: myProfile.userId,
      targetId,
      username: myProfile.username,
      text,
      timestamp: Date.now()
    })
  })

  createWindow()
  setupLanNetwork()

  autoUpdater.checkForUpdatesAndNotify().catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (socket) socket.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
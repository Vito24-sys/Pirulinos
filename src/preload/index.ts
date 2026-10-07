import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getProfile: () => ipcRenderer.invoke('get-profile'),

  createProfile: (username: string) => ipcRenderer.invoke('create-profile', username),

  // Ahora enviamos el ID del destinatario junto al texto
  sendDirectMessage: (targetId: string, text: string) =>
    ipcRenderer.send('send-direct-message', { targetId, text }),

  onLanPacket: (callback: (packet: any) => void) => {
    ipcRenderer.on('lan-packet-received', (_event, value) => callback(value))
  }
})
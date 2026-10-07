export interface UserProfile {
  userId: string
  username: string
}

export interface LanPacket {
  type: 'presence' | 'direct_chat'
  senderId: string
  targetId?: string
  username: string
  text?: string
  timestamp?: number
  ip?: string
}

export interface IpcApi {
  getProfile: () => Promise<UserProfile | null>
  createProfile: (username: string) => Promise<UserProfile>
  sendDirectMessage: (targetId: string, text: string) => void
  onLanPacket: (callback: (packet: LanPacket) => void) => void
}

declare global {
  interface Window {
    api: IpcApi
  }
}
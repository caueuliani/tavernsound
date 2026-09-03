export {}

declare global {
  interface Window {
    updateAgoraMapping?: (socketId: string, agoraUid: string) => void
    socket?: any
  }
}
export const REALAPP_TOOLS_SHUTDOWN_AT = '2026-06-14T22:00:00.000Z'

export function usernameImportDisabled(now = new Date()): boolean {
  return now.getTime() >= new Date(REALAPP_TOOLS_SHUTDOWN_AT).getTime()
}

export function realappToolsShutdownLabel(): string {
  return 'June 14, 2026 at 6 PM ET'
}

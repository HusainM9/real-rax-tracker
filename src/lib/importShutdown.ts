export const REALAPP_TOOLS_SHUTDOWN_AT = '2026-06-14T22:00:00.000Z'

/** Local testing: set VITE_TEST_ADMIN_CACHE_IMPORT=true in .env.local */
export function testAdminCacheImportEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    String(import.meta.env.VITE_TEST_ADMIN_CACHE_IMPORT ?? '')
      .trim()
      .toLowerCase() === 'true'
  )
}

/**
 * Username import now reads pass lists straight from Real through /api/import/real-passes.
 * Set VITE_REAL_IMPORT_ENABLED=true for the client and REAL_IMPORT_ENABLED=true plus the bot
 * credentials for the server.
 */
export function realProviderImportEnabled(): boolean {
  return (
    String(import.meta.env.VITE_REAL_IMPORT_ENABLED ?? '')
      .trim()
      .toLowerCase() === 'true'
  )
}

export function usernameImportDisabled(now = new Date()): boolean {
  if (testAdminCacheImportEnabled()) return true
  if (realProviderImportEnabled()) return false
  return now.getTime() >= new Date(REALAPP_TOOLS_SHUTDOWN_AT).getTime()
}

export function realappToolsShutdownLabel(): string {
  return 'June 14, 2026 at 6 PM ET'
}

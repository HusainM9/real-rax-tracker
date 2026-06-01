/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEOWBOT_SUPABASE_URL?: string
  readonly VITE_MEOWBOT_SUPABASE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_API?: string
  readonly VITE_IDLE_LOGOUT_MINUTES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

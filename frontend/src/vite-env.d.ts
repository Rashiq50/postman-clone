/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute API root for production builds, e.g. https://api.example.com/api.
   * Unset in development, where Vite proxies /api to the backend.
   */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

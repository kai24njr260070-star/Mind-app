/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ネイティブアプリから叩くWorkerのURL(空なら同一オリジン)。 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

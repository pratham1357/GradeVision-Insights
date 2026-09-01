/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the GradeVision API (without the /api/v1 prefix). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

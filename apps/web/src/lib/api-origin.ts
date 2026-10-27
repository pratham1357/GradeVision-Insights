/**
 * The one server origin the web app talks to (REST under /api/v1 and Socket.IO
 * at /realtime). Set at BUILD time with VITE_API_BASE_URL.
 *
 * The local-development default (http://localhost:4000) applies only to the
 * Vite dev server. A production build without VITE_API_BASE_URL has no backend
 * at all - it must never quietly point visitors' browsers at their own machine.
 */
export function resolveApiOrigin(configured: string | undefined, isDev: boolean): string | null {
  const value = configured?.trim().replace(/\/+$/u, "");
  if (value) return value;
  return isDev ? "http://localhost:4000" : null;
}

export const API_ORIGIN = resolveApiOrigin(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);

export const NO_BACKEND_MESSAGE =
  "This deployment is not connected to a GradeVision server, so signing in is not available here. " +
  "The working demo runs on the presenter's machine.";

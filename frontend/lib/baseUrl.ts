import { headers } from "next/headers";

/** Public base URL of this deployment, e.g. https://bahi.vercel.app.
 * Set APP_URL in production; otherwise it's read from the request. */
export function getBaseUrl(): string | null {
  const env = process.env.APP_URL?.replace(/\/+$/, "");
  if (env) return env;
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

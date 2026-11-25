/**
 * Discord's media proxy fetches external activity images from its own servers,
 * so a localhost URL will never render. Keep the last public HTTPS host seen by
 * the HTTP server and use it for Rich Presence head images when the static
 * config still points at localhost.
 */
let observedPublicBase = "";

type HeaderValue = string | string[] | undefined;

export function rememberPublicBaseUrl(headers: { host?: HeaderValue; "x-forwarded-proto"?: HeaderValue }): void {
  const hostValue = headers.host;
  const host = String(Array.isArray(hostValue) ? hostValue[0] : hostValue || "").trim();
  if (!host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(host)) return;

  const protoValue = headers["x-forwarded-proto"];
  const proto = String(Array.isArray(protoValue) ? protoValue[0] : protoValue || "https")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (proto !== "https") return;

  observedPublicBase = `https://${host}`;
}

export function effectivePublicBaseUrl(configured: string): string {
  const base = String(configured || "").trim().replace(/\/+$/, "");
  if (base && !/^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(base)) return base;
  return observedPublicBase;
}

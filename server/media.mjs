import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
export function isPublicIp(ip) {
  if (isIP(ip) === 4) {
    const a = ip.split(".").map(Number);
    return !(
      a[0] === 0 ||
      a[0] === 10 ||
      a[0] === 127 ||
      a[0] >= 224 ||
      (a[0] === 169 && a[1] === 254) ||
      (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168) ||
      (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
      (a[0] === 198 && [18, 19, 51].includes(a[1])) ||
      (a[0] === 192 && a[1] === 0) ||
      (a[0] === 203 && a[1] === 0)
    );
  }
  if (isIP(ip) === 6)
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
  return false;
}
export async function fetchPublic(url, limit = 8 * 1024 * 1024, redirects = 0) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("Unsafe URL");
  const addresses = await dns.lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((x) => !isPublicIp(x.address)))
    throw new Error("Private/reserved network is blocked");
  const addr = addresses.find((x) => x.family === 4) || addresses[0];
  const result = await new Promise((resolve, reject) => {
    const r = https.get(
      u,
      {
        headers: { "User-Agent": "T-Biz-Media/1.0", Accept: "*/*" },
        lookup: (host, options, cb) =>
          options.all ? cb(null, [addr]) : cb(null, addr.address, addr.family),
        timeout: 12000,
      },
      (s) => {
        if ([301, 302, 303, 307, 308].includes(s.statusCode)) {
          s.resume();
          return resolve({ redirect: s.headers.location });
        }
        if (s.statusCode !== 200) {
          s.resume();
          return reject(new Error("Source fetch failed"));
        }
        if (Number(s.headers["content-length"] || 0) > limit) {
          s.destroy();
          return reject(new Error("File too large"));
        }
        let size = 0;
        const chunks = [];
        s.on("data", (c) => {
          size += c.length;
          if (size > limit) {
            r.destroy(new Error("File too large"));
            return;
          }
          chunks.push(c);
        });
        s.on("end", () =>
          resolve({
            bytes: Buffer.concat(chunks),
            contentType: String(s.headers["content-type"] || "").split(";")[0],
          }),
        );
        s.on("error", reject);
      },
    );
    r.on("timeout", () => r.destroy(new Error("Source fetch timed out")));
    r.on("error", reject);
  });
  if (result.redirect) {
    if (redirects >= 3) throw new Error("Too many redirects");
    return fetchPublic(new URL(result.redirect, u).href, limit, redirects + 1);
  }
  return result;
}
export function imageType(b) {
  if (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: "image/png", ext: "png" };
  if (
    b.length > 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  throw new Error("JPEG/PNG/WebP画像のみ利用できます。");
}
export const serviceReady = () =>
  Boolean(
    (process.env.MANUS_API_URL || process.env.BUILT_IN_FORGE_API_URL) &&
    (process.env.MANUS_API_KEY || process.env.BUILT_IN_FORGE_API_KEY),
  );
export async function serviceCall(path, body) {
  const base = process.env.MANUS_API_URL || process.env.BUILT_IN_FORGE_API_URL;
  const key = process.env.MANUS_API_KEY || process.env.BUILT_IN_FORGE_API_KEY;
  if (!base || !key) throw new Error("Manus service credential unavailable");
  const r = await fetch(base.replace(/\/$/, "") + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "connect-protocol-version": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!r.ok || j.error) {
    const error = new Error(`Manus service failed (${r.status})`);
    error.code =
      typeof j.error?.code === "string"
        ? j.error.code.slice(0, 80)
        : "SERVICE_FAILURE";
    throw error;
  }
  return j;
}
export async function storeImage(bytes) {
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error("画像は8MB以下にしてください。");
  imageType(bytes);
  const normalized = await sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
  const key = `tbiz/images/${randomUUID()}.webp`;
  const signed = await serviceCall(
    `/v1/storage/presign/put?path=${encodeURIComponent(key)}`,
  );
  if (!signed.url) throw new Error("Storage unavailable");
  const r = await fetch(signed.url, {
    method: "PUT",
    headers: { "content-type": "image/webp" },
    body: normalized,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error("Image transfer failed");
  return "/manus-storage/" + key;
}
export async function storeImageUrl(url) {
  if (url.startsWith("/manus-storage/")) return url;
  const { bytes } = await fetchPublic(url);
  return storeImage(bytes);
}

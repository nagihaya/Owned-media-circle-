import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { query } from "./db.mjs";
const COOKIE = "webdev_app_session";
const APP_ID = "tbiz-media";
const secret = () => {
  const v = process.env.TBIZ_SESSION_SECRET;
  if (!v || v.length < 32) throw new Error("Session signing key unavailable");
  return new TextEncoder().encode(v);
};
export const emailHash = (e) =>
  createHmac("sha256", secret()).update(e.trim().toLowerCase()).digest("hex");
export const digest = (v) =>
  createHmac("sha256", secret()).update(v).digest("hex");
export function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function approvedOrigin(origin) {
  if (typeof origin !== "string") return false;
  const port = Number(process.env.PORT || 3000);
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  for (const value of [
    process.env.TBIZ_PUBLIC_ORIGIN,
    process.env.TBIZ_PREVIEW_ORIGIN,
  ])
    if (value)
      try {
        const u = new URL(value);
        if (u.protocol === "https:" && !u.username && !u.password)
          allowed.add(u.origin);
      } catch {}
  return allowed.has(origin);
}
export function cookieOptions(req) {
  const loopback =
    process.env.TBIZ_BIND_HOST === "127.0.0.1" &&
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get("host") || "") &&
    !req.get("x-forwarded-host") &&
    !req.get("x-forwarded-proto");
  return {
    httpOnly: true,
    secure: !loopback,
    sameSite: loopback ? "lax" : "none",
    path: "/",
  };
}
export async function verifyProjectToken(token) {
  const { payload } = await jwtVerify(token, secret(), {
    algorithms: ["HS256"],
  });
  if (
    payload.appId !== APP_ID ||
    typeof payload.openId !== "string" ||
    typeof payload.exp !== "number"
  )
    throw new Error("Invalid project session");
  return payload;
}
export async function currentUser(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const p = await verifyProjectToken(token);
    if (p.jti) {
      const rows = await query(
        "SELECT jti FROM sessions WHERE jti=? AND open_id=? AND expires_at>UTC_TIMESTAMP()",
        [digest(p.jti), p.openId],
      );
      if (!rows.length) return null;
    }
    const rows = await query(
      "SELECT open_id AS openId,name,role,active FROM users WHERE open_id=?",
      [p.openId],
    );
    return rows[0]?.active ? rows[0] : null;
  } catch {
    return null;
  }
}
export async function requireEditor(req, res, next) {
  req.user = await currentUser(req);
  if (!req.user) return res.status(401).json({ error: "ログインが必要です。" });
  if (!["admin", "editor"].includes(req.user.role))
    return res.status(403).json({ error: "編集権限がありません。" });
  next();
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "管理者のみ操作できます。" });
  next();
}
export function csrfToken(req, res) {
  let seed = req.cookies?.tbiz_form;
  if (!/^[a-f0-9]{64}$/.test(seed || "")) {
    seed = randomBytes(32).toString("hex");
    res.cookie("tbiz_form", seed, { ...cookieOptions(req), maxAge: 86400000 });
    req.cookies.tbiz_form = seed;
  }
  return digest(seed);
}
export function csrfGuard(req, res, next) {
  const v = req.get("x-csrf-token") || req.body?._csrf;
  if (!req.cookies?.tbiz_form || !equal(v, digest(req.cookies.tbiz_form)))
    return res.status(403).json({
      error: "安全確認が失敗しました。ページを再読み込みしてください。",
    });
  if (req.get("sec-fetch-site") === "cross-site")
    return res
      .status(403)
      .json({ error: "異なるサイトからの操作はできません。" });
  next();
}
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
let googleKeys;
const googleJwks = () =>
  (googleKeys ||= createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  ));
function googleClient() {
  const id = process.env.GOOGLE_CLIENT_ID,
    secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google login is not configured");
  return { id, secret };
}
export async function verifyGoogleIdToken(idToken, nonce, keys = googleJwks()) {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: GOOGLE_ISSUERS,
    audience: process.env.GOOGLE_CLIENT_ID,
    algorithms: ["RS256"],
  });
  if (typeof payload.sub !== "string" || !payload.sub)
    throw new Error("Invalid identity");
  if (typeof nonce !== "string" || !equal(payload.nonce, nonce))
    throw new Error("Nonce mismatch");
  return {
    openId: "google:" + payload.sub,
    name: String(payload.name || ""),
    email:
      payload.email_verified === true && typeof payload.email === "string"
        ? payload.email
        : null,
  };
}
async function exchangeGoogleCode(code, redirectUri) {
  const c = googleClient();
  const r = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.id,
      client_secret: c.secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || typeof j.id_token !== "string")
    throw new Error("Token exchange failed");
  return j.id_token;
}
export async function startLogin(req, res) {
  const origin = req.query.origin;
  if (!approvedOrigin(origin))
    return res
      .status(400)
      .send(
        "サイトのログインURLが未設定、または許可されていません。管理者は公開オリジンを設定してください。",
      );
  let client;
  try {
    client = googleClient();
  } catch {
    return res
      .status(503)
      .send(
        "Googleログインが未設定です。管理者はサーバー設定を確認してください。",
      );
  }
  const redirectUri = origin + "/auth/callback",
    nonce = randomBytes(32).toString("hex");
  const state = Buffer.from(JSON.stringify({ redirectUri, nonce })).toString(
    "base64url",
  );
  await query(
    "INSERT INTO oauth_nonces (nonce_hash,redirect_uri,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE))",
    [digest(nonce), redirectUri],
  );
  res.cookie("tbiz_oauth_nonce", digest(nonce), {
    ...cookieOptions(req),
    maxAge: 600000,
  });
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.href);
}
export async function finishLogin(req, res) {
  try {
    if (
      typeof req.query.state !== "string" ||
      req.query.state.length > 2048 ||
      typeof req.query.code !== "string"
    )
      throw new Error("Invalid callback");
    const state = JSON.parse(
      Buffer.from(req.query.state, "base64url").toString("utf8"),
    );
    if (
      typeof state.nonce !== "string" ||
      typeof state.redirectUri !== "string" ||
      !equal(req.cookies.tbiz_oauth_nonce, digest(state.nonce))
    )
      throw new Error("Invalid OAuth state");
    const u = new URL(state.redirectUri);
    if (
      !approvedOrigin(u.origin) ||
      u.pathname !== "/auth/callback" ||
      u.search ||
      u.hash
    )
      throw new Error("Callback origin is not allowed");
    const consumed = await query(
      "DELETE FROM oauth_nonces WHERE nonce_hash=? AND redirect_uri=? AND expires_at>UTC_TIMESTAMP()",
      [digest(state.nonce), state.redirectUri],
    );
    if (consumed.affectedRows !== 1)
      throw new Error("State expired or already used");
    res.clearCookie("tbiz_oauth_nonce", cookieOptions(req));
    const idToken = await exchangeGoogleCode(req.query.code, state.redirectUri);
    const info = await verifyGoogleIdToken(idToken, state.nonce);
    const hash = info.email ? emailHash(info.email) : null;
    await query(
      "INSERT INTO users (open_id,name,email_hash,last_login) VALUES (?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE name=VALUES(name),email_hash=VALUES(email_hash),last_login=UTC_TIMESTAMP()",
      [info.openId, String(info.name || "").slice(0, 160), hash],
    );
    const existing = (
      await query("SELECT role,active FROM users WHERE open_id=?", [
        info.openId,
      ])
    )[0];
    if (
      existing.active &&
      existing.role === "viewer" &&
      info.email &&
      process.env.TBIZ_ADMIN_EMAIL &&
      equal(hash, emailHash(process.env.TBIZ_ADMIN_EMAIL))
    ) {
      const c = await query(
        "SELECT COUNT(*) AS n FROM users WHERE role='admin'",
      );
      if (Number(c[0].n) === 0)
        await query("UPDATE users SET role='admin' WHERE open_id=?", [
          info.openId,
        ]);
    }
    const invite = hash
      ? (
          await query("SELECT role FROM role_invites WHERE email_hash=?", [
            hash,
          ])
        )[0]
      : null;
    if (existing.active && invite) {
      await query(
        "UPDATE users SET role='editor' WHERE open_id=? AND role='viewer'",
        [info.openId],
      );
      await query("DELETE FROM role_invites WHERE email_hash=?", [hash]);
    }
    const jti = randomBytes(32).toString("hex");
    await query(
      "INSERT INTO sessions (jti,open_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))",
      [digest(jti), info.openId],
    );
    const jwt = await new SignJWT({
      openId: info.openId,
      appId: APP_ID,
      name: String(info.name || ""),
      jti,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret());
    res.cookie(COOKIE, jwt, { ...cookieOptions(req), maxAge: 7 * 86400000 });
    res.redirect("/admin");
  } catch {
    res.status(401).render("login", {
      title: "ログインできませんでした",
      message: "認証を確認できませんでした。もう一度ログインしてください。",
      csrf: csrfToken(req, res),
    });
  }
}
export async function logout(req, res) {
  try {
    const p = await verifyProjectToken(req.cookies[COOKIE]);
    if (p.jti) await query("DELETE FROM sessions WHERE jti=?", [digest(p.jti)]);
  } catch {}
  res.clearCookie(COOKIE, cookieOptions(req));
  res.json({ ok: true });
}
export function scheduledAuthorized(req) {
  const expected = process.env.TBIZ_CRON_SECRET;
  if (!expected || expected.length < 32) return false;
  const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
  const sha = (v) => createHash("sha256").update(v).digest("hex");
  return Boolean(m) && equal(sha(m[1]), sha(expected));
}

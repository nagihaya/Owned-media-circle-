import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import {
  verifyGoogleIdToken,
  scheduledAuthorized,
  verifyProjectToken,
} from "../server/auth.mjs";
import { MEDIA_PATH } from "../server/media.mjs";

const CLIENT = "test-client.apps.googleusercontent.com";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
const keys = createLocalJWKSet({ keys: [jwk] });
const idToken = (claims = {}, opts = {}) =>
  new SignJWT({
    sub: "12345",
    name: "テスト",
    email: "editor@example.test",
    email_verified: true,
    nonce: "n1",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss || "https://accounts.google.com")
    .setAudience(opts.aud || CLIENT)
    .setIssuedAt()
    .setExpirationTime(opts.exp || "5m")
    .sign(privateKey);

test("Google ID token: valid token maps to a namespaced user", async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  const u = await verifyGoogleIdToken(await idToken(), "n1", keys);
  assert.equal(u.openId, "google:12345");
  assert.equal(u.email, "editor@example.test");
});
test("Google ID token: wrong audience, issuer, nonce or expiry is rejected", async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  for (const t of [
    await idToken({}, { aud: "other-client" }),
    await idToken({}, { iss: "https://evil.example" }),
    await idToken({}, { exp: "-1m" }),
  ])
    await assert.rejects(() => verifyGoogleIdToken(t, "n1", keys));
  await assert.rejects(async () =>
    verifyGoogleIdToken(await idToken(), "different-nonce", keys),
  );
});
test("Google ID token: unverified email is not used for admin/editor matching", async () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  const u = await verifyGoogleIdToken(
    await idToken({ email_verified: false }),
    "n1",
    keys,
  );
  assert.equal(u.email, null);
});
test("scheduled endpoint requires a long shared secret as a Bearer token", () => {
  const req = (h) => ({ get: (k) => (k === "authorization" ? h : undefined) });
  const prev = process.env.TBIZ_CRON_SECRET;
  delete process.env.TBIZ_CRON_SECRET;
  assert.equal(scheduledAuthorized(req("Bearer anything")), false);
  process.env.TBIZ_CRON_SECRET = "short";
  assert.equal(scheduledAuthorized(req("Bearer short")), false);
  const s = "x".repeat(40);
  process.env.TBIZ_CRON_SECRET = s;
  assert.equal(scheduledAuthorized(req("Bearer " + s)), true);
  assert.equal(scheduledAuthorized(req("Bearer " + s + "y")), false);
  assert.equal(scheduledAuthorized(req(s)), false);
  assert.equal(scheduledAuthorized(req(undefined)), false);
  if (prev === undefined) delete process.env.TBIZ_CRON_SECRET;
  else process.env.TBIZ_CRON_SECRET = prev;
});
test("session tokens require this app's signing key and app id", async () => {
  const prev = process.env.TBIZ_SESSION_SECRET;
  process.env.TBIZ_SESSION_SECRET = "s".repeat(40);
  const key = new TextEncoder().encode("s".repeat(40));
  const make = (appId) =>
    new SignJWT({ openId: "google:1", appId })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key);
  assert.equal(
    (await verifyProjectToken(await make("tbiz-media"))).openId,
    "google:1",
  );
  await assert.rejects(async () => verifyProjectToken(await make("other")));
  process.env.TBIZ_SESSION_SECRET = "short";
  await assert.rejects(async () =>
    verifyProjectToken(await make("tbiz-media")),
  );
  if (prev === undefined) delete process.env.TBIZ_SESSION_SECRET;
  else process.env.TBIZ_SESSION_SECRET = prev;
});
test("stored image paths only match generated UUID webp files", () => {
  assert.ok(
    MEDIA_PATH.test("/media/6726228c-ef40-4e50-afbe-d6ba592202ce.webp"),
  );
  for (const p of [
    "/media/../etc/passwd",
    "/media/abc.webp",
    "/manus-storage/tbiz/images/x.webp",
    "https://evil.example/media/6726228c-ef40-4e50-afbe-d6ba592202ce.webp",
  ])
    assert.equal(MEDIA_PATH.test(p), false, p);
});

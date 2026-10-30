import test from "node:test";
import assert from "node:assert/strict";
import {
  safeUrl,
  sortByPublished,
  contactSchema,
  articleSchema,
  TYPES,
} from "../server/validation.mjs";
import { isPublicIp, imageType } from "../server/media.mjs";
import { plain } from "../server/rss.mjs";
import {
  equal,
  verifyProjectToken,
  approvedOrigin,
  cookieOptions,
} from "../server/auth.mjs";
const note = "https://note.com/tbiz/n/n123abc";
test("note URL is canonical and rejects non-article/unsafe URLs", () => {
  assert.equal(safeUrl(note + "?utm=test#x", { note: true }), note);
  for (const u of [
    "https://note.com/",
    "http://note.com/t/n/n123",
    "https://evil.test/t/n/n123",
    "https://note.com@evil.test/t/n/n123",
  ])
    assert.throws(() => safeUrl(u, { note: true }));
});
test("newest/oldest use publication dates, not IDs", () => {
  const xs = [
    { id: "z9", publishedAt: "2024-01-01" },
    { id: "a1", publishedAt: "2026-01-01" },
  ];
  assert.equal(sortByPublished(xs)[0].id, "a1");
  assert.equal(sortByPublished(xs, "old")[0].id, "z9");
  assert.equal(xs[0].id, "z9");
});
test("private/loopback/link-local/IPv6 network is blocked", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.0.1",
    "172.16.0.1",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("8.8.8.8"), true);
});
test("contact requires phone, all fields, consent and request UUID", () => {
  const v = {
    kind: "取材依頼",
    company: "テスト団体",
    name: "担当者",
    email: "person@example.test",
    phone: "03-1234-5678",
    message: "ご相談",
    consent: true,
    website: "",
    requestId: "6726228c-ef40-4e50-afbe-d6ba592202ce",
  };
  assert.equal(contactSchema.safeParse(v).success, true);
  for (const k of [
    "kind",
    "company",
    "name",
    "email",
    "phone",
    "message",
    "consent",
    "requestId",
  ]) {
    const x = { ...v };
    delete x[k];
    assert.equal(contactSchema.safeParse(x).success, false, k);
  }
  assert.equal(
    contactSchema.safeParse({ ...v, website: "spam" }).success,
    false,
  );
});
test("article type choices have exactly four types; unknown represented by null", () => {
  assert.deepEqual(TYPES, [
    "経営者インタビュー",
    "若手社員インタビュー",
    "座談会",
    "ビジネス知識",
  ]);
  const v = {
    title: "記事",
    lead: "冒頭",
    noteUrl: note,
    publishedAt: "2026-01-02T09:00:00+09:00",
    industry: null,
    size: null,
    type: null,
    visible: false,
    imageUrl: "",
  };
  assert.equal(articleSchema.safeParse(v).success, true);
  assert.equal(
    articleSchema.safeParse({ ...v, type: "活動情報" }).success,
    false,
  );
  assert.equal(
    articleSchema.safeParse({ ...v, publishedAt: "invalid" }).success,
    false,
  );
});
test("HTML content is stripped and SVG is not accepted as an image", () => {
  assert.equal(plain("<script>bad()</script><p>本文</p>"), "本文");
  assert.throws(() => imageType(Buffer.from('<svg onload="evil()"/>')));
});
test("session validation fails closed for invalid credentials", async () => {
  assert.equal(equal("abc", "abc"), true);
  assert.equal(equal("abc", "abcd"), false);
  await assert.rejects(() => verifyProjectToken("invalid-token"));
});
test("OAuth rejects attacker origins and allows only the declared local port", () => {
  assert.equal(approvedOrigin("https://attacker.example"), false);
  assert.equal(approvedOrigin("http://127.0.0.1:65534"), false);
  assert.equal(
    approvedOrigin("http://127.0.0.1:" + (process.env.PORT || 3000)),
    true,
  );
});
test("public HTTPS cookies use Secure and SameSite=None", () => {
  const req = {
    get: (k) => ({ host: "internal:3000", "x-forwarded-proto": "https" })[k],
  };
  const c = cookieOptions(req);
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, "none");
  assert.equal(c.httpOnly, true);
});
test("bad note article URL is a validation failure rather than an uncaught exception", () => {
  const v = {
    title: "記事",
    lead: "本文",
    noteUrl: "https://note.com/",
    publishedAt: "2026-01-02T00:00:00Z",
    industry: null,
    size: null,
    type: null,
    visible: false,
    imageUrl: "",
  };
  assert.equal(articleSchema.safeParse(v).success, false);
});

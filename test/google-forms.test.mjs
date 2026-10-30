import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ejs from "ejs";
import {
  googleFormUrl,
  cleanForms,
  formView,
  formsSchema,
  FORM_SLOTS,
} from "../server/google-forms.mjs";
import { publicSettings } from "../server/db.mjs";
const url = "https://docs.google.com/forms/d/e/TEST_FORM_ID/viewform";
test("canonical responder link is embedded and strips tracking and prefilled data", () => {
  const r = googleFormUrl(url + "?entry.123=private&usp=sharing#test");
  assert.equal(r.url, url);
  assert.equal(r.embedUrl, url + "?embedded=true");
});
test("official iframe code extracts only its src and discards all other attributes", () => {
  const r = googleFormUrl(
    `<iframe src="${url}?embedded=true&amp;usp=sharing" width="640" height="900" onload="alert(1)"></iframe>`,
  );
  assert.deepEqual(r, googleFormUrl(url));
  assert.ok(!JSON.stringify(r).includes("onload"));
});
test("short Google Forms URLs are link-only", () => {
  const r = googleFormUrl("https://forms.gle/TestCode123");
  assert.equal(r.embedUrl, "");
  assert.equal(r.url, "https://forms.gle/TestCode123");
});
test("unsafe sources, edit URLs, protocol-relative sources and arbitrary HTML are rejected", () => {
  for (const v of [
    "http://docs.google.com/forms/d/e/TEST/viewform",
    "https://docs.google.com.evil.test/forms/d/e/TEST/viewform",
    "https://docs.google.com@evil.test/forms/d/e/TEST/viewform",
    "https://docs.google.com:444/forms/d/e/TEST/viewform",
    "https://docs.google.com/forms/d/e/TEST/edit",
    "https://docs.google.com/forms/d/e/TEST/formResponse",
    "javascript:alert(1)",
    "//docs.google.com/forms/d/e/TEST/viewform",
    "<script>alert(1)</script>",
    `<iframe src="${url}"></iframe><script>alert(1)</script>`,
  ])
    assert.throws(() => googleFormUrl(v), v);
});
test("empty and unsafe legacy settings have safe unconfigured defaults", () => {
  assert.equal(googleFormUrl("").url, "");
  const f = cleanForms({
    inquiry: { url: "javascript:alert(1)", height: -10 },
  });
  assert.equal(f.inquiry.url, "");
  assert.equal(f.inquiry.height, 1000);
  assert.equal(Object.keys(f).length, 4);
});
test("form settings require all four fixed slots, valid URLs and bounded numeric heights", () => {
  const forms = cleanForms();
  forms.inquiry = { url, height: 1200 };
  assert.equal(formsSchema.safeParse({ revision: 1, forms }).success, true);
  assert.equal(
    formsSchema.safeParse({
      revision: 1,
      forms: { ...forms, other: { url, height: 1000 } },
    }).success,
    false,
  );
  assert.equal(
    formsSchema.safeParse({
      revision: 1,
      forms: { ...forms, inquiry: { url, height: 999999 } },
    }).success,
    false,
  );
  assert.equal(
    formsSchema.safeParse({
      revision: 1,
      forms: { ...forms, inquiry: { url: "https://evil.test", height: 1000 } },
    }).success,
    false,
  );
});
test("contact categories switch between configured forms and recruitment stays separate", () => {
  const forms = cleanForms();
  forms.inquiry.url = url;
  forms.sponsor.url = url;
  forms.recruitment.url = url;
  assert.equal(formView(forms, "/contact", "sponsor").selected, "sponsor");
  assert.equal(formView(forms, "/contact", "recruitment").selected, "inquiry");
  assert.equal(formView(forms, "/recruit", "sponsor").selected, "recruitment");
  assert.equal(formView({}, "/contact", "invalid").url, "");
});
test("public settings preserve forms while withholding internal settings", () => {
  const s = publicSettings({
    siteName: "未定",
    googleForms: { inquiry: { url, height: 1200 } },
    rssUrl: "private",
    smtpPassword: "private",
    adminEmail: "private",
  });
  assert.equal(s.googleForms.inquiry.url, url);
  assert.equal(s.googleForms.inquiry.height, 1200);
  assert.ok(!("adminEmail" in s));
  assert.ok(!("smtpPassword" in s));
  assert.ok(!("rssUrl" in s));
});
test("embedded template has responsive dimensions, accessible title and external fallback", async () => {
  const html = await ejs.renderFile("views/google-form.ejs", {
    googleForm: formView(
      { inquiry: { url, height: 1100 } },
      "/contact",
      "inquiry",
    ),
  });
  assert.match(html, /width="100%"/);
  assert.match(html, /height="1100"/);
  assert.match(html, /title="お問い合わせ共通 — Googleフォーム"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /別のタブで開く/);
  assert.ok(!html.includes("contactForm"));
});
test("unconfigured template never invents a form URL or iframe", async () => {
  const html = await ejs.renderFile("views/google-form.ejs", {
    googleForm: formView({}, "/contact"),
  });
  assert.match(html, /フォームを準備中/);
  assert.ok(!html.includes("<iframe"));
});
test("editor template includes four URL inputs, height inputs and previews", async () => {
  const html = await ejs.renderFile("views/forms-admin.ejs", {
    formSlots: FORM_SLOTS,
  });
  for (const s of FORM_SLOTS) {
    assert.match(html, new RegExp('name="' + s.key + 'Url"'));
    assert.match(html, new RegExp('data-form-preview="' + s.key + '"'));
  }
  assert.match(html, /id="googleFormsForm"/);
});
test("production has no native form submission or SMTP dependency and private gates remain", () => {
  const client = fs.readFileSync("public/app.js", "utf8"),
    server = fs.readFileSync("server/index.mjs", "utf8"),
    admin = fs.readFileSync("server/admin.mjs", "utf8"),
    maintenance = fs.readFileSync("server/maintenance.mjs", "utf8");
  assert.ok(!client.includes("/api/contact"));
  assert.ok(!server.includes('from "./mail.mjs"'));
  assert.ok(!admin.includes("sendPending"));
  assert.ok(!maintenance.includes("sendPending"));
  assert.match(admin, /admin\.use\(requireEditor\)/);
  assert.match(admin, /csrfGuard\(req, res, next\)/);
  assert.match(admin, /AND revision=\?/);
});

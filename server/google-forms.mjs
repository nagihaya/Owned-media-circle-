import { z } from "zod";
export const FORM_SLOTS = [
  { key: "inquiry", label: "お問い合わせ共通" },
  { key: "interview", label: "取材依頼" },
  { key: "sponsor", label: "協賛相談" },
  { key: "recruitment", label: "メンバー募集" },
];
export function googleFormUrl(input) {
  let value = String(input ?? "").trim();
  if (!value) return { url: "", embedUrl: "" };
  if (value.length > 4096) throw new Error("フォームURLが長すぎます。");
  if (value.startsWith("<")) {
    const match = value.match(
      /^<iframe\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>\s*<\/iframe>$/i,
    );
    if (!match)
      throw new Error(
        "GoogleフォームのURLまたはiframe埋め込みコードを入力してください。",
      );
    value = match[2].replaceAll("&amp;", "&");
  }
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    value.length > 2048
  )
    throw new Error("安全なGoogleフォームのHTTPS URLを入力してください。");
  u.hash = "";
  u.search = "";
  if (u.hostname === "forms.gle" && /^\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname))
    return { url: u.href, embedUrl: "" };
  if (
    u.hostname !== "docs.google.com" ||
    !/^\/forms\/d\/(?:e\/)?[a-zA-Z0-9_-]+\/viewform\/?$/.test(u.pathname)
  )
    throw new Error(
      "Googleフォームの回答者用URL（末尾viewform）を入力してください。編集用URLは使えません。",
    );
  u.pathname = u.pathname.replace(/\/$/, "");
  const url = u.href;
  u.searchParams.set("embedded", "true");
  return { url, embedUrl: u.href };
}
const urlSchema = z
  .string()
  .max(4096)
  .refine((v) => {
    try {
      googleFormUrl(v);
      return true;
    } catch {
      return false;
    }
  }, "Googleフォームの回答者URLかiframe埋め込みコードが必要です")
  .transform((v) => googleFormUrl(v).url);
const slotSchema = z
  .object({ url: urlSchema, height: z.number().int().min(350).max(3000) })
  .strict();
export const formsSchema = z
  .object({
    revision: z.number().int().positive(),
    forms: z
      .object(Object.fromEntries(FORM_SLOTS.map((s) => [s.key, slotSchema])))
      .strict(),
  })
  .strict();
export function cleanForms(value = {}) {
  return Object.fromEntries(
    FORM_SLOTS.map((s) => {
      let link;
      try {
        link = googleFormUrl(value?.[s.key]?.url || "");
      } catch {
        link = { url: "", embedUrl: "" };
      }
      const raw = Number(value?.[s.key]?.height);
      const height =
        Number.isInteger(raw) && raw >= 350 && raw <= 3000 ? raw : 1000;
      return [s.key, { url: link.url, height }];
    }),
  );
}
export function formView(forms, route, requested) {
  const clean = cleanForms(forms);
  const keys =
    route === "/recruit"
      ? ["recruitment"]
      : FORM_SLOTS.filter(
          (s) => s.key !== "recruitment" && clean[s.key].url,
        ).map((s) => s.key);
  if (!keys.length) keys.push("inquiry");
  const selected = keys.includes(requested) ? requested : keys[0];
  const options = keys.map((key) => ({
    key,
    label: FORM_SLOTS.find((s) => s.key === key).label,
  }));
  const slot = FORM_SLOTS.find((s) => s.key === selected);
  return {
    options,
    selected,
    label: slot.label,
    height: clean[selected].height,
    ...googleFormUrl(clean[selected].url),
  };
}

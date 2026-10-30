import { z } from "zod";
export const TYPES = [
  "経営者インタビュー",
  "若手社員インタビュー",
  "座談会",
  "ビジネス知識",
];
export const INDUSTRIES = [
  "IT・SaaS",
  "メーカー",
  "金融",
  "コンサル",
  "人材",
  "その他",
];
export const SIZES = ["大企業", "スタートアップ・ベンチャー"];
export const INTERVIEW_TYPES = TYPES.slice(0, 3);
const enumNullable = (values) => z.enum(values).nullable();
export function safeUrl(value, { note = false, relative = false } = {}) {
  if (
    relative &&
    /^\/(?!\/)[a-zA-Z0-9/_.,%-]*(\?[a-zA-Z0-9_.,%=&+-]*)?$/.test(value)
  )
    return value;
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("HTTPSのURLを入力してください。");
  if (note && u.hostname !== "note.com")
    throw new Error("note.comの記事URLを入力してください。");
  if (note && !/^\/[^/]+\/n\/n[a-zA-Z0-9]+\/?$/.test(u.pathname))
    throw new Error("note記事本体のURLを入力してください。");
  u.hash = "";
  if (note) {
    u.search = "";
    u.pathname = u.pathname.replace(/\/$/, "");
  }
  return u.href;
}
const webUrl = z
  .string()
  .max(512)
  .refine((v) => {
    try {
      safeUrl(v, { relative: true });
      return true;
    } catch {
      return false;
    }
  }, "安全なHTTPS URLまたはサイト内パスが必要です");
export const settingSchema = z
  .object({
    siteName: z.string().trim().min(1).max(40),
    subtitle: z.string().trim().max(80),
    org: z.string().trim().min(1).max(240),
    noteUrl: webUrl,
    tbizUrl: webUrl,
    instagramUrl: z
      .string()
      .url()
      .max(512)
      .refine((v) => {
        try {
          safeUrl(v);
          return new URL(v).hostname === "www.instagram.com";
        } catch {
          return false;
        }
      }, "InstagramのURLは https://www.instagram.com/アカウント名 の形で入力してください。"),
    xUrl: z
      .string()
      .trim()
      .max(512)
      .refine((v) => {
        if (v === "") return true;
        try {
          safeUrl(v);
          return [
            "x.com",
            "www.x.com",
            "twitter.com",
            "www.twitter.com",
          ].includes(new URL(v).hostname);
        } catch {
          return false;
        }
      }, "XのURLは https://x.com/アカウント名 の形で入力してください（空欄なら非表示）。"),
    response: z.string().trim().min(1).max(40),
    contact: z.string().trim().max(240),
    policyDate: z
      .string()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)),
    revision: z.number().int().positive(),
  })
  .strict();
export const articleSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    lead: z.string().trim().max(2000),
    noteUrl: z
      .string()
      .max(512)
      .refine((v) => {
        try {
          safeUrl(v, { note: true });
          return true;
        } catch {
          return false;
        }
      }, "note記事本体のHTTPS URLを入力してください")
      .transform((v) => safeUrl(v, { note: true })),
    publishedAt: z
      .string()
      .datetime({ offset: true })
      .transform((v) => new Date(v)),
    industry: enumNullable(INDUSTRIES),
    size: enumNullable(SIZES),
    type: enumNullable(TYPES),
    visible: z.boolean(),
    featured: z.boolean().default(false),
    imageUrl: webUrl.or(z.literal("")),
    revision: z.number().int().nonnegative().optional(),
  })
  .strict();
export const contactSchema = z
  .object({
    kind: z.enum(["取材依頼", "協賛相談", "その他"]),
    company: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(100),
    email: z.string().email().max(254),
    phone: z
      .string()
      .trim()
      .regex(/^[+0-9()\-\s]{8,30}$/, "電話番号を確認してください"),
    message: z.string().trim().min(1).max(5000),
    consent: z.literal(true),
    website: z.string().max(0),
    requestId: z.string().uuid(),
  })
  .strict();
export const nullableValue = (v) => (v === "" ? null : v);
export function sortByPublished(items, direction = "new") {
  return [...items].sort((a, b) => {
    const n = new Date(a.publishedAt) - new Date(b.publishedAt);
    const c =
      new Date(a.createdAt || a.publishedAt) -
      new Date(b.createdAt || b.publishedAt);
    return (
      (direction === "old" ? 1 : -1) *
      (n || c || String(a.id).localeCompare(String(b.id)))
    );
  });
}

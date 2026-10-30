import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  query,
  settings,
  publicSettings,
  slides,
  articleList,
  metrics,
  parseJson,
} from "./db.mjs";
import { requireEditor, requireAdmin, csrfGuard, emailHash } from "./auth.mjs";
import { settingSchema, articleSchema, safeUrl } from "./validation.mjs";
import { aiReady, storeImage, storeImageUrl, MEDIA_PATH } from "./media.mjs";
import { syncRss, importNote, enrichPending } from "./rss.mjs";
import { maintenance } from "./maintenance.mjs";
import { formsSchema, googleFormUrl } from "./google-forms.mjs";
export const admin = Router();
admin.use(requireEditor);
admin.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
    return csrfGuard(req, res, next);
  next();
});
admin.get("/settings", async (req, res) => res.json(await settings()));
admin.put("/settings", async (req, res) => {
  const v = settingSchema.parse(req.body);
  const old = await settings();
  if (old.revision !== v.revision)
    return res
      .status(409)
      .json({ error: "別の編集者が更新しています。再読み込みしてください。" });
  const r = await query(
    "UPDATE site_settings SET data=?,revision=revision+1 WHERE id=1 AND revision=?",
    [
      JSON.stringify({ ...publicSettings(old), ...v, revision: undefined }),
      v.revision,
    ],
  );
  if (!r.affectedRows)
    return res.status(409).json({
      error: "別の編集者が更新しています。再読み込みして確認してください。",
    });
  res.json({ ok: true, settings: await settings() });
});
admin.put("/forms", async (req, res) => {
  const v = formsSchema.parse(req.body);
  const [row] = await query(
    "SELECT data,revision FROM site_settings WHERE id=1",
  );
  if (!row || row.revision !== v.revision)
    return res
      .status(409)
      .json({ error: "別の編集者が更新しています。再読み込みしてください。" });
  const next = { ...parseJson(row.data), googleForms: v.forms };
  const result = await query(
    "UPDATE site_settings SET data=?,revision=revision+1 WHERE id=1 AND revision=?",
    [JSON.stringify(next), v.revision],
  );
  if (!result.affectedRows)
    return res.status(409).json({
      error: "別の編集者が更新しています。再読み込みして確認してください。",
    });
  res.json({ ok: true, settings: await settings() });
});
admin.post("/forms/preview", async (req, res) => {
  const v = formsSchema.shape.forms.shape.inquiry.parse(req.body);
  res.json({ ...googleFormUrl(v.url), height: v.height });
});
admin.put("/rss", requireAdmin, async (req, res) => {
  const { url } = z
    .object({ url: z.string().max(512) })
    .strict()
    .parse(req.body);
  if (url) {
    const u = new URL(safeUrl(url));
    if (u.hostname !== "note.com" || !u.pathname.endsWith("/rss"))
      return res.status(400).json({
        error: "noteマガジンのRSS URL（末尾 /rss）を入力してください。",
      });
  }
  await query(
    "UPDATE site_settings SET rss_url=?,revision=revision+1 WHERE id=1",
    [url],
  );
  res.json({ ok: true });
});
admin.get("/status", async (req, res) => {
  const states = await query(
    "SELECT name,data,updated_at AS updatedAt FROM operation_state",
  );
  const jobs = await query(
    "SELECT task_uid AS taskUid,kind,active,last_run AS lastRun,last_status AS lastStatus FROM app_jobs",
  );
  res.json({
    formProvider: "google",
    aiConfigured: aiReady(),
    loginConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    cronConfigured: Boolean(process.env.TBIZ_CRON_SECRET),
    bootstrapConfigured: Boolean(process.env.TBIZ_ADMIN_EMAIL),
    states: states.map((x) => ({ ...x, data: parseJson(x.data) })),
    jobs,
  });
});
admin.get("/slides", async (req, res) => res.json(await slides(false)));
admin.put("/slides", async (req, res) => {
  const schema = z
    .array(
      z
        .object({
          id: z.number().int().positive().optional(),
          imageUrl: z.string().max(768),
          label: z.string().trim().max(80),
          linkUrl: z.string().max(512),
          visible: z.boolean(),
          revision: z.number().int().nonnegative().optional(),
        })
        .strict(),
    )
    .min(0)
    .max(5);
  const values = schema.parse(req.body);
  const old = await slides(false);
  if (old.some((o) => !values.some((v) => v.id === o.id)))
    return res
      .status(400)
      .json({ error: "スライドの削除には非表示設定を使用してください。" });
  const processed = [];
  for (const value of values) {
    const imageUrl = value.imageUrl ? await storeImageUrl(value.imageUrl) : "";
    if (value.visible && !imageUrl)
      return res
        .status(400)
        .json({ error: "公開するスライドには写真が必要です。" });
    const linkUrl = value.linkUrl
      ? safeUrl(value.linkUrl, { relative: true })
      : "";
    processed.push({ ...value, imageUrl, linkUrl });
  }
  const { database } = await import("./db.mjs");
  const conn = await database().getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < processed.length; i++) {
      const v = processed[i];
      if (v.id) {
        const [r] = await conn.execute(
          "UPDATE slides SET image_url=?,label=?,link_url=?,visible=?,position=?,revision=revision+1 WHERE id=? AND revision=?",
          [v.imageUrl, v.label, v.linkUrl, v.visible, i, v.id, v.revision],
        );
        if (!r.affectedRows) {
          const e = new Error("Conflict");
          e.status = 409;
          throw e;
        }
      } else {
        await conn.execute(
          "INSERT INTO slides (image_url,label,link_url,visible,position) VALUES (?,?,?,?,?)",
          [v.imageUrl, v.label, v.linkUrl, v.visible, i],
        );
      }
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});
admin.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "画像ファイルが必要です。" });
  res.json({ url: await storeImage(req.file.buffer) });
});
admin.put("/logo", async (req, res) => {
  const { url } = z
    .object({ url: z.string().regex(MEDIA_PATH).max(768) })
    .strict()
    .parse(req.body);
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.logoUrl',?),revision=revision+1 WHERE id=1",
    [url],
  );
  res.json({ ok: true });
});
admin.get("/articles", async (req, res) =>
  res.json(await articleList(req.query, true)),
);
admin.post("/articles", async (req, res) => {
  const v = articleSchema.parse(req.body);
  const image = v.imageUrl ? await storeImageUrl(v.imageUrl) : "";
  try {
    await query(
      "INSERT INTO articles (id,note_url,title,intro_text,image_url,published_at,industry,company_size,article_type,visible,manual_tags,classification_status) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)",
      [
        randomUUID(),
        v.noteUrl,
        v.title,
        v.lead,
        image,
        v.publishedAt,
        v.industry,
        v.size,
        v.type,
        v.visible,
        "manual",
      ],
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "同じnote記事は登録済みです。" });
    throw e;
  }
});
admin.put("/articles/:id", async (req, res) => {
  const v = articleSchema.parse(req.body);
  if (v.revision === undefined)
    return res.status(400).json({ error: "記事版が必要です。" });
  const image = v.imageUrl ? await storeImageUrl(v.imageUrl) : "";
  try {
    const r = await query(
      "UPDATE articles SET note_url=?,title=?,intro_text=?,image_url=?,published_at=?,industry=?,company_size=?,article_type=?,visible=?,manual_tags=1,classification_status=?,revision=revision+1 WHERE id=? AND revision=?",
      [
        v.noteUrl,
        v.title,
        v.lead,
        image,
        v.publishedAt,
        v.industry,
        v.size,
        v.type,
        v.visible,
        "manual",
        req.params.id,
        v.revision,
      ],
    );
    if (!r.affectedRows)
      return res.status(409).json({
        error: "記事が別の編集者に更新されました。再読み込みしてください。",
      });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "note URLが登録済みです。" });
    throw e;
  }
});
admin.post("/rss/sync", async (req, res) => res.json(await syncRss()));
admin.post("/rss/enrich", async (req, res) => res.json(await enrichPending()));
admin.post("/import", async (req, res) => {
  const { urls } = z
    .object({ urls: z.array(z.string().max(512)).min(1).max(5) })
    .strict()
    .parse(req.body);
  const result = [];
  for (const url of urls)
    try {
      result.push({ url, ...(await importNote(url)) });
    } catch {
      result.push({
        url,
        error: "取得できませんでした。記事登録フォームで登録してください。",
      });
    }
  res.json({ results: result });
});
admin.get("/metrics", async (req, res) => res.json(await metrics()));
admin.get("/users", requireAdmin, async (req, res) =>
  res.json({
    users: await query("SELECT open_id AS openId,name,role,active FROM users"),
    invites: await query(
      "SELECT email_hash AS id,created_at AS createdAt FROM role_invites",
    ),
  }),
);
admin.post("/users", requireAdmin, async (req, res) => {
  const { email } = z
    .object({ email: z.string().email().max(254) })
    .strict()
    .parse(req.body);
  const hash = emailHash(email);
  await query(
    "INSERT INTO role_invites (email_hash,created_by) VALUES (?,?) ON DUPLICATE KEY UPDATE created_by=VALUES(created_by)",
    [hash, req.user.openId],
  );
  await query(
    "UPDATE users SET role='editor',active=1 WHERE email_hash=? AND role IN ('editor','viewer')",
    [hash],
  );
  res.json({ ok: true });
});
admin.delete("/users/:id", requireAdmin, async (req, res) => {
  const r = await query(
    "UPDATE users SET active=0,role='viewer' WHERE open_id=? AND role<>'admin'",
    [req.params.id],
  );
  if (!r.affectedRows)
    return res.status(409).json({ error: "管理者は削除できません。" });
  const rows = await query("SELECT email_hash FROM users WHERE open_id=?", [
    req.params.id,
  ]);
  if (rows[0]?.email_hash)
    await query("DELETE FROM role_invites WHERE email_hash=?", [
      rows[0].email_hash,
    ]);
  await query("DELETE FROM sessions WHERE open_id=?", [req.params.id]);
  res.json({ ok: true });
});
admin.delete("/invites/:id", requireAdmin, async (req, res) => {
  await query("DELETE FROM role_invites WHERE email_hash=?", [req.params.id]);
  res.json({ ok: true });
});
admin.get("/mail", requireAdmin, (req, res) =>
  res
    .status(410)
    .json({ error: "フォーム回答はGoogleフォーム側で確認してください。" }),
);
admin.post("/maintenance", requireAdmin, async (req, res) =>
  res.json(await maintenance()),
);
admin.post("/mail/retry", requireAdmin, (req, res) =>
  res.status(410).json({
    error:
      "サイト側のメール送信は停止しています。Googleフォーム側で通知を設定してください。",
  }),
);

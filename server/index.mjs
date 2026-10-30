import express from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { migrate } from "../migrations/run.mjs";
import {
  query,
  settings,
  publicSettings,
  homeData,
  articleList,
  countEvent,
} from "./db.mjs";
import { admin } from "./admin.mjs";
import {
  currentUser,
  startLogin,
  finishLogin,
  logout,
  csrfGuard,
  csrfToken,
  scheduledIdentity,
} from "./auth.mjs";
import { INDUSTRIES, SIZES, TYPES } from "./validation.mjs";
import { maintenance } from "./maintenance.mjs";
import { formView, FORM_SLOTS } from "./google-forms.mjs";
import { syncRss, enrichPending } from "./rss.mjs";
import { policies } from "./policies.mjs";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = express();
app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(root, "views"));
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.get("/health", async (req, res) => {
  try {
    await query("SELECT version FROM schema_migrations WHERE version=1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
app.use(
  express.static(path.join(root, "public"), {
    index: false,
    dotfiles: "deny",
    maxAge: 0,
  }),
);
app.get("/auth/start", startLogin);
app.get("/auth/callback", finishLogin);
app.post("/auth/logout", csrfGuard, logout);
app.get("/api/session", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const user = await currentUser(req);
  res.json({
    user: user ? { name: user.name, role: user.role } : null,
    csrf: csrfToken(req, res),
  });
});
app.get("/api/articles", async (req, res) =>
  res.json(await articleList(req.query)),
);
app.use("/api/admin", admin);
app.post("/api/contact", (req, res) =>
  res
    .status(410)
    .json({
      error:
        "受付はGoogleフォームに移行しました。お問い合わせページからご回答ください。",
      formProvider: "google",
      contactPath: "/contact",
    }),
);
app.post("/api/scheduled/run", async (req, res) => {
  let uid;
  try {
    uid = await scheduledIdentity(req);
  } catch {
    return res.status(401).json({ error: "Scheduled authentication required" });
  }
  const [job] = await query(
    "SELECT * FROM app_jobs WHERE task_uid=? AND active=1",
    [uid],
  );
  if (!job)
    return res
      .status(403)
      .json({ error: "Schedule is not associated with this application" });
  try {
    const result =
      job.kind === "rss"
        ? { rss: await syncRss(), enrichment: await enrichPending() }
        : await maintenance();
    await query(
      "UPDATE app_jobs SET last_run=UTC_TIMESTAMP(),last_status=? WHERE task_uid=?",
      ["success", uid],
    );
    res.json(result);
  } catch {
    await query(
      "UPDATE app_jobs SET last_run=UTC_TIMESTAMP(),last_status=? WHERE task_uid=?",
      ["failed", uid],
    );
    res.status(500).json({ error: "Scheduled operation failed" });
  }
});
const eventLimiter = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.get("/go/:id", eventLimiter, async (req, res) => {
  const [a] = await query(
    "SELECT note_url FROM articles WHERE id=? AND visible=1",
    [req.params.id],
  );
  if (!a) return res.status(404).send("記事が見つかりません。");
  if (!/bot|crawler|spider/i.test(req.get("user-agent") || ""))
    await countEvent("click", req.params.id);
  res.set("Cache-Control", "no-store");
  res.redirect(302, a.note_url);
});
app.get("/admin", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  const user = await currentUser(req);
  if (!user || !["admin", "editor"].includes(user.role))
    return res.status(user ? 403 : 401).render("login", {
      title: "編集ログイン",
      message: user
        ? "このアカウントには編集権限がありません。管理者へ権限の追加を依頼してください。"
        : "Manusアカウントでログインしてください。",
      csrf: csrfToken(req, res),
    });
  res.render("admin", {
    user,
    csrf: csrfToken(req, res),
    types: TYPES,
    industries: INDUSTRIES,
    sizes: SIZES,
    formSlots: FORM_SLOTS,
  });
});
const names = {
  "/": "ホーム",
  "/articles": "記事検索",
  "/interviews": "インタビュー",
  "/knowledge": "ビジネス知識",
  "/about": "メディアについて",
  "/contact": "取材・協賛",
  "/policy": "各種ポリシー",
  "/recruit": "メンバー募集",
};
for (const [route, title] of Object.entries(names))
  app.get(route, async (req, res) => {
    const data =
      route === "/"
        ? await homeData()
        : { settings: publicSettings(await settings()) };
    let listing;
    if (["/articles", "/interviews", "/knowledge"].includes(route))
      listing = await articleList({
        ...req.query,
        category:
          route === "/interviews"
            ? "interviews"
            : route === "/knowledge"
              ? "knowledge"
              : undefined,
      });
    const s = data.settings;
    const origin = process.env.TBIZ_PUBLIC_ORIGIN || "";
    const canonical =
      origin && /^https:\/\//.test(origin)
        ? origin.replace(/\/$/, "") + route
        : "";
    res.set("Cache-Control", "no-store");
    const csrf = csrfToken(req, res);
    res.render("page", {
      route,
      title: route === "/" ? s.siteName : title + " | " + s.siteName,
      heading: title,
      data,
      listing,
      settings: s,
      policies,
      csrf,
      industries: INDUSTRIES,
      sizes: SIZES,
      types: TYPES,
      query: req.query,
      canonical,
      googleForm: formView(s.googleForms, route, req.query.form),
      formatDate: (d) =>
        new Date(d).toLocaleDateString("ja-JP", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
    });
    if (
      !/bot|crawler|spider/i.test(req.get("user-agent") || "") &&
      !req.get("purpose") &&
      !req.get("sec-purpose")
    )
      countEvent("page", route).catch(() => {});
  });
app.use((req, res) =>
  res
    .status(404)
    .send(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="robots" content="noindex"><title>ページが見つかりません</title><h1>ページが見つかりません</h1><a href="/">ホームへ戻る</a></html>',
    ),
);
app.use((err, req, res, next) => {
  const validation = err instanceof z.ZodError;
  const status = validation
    ? 400
    : err.status || (err.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  const error = validation
    ? err.issues
        .map((x) => x.message)
        .slice(0, 3)
        .join(" / ")
    : status === 409
      ? "別の編集者が更新しています。再読み込みしてください。"
      : status === 413
        ? "画像は8MB以下にしてください。"
        : "処理を完了できませんでした。しばらく待って再試行してください。";
  console.error("Request error:", req.path, err.code || err.name);
  if (res.headersSent) return next(err);
  if (req.path.startsWith("/api/")) res.status(status).json({ error });
  else
    res
      .status(status)
      .send(
        '<!doctype html><html lang="ja"><meta charset="utf-8"><h1>現在このページを表示できません</h1><a href="/">ホームへ戻る</a></html>',
      );
});
try {
  await migrate();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.TBIZ_BIND_HOST || "0.0.0.0";
  app.listen(port, host, () =>
    console.log(`T-Biz server ready on port ${port}`),
  );
} catch (e) {
  console.error("Startup failed:", e.code || e.name);
  process.exitCode = 1;
}

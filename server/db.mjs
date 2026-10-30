import mysql from "mysql2/promise";
import { cleanForms } from "./google-forms.mjs";
let pool;
export function database() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is unavailable");
  const u = new URL(process.env.DATABASE_URL);
  pool = mysql.createPool({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { rejectUnauthorized: true },
    connectionLimit: 5,
    timezone: "Z",
    charset: "utf8mb4",
    dateStrings: false,
    connectTimeout: 10000,
  });
  return pool;
}
export async function query(sql, args = []) {
  const [rows] = await database().execute(sql, args);
  return rows;
}
export async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
export function parseJson(v) {
  return typeof v === "string" ? JSON.parse(v) : v;
}
export async function settings() {
  const rows = await query(
    "SELECT data, revision, rss_url AS rssUrl FROM site_settings WHERE id=1",
  );
  if (!rows[0]) throw new Error("Migration required");
  return {
    ...parseJson(rows[0].data),
    googleForms: cleanForms(parseJson(rows[0].data).googleForms),
    revision: rows[0].revision,
    rssUrl: rows[0].rssUrl,
  };
}
export function publicSettings(s) {
  const {
    siteName,
    subtitle,
    org,
    noteUrl,
    tbizUrl,
    instagramUrl,
    response,
    contact,
    policyDate,
    logoUrl,
  } = s;
  return {
    siteName,
    subtitle,
    org,
    noteUrl,
    tbizUrl,
    instagramUrl,
    response,
    contact,
    policyDate,
    logoUrl,
    googleForms: cleanForms(s.googleForms),
  };
}
export function mapArticle(a) {
  return {
    id: a.id,
    title: a.title,
    lead: a.intro_text,
    noteUrl: a.note_url,
    imageUrl: a.image_url || "",
    publishedAt: a.published_at.toISOString(),
    createdAt: a.created_at.toISOString(),
    industry: a.industry,
    size: a.company_size,
    type: a.article_type,
    visible: Boolean(a.visible),
    manualTags: Boolean(a.manual_tags),
    revision: a.revision,
    classificationStatus: a.classification_status,
  };
}
export async function articleList(filters = {}, admin = false) {
  const parts = admin ? ["1=1"] : ["visible=1"];
  const args = [];
  if (filters.category === "interviews")
    parts.push(
      "article_type IN ('経営者インタビュー','若手社員インタビュー','座談会')",
    );
  if (filters.category === "knowledge")
    parts.push("article_type='ビジネス知識'");
  for (const [key, col] of [
    ["industry", "industry"],
    ["size", "company_size"],
    ["type", "article_type"],
  ])
    if (filters[key]) {
      parts.push(`${col}=?`);
      args.push(String(filters[key]).slice(0, 80));
    }
  if (filters.unclassified === "true") {
    parts.push(
      "(industry IS NULL OR company_size IS NULL OR article_type IS NULL)",
    );
  }
  const q = String(filters.q || "")
    .trim()
    .slice(0, 240);
  if (q) {
    parts.push(
      filters.exact === "true"
        ? "(BINARY title=? OR BINARY intro_text=?)"
        : "(LOCATE(LOWER(?),LOWER(title))>0 OR LOCATE(LOWER(?),LOWER(intro_text))>0)",
    );
    args.push(q, q);
  }
  const dir = filters.sort === "old" ? "ASC" : "DESC";
  const page = Math.max(
    1,
    Math.min(Math.floor(Number(filters.page) || 1), 10000),
  );
  const limit = admin ? 25 : 24;
  const counts = await query(
    `SELECT COUNT(*) AS total FROM articles WHERE ${parts.join(" AND ")}`,
    args,
  );
  const list = await query(
    `SELECT * FROM articles WHERE ${parts.join(" AND ")} ORDER BY published_at ${dir},created_at ${dir},id ${dir} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    args,
  );
  return {
    items: list.map(mapArticle),
    total: Number(counts[0].total),
    page,
    pages: Math.max(1, Math.ceil(counts[0].total / limit)),
  };
}
export async function slides(publicOnly = true) {
  return query(
    `SELECT id,image_url AS imageUrl,label,link_url AS linkUrl,position,visible,revision FROM slides ${publicOnly ? "WHERE visible=1" : ""} ORDER BY position,id`,
  );
}
export async function homeData() {
  const [s, sl, interview, knowledge, featured] = await Promise.all([
    settings(),
    slides(),
    articleList({ category: "interviews" }),
    articleList({ category: "knowledge" }),
    articleList(),
  ]);
  return {
    settings: publicSettings(s),
    slides: sl,
    interviews: interview.items.slice(0, 4),
    knowledge: knowledge.items.slice(0, 4),
    featured: featured.items[0] || null,
  };
}
export async function countEvent(kind, key) {
  await query(
    "INSERT INTO daily_metrics (day,kind,target,count) VALUES (DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,?,1) ON DUPLICATE KEY UPDATE count=count+1",
    [kind, key],
  );
}
export async function metrics() {
  const [monthly, pages, clicks, totals] = await Promise.all([
    query(
      "SELECT DATE_FORMAT(day,'%Y-%m') AS month,SUM(IF(kind='page',count,0)) AS views,SUM(IF(kind='click',count,0)) AS clicks FROM daily_metrics WHERE day>=DATE_SUB(UTC_DATE(),INTERVAL 12 MONTH) GROUP BY month ORDER BY month",
    ),
    query(
      "SELECT target,SUM(count) AS count FROM daily_metrics WHERE kind='page' GROUP BY target ORDER BY count DESC",
    ),
    query(
      "SELECT m.target,a.title,SUM(m.count) AS count FROM daily_metrics m LEFT JOIN articles a ON a.id=m.target WHERE m.kind='click' GROUP BY m.target,a.title ORDER BY count DESC",
    ),
    query(
      "SELECT COUNT(*) AS total,SUM(visible) AS published,SUM(industry IS NULL OR company_size IS NULL OR article_type IS NULL) AS unclassified FROM articles",
    ),
  ]);
  return { monthly, pages, clicks, totals: totals[0] };
}

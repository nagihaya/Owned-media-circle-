import { query, close, safeDbMessage } from "../server/db.mjs";
import { pathToFileURL } from "node:url";
import {
  migrateV2,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  migrateV7,
  migrateV8,
} from "./v2.mjs";
export async function migrate() {
  await query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=1"))
      .length
  ) {
    await migrateV2();
    await migrateV3();
    await migrateV4();
    await migrateV5();
    await migrateV6();
    await migrateV7();
    await migrateV8();
    return;
  }
  const statements = [
    "CREATE TABLE IF NOT EXISTS users (open_id VARCHAR(191) PRIMARY KEY,name VARCHAR(160) NOT NULL DEFAULT '',email_hash CHAR(64) NULL,role ENUM('admin','editor','viewer') NOT NULL DEFAULT 'viewer',active BOOLEAN NOT NULL DEFAULT TRUE,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,last_login DATETIME NULL)",
    "CREATE TABLE IF NOT EXISTS role_invites (email_hash CHAR(64) PRIMARY KEY,role ENUM('editor') NOT NULL DEFAULT 'editor',created_by VARCHAR(191) NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS sessions (jti CHAR(64) PRIMARY KEY,open_id VARCHAR(191) NOT NULL,expires_at DATETIME NOT NULL,FOREIGN KEY (open_id) REFERENCES users(open_id) ON DELETE CASCADE)",
    "CREATE TABLE IF NOT EXISTS site_settings (id INT PRIMARY KEY,data JSON NOT NULL,rss_url VARCHAR(512) NOT NULL DEFAULT '',revision INT NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS slides (id INT AUTO_INCREMENT PRIMARY KEY,image_url VARCHAR(768) NOT NULL,label VARCHAR(80) NOT NULL DEFAULT '',link_url VARCHAR(512) NOT NULL DEFAULT '',position INT NOT NULL,visible BOOLEAN NOT NULL DEFAULT TRUE,revision INT NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS articles (id CHAR(36) PRIMARY KEY,note_url VARCHAR(512) CHARACTER SET ascii NOT NULL UNIQUE,title VARCHAR(240) NOT NULL,intro_text TEXT NOT NULL,image_url VARCHAR(768) NOT NULL DEFAULT '',published_at DATETIME NOT NULL,industry VARCHAR(40) NULL,company_size VARCHAR(40) NULL,article_type VARCHAR(40) NULL,visible BOOLEAN NOT NULL DEFAULT TRUE,manual_tags BOOLEAN NOT NULL DEFAULT FALSE,classification_status VARCHAR(24) NOT NULL DEFAULT 'pending',revision INT NOT NULL DEFAULT 1,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX published_idx (visible,published_at),INDEX type_idx (article_type,published_at))",
    "CREATE TABLE IF NOT EXISTS contacts (id CHAR(36) PRIMARY KEY,request_id CHAR(36) NOT NULL UNIQUE,payload JSON NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at DATETIME NOT NULL,INDEX expiry_idx (expires_at))",
    "CREATE TABLE IF NOT EXISTS mail_outbox (id CHAR(36) PRIMARY KEY,contact_id CHAR(36) NOT NULL,kind ENUM('notify','reply') NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'pending',attempts INT NOT NULL DEFAULT 0,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE kind_idx (contact_id,kind),FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE)",
    "CREATE TABLE IF NOT EXISTS daily_metrics (day DATE NOT NULL,kind ENUM('page','click') NOT NULL,target VARCHAR(191) NOT NULL,count BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(day,kind,target))",
    "CREATE TABLE IF NOT EXISTS app_jobs (task_uid VARCHAR(191) PRIMARY KEY,kind VARCHAR(40) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,last_run DATETIME NULL,last_status VARCHAR(120) NULL)",
    "CREATE TABLE IF NOT EXISTS operation_state (name VARCHAR(80) PRIMARY KEY,data JSON NOT NULL,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)",
    "CREATE TABLE IF NOT EXISTS request_limits (key_hash CHAR(64) NOT NULL,window_start BIGINT NOT NULL,count INT NOT NULL DEFAULT 0,expires_at DATETIME NOT NULL,PRIMARY KEY(key_hash,window_start))",
  ];
  for (const sql of statements) await query(sql);
  const initial = {
    siteName: "未定",
    subtitle: "",
    org: "東京理科大学発のビジネスサークル",
    noteUrl: "https://note.com/",
    tbizUrl: "/about",
    instagramUrl: "https://www.instagram.com/",
    xUrl: "",
    response: "1〜4日ほど",
    contact: "東京理科大学",
    policyDate: "",
    logoUrl: "/assets/tbiz-icon.jpg",
  };
  await query("INSERT IGNORE INTO site_settings (id,data) VALUES (1,?)", [
    JSON.stringify(initial),
  ]);
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (1)");
  await migrateV2();
  await migrateV3();
  await migrateV4();
  await migrateV5();
  await migrateV6();
  await migrateV7();
  await migrateV8();
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await migrate();
    console.log("Migrations completed. No sample articles were published.");
  } catch (e) {
    console.error(
      "Migration failed:",
      e.code || e.name,
      e.code === "DATABASE_URL_FORMAT" ? e.message : safeDbMessage(e),
    );
    process.exitCode = 1;
  } finally {
    await close();
  }
}

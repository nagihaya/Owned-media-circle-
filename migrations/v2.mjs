import { query } from "../server/db.mjs";
export async function migrateV2() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=2"))
      .length
  )
    return;
  await query(
    "CREATE TABLE IF NOT EXISTS oauth_nonces (nonce_hash CHAR(64) PRIMARY KEY,redirect_uri VARCHAR(768) NOT NULL,expires_at DATETIME NOT NULL)",
  );
  await query(
    "CREATE TABLE IF NOT EXISTS ai_budget (month CHAR(7) PRIMARY KEY,calls INT NOT NULL DEFAULT 0)",
  );
  for (const [name, ddl] of [
    ["source_image_url", "VARCHAR(768) NOT NULL DEFAULT ''"],
    ["image_status", "VARCHAR(20) NOT NULL DEFAULT 'none'"],
  ]) {
    const cols = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      ["articles", name],
    );
    if (!cols.length)
      try {
        await query(`ALTER TABLE articles ADD COLUMN ${name} ${ddl}`);
      } catch (e) {
        if (e.code !== "ER_DUP_FIELDNAME") throw e;
      }
  }
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (2)");
}
// v3: images are stored in the database instead of Manus storage.
export async function migrateV3() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=3"))
      .length
  )
    return;
  await query(
    "CREATE TABLE IF NOT EXISTS media (id CHAR(36) PRIMARY KEY,mime VARCHAR(40) NOT NULL,bytes MEDIUMBLOB NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (3)");
}
// v4: slideshow card text (number, date, category, author, tags) and longer titles.
export async function migrateV4() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=4"))
      .length
  )
    return;
  for (const [name, ddl] of [
    ["number_label", "VARCHAR(10) NOT NULL DEFAULT ''"],
    ["date_label", "VARCHAR(20) NOT NULL DEFAULT ''"],
    ["category", "VARCHAR(30) NOT NULL DEFAULT ''"],
    ["author", "VARCHAR(60) NOT NULL DEFAULT ''"],
    ["tags", "VARCHAR(200) NOT NULL DEFAULT ''"],
  ]) {
    const cols = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      ["slides", name],
    );
    if (!cols.length)
      try {
        await query(`ALTER TABLE slides ADD COLUMN ${name} ${ddl}`);
      } catch (e) {
        if (e.code !== "ER_DUP_FIELDNAME") throw e;
      }
  }
  // Widen the title (label) from 80 to 160 characters; existing text is kept.
  await query(
    "ALTER TABLE slides MODIFY COLUMN label VARCHAR(160) NOT NULL DEFAULT ''",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (4)");
}
// v5: slide "所属・名前" up to 100 chars and a "詳細" line under it.
export async function migrateV5() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=5"))
      .length
  )
    return;
  const cols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='slides' AND COLUMN_NAME='detail'",
  );
  if (!cols.length)
    try {
      await query(
        "ALTER TABLE slides ADD COLUMN detail VARCHAR(300) NOT NULL DEFAULT ''",
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }
  await query(
    "ALTER TABLE slides MODIFY COLUMN author VARCHAR(100) NOT NULL DEFAULT ''",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (5)");
}
// v6: company size choices renamed (エンタープライズ→大企業, スタートアップ→
// スタートアップ・ベンチャー) and SMB removed (those articles become 未分類).
export async function migrateV6() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=6"))
      .length
  )
    return;
  await query(
    "UPDATE articles SET company_size='大企業' WHERE company_size='エンタープライズ'",
  );
  await query(
    "UPDATE articles SET company_size='スタートアップ・ベンチャー' WHERE company_size='スタートアップ'",
  );
  await query("UPDATE articles SET company_size=NULL WHERE company_size='SMB'");
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (6)");
}

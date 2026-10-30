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

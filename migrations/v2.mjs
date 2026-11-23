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
// v7: editors pick up to 3 featured articles for the home page.
export async function migrateV7() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=7"))
      .length
  )
    return;
  const cols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='articles' AND COLUMN_NAME='featured'",
  );
  if (!cols.length)
    try {
      await query(
        "ALTER TABLE articles ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE",
      );
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME") throw e;
    }
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (7)");
}
// v8: the subtitle now shows under the site title; start with the agreed
// wording only if it is still empty (never overwrites edits).
export async function migrateV8() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=8"))
      .length
  )
    return;
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.subtitle',?),revision=revision+1 WHERE id=1 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.subtitle')),'')=''",
    ["学生向けのビジネスメディア"],
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (8)");
}
// v9: top intro block under the slideshow (editable). Fill defaults only if
// the keys are missing, never overwriting edits.
export async function migrateV9() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=9"))
      .length
  )
    return;
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.introCatch',?),revision=revision+1 WHERE id=1 AND JSON_EXTRACT(data,'$.introCatch') IS NULL",
    ["企業のリアルを、\n学生の明日へ。"],
  );
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.introText',?),revision=revision+1 WHERE id=1 AND JSON_EXTRACT(data,'$.introText') IS NULL",
    [
      "T-Bizは、東京理科大学発のビジネスサークルです。企業の経営者・社員へのインタビューや活動の記録を掲載し、学生が企業や仕事を知るための情報を届けます。",
    ],
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (9)");
}
// v10: 記事タイプを3つ（インタビュー／活動記録／ビジネス知識）に統合し、
// 活動記録の「コンテンツ」（ビジコン・ポップアップ・通常活動）列を追加する。
// 企業規模・業界の既存データは消さない（企業規模は今後使わない）。
export async function migrateV10() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=10"))
      .length
  )
    return;
  const cols = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='articles' AND COLUMN_NAME='activity_kind'",
  );
  if (!cols.length)
    await query(
      "ALTER TABLE articles ADD COLUMN activity_kind VARCHAR(20) NULL",
    );
  await query(
    "UPDATE articles SET article_type='インタビュー',revision=revision+1 WHERE article_type IN ('経営者インタビュー','若手社員インタビュー')",
  );
  await query(
    "UPDATE articles SET article_type='活動記録',revision=revision+1 WHERE article_type='座談会'",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (10)");
}
// v12: 冒頭レイアウトの試し（一度だけ本番で動いた可能性のある v11）を取り消す。
// v11 で冒頭へ移した大きな一文（heroTitle）を、紹介ブロック（introCatch）へ戻す。
// introCatch に何か入っている場合は上書きしない。
export async function migrateV12() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=12"))
      .length
  )
    return;
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.introCatch',JSON_UNQUOTE(JSON_EXTRACT(data,'$.heroTitle'))),revision=revision+1 WHERE id=1 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.introCatch')),'')='' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data,'$.heroTitle')),'')<>''",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (12)");
}
// v13: 紹介ブロックのキャッチコピーの上に出す小さな一文の初期値（未設定のときだけ）
export async function migrateV13() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=13"))
      .length
  )
    return;
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.introLabel',?),revision=revision+1 WHERE id=1 AND JSON_EXTRACT(data,'$.introLabel') IS NULL",
    ["東京理科大学発のビジネスサークル"],
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (13)");
}
// v14: フッター上の「Join Our Team」（メンバー募集への案内）の初期値（未設定のときだけ）
export async function migrateV14() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=14"))
      .length
  )
    return;
  const defaults = [
    ["$.joinTitle", "Join Our Circle"],
    [
      "$.joinText",
      "T-Bizは、一緒に「やりたいを形にする」仲間を募集しています。\nビジネスコンテストへの挑戦、企業へのインタビュー、イベントの企画など、学年・学部を問わず活躍できます。\n募集要項をぜひご覧ください。",
    ],
    ["$.joinUrl", "/shinkan"],
  ];
  for (const [path, value] of defaults)
    await query(
      `UPDATE site_settings SET data=JSON_SET(data,'${path}',?),revision=revision+1 WHERE id=1 AND JSON_EXTRACT(data,'${path}') IS NULL`,
      [value],
    );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (14)");
}
// v15: 「Join Our Team」の初期値を「Join Our Circle」に（初期値のままの場合だけ変える）
export async function migrateV15() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=15"))
      .length
  )
    return;
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.joinTitle','Join Our Circle'),revision=revision+1 WHERE id=1 AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.joinTitle'))='Join Our Team'",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (15)");
}
// v16: Join Our Circle のリンク先を新歓特設ページに（初期値のままの場合だけ変える）
export async function migrateV16() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=16"))
      .length
  )
    return;
  await query(
    "UPDATE site_settings SET data=JSON_SET(data,'$.joinUrl','/shinkan'),revision=revision+1 WHERE id=1 AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.joinUrl'))='/recruit'",
  );
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (16)");
}
// v17: サイト名を「T-Biz Lab」から「T-Biz」に。保存済みの文章の「T-Biz Lab」も「T-Biz」に置き換える
// （紹介文が初期値のままなら、言い回しが重ならない新しい初期値にする）
const OLD_INTRO_TEXT =
  "T-Biz Labは、東京理科大学発のビジネスサークルT-Bizが運営するメディアです。企業の経営者・社員へのインタビューを掲載し、学生が企業や仕事を知るための情報を届けます。";
const NEW_INTRO_TEXT =
  "T-Bizは、東京理科大学発のビジネスサークルです。企業の経営者・社員へのインタビューや活動の記録を掲載し、学生が企業や仕事を知るための情報を届けます。";
export async function migrateV17() {
  if (
    (await query("SELECT version FROM schema_migrations WHERE version=17"))
      .length
  )
    return;
  const [row] = await query("SELECT data FROM site_settings WHERE id=1");
  if (row) {
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    if (data.introText === OLD_INTRO_TEXT) data.introText = NEW_INTRO_TEXT;
    for (const [k, v] of Object.entries(data))
      if (typeof v === "string" && v.includes("T-Biz Lab"))
        data[k] = v.replaceAll("T-Biz Lab", "T-Biz");
    await query(
      "UPDATE site_settings SET data=?,revision=revision+1 WHERE id=1",
      [JSON.stringify(data)],
    );
  }
  await query("INSERT IGNORE INTO schema_migrations (version) VALUES (17)");
}

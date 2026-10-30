import { query } from "./db.mjs";
import { enrichPending } from "./rss.mjs";
export async function maintenance() {
  const result = await query(
    "DELETE FROM contacts WHERE expires_at<=UTC_TIMESTAMP()",
  );
  await query("DELETE FROM sessions WHERE expires_at<=UTC_TIMESTAMP()");
  await query("DELETE FROM oauth_nonces WHERE expires_at<=UTC_TIMESTAMP()");
  await query("DELETE FROM request_limits WHERE expires_at<=UTC_TIMESTAMP()");
  await query(
    "INSERT INTO operation_state (name,data) VALUES ('maintenance',?) ON DUPLICATE KEY UPDATE data=VALUES(data)",
    [
      JSON.stringify({
        deleted: result.affectedRows,
        at: new Date().toISOString(),
        formProvider: "google",
      }),
    ],
  );
  const enrichment = await enrichPending();
  return { deleted: result.affectedRows, enrichment, formProvider: "google" };
}

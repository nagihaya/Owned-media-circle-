import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { query, database, parseJson, settings } from "./db.mjs";
import { enrichPending } from "./rss.mjs";
export const mailReady = () =>
  Boolean(
    process.env.TBIZ_SMTP_USER &&
    process.env.TBIZ_SMTP_PASSWORD &&
    process.env.TBIZ_NOTIFY_EMAIL,
  );
let transporter;
function transport() {
  if (!mailReady()) throw new Error("Mail not configured");
  return (transporter ||= nodemailer.createTransport({
    host: process.env.TBIZ_SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.TBIZ_SMTP_PORT || 465),
    secure: Number(process.env.TBIZ_SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.TBIZ_SMTP_USER,
      pass: process.env.TBIZ_SMTP_PASSWORD,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  }));
}
function sameRequest(prior, payload) {
  const old = parseJson(prior);
  return Object.keys(payload).every((k) => old[k] === payload[k]);
}
export async function createContact(payload) {
  const old = await query(
    "SELECT id,payload FROM contacts WHERE request_id=?",
    [payload.requestId],
  );
  if (old.length) {
    if (!sameRequest(old[0].payload, payload)) {
      const e = new Error("Idempotency conflict");
      e.status = 409;
      throw e;
    }
    return { id: old[0].id, duplicate: true };
  }
  const id = randomUUID(),
    conn = await database().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "INSERT INTO contacts (id,request_id,payload,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 6 MONTH))",
      [id, payload.requestId, JSON.stringify(payload)],
    );
    for (const kind of ["notify", "reply"])
      await conn.execute(
        "INSERT INTO mail_outbox (id,contact_id,kind) VALUES (?,?,?)",
        [randomUUID(), id, kind],
      );
    await conn.commit();
    return { id };
  } catch (e) {
    await conn.rollback();
    if (e.code === "ER_DUP_ENTRY") {
      const r = await query(
        "SELECT id,payload FROM contacts WHERE request_id=?",
        [payload.requestId],
      );
      if (r[0] && sameRequest(r[0].payload, payload))
        return { id: r[0].id, duplicate: true };
    }
    throw e;
  } finally {
    conn.release();
  }
}
export async function sendPending(contactId) {
  if (!mailReady()) return { sent: 0, pending: true, complete: false };
  const conn = await database().getConnection();
  try {
    const [lock] = await conn.query(
      "SELECT GET_LOCK('tbiz_mail_send',0) AS locked",
    );
    if (!lock[0].locked) return { pending: true, sent: 0, complete: false };
    const args = contactId ? [contactId] : [];
    const list = await query(
      `SELECT o.id,o.kind,c.id AS contactId,c.payload FROM mail_outbox o JOIN contacts c ON c.id=o.contact_id WHERE o.status IN ('pending','failed') AND o.attempts<3 AND c.expires_at>UTC_TIMESTAMP() ${contactId ? "AND c.id=?" : ""} ORDER BY o.updated_at LIMIT 10`,
      args,
    );
    const s = await settings();
    let sent = 0;
    for (const row of list) {
      const p = parseJson(row.payload);
      await query(
        "UPDATE mail_outbox SET status='sending',attempts=attempts+1,updated_at=UTC_TIMESTAMP() WHERE id=?",
        [row.id],
      );
      const detail = `お問い合わせ区分：${p.kind}\n会社・団体名：${p.company}\n担当者名：${p.name}\nメール：${p.email}\n電話：${p.phone}\n\n${p.message}`;
      try {
        await transport().sendMail({
          from: {
            name: s.siteName === "未定" ? "T-Biz" : s.siteName,
            address: process.env.TBIZ_SMTP_USER,
          },
          to: row.kind === "notify" ? process.env.TBIZ_NOTIFY_EMAIL : p.email,
          replyTo: row.kind === "notify" ? p.email : process.env.TBIZ_SMTP_USER,
          subject:
            row.kind === "notify"
              ? `【T-Biz】${p.kind} 受付`
              : `【T-Biz】お問い合わせを受け付けました`,
          text:
            row.kind === "notify"
              ? `受付番号：${row.contactId}\n${detail}\n\n個人情報の保存期限：受付から6か月。受信箱も期限内に整理してください。`
              : `${p.name} 様\n\nお問い合わせありがとうございます。${s.response}でご連絡する予定です。\n受付番号：${row.contactId}\n\n${detail}\n\nT-Biz\n本メールは自動返信です。`,
          messageId: `<${row.id}@tbiz.media.local>`,
        });
        await query(
          "UPDATE mail_outbox SET status='sent',updated_at=UTC_TIMESTAMP() WHERE id=?",
          [row.id],
        );
        sent++;
      } catch (e) {
        const definite = ["EAUTH", "EENVELOPE", "ECONNECTION", "EDNS"].includes(
          e.code,
        );
        await query(
          "UPDATE mail_outbox SET status=?,updated_at=UTC_TIMESTAMP() WHERE id=?",
          [definite ? "failed" : "unknown", row.id],
        );
      }
    }
    if (contactId) {
      const status = await query(
        "SELECT status FROM mail_outbox WHERE contact_id=?",
        [contactId],
      );
      const complete =
        status.length === 2 && status.every((x) => x.status === "sent");
      return { sent, complete, pending: !complete };
    }
    return {
      sent,
      pending: sent !== list.length,
      complete: sent === list.length,
    };
  } finally {
    await conn.query("SELECT RELEASE_LOCK('tbiz_mail_send')").catch(() => {});
    conn.release();
  }
}
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
      }),
    ],
  );
  const mail = await sendPending(),
    enrichment = await enrichPending();
  return { deleted: result.affectedRows, mail, enrichment };
}

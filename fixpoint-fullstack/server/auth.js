const crypto = require("crypto");
const { db, uid, nowIso } = require("./db.js");

const SESSION_DAYS = 14;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`)
    .run(token, userId, created.toISOString(), expires.toISOString());
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const session = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  const user = db.prepare(`SELECT id, role, name, email, category, district, phone, rating_total, rating_count, created_at
    FROM users WHERE id = ?`).get(session.user_id);
  return user || null;
}

function destroySession(token) {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

function tokenFromReq(req) {
  const header = req.headers["authorization"] || "";
  const match = header.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

module.exports = { createSession, getUserByToken, destroySession, tokenFromReq };

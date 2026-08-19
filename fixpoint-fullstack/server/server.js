const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { db, CATEGORIES, TN_DISTRICTS, STATUS, uid, nowIso, hashPassword, verifyPassword } = require("./db.js");
const { createSession, getUserByToken, destroySession, tokenFromReq } = require("./auth.js");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ---------------- tiny router ---------------- */
const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regex = new RegExp("^" + pattern.replace(/:([A-Za-z]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  }) + "$");
  routes.push({ method, regex, paramNames, handler });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}
function authUser(req) { return getUserByToken(tokenFromReq(req)); }
function isSuperAdmin(user) { return user.role === "admin" && !user.district; }

function savePhoto(complaintId, photoBase64) {
  if (!photoBase64) return null;
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(photoBase64);
  if (!match) return null;
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const filename = `${complaintId}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(match[2], "base64"));
  return `/uploads/${filename}`;
}
function addHistory(complaintId, status, note) {
  db.prepare(`INSERT INTO complaint_history (complaint_id, status, note, at) VALUES (?,?,?,?)`)
    .run(complaintId, status, note || null, nowIso());
}
function complaintOut(row) {
  if (!row) return null;
  return {
    id: row.id, category: row.category, district: row.district, description: row.description,
    photoUrl: row.photo_path || null, lat: row.lat, lng: row.lng, address: row.address,
    method: row.method, status: row.status, citizenId: row.citizen_id,
    assignedWorkerId: row.assigned_worker_id, scheduledAt: row.scheduled_at,
    rejectReason: row.reject_reason, feedbackRating: row.feedback_rating,
    feedbackComment: row.feedback_comment, workerRating: row.worker_rating,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
function userOut(row) {
  if (!row) return null;
  return {
    id: row.id, role: row.role, name: row.name, email: row.email, category: row.category || null,
    district: row.district || null, phone: row.phone || null,
    ratingAvg: row.rating_count ? Math.round((row.rating_total / row.rating_count) * 10) / 10 : null,
    ratingCount: row.rating_count || 0, createdAt: row.created_at
  };
}

/* ================= AUTH ================= */
route("POST", "/api/auth/signup", async (req, res) => {
  const body = await readBody(req);
  const { role, name, email, password, category, district, phone } = body;
  if (!["citizen", "worker"].includes(role)) return sendJson(res, 400, { error: "Role must be citizen or worker." });
  if (!name || !email || !password) return sendJson(res, 400, { error: "Name, email, and password are required." });
  if (password.length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters." });
  if (!TN_DISTRICTS.includes(district)) return sendJson(res, 400, { error: "Choose a valid Tamil Nadu district." });
  if (role === "worker" && !CATEGORIES.includes(category)) return sendJson(res, 400, { error: "Choose a valid work category." });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (existing) return sendJson(res, 409, { error: "An account with this email already exists." });

  const { hash, salt } = hashPassword(password);
  const id = uid(role === "worker" ? "w" : "c");
  db.prepare(`INSERT INTO users (id, role, name, email, password_hash, password_salt, category, district, phone, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, role, name.trim(), email.toLowerCase().trim(), hash, salt, role === "worker" ? category : null, district, phone || null, nowIso());

  const token = createSession(id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  sendJson(res, 201, { token, user: userOut(user) });
});

route("POST", "/api/auth/login", async (req, res) => {
  const { email, password } = await readBody(req);
  if (!email || !password) return sendJson(res, 400, { error: "Email and password are required." });
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
    return sendJson(res, 401, { error: "Incorrect email or password." });
  }
  const token = createSession(row.id);
  sendJson(res, 200, { token, user: userOut(row) });
});

route("POST", "/api/auth/logout", async (req, res) => {
  destroySession(tokenFromReq(req));
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/me", async (req, res) => {
  const user = authUser(req);
  if (!user) return sendJson(res, 401, { error: "Not signed in." });
  sendJson(res, 200, { user: userOut(user) });
});

route("GET", "/api/categories", async (req, res) => sendJson(res, 200, { categories: CATEGORIES }));
route("GET", "/api/districts", async (req, res) => sendJson(res, 200, { districts: TN_DISTRICTS }));

/* ================= CITIZEN ================= */
route("POST", "/api/complaints", async (req, res) => {
  const user = authUser(req);
  if (!user || user.role !== "citizen") return sendJson(res, 403, { error: "Only citizens can file reports." });
  const body = await readBody(req);
  const { category, description, lat, lng, address, method, photoBase64 } = body;
  if (!CATEGORIES.includes(category)) return sendJson(res, 400, { error: "Choose a valid category." });
  if (!description || !description.trim()) return sendJson(res, 400, { error: "Add a description." });
  if (typeof lat !== "number" || typeof lng !== "number") return sendJson(res, 400, { error: "A location is required." });

  const id = uid("CI");
  const photoPath = savePhoto(id, photoBase64);
  const ts = nowIso();
  db.prepare(`INSERT INTO complaints (id, category, district, description, photo_path, lat, lng, address, method, status, citizen_id, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, category, user.district, description.trim(), photoPath, lat, lng, address || null, method || "Manual", STATUS.SUBMITTED, user.id, ts, ts);
  addHistory(id, STATUS.SUBMITTED, "Filed by citizen");
  sendJson(res, 201, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id = ?").get(id)) });
});

route("GET", "/api/complaints/mine", async (req, res) => {
  const user = authUser(req);
  if (!user || user.role !== "citizen") return sendJson(res, 403, { error: "Citizens only." });
  const rows = db.prepare("SELECT * FROM complaints WHERE citizen_id = ? ORDER BY created_at DESC").all(user.id);
  sendJson(res, 200, { complaints: rows.map(complaintOut) });
});

route("POST", "/api/complaints/:id/feedback", async (req, res, params) => {
  const user = authUser(req);
  if (!user || user.role !== "citizen") return sendJson(res, 403, { error: "Citizens only." });
  const { rating, comment } = await readBody(req);
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) return sendJson(res, 400, { error: "Rating must be 1 to 5." });
  const c = db.prepare("SELECT * FROM complaints WHERE id = ?").get(params.id);
  if (!c || c.citizen_id !== user.id) return sendJson(res, 404, { error: "Report not found." });
  if (c.status !== STATUS.COMPLETED) return sendJson(res, 400, { error: "Feedback can only be given once the work is completed." });
  db.prepare(`UPDATE complaints SET feedback_rating=?, feedback_comment=?, status=?, updated_at=? WHERE id=?`)
    .run(r, comment || null, STATUS.CLOSED, nowIso(), c.id);
  addHistory(c.id, STATUS.CLOSED, `Citizen feedback: ${r}/5`);
  sendJson(res, 200, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id = ?").get(c.id)) });
});

route("GET", "/api/complaints/map", async (req, res) => {
  const user = authUser(req);
  if (!user) return sendJson(res, 401, { error: "Sign in required." });
  let rows = db.prepare("SELECT id, category, district, status, lat, lng, created_at FROM complaints").all();
  if (!isSuperAdmin(user)) rows = rows.filter(r => r.district === user.district);
  sendJson(res, 200, { points: rows });
});

/* ================= ADMIN ================= */
function requireAdmin(req, res) {
  const user = authUser(req);
  if (!user || user.role !== "admin") { sendJson(res, 403, { error: "Admin access only." }); return null; }
  return user;
}
function scopeToDistrict(admin, rows) {
  if (isSuperAdmin(admin)) return rows;
  return rows.filter(r => r.district === admin.district);
}

route("GET", "/api/admin/complaints", async (req, res, params, query) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  let rows = db.prepare("SELECT * FROM complaints ORDER BY created_at DESC").all();
  rows = scopeToDistrict(admin, rows);
  if (query.status) rows = rows.filter(r => r.status === query.status);
  if (query.category) rows = rows.filter(r => r.category === query.category);
  if (query.district && isSuperAdmin(admin)) rows = rows.filter(r => r.district === query.district);
  if (query.search) {
    const s = query.search.toLowerCase();
    rows = rows.filter(r => `${r.id} ${r.description}`.toLowerCase().includes(s));
  }
  const citizens = Object.fromEntries(db.prepare("SELECT id, name FROM users WHERE role='citizen'").all().map(u => [u.id, u.name]));
  const workers = Object.fromEntries(db.prepare("SELECT id, name FROM users WHERE role='worker'").all().map(u => [u.id, u.name]));
  sendJson(res, 200, { complaints: rows.map(r => ({ ...complaintOut(r), citizenName: citizens[r.citizen_id] || "Unknown", workerName: r.assigned_worker_id ? (workers[r.assigned_worker_id] || "Unknown") : null })) });
});

route("POST", "/api/admin/complaints/:id/approve", async (req, res, params) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const c = db.prepare("SELECT * FROM complaints WHERE id=?").get(params.id);
  if (!c) return sendJson(res, 404, { error: "Not found." });
  if (!isSuperAdmin(admin) && c.district !== admin.district) return sendJson(res, 403, { error: "That report belongs to a different district." });
  if (c.status !== STATUS.SUBMITTED) return sendJson(res, 400, { error: "Only newly submitted reports can be approved." });
  db.prepare("UPDATE complaints SET status=?, updated_at=? WHERE id=?").run(STATUS.APPROVED, nowIso(), c.id);
  addHistory(c.id, STATUS.APPROVED, "Approved by admin");
  sendJson(res, 200, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id=?").get(c.id)) });
});

route("POST", "/api/admin/complaints/:id/reject", async (req, res, params) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const { reason } = await readBody(req);
  const c = db.prepare("SELECT * FROM complaints WHERE id=?").get(params.id);
  if (!c) return sendJson(res, 404, { error: "Not found." });
  if (!isSuperAdmin(admin) && c.district !== admin.district) return sendJson(res, 403, { error: "That report belongs to a different district." });
  db.prepare("UPDATE complaints SET status=?, reject_reason=?, updated_at=? WHERE id=?").run(STATUS.REJECTED, reason || "Not specified", nowIso(), c.id);
  addHistory(c.id, STATUS.REJECTED, reason || "");
  sendJson(res, 200, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id=?").get(c.id)) });
});

route("POST", "/api/admin/complaints/:id/assign", async (req, res, params) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const { workerId } = await readBody(req);
  const c = db.prepare("SELECT * FROM complaints WHERE id=?").get(params.id);
  if (!c) return sendJson(res, 404, { error: "Not found." });
  if (!isSuperAdmin(admin) && c.district !== admin.district) return sendJson(res, 403, { error: "That report belongs to a different district." });
  if (c.status !== STATUS.APPROVED) return sendJson(res, 400, { error: "Approve the report before assigning a worker." });
  const worker = db.prepare("SELECT * FROM users WHERE id=? AND role='worker'").get(workerId);
  if (!worker) return sendJson(res, 404, { error: "Worker not found." });
  if (worker.category !== c.category) return sendJson(res, 400, { error: "This worker doesn't cover that category." });
  if (worker.district !== c.district) return sendJson(res, 400, { error: "This worker isn't enrolled in that district." });
  db.prepare("UPDATE complaints SET status=?, assigned_worker_id=?, updated_at=? WHERE id=?").run(STATUS.ASSIGNED, workerId, nowIso(), c.id);
  addHistory(c.id, STATUS.ASSIGNED, `Assigned to ${worker.name}`);
  db.prepare("INSERT INTO notifications (user_id, type, complaint_id, created_at) VALUES (?,?,?,?)").run(workerId, "assignment", c.id, nowIso());
  sendJson(res, 200, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id=?").get(c.id)) });
});

route("POST", "/api/admin/complaints/:id/rate-worker", async (req, res, params) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const { rating } = await readBody(req);
  const r = Number(rating);
  if (!(r >= 1 && r <= 5)) return sendJson(res, 400, { error: "Rating must be 1 to 5." });
  const c = db.prepare("SELECT * FROM complaints WHERE id=?").get(params.id);
  if (!c || !c.assigned_worker_id) return sendJson(res, 404, { error: "No worker assigned to this report." });
  if (!isSuperAdmin(admin) && c.district !== admin.district) return sendJson(res, 403, { error: "That report belongs to a different district." });
  db.prepare("UPDATE complaints SET worker_rating=?, updated_at=? WHERE id=?").run(r, nowIso(), c.id);
  db.prepare("UPDATE users SET rating_total = rating_total + ?, rating_count = rating_count + 1 WHERE id=?").run(r, c.assigned_worker_id);
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/admin/workers", async (req, res, params, query) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  let rows = db.prepare("SELECT * FROM users WHERE role='worker' ORDER BY district, category").all();
  if (!isSuperAdmin(admin)) rows = rows.filter(w => w.district === admin.district);
  else if (query.district) rows = rows.filter(w => w.district === query.district);
  const active = db.prepare(`SELECT assigned_worker_id, COUNT(*) as c FROM complaints WHERE status IN (?,?,?) GROUP BY assigned_worker_id`)
    .all(STATUS.ASSIGNED, STATUS.SCHEDULED, STATUS.IN_PROGRESS);
  const activeMap = Object.fromEntries(active.map(a => [a.assigned_worker_id, a.c]));
  sendJson(res, 200, { workers: rows.map(w => ({ ...userOut(w), activeJobs: activeMap[w.id] || 0 })) });
});

route("GET", "/api/admin/stats", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  let all = db.prepare("SELECT status, category, district FROM complaints").all();
  all = scopeToDistrict(admin, all);
  const byStatus = {}; const byCategory = {};
  all.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; byCategory[r.category] = (byCategory[r.category] || 0) + 1; });
  sendJson(res, 200, { total: all.length, byStatus, byCategory });
});

/* ================= WORKER ================= */
function requireWorker(req, res) {
  const user = authUser(req);
  if (!user || user.role !== "worker") { sendJson(res, 403, { error: "Worker access only." }); return null; }
  return user;
}

route("GET", "/api/worker/assignments", async (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const rows = db.prepare("SELECT * FROM complaints WHERE assigned_worker_id=? ORDER BY updated_at DESC").all(worker.id);
  sendJson(res, 200, { complaints: rows.map(complaintOut) });
});

route("POST", "/api/worker/assignments/:id/accept", async (req, res, params) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const { scheduledAt } = await readBody(req);
  const c = db.prepare("SELECT * FROM complaints WHERE id=? AND assigned_worker_id=?").get(params.id, worker.id);
  if (!c) return sendJson(res, 404, { error: "Not found." });
  if (c.status !== STATUS.ASSIGNED) return sendJson(res, 400, { error: "This job was already accepted or is no longer pending." });
  db.prepare("UPDATE complaints SET status=?, scheduled_at=?, updated_at=? WHERE id=?").run(STATUS.SCHEDULED, scheduledAt || null, nowIso(), c.id);
  addHistory(c.id, STATUS.SCHEDULED, scheduledAt ? `Worker scheduled for ${scheduledAt}` : "Worker accepted");
  sendJson(res, 200, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id=?").get(c.id)) });
});

route("POST", "/api/worker/assignments/:id/status", async (req, res, params) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const { status } = await readBody(req);
  if (![STATUS.IN_PROGRESS, STATUS.COMPLETED].includes(status)) return sendJson(res, 400, { error: "Invalid status." });
  const c = db.prepare("SELECT * FROM complaints WHERE id=? AND assigned_worker_id=?").get(params.id, worker.id);
  if (!c) return sendJson(res, 404, { error: "Not found." });
  db.prepare("UPDATE complaints SET status=?, updated_at=? WHERE id=?").run(status, nowIso(), c.id);
  addHistory(c.id, status, "Updated by worker");
  sendJson(res, 200, { complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id=?").get(c.id)) });
});

route("GET", "/api/worker/notifications/pending", async (req, res) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  const rows = db.prepare("SELECT * FROM notifications WHERE user_id=? AND seen=0 ORDER BY created_at ASC").all(worker.id);
  const withComplaint = rows.map(n => ({ ...n, complaint: complaintOut(db.prepare("SELECT * FROM complaints WHERE id=?").get(n.complaint_id)) }));
  sendJson(res, 200, { notifications: withComplaint });
});

route("POST", "/api/worker/notifications/:id/seen", async (req, res, params) => {
  const worker = requireWorker(req, res);
  if (!worker) return;
  db.prepare("UPDATE notifications SET seen=1 WHERE id=? AND user_id=?").run(params.id, worker.id);
  sendJson(res, 200, { ok: true });
});

/* ================= MESSAGES (chat) ================= */
function userDistrict(userId) {
  const row = db.prepare("SELECT district FROM users WHERE id=?").get(userId);
  return row ? row.district : null;
}

route("GET", "/api/messages/thread/:userId", async (req, res, params) => {
  const user = authUser(req);
  if (!user) return sendJson(res, 401, { error: "Sign in required." });
  if (user.role === "admin") {
    if (!isSuperAdmin(user) && userDistrict(params.userId) !== user.district) return sendJson(res, 403, { error: "That conversation belongs to a different district." });
  } else if (user.id !== params.userId) {
    return sendJson(res, 403, { error: "Not your thread." });
  }
  const rows = db.prepare("SELECT * FROM messages WHERE thread_user_id=? ORDER BY at ASC").all(params.userId);
  if (user.role === "admin") db.prepare("UPDATE messages SET read_by_admin=1 WHERE thread_user_id=?").run(params.userId);
  else db.prepare("UPDATE messages SET read_by_user=1 WHERE thread_user_id=?").run(params.userId);
  sendJson(res, 200, { messages: rows });
});

route("POST", "/api/messages", async (req, res) => {
  const user = authUser(req);
  if (!user) return sendJson(res, 401, { error: "Sign in required." });
  const { text, threadUserId, complaintId } = await readBody(req);
  if (!text || !text.trim()) return sendJson(res, 400, { error: "Message can't be empty." });
  let thread;
  if (user.role === "admin") {
    if (!threadUserId) return sendJson(res, 400, { error: "threadUserId required for admin messages." });
    if (!isSuperAdmin(user) && userDistrict(threadUserId) !== user.district) return sendJson(res, 403, { error: "That conversation belongs to a different district." });
    thread = threadUserId;
  } else {
    thread = user.id;
  }
  db.prepare(`INSERT INTO messages (thread_user_id, from_user_id, from_role, text, complaint_id, at, read_by_admin, read_by_user)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(thread, user.id, user.role, text.trim(), complaintId || null, nowIso(), user.role === "admin" ? 1 : 0, user.role === "admin" ? 0 : 1);
  sendJson(res, 201, { ok: true });
});

route("GET", "/api/messages/threads", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const threadIds = db.prepare("SELECT DISTINCT thread_user_id FROM messages").all().map(r => r.thread_user_id);
  let result = threadIds.map(tid => {
    const u = db.prepare("SELECT id, name, role, district FROM users WHERE id=?").get(tid);
    const last = db.prepare("SELECT * FROM messages WHERE thread_user_id=? ORDER BY at DESC LIMIT 1").get(tid);
    const unread = db.prepare("SELECT COUNT(*) c FROM messages WHERE thread_user_id=? AND read_by_admin=0").get(tid).c;
    return { userId: tid, name: u ? u.name : "Unknown", role: u ? u.role : "unknown", district: u ? u.district : null, lastMessage: last ? last.text : "", lastAt: last ? last.at : null, unread };
  });
  if (!isSuperAdmin(admin)) result = result.filter(t => t.district === admin.district);
  result.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  sendJson(res, 200, { threads: result });
});

/* ---------------- static + upload serving ---------------- */
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
function serveStatic(req, res, rootDir, urlPath) {
  const target = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(target).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, safePath);
  if (!filePath.startsWith(rootDir)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---------------- request handler ---------------- */
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
  const query = Object.fromEntries(urlObj.searchParams.entries());

  if (pathname.startsWith("/uploads/")) return serveStatic(req, res, UPLOADS_DIR, pathname.replace("/uploads", ""));
  if (pathname.startsWith("/api/")) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      try {
        await r.handler(req, res, params, query);
      } catch (e) {
        console.error(e);
        if (!res.headersSent) sendJson(res, 500, { error: e.message || "Server error." });
      }
      return;
    }
    return sendJson(res, 404, { error: "No such API route." });
  }
  return serveStatic(req, res, PUBLIC_DIR, pathname);
});

server.listen(PORT, () => {
  console.log(`FixPoint server running at http://localhost:${PORT}`);
  console.log(`Super-admin login -> admin@fixpoint.local / admin123`);
  console.log(`District admin pattern -> admin.<district>@fixpoint.local / admin123 (e.g. admin.tiruchirappalli@fixpoint.local)`);
});

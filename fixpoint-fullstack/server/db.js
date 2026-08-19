const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "data.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  category TEXT,
  district TEXT,
  phone TEXT,
  rating_total INTEGER DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  district TEXT,
  description TEXT NOT NULL,
  photo_path TEXT,
  lat REAL,
  lng REAL,
  address TEXT,
  method TEXT,
  status TEXT NOT NULL,
  citizen_id TEXT NOT NULL,
  assigned_worker_id TEXT,
  scheduled_at TEXT,
  reject_reason TEXT,
  feedback_rating INTEGER,
  feedback_comment TEXT,
  worker_rating INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaint_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_user_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  text TEXT NOT NULL,
  complaint_id TEXT,
  at TEXT NOT NULL,
  read_by_admin INTEGER DEFAULT 0,
  read_by_user INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  complaint_id TEXT,
  seen INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

/* ---------- Migration: add district columns if this is an older database ---------- */
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
ensureColumn("users", "district", "TEXT");
ensureColumn("complaints", "district", "TEXT");

const CATEGORIES = [
  "Roads & Potholes",
  "Garbage & Sanitation",
  "Water Supply",
  "Street Lighting & Electrical",
  "Public Property / Other"
];

const TN_DISTRICTS = [
  "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul",
  "Erode", "Kallakurichi", "Kanchipuram", "Kanniyakumari", "Karur", "Krishnagiri",
  "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur",
  "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi",
  "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupattur",
  "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram",
  "Virudhunagar"
];

const STATUS = {
  SUBMITTED: "Submitted",
  REJECTED: "Rejected",
  APPROVED: "Approved",
  ASSIGNED: "Assigned",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed"
};

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}
function nowIso() { return new Date().toISOString(); }
function slugDistrict(d) { return d.toLowerCase().replace(/[^a-z]/g, ""); }

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(hash, "hex"));
}

/* ---------- Seed: one super-admin, one admin per district, demo workers in two districts ---------- */
function seed() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;

  const insertUser = db.prepare(`INSERT INTO users
    (id, role, name, email, password_hash, password_salt, category, district, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);

  // State-level super-admin (sees every district)
  const sa = hashPassword("admin123");
  insertUser.run("admin-1", "admin", "State Department Head", "admin@fixpoint.local", sa.hash, sa.salt, null, null, nowIso());

  // One department admin per district
  TN_DISTRICTS.forEach(d => {
    const { hash, salt } = hashPassword("admin123");
    insertUser.run(uid("adm"), "admin", `${d} Department`, `admin.${slugDistrict(d)}@fixpoint.local`, hash, salt, null, d, nowIso());
  });

  // Demo workers, one per category, in two districts to start with
  const trichyWorkers = [
    ["Ravi Kumar", "ravi.roads@fixpoint.local", "Roads & Potholes"],
    ["Meena S", "meena.sanitation@fixpoint.local", "Garbage & Sanitation"],
    ["Arun Das", "arun.water@fixpoint.local", "Water Supply"],
    ["Priya N", "priya.electrical@fixpoint.local", "Street Lighting & Electrical"],
    ["Suresh V", "suresh.property@fixpoint.local", "Public Property / Other"]
  ];
  trichyWorkers.forEach(([name, email, category]) => {
    const { hash, salt } = hashPassword("worker123");
    insertUser.run(uid("w"), "worker", name, email, hash, salt, category, "Tiruchirappalli", nowIso());
  });

  const chennaiWorkers = [
    ["Karthik R", "karthik.roads.chennai@fixpoint.local", "Roads & Potholes"],
    ["Divya M", "divya.sanitation.chennai@fixpoint.local", "Garbage & Sanitation"],
    ["Bala S", "bala.water.chennai@fixpoint.local", "Water Supply"],
    ["Lakshmi P", "lakshmi.electrical.chennai@fixpoint.local", "Street Lighting & Electrical"],
    ["Manoj K", "manoj.property.chennai@fixpoint.local", "Public Property / Other"]
  ];
  chennaiWorkers.forEach(([name, email, category]) => {
    const { hash, salt } = hashPassword("worker123");
    insertUser.run(uid("w"), "worker", name, email, hash, salt, category, "Chennai", nowIso());
  });
}
seed();

module.exports = { db, CATEGORIES, TN_DISTRICTS, STATUS, uid, nowIso, hashPassword, verifyPassword, slugDistrict };

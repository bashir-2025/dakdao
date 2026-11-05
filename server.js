// ডাকদাও — backend server (Node 22+)
// Run locally:  node --env-file=.env server.js
// Database: local SQLite file by default, or Turso when TURSO_DATABASE_URL is set.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error("❌ ADMIN_PASSWORD env variable must be set (at least 8 characters).");
  process.exit(1);
}

/* ---------------- database ---------------- */
const db = createClient(process.env.TURSO_DATABASE_URL
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: "file:" + path.join(__dirname, "data.db") });

await db.executeMultiple(`
  CREATE TABLE IF NOT EXISTS bids (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    msg         TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | pending | approved | rejected
    trx         TEXT UNIQUE,
    from_last4  TEXT,
    ip          TEXT,
    created_at  INTEGER NOT NULL,
    paid_at     INTEGER,
    decided_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_status_amount ON bids(status, amount DESC);
`);

const all = async (sql, ...args) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));
const get = async (sql, ...args) => (await all(sql, ...args))[0];
const run = async (sql, ...args) => (await db.execute({ sql, args })).rowsAffected;

const APPROVED = `SELECT name, msg, amount, decided_at AS time FROM bids WHERE status='approved' ORDER BY amount DESC, decided_at ASC`;
const q = {
  king:    () => get(APPROVED + " LIMIT 1"),
  history: () => all(APPROVED + " LIMIT 50 OFFSET 1"),
  insert:  (...a) => run(`INSERT INTO bids (ref, name, msg, amount, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)`, ...a),
  byRef:   ref => get(`SELECT * FROM bids WHERE ref = ?`, ref),
  byId:    id => get(`SELECT * FROM bids WHERE id = ?`, id),
  byTrx:   trx => get(`SELECT id FROM bids WHERE trx = ?`, trx),
  pay:     (...a) => run(`UPDATE bids SET status='pending', trx=?, from_last4=?, paid_at=? WHERE ref=? AND status='unpaid'`, ...a),
  pending: () => all(`SELECT id, ref, name, msg, amount, trx, from_last4, paid_at FROM bids WHERE status='pending' ORDER BY paid_at ASC`),
  decide:  (...a) => run(`UPDATE bids SET status=?, decided_at=? WHERE id=? AND status='pending'`, ...a),
  cleanup: t => run(`DELETE FROM bids WHERE status='unpaid' AND created_at < ?`, t),
};

const minNext = async () => {
  const k = await q.king();
  return k ? k.amount + config.minIncrement : config.startPrice;
};

// remove unpaid drafts older than 24h, hourly
setInterval(() => q.cleanup(Date.now() - 24 * 3600e3).catch(console.error), 3600e3).unref();

/* ---------------- admin sessions (signed cookie, survives restarts) ---------------- */
const SESSION_MS = 12 * 3600e3;
const SESSION_KEY = crypto.createHash("sha256").update("dakdao-session:" + ADMIN_PASSWORD).digest();
const sign = v => crypto.createHmac("sha256", SESSION_KEY).update(v).digest("hex");

function checkPassword(input) {
  const a = crypto.createHash("sha256").update(String(input)).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function getCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return exp + "." + sign(exp);
}
function isAdmin(req) {
  const [exp, sig] = String(getCookie(req, "dd_admin") || "").split(".");
  if (!exp || !sig || sig.length !== 64) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp)));
  return ok && Number(exp) > Date.now();
}

/* ---------------- rate limiting ---------------- */
const hits = new Map(); // key -> [timestamps]
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 3600e3).unref();

/* ---------------- helpers ---------------- */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
};
function send(res, status, data, extra = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra });
  res.end(JSON.stringify(data));
}
const fail = (res, status, error) => send(res, status, { error });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > 10_000) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const toEnDigits = s => String(s ?? "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const clientIp = req => (process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "") || req.socket.remoteAddress;

function newRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "DD";
  for (const b of crypto.randomBytes(6)) r += chars[b % chars.length];
  return r;
}

/* ---------------- routes ---------------- */
async function api(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const ip = clientIp(req);

  if (method === "GET" && pathname === "/api/health") return send(res, 200, { ok: true });

  // public state
  if (method === "GET" && pathname === "/api/state") {
    return send(res, 200, {
      king: (await q.king()) || null,
      history: await q.history(),
      minNext: await minNext(),
      bank: config.bank,
      minIncrement: config.minIncrement,
    });
  }

  // step 1: create a bid draft, returns a reference code to use in the bank transfer
  if (method === "POST" && pathname === "/api/bids") {
    if (limited("bid:" + ip, 10, 60e3)) return fail(res, 429, "অনেক বেশি চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করো");
    const b = await readBody(req);
    const name = clean(b.name, 40), msg = clean(b.msg, 120);
    const amount = Math.floor(Number(toEnDigits(b.amount).replace(/[,\s]/g, "")));
    if (!name) return fail(res, 400, "নাম লেখো");
    if (!msg) return fail(res, 400, "একটা বার্তা লেখো");
    if (!Number.isFinite(amount) || amount > 100_000_000) return fail(res, 400, "সঠিক পরিমাণ লেখো");
    const min = await minNext();
    if (amount < min) return fail(res, 400, `কমপক্ষে ৳${min} ডাক দিতে হবে`);
    const ref = newRef();
    await q.insert(ref, name, msg, amount, ip, Date.now());
    return send(res, 201, { ref, amount, bank: config.bank });
  }

  // step 2: submit payment proof
  let m = pathname.match(/^\/api\/bids\/([A-Z0-9]{8})\/payment$/);
  if (method === "POST" && m) {
    if (limited("pay:" + ip, 10, 60e3)) return fail(res, 429, "অনেক বেশি চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করো");
    const b = await readBody(req);
    const trx = clean(b.trx, 60).toUpperCase(), from = toEnDigits(clean(b.from, 4));
    const bid = await q.byRef(m[1]);
    if (!bid) return fail(res, 404, "ডাকটি খুঁজে পাওয়া যায়নি");
    if (bid.status !== "unpaid") return fail(res, 409, "এই ডাকের পেমেন্ট আগেই জমা হয়েছে");
    if (trx.length < 4) return fail(res, 400, "সঠিক ট্রানজেকশন আইডি দাও");
    if (!/^\d{4}$/.test(from)) return fail(res, 400, "অ্যাকাউন্টের শেষ ৪ সংখ্যা দাও");
    if (await q.byTrx(trx)) return fail(res, 409, "এই ট্রানজেকশন আইডি আগেই জমা হয়েছে");
    try { await q.pay(trx, from, Date.now(), bid.ref); }
    catch (e) {
      if (String(e.message).includes("UNIQUE")) return fail(res, 409, "এই ট্রানজেকশন আইডি আগেই জমা হয়েছে");
      throw e;
    }
    return send(res, 200, { ok: true, status: "pending" });
  }

  // bid status lookup (for the bidder)
  m = pathname.match(/^\/api\/bids\/([A-Z0-9]{8})$/);
  if (method === "GET" && m) {
    const bid = await q.byRef(m[1]);
    if (!bid) return fail(res, 404, "ডাকটি খুঁজে পাওয়া যায়নি");
    return send(res, 200, { ref: bid.ref, amount: bid.amount, msg: bid.msg, status: bid.status });
  }

  /* ----- admin ----- */
  if (method === "POST" && pathname === "/api/admin/login") {
    if (limited("login:" + ip, 5, 15 * 60e3)) return fail(res, 429, "অনেকবার ভুল হয়েছে, ১৫ মিনিট পরে চেষ্টা করো");
    const b = await readBody(req);
    if (!checkPassword(b.password || "")) return fail(res, 401, "ভুল পাসওয়ার্ড");
    const token = makeToken();
    const secure = process.env.COOKIE_SECURE ? "; Secure" : "";
    return send(res, 200, { ok: true }, { "Set-Cookie": `dd_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
  }
  if (method === "POST" && pathname === "/api/admin/logout") {
    return send(res, 200, { ok: true }, { "Set-Cookie": "dd_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }
  if (pathname.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return fail(res, 401, "লগইন করো");

    if (method === "GET" && pathname === "/api/admin/pending") {
      return send(res, 200, { pending: await q.pending(), kingAmount: (await q.king())?.amount ?? 0 });
    }
    m = pathname.match(/^\/api\/admin\/bids\/(\d+)\/(approve|reject)$/);
    if (method === "POST" && m) {
      const bid = await q.byId(Number(m[1]));
      if (!bid || bid.status !== "pending") return fail(res, 404, "এই পেমেন্ট আর অপেক্ষায় নেই");
      await q.decide(m[2] === "approve" ? "approved" : "rejected", Date.now(), bid.id);
      return send(res, 200, { ok: true });
    }
  }

  return fail(res, 404, "পাওয়া যায়নি");
}

/* ---------------- static files ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const PUBLIC = path.join(__dirname, "public");
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/" || p === "/admin") p = "/index.html";
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", ...SECURITY_HEADERS });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      // CSRF guard: state-changing requests must be JSON from our own page
      if (req.method !== "GET" && !String(req.headers["content-type"] || "").includes("application/json")) {
        return fail(res, 415, "JSON প্রয়োজন");
      }
      await api(req, res, url);
    } else serveStatic(req, res, url);
  } catch (e) {
    if (e.message === "too large" || e.message === "bad json") return fail(res, 400, "ভুল অনুরোধ");
    console.error(e);
    fail(res, 500, "সার্ভারে সমস্যা হয়েছে");
  }
}).listen(PORT, () => console.log(`✅ ডাকদাও চলছে: http://localhost:${PORT}`));

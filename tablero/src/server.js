import express from "express";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TiendanubeClient, productName } from "./tiendanube.js";
import { createDb } from "./db.js";

const {
  PORT = 3000,
  DATABASE_URL,
  SESSION_SECRET,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TIENDANUBE_STORE_ID,
  TIENDANUBE_ACCESS_TOKEN,
  TIENDANUBE_USER_AGENT,
  NODE_ENV,
} = process.env;

if (!DATABASE_URL) throw new Error("Falta DATABASE_URL");
if (!SESSION_SECRET || SESSION_SECRET.length < 24) throw new Error("Falta SESSION_SECRET (24+ caracteres)");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");
const D3_FILE = path.join(__dirname, "..", "node_modules", "d3", "dist", "d3.min.js");

const db = createDb(DATABASE_URL);
let tnClient = null;
const tn = {
  get(path, query) {
    if (!tnClient) {
      if (!TIENDANUBE_STORE_ID || !TIENDANUBE_ACCESS_TOKEN) {
        const e = new Error("Falta configurar TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN en Railway"); e.status = 503; throw e;
      }
      tnClient = new TiendanubeClient({ storeId: TIENDANUBE_STORE_ID, accessToken: TIENDANUBE_ACCESS_TOKEN, userAgent: TIENDANUBE_USER_AGENT || "Linea Color Tablero" });
    }
    return tnClient.get(path, query);
  },
};

// ---------- Tiendanube: pedidos y catálogo ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const pending = fn().then((value) => { cache.set(key, { at: Date.now(), value }); return value; })
    .catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { ...(hit || {}), at: hit ? hit.at : 0, pending });
  return pending;
}

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const dayAR = (s) => {
  const t = Date.parse(String(s).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isFinite(t) ? new Date(t - 3 * 3600e3).toISOString().slice(0, 10) : String(s).slice(0, 10);
};
const todayAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

async function fetchVentas(desde, hasta) {
  const query = { created_at_min: `${desde}T00:00:00-03:00`, created_at_max: `${hasta}T23:59:59-03:00`, payment_status: "paid", status: "any", per_page: 200 };
  const orders = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    if (page > 40) { truncated = true; break; }
    let data, total;
    try { ({ data, total } = await tn.get("/orders", { ...query, page })); }
    catch (e) { if (e.status === 404) break; throw e; }
    if (!data?.length) break;
    orders.push(...data);
    if (data.length < 200 || (total && orders.length >= Number(total))) break;
  }
  const rows = [];
  for (const o of orders) {
    const lines = (o.products || []).map((p) => ({ p, bruto: n(p.quantity) * n(p.price) }));
    const sub = n(o.subtotal) || lines.reduce((s, l) => s + l.bruto, 0);
    const desc = n(o.discount);
    lines.forEach((l, i) => rows.push({
      pedido: String(o.number), linea: i, fecha: dayAR(o.created_at),
      envio_tipo: o.shipping_option || "", provincia: o.shipping_address?.province || "",
      envio_cobrado: i === 0 ? n(o.shipping_cost_customer) : 0, total: i === 0 ? n(o.total) : 0,
      variant_id: String(l.p.variant_id), articulo: l.p.name, cantidad: n(l.p.quantity), precio: n(l.p.price),
      neto: Math.round((l.bruto - (sub ? (desc * l.bruto) / sub : 0)) * 100) / 100,
    }));
  }
  return { rows, truncated };
}

async function fetchCatalogo() {
  const rows = [];
  for (let page = 1; page < 50; page++) {
    let data;
    try { ({ data } = await tn.get("/products", { page, per_page: 200 })); }
    catch (e) { if (e.status === 404) break; throw e; }
    if (!data?.length) break;
    for (const p of data) {
      for (const v of p.variants || []) {
        const values = (v.values || []).map((x) => (typeof x === "string" ? x : x.es || Object.values(x)[0]));
        rows.push({
          variant_id: String(v.id), articulo: productName(p) + (values.length ? " · " + values.join(" / ") : ""),
          publicado: p.published !== false, sku: v.sku || "",
          precio_promo: v.promotional_price == null ? null : Number(v.promotional_price),
          costo: v.cost == null ? null : Number(v.cost), stock: v.stock == null ? null : Number(v.stock),
        });
      }
    }
    if (data.length < 200) break;
  }
  return { rows };
}

// ---------- App ----------
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Frame-Options", "DENY");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  next();
});
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieSession({
  name: "lc_sesion",
  keys: [SESSION_SECRET],
  maxAge: 14 * 24 * 3600 * 1000,
  httpOnly: true,
  sameSite: "lax",
  secure: NODE_ENV === "production",
}));

async function currentUser(req) {
  const id = req.session?.uid;
  if (!id) return null;
  const u = await db.userById(id);
  if (!u) { req.session = null; return null; }
  return u;
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAuth = (api) => wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return api ? res.status(401).json({ error: "Sesión vencida" }) : res.redirect("/login");
  req.user = u;
  next();
});
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) ? next() : res.status(403).json({ error: "Tu usuario no puede hacer cambios" });
const requireJson = (req, res, next) =>
  ["GET", "HEAD", "DELETE"].includes(req.method) || req.is("application/json") ? next() : res.status(415).json({ error: "Se espera JSON" });

// Login con freno a intentos repetidos
const attempts = new Map();
function tooMany(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60 * 1000) { attempts.delete(key); return false; }
  return a.count >= 8;
}
function fail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60 * 1000) attempts.set(key, { first: Date.now(), count: 1 });
  else a.count++;
}

app.get("/", (req, res) => res.redirect(req.session?.uid ? "/app/" : "/login"));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/login", (req, res) => res.sendFile(path.join(PUBLIC, "login.html")));
app.post("/login", wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const key = `${req.ip}|${email}`;
  if (tooMany(key)) return res.redirect("/login?e=bloqueado");
  const u = email && (await db.userByEmail(email));
  const ok = u && (await bcrypt.compare(password, u.password_hash));
  if (!ok) { fail(key); return res.redirect("/login?e=1"); }
  attempts.delete(key);
  req.session = { uid: u.id };
  res.redirect("/app/");
}));
app.post("/logout", (req, res) => { req.session = null; res.redirect("/login"); });

app.use((req, res, next) => (req.path === "/app" ? res.redirect("/app/") : next()));
app.use("/app", requireAuth(false), express.static(path.join(PUBLIC, "app"), { index: "index.html", maxAge: 0 }));
app.get("/vendor/d3.min.js", requireAuth(false), (_req, res) => res.sendFile(D3_FILE, { maxAge: "7d" }));

// ---------- API ----------
const api = express.Router();
api.use(requireAuth(true), requireJson);

api.get("/me", (req, res) => res.json({ id: req.user.id, email: req.user.email, nombre: req.user.nombre, rol: req.user.rol }));
api.post("/me/password", wrap(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!nueva || String(nueva).length < 10) return res.status(400).json({ error: "La contraseña nueva tiene que tener al menos 10 caracteres" });
  if (!(await bcrypt.compare(String(actual || ""), req.user.password_hash))) return res.status(400).json({ error: "La contraseña actual no es correcta" });
  await db.updateUser(req.user.id, { password_hash: await bcrypt.hash(String(nueva), 12) });
  res.json({ ok: true });
}));

const DATE = /^20\d{2}-[01]\d-[0-3]\d$/;
api.get("/ventas", wrap(async (req, res) => {
  const desde = String(req.query.desde || ""), hasta = String(req.query.hasta || "");
  if (!DATE.test(desde) || !DATE.test(hasta) || desde > hasta) return res.status(400).json({ error: "Fechas inválidas" });
  const ttl = hasta >= todayAR() ? 5 * 60 * 1000 : 60 * 60 * 1000;
  res.json(await cached(`ventas|${desde}|${hasta}`, ttl, () => fetchVentas(desde, hasta)));
}));
api.get("/catalogo", wrap(async (_req, res) => res.json(await cached("catalogo", 10 * 60 * 1000, fetchCatalogo))));

const numOr = (v, d) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const SUP_KEYS = ["roas", "envio_moova_caba", "envio_moova_gba", "envio_intralog", "envio_interior", "envio_retiro", "comision_pct"];
const PAR_KEYS = ["precio_cfr_usd_t", "seguro_pct", "arancel_pct", "tasa_est_pct", "gastos_pct", "iva_pct", "tipo_cambio"];

api.get("/supuestos", wrap(async (_req, res) => res.json({ rows: [{ id: "supuestos", ...(await db.getConfig("supuestos")) }] })));
api.put("/supuestos", requireRole("admin", "editor"), wrap(async (req, res) => {
  const prev = (await db.getConfig("supuestos")) || {};
  const next = {};
  for (const k of SUP_KEYS) next[k] = numOr(req.body?.[k], prev[k] ?? 0);
  await db.setConfig("supuestos", next);
  res.json({ ok: true });
}));
api.get("/paridad", wrap(async (_req, res) => res.json({ rows: [{ id: "paridad", ...(await db.getConfig("paridad")) }] })));
api.put("/paridad", requireRole("admin", "editor"), wrap(async (req, res) => {
  const prev = (await db.getConfig("paridad")) || {};
  const next = { fuente: prev.fuente || "" };
  for (const k of PAR_KEYS) next[k] = numOr(req.body?.[k], prev[k] ?? 0);
  const m = req.body?.costo_kg_manual;
  next.costo_kg_manual = m === null || m === "" || m === undefined || !(Number(m) > 0) ? null : Number(m);
  await db.setConfig("paridad", next);
  res.json({ ok: true });
}));

const TIPOS = ["plastico", "materia_prima", "packaging", "etiqueta", "mano_obra", "otro"];
function cleanInsumo(b) {
  const nombre = String(b?.nombre || "").trim().slice(0, 80);
  const tipo = TIPOS.includes(b?.tipo) ? b.tipo : "otro";
  if (!nombre) { const e = new Error("Falta el nombre"); e.status = 400; throw e; }
  return { nombre, tipo, unidad: tipo === "plastico" ? "kg" : String(b?.unidad || "u.").trim().slice(0, 12) || "u.", costo_unit: tipo === "plastico" ? null : numOr(b?.costo_unit, 0) };
}
function cleanConsumo(b) {
  const cantidad = Number(b?.cantidad);
  if (!b?.variant_id || !b?.insumo_id || !(cantidad > 0)) { const e = new Error("Faltan artículo, insumo o cantidad"); e.status = 400; throw e; }
  return { variant_id: String(b.variant_id).slice(0, 40), articulo: String(b.articulo || "").slice(0, 200), insumo_id: String(b.insumo_id).slice(0, 60), cantidad };
}
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const checkId = (req, res, next) => (ID.test(req.params.id) ? next() : res.status(400).json({ error: "Id inválido" }));
const edit = requireRole("admin", "editor");

api.get("/insumos", wrap(async (_req, res) => res.json({ rows: await db.listInsumos() })));
api.post("/insumos", edit, wrap(async (req, res) => res.json(await db.putInsumo(null, cleanInsumo(req.body)))));
api.put("/insumos/:id", edit, checkId, wrap(async (req, res) => res.json(await db.putInsumo(req.params.id, cleanInsumo(req.body)))));
api.delete("/insumos/:id", edit, checkId, wrap(async (req, res) => { await db.deleteInsumo(req.params.id); res.json({ ok: true }); }));

api.get("/consumos", wrap(async (_req, res) => res.json({ rows: await db.listConsumos() })));
api.post("/consumos", edit, wrap(async (req, res) => res.json(await db.putConsumo(null, cleanConsumo(req.body)))));
api.put("/consumos/:id", edit, checkId, wrap(async (req, res) => res.json(await db.putConsumo(req.params.id, cleanConsumo(req.body)))));
api.delete("/consumos/:id", edit, checkId, wrap(async (req, res) => { await db.deleteConsumo(req.params.id); res.json({ ok: true }); }));

// Usuarios (solo admin)
const ROLES = ["admin", "editor", "lector"];
const admin = requireRole("admin");
api.get("/usuarios", admin, wrap(async (_req, res) => res.json({ rows: await db.listUsers() })));
api.post("/usuarios", admin, wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const rol = ROLES.includes(req.body?.rol) ? req.body.rol : "lector";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Email inválido" });
  if (password.length < 10) return res.status(400).json({ error: "La contraseña tiene que tener al menos 10 caracteres" });
  if (await db.userByEmail(email)) return res.status(409).json({ error: "Ya existe un usuario con ese email" });
  res.json(await db.createUser({ email, nombre: String(req.body?.nombre || "").slice(0, 80), password_hash: await bcrypt.hash(password, 12), rol }));
}));
api.patch("/usuarios/:id", admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.userById(id);
  if (!u) return res.status(404).json({ error: "No existe" });
  const patch = {};
  if (req.body?.rol) {
    if (!ROLES.includes(req.body.rol)) return res.status(400).json({ error: "Rol inválido" });
    if (u.rol === "admin" && req.body.rol !== "admin" && (await db.countAdmins()) <= 1) return res.status(400).json({ error: "Tiene que quedar al menos un admin" });
    patch.rol = req.body.rol;
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 10) return res.status(400).json({ error: "La contraseña tiene que tener al menos 10 caracteres" });
    patch.password_hash = await bcrypt.hash(String(req.body.password), 12);
  }
  await db.updateUser(id, patch);
  res.json({ ok: true });
}));
api.delete("/usuarios/:id", admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "No podés borrar tu propio usuario" });
  await db.deleteUser(id);
  res.json({ ok: true });
}));

app.use("/api", api);
app.use((err, _req, res, _next) => {
  const status = err.status && (err.status < 500 || err.status === 503) ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? (String(err.message || "").startsWith("Tiendanube") ? "No se pudo leer Tiendanube" : "Error interno") : err.message });
});

// ---------- Arranque ----------
await db.init();
if ((await db.countUsers()) === 0) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) {
    console.warn("No hay usuarios: definí ADMIN_EMAIL y ADMIN_PASSWORD (10+ caracteres) para crear el primer admin.");
  } else {
    await db.createUser({ email: ADMIN_EMAIL, nombre: "Admin", password_hash: await bcrypt.hash(ADMIN_PASSWORD, 12), rol: "admin" });
    console.log(`Usuario admin creado: ${ADMIN_EMAIL}`);
  }
}
app.listen(PORT, () => console.log(`linea-color-tablero escuchando en :${PORT}`));

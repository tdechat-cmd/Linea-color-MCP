import pg from "pg";
import { randomUUID } from "node:crypto";

const SUPUESTOS = { roas: 6, envio_moova_caba: 7082, envio_moova_gba: 10224, envio_intralog: 15800, envio_interior: 18000, envio_retiro: 0, comision_pct: 0 };
const PARIDAD = {
  precio_cfr_usd_t: 1300, seguro_pct: 0.5, arancel_pct: 12, tasa_est_pct: 3, gastos_pct: 8, iva_pct: 21, tipo_cambio: 1604, costo_kg_manual: null,
  fuente: "valores al 25/11/2026. PP homopolímero CFR Sudamérica ~USD 1.300–1.350/t (Platts) y ofertas CFR Asia USD 1.210–1.380/t (Polymerupdate, noviembre 2026); dólar mayorista $1.604 (cierre 25/11/2026). Derecho de importación 12% y tasa estadística 3% son valores de referencia: confirmalos con tu despachante para la posición 3902.10.",
};

export function createDb(connectionString) {
  const ssl = /localhost|127\.0\.0\.1|\.railway\.internal/.test(connectionString) ? false : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString, ssl, max: 5 });
  const q = (text, params) => pool.query(text, params);

  async function init() {
    await q(`CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('admin','editor','lector')),
      creado TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS insumos (
      id TEXT PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL, unidad TEXT NOT NULL DEFAULT 'u.', costo_unit NUMERIC
    )`);
    await q(`CREATE TABLE IF NOT EXISTS consumos (
      id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, articulo TEXT NOT NULL DEFAULT '', insumo_id TEXT NOT NULL, cantidad NUMERIC NOT NULL
    )`);
    await q(`INSERT INTO config (key, value) VALUES ('supuestos', $1), ('paridad', $2) ON CONFLICT (key) DO NOTHING`, [SUPUESTOS, PARIDAD]);
    await q(`INSERT INTO insumos (id, nombre, tipo, unidad, costo_unit) VALUES ('pp', 'Polipropileno (PP)', 'plastico', 'kg', NULL) ON CONFLICT (id) DO NOTHING`);
  }

  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const rowInsumo = (r) => ({ id: r.id, nombre: r.nombre, tipo: r.tipo, unidad: r.unidad, costo_unit: num(r.costo_unit) });
  const rowConsumo = (r) => ({ id: r.id, variant_id: r.variant_id, articulo: r.articulo, insumo_id: r.insumo_id, cantidad: num(r.cantidad) });

  return {
    pool, init,
    // usuarios
    countUsers: async () => Number((await q("SELECT count(*)::int AS n FROM usuarios")).rows[0].n),
    userByEmail: async (email) => (await q("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [email])).rows[0],
    userById: async (id) => (await q("SELECT id, email, nombre, rol, password_hash FROM usuarios WHERE id = $1", [id])).rows[0],
    listUsers: async () => (await q("SELECT id, email, nombre, rol, creado FROM usuarios ORDER BY email")).rows,
    createUser: async ({ email, nombre, password_hash, rol }) =>
      (await q("INSERT INTO usuarios (email, nombre, password_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id, email, nombre, rol", [email.toLowerCase(), nombre || "", password_hash, rol])).rows[0],
    updateUser: async (id, { rol, password_hash, nombre }) => {
      if (rol) await q("UPDATE usuarios SET rol = $2 WHERE id = $1", [id, rol]);
      if (password_hash) await q("UPDATE usuarios SET password_hash = $2 WHERE id = $1", [id, password_hash]);
      if (nombre !== undefined) await q("UPDATE usuarios SET nombre = $2 WHERE id = $1", [id, nombre]);
    },
    deleteUser: async (id) => q("DELETE FROM usuarios WHERE id = $1", [id]),
    countAdmins: async () => Number((await q("SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin'")).rows[0].n),
    // config
    getConfig: async (key) => (await q("SELECT value FROM config WHERE key = $1", [key])).rows[0]?.value || null,
    setConfig: async (key, value) => q("INSERT INTO config (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]),
    // insumos
    listInsumos: async () => (await q("SELECT * FROM insumos ORDER BY nombre")).rows.map(rowInsumo),
    putInsumo: async (id, i) => rowInsumo((await q(
      `INSERT INTO insumos (id, nombre, tipo, unidad, costo_unit) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, unidad = EXCLUDED.unidad, costo_unit = EXCLUDED.costo_unit RETURNING *`,
      [id || randomUUID(), i.nombre, i.tipo, i.unidad, i.costo_unit])).rows[0]),
    deleteInsumo: async (id) => {
      const used = (await q("SELECT 1 FROM consumos WHERE insumo_id = $1 LIMIT 1", [id])).rows.length;
      if (used) { const e = new Error("El insumo está en uso"); e.status = 409; throw e; }
      await q("DELETE FROM insumos WHERE id = $1", [id]);
    },
    // consumos
    listConsumos: async () => (await q("SELECT * FROM consumos ORDER BY articulo, id")).rows.map(rowConsumo),
    putConsumo: async (id, c) => rowConsumo((await q(
      `INSERT INTO consumos (id, variant_id, articulo, insumo_id, cantidad) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET variant_id = EXCLUDED.variant_id, articulo = EXCLUDED.articulo, insumo_id = EXCLUDED.insumo_id, cantidad = EXCLUDED.cantidad RETURNING *`,
      [id || randomUUID(), c.variant_id, c.articulo || "", c.insumo_id, c.cantidad])).rows[0]),
    deleteConsumo: async (id) => q("DELETE FROM consumos WHERE id = $1", [id]),
  };
}

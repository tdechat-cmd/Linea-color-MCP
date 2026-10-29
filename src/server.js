import express from "express";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TiendanubeClient, compactProduct, productName } from "./tiendanube.js";

const {
  PORT = 3000,
  MCP_SECRET,
  TIENDANUBE_STORE_ID,
  TIENDANUBE_ACCESS_TOKEN,
  TIENDANUBE_USER_AGENT,
} = process.env;

if (!MCP_SECRET || MCP_SECRET.length < 24) {
  console.error("MCP_SECRET es obligatorio y debe tener al menos 24 caracteres.");
  process.exit(1);
}

const tn = new TiendanubeClient({
  storeId: TIENDANUBE_STORE_ID,
  accessToken: TIENDANUBE_ACCESS_TOKEN,
  userAgent: TIENDANUBE_USER_AGENT,
});

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message || e) }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = z.number().nonnegative();

function buildServer() {
  const server = new McpServer({ name: "linea-color-tiendanube", version: "1.0.0" });

  server.tool("get_store", "Datos generales de la tienda Linea Color.", {}, async () => {
    try {
      const { data } = await tn.get("/store");
      return ok({ id: data.id, name: productName(data), url: data.url_with_protocol, currency: data.main_currency, plan: data.plan_name });
    } catch (e) { return fail(e); }
  });

  server.tool(
    "list_products",
    "Lista productos con sus variantes (precio, precio promocional, costo, stock). Paginado.",
    {
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(200).default(50),
      q: z.string().optional().describe("Texto a buscar en el nombre o SKU"),
      published: z.boolean().optional(),
    },
    async ({ page, per_page, q, published }) => {
      try {
        const { data, total } = await tn.get("/products", { page, per_page, q, published });
        return ok({ total: Number(total) || undefined, page, products: data.map(compactProduct) });
      } catch (e) { return fail(e); }
    }
  );

  server.tool(
    "list_all_products",
    "Devuelve el catálogo completo (todas las páginas) en formato compacto.",
    { published: z.boolean().optional() },
    async ({ published }) => {
      try {
        const all = [];
        for (let page = 1; page < 50; page++) {
          let data;
          try {
            ({ data } = await tn.get("/products", { page, per_page: 200, published }));
          } catch (e) {
            if (e.status === 404) break;
            throw e;
          }
          if (!data?.length) break;
          all.push(...data.map(compactProduct));
          if (data.length < 200) break;
        }
        return ok({ count: all.length, products: all });
      } catch (e) { return fail(e); }
    }
  );

  server.tool(
    "get_product",
    "Detalle de un producto y sus variantes.",
    { product_id: z.number().int() },
    async ({ product_id }) => {
      try {
        const { data } = await tn.get(`/products/${product_id}`);
        return ok(compactProduct(data));
      } catch (e) { return fail(e); }
    }
  );

  const variantUpdate = {
    product_id: z.number().int(),
    variant_id: z.number().int(),
    price: money.optional().describe("Precio de lista (se muestra tachado si hay precio promocional)"),
    promotional_price: money.nullable().optional().describe("Precio promocional. null para quitarlo"),
    cost: money.optional(),
  };

  async function applyVariant({ product_id, variant_id, price, promotional_price, cost }) {
    const body = {};
    if (price !== undefined) body.price = price;
    if (promotional_price !== undefined) body.promotional_price = promotional_price;
    if (cost !== undefined) body.cost = cost;
    if (!Object.keys(body).length) throw new Error("No hay campos para actualizar");
    if (body.price !== undefined && body.promotional_price && body.promotional_price >= body.price) {
      throw new Error("El precio promocional debe ser menor que el precio de lista");
    }
    const { data } = await tn.put(`/products/${product_id}/variants/${variant_id}`, body);
    return { product_id, variant_id, price: data.price, promotional_price: data.promotional_price, cost: data.cost };
  }

  server.tool(
    "update_variant",
    "Actualiza precio, precio promocional (precio tachado) y/o costo de una variante.",
    variantUpdate,
    async (args) => {
      try { return ok(await applyVariant(args)); } catch (e) { return fail(e); }
    }
  );

  server.tool(
    "bulk_update_variants",
    "Actualiza varias variantes en una sola llamada (máximo 150). Devuelve el resultado de cada una.",
    { updates: z.array(z.object(variantUpdate)).min(1).max(150) },
    async ({ updates }) => {
      const results = [];
      for (const u of updates) {
        try {
          results.push({ ok: true, ...(await applyVariant(u)) });
        } catch (e) {
          results.push({ ok: false, product_id: u.product_id, variant_id: u.variant_id, error: String(e.message || e) });
        }
        await sleep(250);
      }
      return ok({ updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
    }
  );

  server.tool(
    "list_orders",
    "Lista pedidos en formato compacto. Fechas en ISO 8601 (ej. 2026-11-02T00:00:00-03:00).",
    {
      created_at_min: z.string().optional(),
      created_at_max: z.string().optional(),
      payment_status: z.enum(["any", "pending", "authorized", "paid", "abandoned", "refunded", "voided"]).optional(),
      status: z.enum(["any", "open", "closed", "cancelled"]).optional(),
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(200).default(50),
    },
    async (args) => {
      try {
        const { data, total } = await tn.get("/orders", args);
        return ok({
          total: Number(total) || undefined,
          orders: data.map((o) => ({
            id: o.id, number: o.number, created_at: o.created_at, status: o.status,
            payment_status: o.payment_status, shipping_status: o.shipping_status,
            subtotal: o.subtotal, discount: o.discount, shipping: o.shipping_cost_customer, total: o.total,
            province: o.shipping_address?.province, shipping_option: o.shipping_option,
            products: (o.products || []).map((p) => ({ name: p.name, variant_id: p.variant_id, quantity: p.quantity, price: p.price })),
          })),
        });
      } catch (e) { return fail(e); }
    }
  );

  return server;
}

function secretMatches(given) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(MCP_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.json({ ok: true, service: "linea-color-mcp" }));

app.post("/mcp/:secret", async (req, res) => {
  if (!secretMatches(req.params.secret)) return res.status(404).end();
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

app.all("/mcp/:secret", (req, res) => {
  if (!secretMatches(req.params.secret)) return res.status(404).end();
  res.status(405).set("Allow", "POST").end();
});

app.listen(PORT, () => console.log(`linea-color-mcp escuchando en :${PORT}`));

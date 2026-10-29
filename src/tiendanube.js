const API_BASE = "https://api.tiendanube.com/v1";

export class TiendanubeClient {
  constructor({ storeId, accessToken, userAgent }) {
    if (!storeId || !accessToken) {
      throw new Error("Faltan TIENDANUBE_STORE_ID o TIENDANUBE_ACCESS_TOKEN");
    }
    this.storeId = storeId;
    this.accessToken = accessToken;
    this.userAgent = userAgent || "Linea Color MCP";
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(`${API_BASE}/${this.storeId}${path}`);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authentication: `bearer ${this.accessToken}`,
          "User-Agent": this.userAgent,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("x-rate-limit-reset") || 1000);
        await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 500), 5000)));
        continue;
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(`Tiendanube ${res.status}: ${text.slice(0, 500)}`);
        err.status = res.status;
        throw err;
      }
      return { data, total: res.headers.get("x-total-count") };
    }
    throw new Error("Tiendanube: demasiados reintentos por límite de requests (429)");
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }
  put(path, body) {
    return this.request("PUT", path, { body });
  }
}

export function productName(p) {
  const n = p?.name;
  if (!n) return "";
  return typeof n === "string" ? n : n.es || Object.values(n)[0] || "";
}

export function compactProduct(p) {
  return {
    id: p.id,
    name: productName(p),
    published: p.published,
    handle: typeof p.handle === "string" ? p.handle : p.handle?.es,
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      sku: v.sku,
      values: (v.values || []).map((x) => (typeof x === "string" ? x : x.es || Object.values(x)[0])),
      price: v.price,
      promotional_price: v.promotional_price,
      cost: v.cost,
      stock: v.stock,
    })),
  };
}

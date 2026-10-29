# Linea Color · MCP de Tiendanube

Servidor MCP remoto (Streamable HTTP) para leer el catálogo y los pedidos de la tienda Tiendanube de Linea Color y actualizar precios, precios promocionales (precio tachado) y costos.

## Variables de entorno (Railway → Variables)

| Variable | Valor |
|---|---|
| `TIENDANUBE_STORE_ID` | ID de la tienda (`7018822`) |
| `TIENDANUBE_ACCESS_TOKEN` | Token de acceso de la app de Tiendanube |
| `TIENDANUBE_USER_AGENT` | `Linea Color MCP (tu-email@dominio.com)` |
| `MCP_SECRET` | Cadena aleatoria de 24+ caracteres. Forma parte de la URL del conector |

Railway define `PORT` automáticamente.

## URL del conector

```
https://<tu-servicio>.up.railway.app/mcp/<MCP_SECRET>
```

Cargarla en claude.ai → Configuración → Conectores → Agregar conector personalizado.

## Herramientas

- `get_store`
- `list_products`, `list_all_products`, `get_product`
- `update_variant`, `bulk_update_variants` (precio, precio promocional, costo)
- `list_orders`

## Local

```
npm install
MCP_SECRET=... TIENDANUBE_STORE_ID=... TIENDANUBE_ACCESS_TOKEN=... npm start
```

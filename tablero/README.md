# Linea Color · Tablero comercial y de precosteo

App web con login que muestra la venta de la tienda Tiendanube, el margen bruto, los gastos estimados (envío, pauta, comisiones), la proyección del mes, el ranking de artículos con acciones sugeridas y la solapa de precosteo (insumos, consumos y costo del kg de plástico por paridad de importación).

## Cómo se publica en Railway

1. **Nuevo servicio**: en el proyecto de Railway donde ya está el conector, *New → GitHub Repo*, elegí este repo y en *Settings → Source* poné **Root Directory = `/tablero`** (y en *Watch Paths* `/tablero/**`, para que no se redeploye con cambios del conector).
2. **Base de datos**: *New → Database → PostgreSQL*. En el servicio del tablero, agregá la variable `DATABASE_URL` con el valor `${{Postgres.DATABASE_URL}}`.
3. **Variables del servicio del tablero** (Settings → Variables):

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | Cadena aleatoria de 32+ caracteres |
| `ADMIN_EMAIL` | Email del primer administrador |
| `ADMIN_PASSWORD` | Contraseña inicial del admin (10+ caracteres). Cambiala después desde "Mi cuenta" |
| `TIENDANUBE_STORE_ID` | Igual que en el conector |
| `TIENDANUBE_ACCESS_TOKEN` | Igual que en el conector (podés usar `${{linea-color-mcp.TIENDANUBE_ACCESS_TOKEN}}`) |
| `TIENDANUBE_USER_AGENT` | `Linea Color Tablero (tu-email@dominio.com)` |
| `NODE_ENV` | `production` |

4. **Dominio**: Settings → Networking → *Generate Domain*, o *Custom Domain* para usar algo como `tablero.lineacolor.com.ar` (Railway te indica el CNAME que tenés que cargar en tu DNS).
5. Entrá con `ADMIN_EMAIL` y `ADMIN_PASSWORD` y creá el resto de los usuarios en **Mi cuenta → Usuarios**.

El admin inicial se crea solo la primera vez que la base está vacía. Después de entrar podés borrar `ADMIN_PASSWORD` de las variables.

## Roles

- **Admin**: todo, más alta y baja de usuarios.
- **Editor**: carga supuestos de gastos, paridad del plástico, insumos y consumos.
- **Lector**: solo mira.

## Datos

- Pedidos y catálogo se leen de la API de Tiendanube (solo lectura) y se guardan en memoria 5 minutos (1 hora para períodos cerrados).
- Supuestos, paridad, insumos, consumos y usuarios se guardan en Postgres.
- Las contraseñas se guardan con bcrypt; la sesión es una cookie firmada, `httpOnly`, válida 14 días.

## Local

```
npm install
DATABASE_URL=postgres://... SESSION_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
TIENDANUBE_STORE_ID=... TIENDANUBE_ACCESS_TOKEN=... npm start
```

/* Linea Color · cálculos del tablero comercial */
window.LC = (function () {
  const DAY = 864e5;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r0 = (v) => Math.round(v);
  const r1 = (v) => Math.round(v * 10) / 10;

  function arDate(s) {
    const t = Date.parse(String(s).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    return Number.isFinite(t) ? iso(t - 3 * 3600e3) : String(s).slice(0, 10);
  }
  function todayAR() { return iso(Date.now() - 3 * 3600e3); }

  const DEFAULTS = { roas: 6, envio_moova_caba: 7082, envio_moova_gba: 10224, envio_intralog: 15800, envio_interior: 18000, envio_retiro: 0, comision_pct: 0 };
  function sup(rows) {
    const r = (rows && rows[0]) || {};
    const g = (k) => { const v = Number(r[k]); return Number.isFinite(v) ? v : DEFAULTS[k]; };
    return {
      roas: Math.max(0.1, g('roas')), caba: g('envio_moova_caba'), gba: g('envio_moova_gba'),
      intralog: g('envio_intralog'), interior: g('envio_interior'), retiro: g('envio_retiro'),
      comision: g('comision_pct') / 100,
    };
  }
  function modalidad(r) {
    const o = String(r.envio_tipo || '').toLowerCase();
    if (o.includes('moova')) return r.provincia === 'Capital Federal' ? 'Moova CABA' : 'Moova GBA';
    if (o.includes('intralog')) return 'Intralog AMBA';
    if (o.includes('interior')) return 'Interior';
    if (o.includes('parque patricios') || o.includes('retiro')) return 'Retiro en Parque Patricios';
    return 'Otra';
  }
  function costoEnvio(mod, S) {
    const m = { 'Moova CABA': S.caba, 'Moova GBA': S.gba, 'Intralog AMBA': S.intralog, 'Interior': S.interior, 'Retiro en Parque Patricios': S.retiro };
    return mod in m ? m[mod] : S.gba;
  }
  function periodo(p) {
    const hoy = todayAR();
    const desde = (p && p.desde) || hoy.slice(0, 8) + '01';
    let hasta = (p && p.hasta) || hoy;
    if (hasta > hoy) hasta = hoy;
    const dias = Math.max(1, Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / DAY) + 1);
    const diasMes = new Date(Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7), 0)).getUTCDate();
    return { desde, hasta, dias, diasMes, factor: diasMes / dias };
  }

  function base(ventas, catalogo, supuestos) {
    const S = sup(supuestos);
    const cat = new Map((catalogo || []).map((c) => [String(c.variant_id), c]));
    let venta = 0, cmvConocido = 0, ventaConCosto = 0, envCob = 0, envCosto = 0, facturado = 0, unidades = 0, pedidos = 0;
    const lineas = new Map();
    for (const r of ventas || []) {
      const neto = num(r.neto), q = num(r.cantidad);
      venta += neto; unidades += q;
      const c = cat.get(String(r.variant_id));
      if (c && c.costo != null) { cmvConocido += num(c.costo) * q; ventaConCosto += neto; }
      lineas.set(r.pedido, (lineas.get(r.pedido) || 0) + 1);
      if (num(r.linea) === 0) {
        pedidos += 1; envCob += num(r.envio_cobrado); facturado += num(r.total);
        envCosto += costoEnvio(modalidad(r), S);
      }
    }
    const ratio = ventaConCosto > 0 ? cmvConocido / ventaConCosto : 0;
    const cmv = cmvConocido + (venta - ventaConCosto) * ratio;
    return { S, cat, venta, cmv, ratio, ventaSinCosto: venta - ventaConCosto, envCob, envCosto, facturado, unidades, pedidos, lineas };
  }

  function kpis(ventas, catalogo, supuestos, params) {
    const B = base(ventas, catalogo, supuestos), P = periodo(params);
    const margen = B.venta - B.cmv;
    const pauta = B.venta / B.S.roas;
    const comisiones = B.facturado * B.S.comision;
    const envioNeto = B.envCosto - B.envCob;
    const contribucion = margen - envioNeto - pauta - comisiones;
    const pc = (v) => (B.venta > 0 ? r1((v / B.venta) * 100) : 0);
    return [{
      venta: r0(B.venta), pedidos: B.pedidos, unidades: B.unidades,
      ticket: B.pedidos ? r0(B.facturado / B.pedidos) : 0,
      facturado: r0(B.facturado),
      cmv: r0(B.cmv), margen: r0(margen), margen_pct: pc(margen),
      envio_costo: r0(B.envCosto), envio_cobrado: r0(B.envCob), envio_neto: r0(envioNeto),
      pauta: r0(pauta), comisiones: r0(comisiones),
      contribucion: r0(contribucion), contribucion_pct: pc(contribucion),
      venta_sin_costo_pct: pc(B.ventaSinCosto),
      dias: P.dias, dias_mes: P.diasMes,
      venta_proy: r0(B.venta * P.factor), margen_proy: r0(margen * P.factor),
      contribucion_proy: r0(contribucion * P.factor),
      pauta_proy: r0(pauta * P.factor), envio_neto_proy: r0(envioNeto * P.factor),
      roas: B.S.roas,
    }];
  }

  function cascada(kpisRows) {
    const k = kpisRows && kpisRows[0];
    if (!k) return [];
    const f = k.dias_mes / k.dias;
    const pc = (v) => (k.venta ? r1((v / k.venta) * 100) : 0);
    const row = (concepto, v) => ({ concepto, periodo: r0(v), pct: pc(v), proyeccion: r0(v * f) });
    return [
      row('Venta neta', k.venta),
      row('Costo de mercadería (CMV)', -k.cmv),
      row('Margen bruto', k.margen),
      row('Envío (costo − cobrado)', -k.envio_neto),
      row('Pauta', -k.pauta),
      row('Comisiones de cobro', -k.comisiones),
      row('Contribución', k.contribucion),
    ];
  }

  function diario(ventas, catalogo) {
    const cat = new Map((catalogo || []).map((c) => [String(c.variant_id), c]));
    let cc = 0, vc = 0;
    for (const r of ventas || []) { const c = cat.get(String(r.variant_id)); if (c && c.costo != null) { cc += num(c.costo) * num(r.cantidad); vc += num(r.neto); } }
    const ratio = vc ? cc / vc : 0;
    const m = new Map();
    for (const r of ventas || []) {
      const d = m.get(r.fecha) || { fecha: r.fecha, venta: 0, cmv: 0, pedidos: 0 };
      const c = cat.get(String(r.variant_id));
      d.venta += num(r.neto);
      d.cmv += c && c.costo != null ? num(c.costo) * num(r.cantidad) : num(r.neto) * ratio;
      if (num(r.linea) === 0) d.pedidos += 1;
      m.set(r.fecha, d);
    }
    return [...m.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
      .map((d) => ({ fecha: d.fecha, venta: r0(d.venta), margen: r0(d.venta - d.cmv), pedidos: d.pedidos }));
  }

  function envios(ventas, supuestos) {
    const S = sup(supuestos);
    const m = new Map();
    for (const r of ventas || []) {
      const mod = modalidad(r);
      const e = m.get(mod) || { modalidad: mod, pedidos: 0, venta: 0, cobrado: 0, costo: 0 };
      e.venta += num(r.neto);
      if (num(r.linea) === 0) { e.pedidos += 1; e.cobrado += num(r.envio_cobrado); e.costo += costoEnvio(mod, S); }
      m.set(mod, e);
    }
    return [...m.values()].sort((a, b) => b.venta - a.venta).map((e) => ({
      modalidad: e.modalidad, pedidos: e.pedidos, venta: r0(e.venta), cobrado: r0(e.cobrado),
      costo: r0(e.costo), neto: r0(e.costo - e.cobrado), neto_pct: e.venta ? r1(((e.costo - e.cobrado) / e.venta) * 100) : 0,
    }));
  }

  function ranking(ventas, catalogo, supuestos, params) {
    const B = base(ventas, catalogo, supuestos), P = periodo(params);
    const varPct = 1 / B.S.roas + (B.venta ? (B.envCosto - B.envCob) / B.venta : 0) + B.S.comision * (B.venta ? B.facturado / B.venta : 1);
    const m = new Map();
    for (const r of ventas || []) {
      const key = String(r.variant_id);
      const c = B.cat.get(key);
      const a = m.get(key) || { variant_id: key, articulo: (c && c.articulo) || r.articulo, unidades: 0, venta: 0, cmv: 0, sin_costo: !(c && c.costo != null) };
      const q = num(r.cantidad), neto = num(r.neto);
      a.unidades += q; a.venta += neto;
      a.cmv += c && c.costo != null ? num(c.costo) * q : neto * B.ratio;
      m.set(key, a);
    }
    const rows = [...m.values()].map((a) => {
      const c = B.cat.get(a.variant_id);
      const margen = a.venta - a.cmv;
      const contrib = margen - a.venta * varPct;
      const stock = c && c.stock != null && num(c.stock) < 1e6 ? num(c.stock) : null;
      const ritmo = a.unidades / P.dias;
      return {
        variant_id: a.variant_id, articulo: a.articulo, unidades: a.unidades, venta: r0(a.venta),
        margen: r0(margen), margen_pct: a.venta ? r1((margen / a.venta) * 100) : 0,
        contrib: r0(contrib), contrib_pct: a.venta ? r1((contrib / a.venta) * 100) : 0,
        part: B.venta ? r1((a.venta / B.venta) * 100) : 0,
        stock, cobertura_dias: stock != null && ritmo > 0 ? Math.round(stock / ritmo) : null,
        sin_costo: a.sin_costo,
      };
    }).sort((a, b) => b.margen - a.margen);
    rows.forEach((r, i) => {
      r.puesto = i + 1;
      r.accion = r.sin_costo ? 'Cargar costo'
        : r.cobertura_dias != null && r.cobertura_dias < 15 ? 'Reponer stock'
        : r.contrib_pct < 0 ? 'Revisar precio'
        : r.puesto <= 3 ? 'Escalar en pauta'
        : r.margen_pct < 45 ? 'Cuidar descuento'
        : 'Mantener';
    });
    return rows;
  }

  function acciones(rank, env, kpisRows, ventas, catalogo) {
    const k = kpisRows && kpisRows[0];
    if (!k || !rank || !rank.length) return [];
    const money = (v) => '$ ' + Math.round(v).toLocaleString('es-AR');
    const pct = (v) => (Math.round(v * 10) / 10).toLocaleString('es-AR') + ' %';
    const list = (xs) => xs.length > 1 ? xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1] : xs[0];
    const out = [];

    const top = rank.filter((r) => r.contrib_pct > 0 && !r.sin_costo).slice(0, 3);
    if (top.length) {
      const share = k.margen ? (top.reduce((s, r) => s + r.margen, 0) / k.margen) * 100 : 0;
      out.push({ prioridad: 'Alta', tema: 'Pauta', accion: 'Concentrar la pauta en ' + list(top.map((r) => r.articulo)),
        detalle: 'Generan el ' + pct(share) + ' del margen bruto del período y siguen dejando ganancia después de pauta y envío. Usalos como producto ancla en anuncios y arriba de todo en la home.' });
    }
    const rep = rank.filter((r) => r.cobertura_dias != null && r.cobertura_dias < 15);
    if (rep.length) {
      out.push({ prioridad: 'Alta', tema: 'Stock', accion: 'Reponer ' + list(rep.slice(0, 4).map((r) => r.articulo)),
        detalle: rep.slice(0, 6).map((r) => r.articulo + ': ' + r.stock + ' u., alcanza para ~' + r.cobertura_dias + ' días').join(' · ') + '. Si no llega la reposición, sacalos de la pauta para no pagar clics sin stock.' });
    }
    const neg = rank.filter((r) => r.contrib_pct < 0 && !r.sin_costo);
    if (neg.length) {
      out.push({ prioridad: 'Alta', tema: 'Precio', accion: 'Revisar el precio de ' + neg.length + (neg.length === 1 ? ' artículo que no cubre' : ' artículos que no cubren') + ' pauta y envío',
        detalle: neg.slice(0, 5).map((r) => r.articulo + ' (margen bruto ' + pct(r.margen_pct) + ')').join(' · ') + '. Subí el precio, sacalos de la promo o vendelos solo dentro de combos.' });
    }
    if (k.contribucion_pct < 15) {
      out.push({ prioridad: 'Alta', tema: 'Rentabilidad', accion: 'La contribución quedó en ' + pct(k.contribucion_pct) + ' de la venta',
        detalle: 'Después de mercadería, envío y pauta queda poco. Revisá la profundidad del descuento o pedile a la pauta un ROAS mayor a ' + k.roas.toLocaleString('es-AR') + '.' });
    }
    const inter = (env || []).find((e) => e.modalidad === 'Interior');
    if (inter && inter.venta > 0 && inter.neto_pct > 8) {
      const tk = inter.pedidos ? inter.venta / inter.pedidos : 0;
      out.push({ prioridad: 'Media', tema: 'Envíos', accion: 'Poner un mínimo de compra para el envío gratis al interior',
        detalle: 'El envío al interior se lleva el ' + pct(inter.neto_pct) + ' de lo que se vende ahí (' + money(inter.neto) + ' en ' + inter.pedidos + ' pedidos, ticket promedio ' + money(tk) + '). Un mínimo cerca de ' + money(Math.ceil((tk * 1.2) / 10000) * 10000) + ' empuja a sumar artículos.' });
    }
    const lineas = new Map();
    for (const r of ventas || []) lineas.set(r.pedido, (lineas.get(r.pedido) || 0) + 1);
    const solo = [...lineas.values()].filter((n) => n === 1).length;
    if (lineas.size && solo / lineas.size > 0.5) {
      out.push({ prioridad: 'Media', tema: 'Ticket', accion: 'Sumar una oferta complementaria en el carrito',
        detalle: 'El ' + pct((solo / lineas.size) * 100) + ' de los pedidos lleva un solo artículo. Ofrecé un combo vianda o un set de potes con descuento al agregar un combo grande.' });
    }
    const sinCosto = rank.filter((r) => r.sin_costo);
    if (sinCosto.length) {
      out.push({ prioridad: 'Media', tema: 'Datos', accion: 'Cargar el costo de ' + sinCosto.length + (sinCosto.length === 1 ? ' artículo' : ' artículos'),
        detalle: list(sinCosto.slice(0, 5).map((r) => r.articulo)) + ' no tienen costo en Tiendanube; su margen se estima con el promedio del resto.' });
    }
    const vendidos = new Set(rank.map((r) => r.variant_id));
    const quietos = (catalogo || []).filter((c) => !vendidos.has(String(c.variant_id)) && c.publicado !== false && c.stock != null && c.stock >= 300 && c.stock < 1e6 && c.costo != null)
      .map((c) => ({ ...c, capital: c.stock * c.costo })).sort((a, b) => b.capital - a.capital).slice(0, 4);
    if (quietos.length) {
      out.push({ prioridad: 'Baja', tema: 'Stock', accion: 'Mover stock que no rotó en el período',
        detalle: quietos.map((c) => c.articulo + ' (' + c.stock.toLocaleString('es-AR') + ' u., ' + money(c.capital) + ' a costo)').join(' · ') + '. Sumalos a combos o a la promo de Black Friday.' });
    }
    const ord = { Alta: 0, Media: 1, Baja: 2 };
    return out.sort((a, b) => ord[a.prioridad] - ord[b.prioridad]).map((a, i) => ({ id: 'a' + (i + 1), ...a }));
  }

  return { arDate, todayAR, periodo, modalidad, kpis, cascada, diario, envios, ranking, acciones, DEFAULTS };
})();

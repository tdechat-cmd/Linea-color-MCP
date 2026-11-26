/* Linea Color · solapa de precosteo */
window.LCP = (function () {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r2 = (v) => Math.round(v * 100) / 100;
  const PARIDAD = { precio_cfr_usd_t: 1300, seguro_pct: 0.5, arancel_pct: 12, tasa_est_pct: 3, gastos_pct: 8, iva_pct: 21, tipo_cambio: 1604, costo_kg_manual: null };
  const TIPOS = { plastico: 'Plástico (PP)', materia_prima: 'Otra materia prima', packaging: 'Packaging', etiqueta: 'Etiquetas', mano_obra: 'Mano de obra', otro: 'Otro' };

  function costoKg(paridad) {
    const r = (paridad && paridad[0]) || {};
    const g = (k) => { const v = r[k]; return v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? PARIDAD[k] : Number(v); };
    const cfr = g('precio_cfr_usd_t');
    const cif = cfr * (1 + g('seguro_pct') / 100);
    const nac = cif * (1 + (g('arancel_pct') + g('tasa_est_pct')) / 100) * (1 + g('gastos_pct') / 100);
    const sugerido = ((nac * g('tipo_cambio')) / 1000) * (1 + g('iva_pct') / 100);
    const manual = num(r.costo_kg_manual) > 0 ? num(r.costo_kg_manual) : null;
    return [{
      cfr_usd_t: r2(cfr), cif_usd_t: r2(cif), nacionalizado_usd_t: r2(nac), tipo_cambio: g('tipo_cambio'),
      sugerido_kg: r2(sugerido), manual_kg: manual, usado_kg: r2(manual != null ? manual : sugerido),
      origen: manual != null ? 'Manual' : 'Sugerido por paridad',
    }];
  }

  function insumosDet(insumos, kg) {
    const k = kg && kg[0];
    return (insumos || []).map((i) => ({
      id: i.id, nombre: i.nombre || '(sin nombre)', tipo: i.tipo || 'otro', tipo_label: TIPOS[i.tipo] || 'Otro',
      unidad: i.tipo === 'plastico' ? 'kg' : (i.unidad || 'u.'),
      costo_unit: i.tipo === 'plastico' ? (k ? k.usado_kg : null) : r2(num(i.costo_unit)),
    })).sort((a, b) => (a.tipo === 'plastico' ? -1 : b.tipo === 'plastico' ? 1 : a.nombre.localeCompare(b.nombre, 'es')));
  }

  function consumosDet(consumos, insumosRows) {
    const ins = new Map((insumosRows || []).map((i) => [i.id, i]));
    return (consumos || []).map((c) => {
      const i = ins.get(c.insumo_id);
      const cu = i ? num(i.costo_unit) : 0;
      return {
        id: c.id, variant_id: String(c.variant_id), articulo: c.articulo || '', insumo_id: c.insumo_id,
        insumo: i ? i.nombre : '(insumo borrado)', tipo: i ? i.tipo_label : '—', unidad: i ? i.unidad : '',
        cantidad: num(c.cantidad), costo_unit: cu, subtotal: r2(cu * num(c.cantidad)),
      };
    });
  }

  function precosteo(det, insumosRows, catalogo) {
    const ins = new Map((insumosRows || []).map((i) => [i.id, i]));
    const cat = new Map((catalogo || []).map((c) => [String(c.variant_id), c]));
    const m = new Map();
    for (const d of det || []) {
      const i = ins.get(d.insumo_id);
      const c = cat.get(d.variant_id);
      const a = m.get(d.variant_id) || { variant_id: d.variant_id, articulo: (c && c.articulo) || d.articulo, plastico: 0, packaging: 0, etiquetas: 0, otros: 0 };
      const t = i ? i.tipo : 'otro';
      const k = t === 'plastico' ? 'plastico' : t === 'packaging' ? 'packaging' : t === 'etiqueta' ? 'etiquetas' : 'otros';
      a[k] += d.subtotal;
      m.set(d.variant_id, a);
    }
    return [...m.values()].map((a) => {
      const c = cat.get(a.variant_id);
      const total = a.plastico + a.packaging + a.etiquetas + a.otros;
      const tn = c && c.costo != null ? num(c.costo) : null;
      const precio = c && c.precio_promo != null ? num(c.precio_promo) : null;
      return {
        variant_id: a.variant_id, articulo: a.articulo,
        plastico: r2(a.plastico), packaging: r2(a.packaging), etiquetas: r2(a.etiquetas), otros: r2(a.otros),
        costo_total: r2(total), costo_tn: tn, dif_pct: tn ? Math.round(((total - tn) / tn) * 1000) / 10 : null,
        precio, margen_pct: precio ? Math.round(((precio - total) / precio) * 1000) / 10 : null,
      };
    }).sort((x, y) => x.articulo.localeCompare(y.articulo, 'es'));
  }

  return { PARIDAD, TIPOS, costoKg, insumosDet, consumosDet, precosteo };
})();

dash.calc('costo_kg', { inputs: ['paridad'], title: 'Costo del kg de plástico', description: 'Paridad de importación del polipropileno y costo por kg usado en el precosteo.',
  fn: (paridad) => LCP.costoKg(paridad) });
dash.calc('insumos_det', { inputs: ['insumos', 'costo_kg'], title: 'Insumos con precio', description: 'Lista de insumos; el plástico toma el costo por kg vigente.',
  fn: (insumos, costo_kg) => LCP.insumosDet(insumos, costo_kg) });
dash.calc('consumos_det', { inputs: ['consumos', 'insumos_det'], title: 'Consumos valorizados', description: 'Cada consumo cargado, con el precio de su insumo y el subtotal.',
  fn: (consumos, insumos_det) => LCP.consumosDet(consumos, insumos_det) });
dash.calc('precosteo', { inputs: ['consumos_det', 'insumos_det', 'catalogo'], title: 'Costo precosteado por artículo', description: 'Suma de consumos por rubro, comparada con el costo cargado en Tiendanube y el precio de venta.',
  fn: (consumos_det, insumos_det, catalogo) => LCP.precosteo(consumos_det, insumos_det, catalogo) });

(function () {
  const $ = (id) => document.getElementById(id);
  const m2 = (v) => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: Math.abs(v) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 });
  const pc = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  const qty = (v) => Number(v).toLocaleString('es-AR', { maximumFractionDigits: 4 });
  const fmts = { money: m2, int: (v) => Math.round(v).toLocaleString('es-AR'), pct: pc };
  let artSel = '';
  async function db() { return claude.use('db'); }
  function flag(okId, errId, ok) {
    document.querySelectorAll('#' + okId).forEach((s) => { s.hidden = !ok; });
    document.querySelectorAll('#' + errId).forEach((s) => { s.hidden = ok; });
  }

  // Solapas
  const tabs = { comercial: 'tab-comercial', precosteo: 'tab-precosteo' };
  function show(name) {
    if (!tabs[name]) name = 'comercial';
    Object.entries(tabs).forEach(([k, id]) => document.querySelectorAll('#' + id).forEach((s) => { s.hidden = k !== name; }));
    document.querySelectorAll('[data-tab]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === name)); b.classList.toggle('lc-on', b.dataset.tab === name); });
    dash.setLink(name);
  }
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  show((location.hash || '').replace('#', '') === 'precosteo' ? 'precosteo' : 'comercial');
  window.addEventListener('beforeprint', () => Object.values(tabs).forEach((id) => document.querySelectorAll('#' + id).forEach((s) => { s.hidden = false; })));
  window.addEventListener('afterprint', () => show(document.querySelector('[data-tab].lc-on') ? document.querySelector('[data-tab].lc-on').dataset.tab : 'comercial'));

  // Costo del kg
  dash.draw('kg', (el) => {
    const d = dash.data('costo_kg');
    if (d.status !== 'loading') el.classList.remove('dash-skeleton');
    if (d.status !== 'ok' || !d.data || !d.data[0]) { el.textContent = '—'; return; }
    const v = d.data[0][el.dataset.field];
    el.textContent = v == null ? '—' : (el.dataset.fmt === 'text' ? String(v) : (fmts[el.dataset.fmt] || fmts.int)(v));
  });
  dash.draw('fuente', (el) => {
    const d = dash.data('paridad');
    const r = d.status === 'ok' && d.data && d.data[0];
    el.textContent = r && r.fuente ? String(r.fuente) : '—';
  });

  const fP = $('lp-paridad');
  function syncParidad() {
    if (!fP) return;
    const d = dash.data('paridad');
    const r = (d.status === 'ok' && d.data && d.data[0]) || {};
    fP.querySelectorAll('input').forEach((inp) => {
      if (document.activeElement === inp) return;
      const v = r[inp.name];
      inp.value = v == null || v === '' ? (LCP.PARIDAD[inp.name] == null ? '' : LCP.PARIDAD[inp.name]) : v;
    });
  }
  async function saveParidad(clearManual) {
    const row = {};
    fP.querySelectorAll('input').forEach((inp) => {
      if (inp.name === 'costo_kg_manual') row[inp.name] = clearManual || inp.value === '' ? null : Number(inp.value);
      else { const v = Number(inp.value); row[inp.name] = inp.value !== '' && Number.isFinite(v) ? v : LCP.PARIDAD[inp.name]; }
    });
    let ok = true;
    try {
      const d = dash.data('paridad'); const prev = (d.status === 'ok' && d.data && d.data[0]) || {};
      if (prev.fuente) row.fuente = prev.fuente;
      await (await db()).doc('data/paridad').set(row);
    } catch (e) { ok = false; }
    flag('lp-p-ok', 'lp-p-err', ok);
  }
  if ($('lp-p-guardar')) $('lp-p-guardar').addEventListener('click', () => saveParidad(false));
  if ($('lp-p-sugerido')) $('lp-p-sugerido').addEventListener('click', () => saveParidad(true));

  // Selects que dependen de datos
  dash.draw('lp-art', (sel) => {
    const d = dash.data('catalogo');
    const rows = d.status === 'ok' ? d.data.filter((c) => c.publicado !== false).slice().sort((a, b) => a.articulo.localeCompare(b.articulo, 'es')) : [];
    sel.replaceChildren(new Option(rows.length ? 'Elegí un artículo' : 'Cargando artículos…', ''), ...rows.map((c) => new Option(c.articulo, c.variant_id)));
    sel.value = rows.some((c) => c.variant_id === artSel) ? artSel : '';
    sel.onchange = () => { artSel = sel.value; dash.draw('consumos_det'); };
  });
  dash.draw('lp-ins', (sel) => {
    const d = dash.data('insumos_det');
    const rows = d.status === 'ok' ? d.data : [];
    const prev = sel.value;
    sel.replaceChildren(new Option(rows.length ? 'Elegí un insumo' : 'Primero cargá insumos', ''), ...rows.map((i) => new Option(i.nombre + ' (' + i.unidad + ')', i.id)));
    if (rows.some((i) => i.id === prev)) sel.value = prev;
  });
  dash.draw('lp-ins-edit', (sel) => {
    const d = dash.data('insumos_det');
    const rows = d.status === 'ok' ? d.data : [];
    const prev = sel.value;
    sel.replaceChildren(new Option('+ Nuevo insumo', ''), ...rows.map((i) => new Option(i.nombre, i.id)));
    if (rows.some((i) => i.id === prev)) sel.value = prev;
    sel.onchange = () => {
      const i = rows.find((x) => x.id === sel.value);
      const raw = (dash.data('insumos').data || []).find((x) => x.id === sel.value) || {};
      const f = $('lp-ins-form'); if (!f) return;
      f.elements.nombre.value = i ? i.nombre : '';
      f.elements.tipo.value = i ? i.tipo : 'packaging';
      f.elements.unidad.value = i ? i.unidad : 'u.';
      f.elements.costo_unit.value = i && i.tipo !== 'plastico' ? (raw.costo_unit ?? '') : '';
      f.elements.costo_unit.disabled = !!(i && i.tipo === 'plastico');
    };
  });
  const fI = $('lp-ins-form');
  if (fI) fI.elements.tipo.addEventListener('change', () => { fI.elements.costo_unit.disabled = fI.elements.tipo.value === 'plastico'; if (fI.elements.tipo.value === 'plastico') fI.elements.unidad.value = 'kg'; });

  // Tablas
  const cell = (tr, t, cls) => { const td = tr.insertCell(); td.textContent = t; if (cls) td.className = cls; return td; };

  dash.draw('precosteo', (el) => {
    const d = dash.data('precosteo');
    if (d.status === 'error') { el.replaceChildren(); const td = el.insertRow().insertCell(); td.colSpan = 10; td.textContent = 'No se pudo calcular el precosteo.'; return; }
    if (d.status !== 'ok') return;
    el.replaceChildren();
    if (!d.data.length) { const td = el.insertRow().insertCell(); td.colSpan = 10; td.className = 'lc-muted'; td.textContent = 'Todavía no hay consumos cargados. Empezá por la lista de insumos y después cargá los consumos de cada artículo.'; return; }
    for (const r of d.data) {
      const tr = el.insertRow(); tr.dataset.key = r.variant_id;
      cell(tr, r.articulo); cell(tr, m2(r.plastico), 'n'); cell(tr, m2(r.packaging), 'n'); cell(tr, m2(r.etiquetas), 'n'); cell(tr, m2(r.otros), 'n');
      cell(tr, m2(r.costo_total), 'n'); cell(tr, m2(r.costo_tn), 'n');
      cell(tr, r.dif_pct == null ? '—' : (r.dif_pct > 0 ? '+' : '') + pc(r.dif_pct), 'n' + (r.dif_pct > 5 ? ' lc-neg' : ''));
      cell(tr, m2(r.precio), 'n'); cell(tr, pc(r.margen_pct), 'n' + (r.margen_pct != null && r.margen_pct < 45 ? ' lc-neg' : ''));
    }
  });

  dash.draw('consumos_det', (el) => {
    const d = dash.data('consumos_det');
    if (d.status === 'error') { el.replaceChildren(); const td = el.insertRow().insertCell(); td.colSpan = 7; td.textContent = 'No se pudieron cargar los consumos.'; return; }
    if (d.status !== 'ok') return;
    el.replaceChildren();
    const rows = d.data.filter((r) => r.variant_id === artSel);
    if (!artSel || !rows.length) { const td = el.insertRow().insertCell(); td.colSpan = 7; td.className = 'lc-muted'; td.textContent = artSel ? 'Este artículo todavía no tiene consumos.' : 'Elegí un artículo para ver y cargar sus consumos.'; return; }
    let tot = 0;
    for (const r of rows) {
      tot += r.subtotal;
      const tr = el.insertRow(); tr.dataset.key = r.id;
      cell(tr, r.insumo); cell(tr, r.tipo); cell(tr, qty(r.cantidad) + ' ' + r.unidad, 'n'); cell(tr, m2(r.costo_unit), 'n'); cell(tr, m2(r.subtotal), 'n');
      const td = tr.insertCell(); const b = document.createElement('button'); b.type = 'button'; b.className = 'lc-btn'; b.textContent = 'Quitar';
      b.onclick = async () => { let ok = true; try { await (await db()).doc('data/precosteo/consumos/' + r.id).delete(); } catch (e) { ok = false; } flag('lp-c-ok', 'lp-c-err', ok); };
      td.appendChild(b);
    }
    const tr = el.insertRow(); tr.className = 'lc-strong';
    cell(tr, 'Costo total por unidad de venta'); cell(tr, ''); cell(tr, ''); cell(tr, ''); cell(tr, m2(Math.round(tot * 100) / 100), 'n'); cell(tr, '');
  });

  dash.draw('insumos_det', (el) => {
    const d = dash.data('insumos_det');
    if (d.status === 'error') { el.replaceChildren(); const td = el.insertRow().insertCell(); td.colSpan = 4; td.textContent = 'No se pudieron cargar los insumos.'; return; }
    if (d.status !== 'ok') return;
    el.replaceChildren();
    if (!d.data.length) { const td = el.insertRow().insertCell(); td.colSpan = 4; td.className = 'lc-muted'; td.textContent = 'Sin insumos todavía.'; return; }
    for (const r of d.data) {
      const tr = el.insertRow(); tr.dataset.key = r.id;
      cell(tr, r.nombre); cell(tr, r.tipo_label); cell(tr, r.unidad); cell(tr, m2(r.costo_unit) + (r.tipo === 'plastico' ? ' (costo del kg)' : ''), 'n');
    }
  });

  // Cargar consumo
  if ($('lp-c-agregar')) $('lp-c-agregar').addEventListener('click', async () => {
    const art = document.querySelector('[data-draw="lp-art"]'), ins = document.querySelector('[data-draw="lp-ins"]'), cant = $('lp-c-cant');
    const q = Number(cant && cant.value);
    if (!art || !art.value || !ins || !ins.value || !(q > 0)) { document.querySelectorAll('#lp-c-falta').forEach((s) => { s.hidden = false; }); return; }
    document.querySelectorAll('#lp-c-falta').forEach((s) => { s.hidden = true; });
    const c = (dash.data('catalogo').data || []).find((x) => x.variant_id === art.value);
    let ok = true;
    try { await (await db()).collection('data/precosteo/consumos').add({ variant_id: art.value, articulo: c ? c.articulo : '', insumo_id: ins.value, cantidad: q }); } catch (e) { ok = false; }
    if (ok && cant) cant.value = '';
    flag('lp-c-ok', 'lp-c-err', ok);
  });

  // Guardar / borrar insumo
  if ($('lp-i-guardar')) $('lp-i-guardar').addEventListener('click', async () => {
    const sel = document.querySelector('[data-draw="lp-ins-edit"]');
    const f = fI; if (!f || !f.elements.nombre.value.trim()) return;
    const tipo = f.elements.tipo.value;
    const row = { nombre: f.elements.nombre.value.trim(), tipo, unidad: tipo === 'plastico' ? 'kg' : (f.elements.unidad.value.trim() || 'u.'), costo_unit: tipo === 'plastico' ? null : Number(f.elements.costo_unit.value) || 0 };
    let ok = true;
    try {
      const h = await db();
      if (sel && sel.value) await h.doc('data/precosteo/insumos/' + sel.value).set(row);
      else await h.collection('data/precosteo/insumos').add(row);
    } catch (e) { ok = false; }
    flag('lp-i-ok', 'lp-i-err', ok);
  });
  if ($('lp-i-borrar')) $('lp-i-borrar').addEventListener('click', async () => {
    const sel = document.querySelector('[data-draw="lp-ins-edit"]');
    if (!sel || !sel.value) return;
    const usado = (dash.data('consumos').data || []).some((c) => c.insumo_id === sel.value);
    if (usado) { document.querySelectorAll('#lp-i-usado').forEach((s) => { s.hidden = false; }); return; }
    document.querySelectorAll('#lp-i-usado').forEach((s) => { s.hidden = true; });
    let ok = true;
    try { await (await db()).doc('data/precosteo/insumos/' + sel.value).delete(); } catch (e) { ok = false; }
    flag('lp-i-ok', 'lp-i-err', ok);
  });

  dash.onData(() => { syncParidad(); });
})();

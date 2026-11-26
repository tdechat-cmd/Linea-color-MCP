/* Linea Color · gráficos */
(function () {
  const money = (v) => (v < 0 ? '−' : '') + '$ ' + Math.abs(Math.round(v)).toLocaleString('es-AR');
  const short = (v) => {
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3).toLocaleString('es-AR') + 'k';
    return s + '$' + Math.round(a).toLocaleString('es-AR');
  };
  const pct = (v) => (Math.round(v * 10) / 10).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' %';
  const C = () => dash.colors;

  function state(el, d, msg) {
    if (d.status === 'error') { el.classList.remove('dash-skeleton'); el.textContent = msg; return false; }
    if (d.status !== 'ok') return false;
    el.classList.remove('dash-skeleton');
    return true;
  }
  function tipFor(el) {
    const tip = document.createElement('div'); tip.className = 'lc-tip'; tip.style.display = 'none'; el.appendChild(tip);
    return {
      show(ev, lines) {
        tip.replaceChildren(...lines.map((t, i) => { const d = document.createElement('div'); d.textContent = t; if (i === 0) d.style.fontWeight = '600'; return d; }));
        tip.style.display = '';
        const r = el.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
        tip.style.left = Math.max(0, Math.min(x + 12, el.clientWidth - tip.offsetWidth - 4)) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
      },
      hide() { tip.style.display = 'none'; },
    };
  }

  // Barras horizontales (simples o apiladas)
  function hbars(el, rows, opt) {
    el.replaceChildren();
    if (!rows.length) { el.textContent = opt.empty || 'Sin datos para el período.'; return; }
    const W = Math.max(260, el.clientWidth || 600), rowH = 30, m = { t: 4, r: 8, b: 4 };
    const H = m.t + m.b + rows.length * rowH;
    const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', opt.aria);
    // ancho de etiquetas
    const meas = svg.append('g');
    let lw = 0; rows.forEach((r) => { const t = meas.append('text').text(opt.label(r)); lw = Math.max(lw, t.node().getComputedTextLength()); });
    meas.remove();
    const labW = Math.min(Math.ceil(lw) + 10, Math.round(W * 0.42));
    let vw = 0; rows.forEach((r) => { const t = svg.append('text').attr('class', 'tmp').text(opt.value(r)); vw = Math.max(vw, t.node().getComputedTextLength()); t.remove(); });
    const valW = Math.ceil(vw) + 10;
    const total = (r) => opt.segments.reduce((s, sg) => s + Math.max(0, r[sg.key] || 0), 0);
    const max = d3.max(rows, total) || 1;
    const x = d3.scaleLinear().domain([0, max]).range([0, Math.max(40, W - labW - valW - m.r)]);
    const tip = tipFor(el);
    rows.forEach((r, i) => {
      const y = m.t + i * rowH;
      const g = svg.append('g').attr('transform', `translate(0,${y})`);
      const name = opt.label(r);
      const txt = g.append('text').attr('x', labW - 8).attr('y', rowH / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(name);
      while (txt.node().getComputedTextLength() > labW - 10 && txt.text().length > 4) txt.text(txt.text().slice(0, -2) + '…');
      let x0 = labW;
      opt.segments.forEach((sg, j) => {
        const v = Math.max(0, r[sg.key] || 0); const w = x(v);
        g.append('rect').attr('x', x0).attr('y', 6).attr('width', w).attr('height', rowH - 12).attr('rx', 2).style('fill', sg.color || C()[j]);
        x0 += w;
      });
      g.append('text').attr('x', x0 + 6).attr('y', rowH / 2).attr('dy', '0.35em').attr('class', 'lc-vlab').text(opt.value(r));
      g.append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', rowH).attr('fill', 'transparent')
        .on('pointerenter pointermove', (ev) => tip.show(ev, [name, ...opt.tip(r)]))
        .on('pointerleave', () => tip.hide());
    });
  }

  // De cada $100 vendidos
  dash.draw('g-cascada', (el) => {
    const d = dash.data('kpis');
    if (!state(el, d, 'No se pudo calcular.')) return;
    const k = d.data && d.data[0];
    el.replaceChildren();
    if (!k || !k.venta) { el.textContent = 'Sin ventas en el período.'; return; }
    const segs = [
      { n: 'Mercadería', v: k.cmv, c: C()[0] },
      { n: 'Envío', v: k.envio_neto, c: C()[1] },
      { n: 'Pauta', v: k.pauta, c: C()[2] },
      { n: 'Comisiones', v: k.comisiones, c: C()[3] },
      { n: k.contribucion >= 0 ? 'Te queda' : 'Pérdida', v: Math.abs(k.contribucion), c: k.contribucion >= 0 ? 'var(--color-ok)' : 'var(--color-bad)' },
    ].filter((s) => s.v > 0);
    const tot = segs.reduce((s, x) => s + x.v, 0);
    const W = Math.max(260, el.clientWidth || 600), H = 44;
    const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('role', 'img')
      .attr('aria-label', 'Reparto de cada 100 pesos vendidos entre mercadería, envío, pauta, comisiones y contribución');
    const tip = tipFor(el);
    let x0 = 0;
    segs.forEach((s) => {
      const w = (s.v / tot) * W;
      svg.append('rect').attr('x', x0).attr('y', 0).attr('width', Math.max(0, w - 2)).attr('height', H).attr('rx', 3).style('fill', s.c)
        .on('pointerenter pointermove', (ev) => tip.show(ev, [s.n, money(s.v), pct((s.v / k.venta) * 100) + ' de la venta']))
        .on('pointerleave', () => tip.hide());
      const share = Math.round((s.v / k.venta) * 100);
      if (w > 44) svg.append('text').attr('x', x0 + w / 2).attr('y', H / 2).attr('dy', '0.35em').attr('text-anchor', 'middle').attr('class', 'lc-inlab').text('$' + share);
      x0 += w;
    });
    const leg = document.createElement('div'); leg.className = 'lc-legend lc-legend-wrap';
    segs.forEach((s) => {
      const it = document.createElement('span');
      const sw = document.createElement('span'); sw.className = 'lc-sw'; sw.style.background = s.c;
      it.append(sw, document.createTextNode(s.n + ' $' + Math.round((s.v / k.venta) * 100)));
      leg.appendChild(it);
    });
    el.appendChild(leg);
  });

  // Top artículos por margen
  dash.draw('g-top', (el) => {
    const d = dash.data('ranking');
    if (!state(el, d, 'No se pudo cargar el ranking.')) return;
    const rows = d.data.slice(0, 10);
    hbars(el, rows, {
      aria: 'Los 10 artículos que más margen bruto dejaron en el período',
      label: (r) => r.articulo, value: (r) => short(r.margen) + ' · ' + pct(r.margen_pct),
      segments: [{ key: 'margen', color: C()[0] }],
      tip: (r) => ['Venta ' + money(r.venta), 'Margen ' + money(r.margen) + ' (' + pct(r.margen_pct) + ')', 'Contribución ' + money(r.contrib), r.unidades + ' unidades'],
    });
  });

  // Envío a cargo por modalidad
  dash.draw('g-envios', (el) => {
    const d = dash.data('envios');
    if (!state(el, d, 'No se pudo cargar.')) return;
    const rows = d.data.filter((r) => r.costo > 0 || r.cobrado > 0);
    hbars(el, rows, {
      aria: 'Costo de envío neto a cargo de la tienda por modalidad',
      label: (r) => r.modalidad, value: (r) => short(r.neto) + ' · ' + pct(r.neto_pct) + ' de su venta',
      segments: [{ key: 'neto', color: C()[1] }],
      tip: (r) => [r.pedidos + ' pedidos', 'Costo estimado ' + money(r.costo), 'Cobrado ' + money(r.cobrado), 'Neto ' + money(r.neto)],
      empty: 'Sin envíos en el período.',
    });
  });

  // Precosteo por rubro
  dash.draw('g-precosteo', (el) => {
    const d = dash.data('precosteo');
    if (!state(el, d, 'No se pudo calcular.')) return;
    const rows = d.data.slice().sort((a, b) => b.costo_total - a.costo_total).slice(0, 15);
    hbars(el, rows, {
      aria: 'Costo precosteado de cada artículo separado por rubro',
      label: (r) => r.articulo, value: (r) => money(r.costo_total),
      segments: [{ key: 'plastico', color: C()[0] }, { key: 'packaging', color: C()[1] }, { key: 'etiquetas', color: C()[2] }, { key: 'otros', color: C()[3] }],
      tip: (r) => ['Plástico ' + money(r.plastico), 'Packaging ' + money(r.packaging), 'Etiquetas ' + money(r.etiquetas), 'Otros ' + money(r.otros)],
      empty: 'Cuando cargues consumos, acá vas a ver de qué está hecho el costo de cada artículo.',
    });
  });

  document.querySelectorAll('[data-csw]').forEach((s) => { s.style.background = dash.colors[Number(s.dataset.csw)]; });
})();

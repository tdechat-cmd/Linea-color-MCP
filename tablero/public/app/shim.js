/* Capa de datos del tablero: lee la API de la app y redibuja la página. */
(function () {
  const todayAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const hoy = todayAR();
  const DEFAULT_PARAMS = { desde: hoy.slice(0, 8) + '01', hasta: hoy };
  const st = { params: { ...DEFAULT_PARAMS }, sources: {}, calcs: {}, calcCache: {}, draws: {}, onData: [], scheduled: false };

  const SRC = {
    ventas: () => '/api/ventas?desde=' + encodeURIComponent(st.params.desde) + '&hasta=' + encodeURIComponent(st.params.hasta),
    catalogo: () => '/api/catalogo',
    supuestos: () => '/api/supuestos',
    paridad: () => '/api/paridad',
    insumos: () => '/api/insumos',
    consumos: () => '/api/consumos',
  };

  async function getJson(url, opts) {
    const r = await fetch(url, { credentials: 'same-origin', ...(opts || {}) });
    if (r.status === 401) { location.href = '/login'; throw new Error('Sesión vencida'); }
    let j = null; try { j = await r.json(); } catch (e) { /* vacío */ }
    if (!r.ok) throw new Error((j && j.error) || r.statusText);
    return j;
  }

  function load(id) {
    if (!SRC[id]) return { status: 'missing', data: [] };
    const s = st.sources[id] || (st.sources[id] = { status: 'loading', data: [], key: null, pending: null });
    const url = SRC[id]();
    if (s.key === url || s.pending === url) return s;
    s.pending = url;
    if (s.status === 'ok') s.refreshing = true; else s.status = 'loading';
    getJson(url).then((j) => {
      if (s.pending !== url) return;
      Object.assign(s, { status: 'ok', data: (j && j.rows) || [], truncated: !!(j && j.truncated), key: url, pending: null, refreshing: false, message: null });
      invalidate();
    }).catch((e) => {
      if (s.pending !== url) return;
      Object.assign(s, { status: 'error', message: e.message, key: url, pending: null, refreshing: false });
      invalidate();
    });
    return s;
  }

  function data(id) {
    if (st.calcs[id]) return calc(id);
    const s = load(id);
    return { status: s.status, data: s.status === 'ok' || s.refreshing ? s.data : [], message: s.message, refreshing: !!s.refreshing, truncated: !!s.truncated };
  }

  function calc(id) {
    if (st.calcCache[id]) return st.calcCache[id];
    const c = st.calcs[id];
    const ins = c.inputs.map((i) => data(i));
    let out;
    if (ins.some((d) => d.status === 'error')) out = { status: 'error', data: null, message: (ins.find((d) => d.status === 'error') || {}).message };
    else if (ins.some((d) => d.status !== 'ok')) out = { status: 'loading', data: null };
    else {
      try { out = { status: 'ok', data: c.fn(...ins.map((d) => d.data)), refreshing: ins.some((d) => d.refreshing) }; }
      catch (e) { console.error('calc', id, e); out = { status: 'error', data: null, message: e.message }; }
    }
    st.calcCache[id] = out;
    return out;
  }

  function visible(el) { return !el.closest('[hidden]'); }

  function render() {
    st.scheduled = false;
    st.calcCache = {};
    for (const fn of st.onData) { try { fn(); } catch (e) { console.error(e); } }
    for (const [name, fn] of Object.entries(st.draws)) runDraw(name, fn);
  }
  function runDraw(name, fn) {
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
      if (!visible(el)) return;
      try {
        if (typeof fn === 'function') fn(el);
        else {
          if (!el.__made) { el.replaceChildren(); el.__made = { v: fn.mount ? fn.mount(el) : undefined }; }
          if (fn.update) fn.update(el, el.__made.v);
        }
      } catch (e) { console.error('draw', name, e); }
    });
  }
  function invalidate() {
    st.calcCache = {};
    if (st.scheduled) return;
    st.scheduled = true;
    requestAnimationFrame(render);
  }

  let lastW = 0;
  window.addEventListener('resize', () => { const w = window.innerWidth; if (w !== lastW) { lastW = w; invalidate(); } });
  document.addEventListener('toggle', invalidate, true);

  window.dash = {
    data,
    calc(id, def) { st.calcs[id] = def; invalidate(); },
    loader() { /* el servidor ya devuelve filas */ },
    draw(name, fn) { if (fn) { st.draws[name] = fn; invalidate(); } else if (st.draws[name]) { st.calcCache = {}; runDraw(name, st.draws[name]); } },
    onData(fn) { st.onData.push(fn); invalidate(); },
    params() { return { ...st.params }; },
    setParams(p) { for (const [k, v] of Object.entries(p || {})) { if (v === null || v === undefined) delete st.params[k]; else st.params[k] = v; } invalidate(); },
    resetParams() { st.params = { ...DEFAULT_PARAMS }; invalidate(); },
    refresh(id) { const s = st.sources[id]; if (s) s.key = null; invalidate(); },
    setLink(name) { try { history.replaceState(null, '', name && name !== 'comercial' ? '#' + name : location.pathname); } catch (e) { /* nada */ } invalidate(); },
    colors: ['var(--lc-c1)', 'var(--lc-c2)', 'var(--lc-c3)', 'var(--lc-c4)', 'var(--lc-c5)', 'var(--lc-c6)'],
  };

  // Escrituras: traducen las rutas del tablero a la API
  function api(method, url, body) {
    return getJson(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  }
  const DOCS = [
    [/^data\/supuestos$/, { set: (row) => api('PUT', '/api/supuestos', row), src: 'supuestos' }],
    [/^data\/paridad$/, { set: (row) => api('PUT', '/api/paridad', row), src: 'paridad' }],
    [/^data\/precosteo\/insumos\/([A-Za-z0-9_-]+)$/, { set: (row, m) => api('PUT', '/api/insumos/' + m[1], row), del: (m) => api('DELETE', '/api/insumos/' + m[1]), src: 'insumos' }],
    [/^data\/precosteo\/consumos\/([A-Za-z0-9_-]+)$/, { set: (row, m) => api('PUT', '/api/consumos/' + m[1], row), del: (m) => api('DELETE', '/api/consumos/' + m[1]), src: 'consumos' }],
  ];
  const COLS = { 'data/precosteo/insumos': ['/api/insumos', 'insumos'], 'data/precosteo/consumos': ['/api/consumos', 'consumos'] };
  function route(path) {
    for (const [re, h] of DOCS) { const m = path.match(re); if (m) return [h, m]; }
    throw new Error('Ruta no soportada: ' + path);
  }
  const db = {
    doc(path) {
      return {
        async set(row) { const [h, m] = route(path); await h.set(row, m); dash.refresh(h.src); },
        async delete() { const [h, m] = route(path); if (!h.del) throw new Error('No se puede borrar'); await h.del(m); dash.refresh(h.src); },
      };
    },
    collection(path) {
      return {
        async add(row) { const c = COLS[path]; if (!c) throw new Error('Ruta no soportada: ' + path); const r = await api('POST', c[0], row); dash.refresh(c[1]); return r; },
      };
    },
  };
  window.claude = { use: async (name) => (name === 'db' ? db : null) };

  // Usuario actual
  getJson('/api/me').then((me) => {
    document.querySelectorAll('[data-me="nombre"]').forEach((el) => { el.textContent = me.nombre || me.email; });
    document.querySelectorAll('[data-me="rol"]').forEach((el) => { el.textContent = me.rol; });
    document.body.classList.add('rol-' + me.rol);
    document.querySelectorAll('[data-solo-admin]').forEach((el) => { el.hidden = me.rol !== 'admin'; });
  }).catch(() => {});
})();

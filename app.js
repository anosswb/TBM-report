/* Production report form. State shape = what ReportFill.fillReport expects:
   { f: {flat key -> string}, times: {row: [[from,to],...]}, geo: [option index], lines: [{n,text}] } */
(function () {
  'use strict';
  var RF = window.ReportFill;
  var STORE = null, PILOT = null, started = false;   // set by start() after login
  var DEFAULTS = {
    obra: '2079MA20_CASABLANCA SWI2 DESALINATION PLANT_DISCHARGE PIPELINE',
    maquina: 'M-1469M', contenedor: 'M-2998C', tramo: 'Discharge pipeline - 1833 m',
    jefe: 'Angelo Giovanni Ferrante Giardina', turno: 'NIGHT'
  };

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lab(es, en) { return esc(es) + (en ? '<small>' + esc(en) + '</small>' : ''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(min) { min = ((min % 1440) + 1440) % 1440; return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  /* ---------- description history: the work lines carry over to the next report ---------- */
  var DESC_KEY = 'tbm-desc-last-v1';     // last description written on this device, by any pilot
  var linesDirty = false;
  function cleanLines(lines) {
    var out = (lines || []).filter(function (l) { return l && String(l.text || '').trim() !== ''; })
      .map(function (l) { var o = { n: l.n || '', text: l.text || '' }; if (l.color) o.color = l.color; return o; });
    return out.length ? out : [{ n: '', text: '' }];
  }
  function lastDescription() {
    try {
      var d = JSON.parse(localStorage.getItem(DESC_KEY) || 'null');
      if (d && Array.isArray(d.lines)) return d;
    } catch (e) { /* none */ }
    return null;
  }
  function saveDescription() {
    linesDirty = false;
    try { localStorage.setItem(DESC_KEY, JSON.stringify({ lines: cleanLines(state.lines), at: Date.now(), by: PILOT ? PILOT.id : '' })); } catch (e) { /* storage full */ }
  }

  /* ---------- state ---------- */
  var state, hourSel = 0;
  function freshState(carryLines) {
    var f = {}; for (var k in DEFAULTS) f[k] = DEFAULTS[k];
    f.fecha = todayISO();
    if (PILOT) f.piloto = PILOT.name;
    var last = lastDescription();
    var lines = last ? cleanLines(last.lines) : cleanLines(carryLines);
    return { f: f, times: {}, geo: [], lines: lines, chain: [], cy: {} };
  }
  function load() {
    state = freshState();
    var savedAt = null;
    try {
      var d = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (d && d.state && d.state.f) {
        state.f = Object.assign(state.f, d.state.f);
        state.times = d.state.times || {};
        state.chain = Array.isArray(d.state.chain) ? d.state.chain : [];
        state.cy = d.state.cy || {};
        state.geo = d.state.geo || [];
        state.lines = (d.state.lines && d.state.lines.length) ? d.state.lines : state.lines;
        hourSel = d.hour || 0;
        savedAt = d.savedAt || null;
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    // first run with this feature: the current draft's description becomes the history
    if (!lastDescription() && state.lines.some(function (l) { return String(l.text || '').trim() !== ''; })) saveDescription();
    if (PILOT) state.f.piloto = PILOT.name;
    return savedAt;
  }
  var saveTimer, savePending = false;
  function writeNow() {
    clearTimeout(saveTimer);
    if (!STORE || !state) return;
    savePending = false;
    var at = Date.now();
    try {
      localStorage.setItem(STORE, JSON.stringify({ state: state, hour: hourSel, savedAt: at }));
      if (linesDirty) saveDescription();
      savedMark(at, false);
    } catch (e) { savedMark(at, true); }
  }
  function persist() {
    savePending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 150);
    clearTimeout(progTimer);
    progTimer = setTimeout(updateProgress, 300);
  }
  window.addEventListener('pagehide', function () { if (savePending) writeNow(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && savePending) writeNow(); });
  function savedMark(at, failed) {
    var s = $('#saved'); if (!s) return;
    if (failed) { s.className = 'saved err'; s.innerHTML = 'No se pudo guardar<small>Could not save</small>'; return; }
    if (!at) { s.className = 'saved'; s.innerHTML = ''; return; }
    var d = new Date(at);
    s.className = 'saved';
    s.innerHTML = '✓ Guardado ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '<small>Saved on this device</small>';
  }
  function status(msg, err) {
    var s = $('#status'); s.textContent = msg || ''; s.className = 'status' + (err ? ' err' : '');
    if (msg && !err) setTimeout(function () { if (s.textContent === msg) s.textContent = ''; }, 4000);
  }
  function shiftStart() { return state.f.turno === 'DAY' ? 7 : 19; }

  /* section progress shown in the navigation */
  var progTimer;
  function anyKey(re) { for (var k in state.f) if (re.test(k) && String(state.f[k] || '').trim() !== '') return true; return false; }
  function sectionDone(i) {
    switch (i) {
      case 0: return anyKey(/^(colocados|avance|tuboInicio|inicio|tuboFin|fin)$/);
      case 1: if (state.chain.length) return true; for (var r in state.times) if ((state.times[r] || []).length) return true; return false;
      case 2: return anyKey(/^h(\d+|29v|29d)_\d+$/);
      case 3: return state.geo.length > 0;
      case 4: return anyKey(/^c_/);
      case 5: return anyKey(/^(locAverias1|locAverias2|averias)$/);
      case 6: return anyKey(/^(trabajos1|trabajos2|obs1|obs2)$/);
      case 7: return anyKey(/^p_\d+$/);
      case 8: return anyKey(/^(k_|pt_|pr_|pd_)/) || state.lines.some(function (l) { return String(l.text || '').trim() !== ''; });
    }
    return false;
  }
  function updateProgress() {
    if (!state) return;
    var links = document.querySelectorAll('#nav a'), n = 0;
    Array.prototype.forEach.call(links, function (a, i) { var d = sectionDone(i); a.classList.toggle('done', d); if (d) n++; });
    var p = $('#progress');
    if (p) p.innerHTML = '<b>' + n + ' / ' + links.length + '</b> secciones con datos<small>sections with data</small>';
  }

  /* ---------- field definitions ---------- */
  var GENERAL = [
    ['obra', 'Obra', 'Project', 'text', 'span2'],
    ['maquina', 'Máquina', 'Machine', 'text'],
    ['contenedor', 'Contenedor', 'Container', 'text'],
    ['tramo', 'Tramo', 'Section', 'text', 'span2'],
    ['colocados', '# Tubos / # Anillos colocados', 'Pipes / rings installed', 'text'],
    ['avance', 'Avance (m)', 'Advance (m)', 'num'],
    ['piloto', 'Piloto', 'Pilot', 'ro'],
    ['turno', 'Turno (Día / Noche)', 'Shift (Day / Night)', 'shift'],
    ['fecha', 'Fecha', 'Date', 'date'],
    ['tuboInicio', '# Tubo / # Anillo inicio turno', 'Pipe / ring at shift start', 'text'],
    ['inicio', 'Inicio (m)', 'Start (m)', 'num'],
    ['tuboFin', '# Tubo / # Anillo fin turno', 'Pipe / ring at shift end', 'text'],
    ['fin', 'Fin (m)', 'End (m)', 'num']
  ];
  var TIMES = [
    [9, 'Avance máquina', 'Machine advance'], [10, 'Montaje tubo-anillo', 'Pipe–ring installation'],
    [12, 'Averías', 'Breakdowns'], [13, 'Recirculación - cambio lodo', 'Recirculation – slurry change'],
    [14, 'Espera tren - mortero', 'Waiting for train – grout'], [15, 'Espera cliente', 'Waiting for client'],
    [16, 'Montaje', 'Assembly'], [17, 'Desmontaje', 'Disassembly'], [18, 'Comida', 'Meal'],
    [19, 'Descanso', 'Break'], [20, 'Otros', 'Other']
  ];
  // [row, es, en, kind]  kind: t text, n number, neg number that may be negative, p percent, s Si/No
  var HOURLY = [
    [22, 'Pre. bastidor-cilindros (bar)', 'Frame–cylinder pressure (bar)', 't'],
    [23, 'Estación en uso (#)', 'Station in use (#)', 't'],
    [24, 'Presiones estación (bar) [#]', 'Station pressures (bar) [#]', 't'],
    [25, 'Velocidad avance (mm/min)', 'Advance speed (mm/min)', 't'],
    [26, 'Velocidad RdC (rpm)', 'Cutterhead speed (rpm)', 't'],
    [27, 'Presión corte (bar)', 'Cutting pressure (bar)', 't'],
    [28, 'Fuerza empuje principal (kN)', 'Main thrust force (kN)', 't'],
    ['29v', 'Agua de perforación: viscosidad (s)', 'Drilling water: viscosity (s)', 't'],
    ['29d', 'Agua de perforación: densidad (g/l)', 'Drilling water: density (g/l)', 't'],
    [31, 'Alineación vertical (mm)', 'Alignment – vertical (mm)', 'neg'],
    [32, 'Alineación horizontal (mm)', 'Alignment – horizontal (mm)', 'neg'],
    [33, 'Pitch (mm)', 'Pitch (mm)', 'neg'],
    [34, 'Yaw (mm)', 'Yaw (mm)', 'neg'],
    [35, 'Roll (º)', 'Roll (º)', 'neg'],
    [37, 'Cilindro de mando 1 (mm)', 'Drive cylinder 1 (mm)', 'n'],
    [38, 'Cilindro de mando 2 (mm)', 'Drive cylinder 2 (mm)', 'n'],
    [39, 'Cilindro de mando 3 (mm)', 'Drive cylinder 3 (mm)', 'n'],
    [40, 'Cilindro de mando 4 (mm)', 'Drive cylinder 4 (mm)', 'n'],
    [41, 'Presión tierras-frente (bar)', 'Face earth pressure (bar)', 'n'],
    [42, 'Nivel frente (%)', 'Face level (%)', 'n'],
    [43, 'Q Alimentación (m³/h)', 'Feed flow (m³/h)', 'n'],
    [44, 'Q Extracción (m³/h)', 'Extraction flow (m³/h)', 'n'],
    [45, 'Inyec. bentonita frente (Sí/No)', 'Bentonite injection at face (Yes/No)', 's'],
    [46, 'P inyec. bentonita (bar)', 'Bentonite injection pressure (bar)', 'n'],
    [47, 'Inyección mortero (m³)', 'Grout injection (m³)', 'n']
  ];
  var GEO = [
    ['A: Arcillas', 'Clays'], ['S: Arenas', 'Sands'], ['G: Gravas', 'Gravels'], ['L: Limos', 'Silts'],
    ['R: Roca', 'Rock'], ['O: Orgánico', 'Organic'], ['H: Hormigón', 'Concrete'],
    ['Arcilla / Arena', 'Clay / Sand'], ['Arcilla / Grava', 'Clay / Gravel'], ['Arcilla / Roca', 'Clay / Rock'],
    ['Arenas / Grava', 'Sands / Gravel'], ['Arenas / Roca', 'Sands / Rock']
  ];
  var CONS1 = [
    ['O49', 'Gasoil (L)', 'Diesel (L)'], ['AM49', 'Bentonita (kg)', 'Bentonite (kg)'],
    ['BK49', 'Aceite hidráulico (L)', 'Hydraulic oil (L)'], ['CI49', 'Picas (uds)', 'Picks (units)'],
    ['DG49', 'Grasa cola (bidón)', 'Tail grease (drum)'], ['EE49', 'Grasa negra (bidón)', 'Black grease (drum)'],
    ['O50', 'Agua (m³)', 'Water (m³)'], ['AM50', 'Polímero (kg-L)', 'Polymer (kg-L)'],
    ['BK50', 'Discos (uds)', 'Disc cutters (units)'], ['CI50', 'Rastreles (uds)', 'Scrapers (units)'],
    ['DG50', 'Grasa EP2 (bidón)', 'EP2 grease (drum)'], ['EE50', 'Espumas (kg-ltrs)', 'Foams (kg-ltrs)']
  ];
  var TEXTS = {
    averias: [
      ['locAverias1', 'Localización de averías (1)', 'Breakdown location (1)'],
      ['locAverias2', 'Localización de averías (2)', 'Breakdown location (2)'],
      ['averias', 'Averías', 'Breakdowns']
    ],
    trabajos: [
      ['trabajos1', 'Trabajos realizados (1)', 'Works done (1)'],
      ['trabajos2', 'Trabajos realizados (2)', 'Works done (2)'],
      ['obs1', 'Observaciones (1)', 'Remarks (1)'],
      ['obs2', 'Observaciones (2)', 'Remarks (2)']
    ]
  };
  var ROLES = ['Piloto', 'Chef de puits', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador', 'Trabajador'];
  var ROLES_EN = ['Pilot', 'Shaft chief', 'Worker', 'Worker', 'Worker', 'Worker', 'Worker', 'Worker', 'Worker', 'Worker', 'Worker', 'Worker'];
  var K1 = [['C40', 'Agua acciona', 'Acciona water', 'm³'], ['C41', 'Agua filtrada', 'Filtered water', 'm³'], ['C42', 'Lodo filtrada', 'Filtered slurry', 'm³'],
    ['C43', 'Bentonita tunnel gel plus', 'Bentonite tunnel gel plus', 'kg'], ['C44', 'Tunnel LUBE', 'Tunnel LUBE', 'kg'], ['C45', 'Pac-L', 'Pac-L', 'kg']];
  var K2 = [['G40', 'Gasoil', 'Diesel', 'L'], ['G41', 'Bentonita lubricación', 'Lubrication bentonite', 'm³'], ['G42', 'Soda ash', 'Soda ash', 'kg'],
    ['G43', 'Hybride Gel', 'Hybride Gel', 'kg'], ['G44', 'Call', 'Call', 'kg'], ['G45', 'Cebo IPR503', 'Cebo IPR503', 'kg']];

  var SECTIONS = [
    ['sec-general', 'Datos generales', 'General data'],
    ['sec-times', 'Tiempos de producción y paradas', 'Production and stoppage times'],
    ['sec-hourly', 'Valores de producción, alineación, cilindros de mando', 'Production values (hourly)'],
    ['sec-geo', 'Geología', 'Geology'],
    ['sec-cons', 'Consumos', 'Consumption'],
    ['sec-faults', 'Averías', 'Breakdowns'],
    ['sec-works', 'Trabajos realizados y observaciones', 'Works done and remarks'],
    ['sec-crew', 'Personal', 'Crew'],
    ['sec-desc', 'Descripción de trabajos', 'Description of works (sheet 2)']
  ];
  var NAV_SHORT = ['Datos', 'Tiempos', 'Valores', 'Geología', 'Consumos', 'Averías', 'Trabajos', 'Personal', 'Descripción'];
  var STOP_ROWS = RF.STOP_ROWS || [12];   // problems and waits: painted red here and in Excel
  function isStop(row) { return STOP_ROWS.indexOf(+row) >= 0; }
  var LINE_COLORS = [['', 'Sin color', 'No colour', '#ffffff'], ['yellow', 'Amarillo', 'Yellow', '#ffff00'], ['green', 'Verde', 'Green', '#00b050'],
    ['blue', 'Azul', 'Blue', '#00b0f0'], ['orange', 'Naranja', 'Orange', '#ff9900'], ['red', 'Rojo', 'Red', '#ff0000'],
    ['purple', 'Morado', 'Purple', '#b266ff'], ['grey', 'Gris', 'Grey', '#a6a6a6']];
  function lineCss(c) { for (var i = 1; i < LINE_COLORS.length; i++) if (LINE_COLORS[i][0] === c) return LINE_COLORS[i][3]; return ''; }
  var NAV_EN = ['General', 'Times', 'Values', 'Geology', 'Consumption', 'Breakdowns', 'Works', 'Crew', 'Description'];

  /* ---------- input builders ---------- */
  function inputHtml(key, kind, extra) {
    var v = esc(state.f[key] || '');
    var a = ' data-k="' + key + '" value="' + v + '" autocomplete="off"' + (extra || '');
    if (kind === 'date') return '<input type="date"' + a + '>';
    if (kind === 'ro') return '<input type="text" readonly tabindex="-1" class="ro"' + a + '>';
    if (kind === 'shift') return '<select data-k="turno"><option value="NIGHT"' + (state.f.turno === 'NIGHT' ? ' selected' : '') + '>Noche / Night (19:00–07:00)</option><option value="DAY"' + (state.f.turno === 'DAY' ? ' selected' : '') + '>Día / Day (07:00–19:00)</option></select>';
    if (kind === 's') return '<select data-k="' + key + '"><option value=""></option><option value="Si"' + (state.f[key] === 'Si' ? ' selected' : '') + '>Sí / Yes</option><option value="No"' + (state.f[key] === 'No' ? ' selected' : '') + '>No</option></select>';
    if (kind === 'num' || kind === 'n') return '<input type="text" inputmode="decimal"' + a + '>';
    if (kind === 'neg') return '<input type="text" inputmode="text" autocapitalize="off"' + a + '>';
    return '<input type="text"' + a + '>';
  }
  function field(key, es, en, kind, cls) {
    return '<label class="fld ' + (cls || '') + '"><span class="l">' + lab(es, en) + '</span>' + inputHtml(key, kind) + '</label>';
  }

  /* ---------- render ---------- */
  function render() {
    var main = $('#main'), nav = $('#nav'), h = '';
    nav.innerHTML = SECTIONS.map(function (s, i) { return '<a href="#' + s[0] + '" data-sec="' + s[0] + '">' + esc(NAV_SHORT[i]) + '<small>' + esc(NAV_EN[i]) + '</small></a>'; }).join('');
    function sec(i, body) { var s = SECTIONS[i]; return '<section id="' + s[0] + '"><h2>' + lab(s[1], s[2]) + '</h2>' + body + '</section>'; }

    h += sec(0, '<div class="grid">' + GENERAL.map(function (g) { return field(g[0], g[1], g[2], g[3], g[4]); }).join('') + '</div>');
    h += sec(1, '<div class="cycle" id="cycle"></div>' +
      '<h3>' + lab('Línea de tiempo del turno', 'Shift timeline') + '</h3><div id="timeline" class="timeline"></div>' +
      '<details class="manual"><summary>' + lab('Por actividad (manual)', 'By activity (manual)') + '</summary>' +
      '<p class="count">Intervalos manuales con “Desde / Hasta”. Las barras muestran también el ciclo. / Manual intervals; bars also show the cycle.</p><div id="times"></div></details>');
    h += sec(2, '<div class="tabs" id="tabs"></div><div id="hourly"></div>');
    h += sec(3, '<p class="count">Toque para marcar una o varias opciones. / Tap to select one or more options.</p><div class="chips" id="geo"></div>');
    h += sec(4, '<div class="grid">' + CONS1.map(function (c) { return field('c_' + c[0], c[1], c[2], 'n'); }).join('') + '</div>');
    h += sec(5, '<div class="grid wide">' + TEXTS.averias.map(function (t) { return '<label class="fld"><span class="l">' + lab(t[1], t[2]) + '</span><textarea data-k="' + t[0] + '">' + esc(state.f[t[0]] || '') + '</textarea></label>'; }).join('') + '</div>');
    h += sec(6, '<div class="grid wide">' + TEXTS.trabajos.map(function (t) { return '<label class="fld"><span class="l">' + lab(t[1], t[2]) + '</span><textarea data-k="' + t[0] + '">' + esc(state.f[t[0]] || '') + '</textarea></label>'; }).join('') + '</div>');
    var crew = field('jefe', 'Jefe de obra', 'Site manager', 'text', 'span2') + '</div><h3>' + lab('Fila 1', 'Row 1') + '</h3><div class="grid">';
    for (var i = 0; i < 24; i++) {
      if (i === 12) crew += '</div><h3>' + lab('Fila 2 (trabajadores)', 'Row 2 (workers)') + '</h3><div class="grid">';
      var r = i % 12;
      crew += field('p_' + i, i < 12 ? ROLES[r] : 'Trabajador', i < 12 ? ROLES_EN[r] : 'Worker', 'text');
    }
    h += sec(7, '<div class="grid">' + crew + '</div>');
    h += sec(8, '<h3>' + lab('Líneas de trabajo', 'Work lines') + '</h3><div id="lines"></div>' +
      '<h3>' + lab('Consumos', 'Consumption') + '</h3><div class="grid">' +
      K1.concat(K2).map(function (c) { return '<label class="fld"><span class="l">' + lab(c[1], c[2]) + '</span><span class="unit"><input type="text" inputmode="decimal" data-k="k_' + c[0] + '" value="' + esc(state.f['k_' + c[0]] || '') + '" autocomplete="off"><span>' + c[3] + '</span></span></label>'; }).join('') +
      '</div><h3>' + lab('Tubos colocados', 'Installed pipes') + '</h3><div class="pipes" id="pipes"></div>');
    main.innerHTML = h;

    var p = '<span></span><span class="l">' + lab('Nº tubo', 'Pipe no.') + '</span><span class="l">' + lab('Referencia', 'Reference') + '</span><span class="l">' + lab('Fecha fabricación', 'Fabrication date') + '</span>';
    p = '<div class="pipes" style="grid-template-columns:90px 1fr 1fr 1fr">' + p;
    for (var t = 0; t < 5; t++) p += '<span class="l" style="align-self:center">T: ' + (t + 1) + '</span><input type="text" inputmode="numeric" data-k="pt_' + t + '" value="' + esc(state.f['pt_' + t] || '') + '" aria-label="Nº tubo"><input type="text" data-k="pr_' + t + '" value="' + esc(state.f['pr_' + t] || '') + '" aria-label="Referencia"><input type="date" data-k="pd_' + t + '" value="' + esc(state.f['pd_' + t] || '') + '" aria-label="Fecha fabricación">';
    $('#pipes').outerHTML = p + '</div>';

    renderCycle(); renderTimeline(); renderTimes(); renderTabs(); renderHourly(); renderGeo(); renderLines();
    updateProgress();
  }

  /* times */
  function renderTimes() {
    var box = $('#times'), s = shiftStart(), ticks = '';
    for (var i = 0; i < 12; i++) ticks += '<span style="left:' + (i * 100 / 12) + '%">' + pad((s + i) % 24) + '</span>';
    box.innerHTML = TIMES.map(function (t) {
      var row = t[0];
      return '<div class="trow" data-row="' + row + '"><div class="thead"><span class="l">' + lab(t[1], t[2]) + '</span><button type="button" class="sm add" data-act="addint" data-row="' + row + '">+ Intervalo / Interval</button></div>' +
        '<div class="bar' + (isStop(row) ? ' red' : '') + '" id="bar' + row + '"></div><div class="ticks">' + ticks + '</div><div class="ints" id="ints' + row + '"></div></div>';
    }).join('');
    TIMES.forEach(function (t) { renderInts(t[0]); });
  }
  function renderInts(row) {
    var list = state.times[row] || [];
    $('#ints' + row).innerHTML = list.map(function (r, i) {
      return '<div class="int" data-row="' + row + '" data-i="' + i + '"><input type="time" step="300" data-t="0" value="' + esc(r[0] || '') + '" aria-label="Desde / From"><span class="dash">–</span><input type="time" step="300" data-t="1" value="' + esc(r[1] || '') + '" aria-label="Hasta / To"><button type="button" class="sm del" data-act="delint" data-row="' + row + '" data-i="' + i + '" aria-label="Quitar / Remove">✕</button><span class="warn" id="w' + row + '_' + i + '"></span></div>';
    }).join('');
    drawBar(row);
  }
  function drawBar(row) {
    var bar = $('#bar' + row), html = '';
    (state.times[row] || []).forEach(function (r, i) {
      var c = RF.rangeToCells(r[0], r[1], state.f.turno), w = $('#w' + row + '_' + i);
      if (c) html += '<i style="left:' + (c[0] * 100 / 144) + '%;width:' + ((c[1] - c[0]) * 100 / 144) + '%"></i>';
      if (w) w.textContent = (r[0] && r[1] && !c) ? 'Fuera del turno / Outside shift' : '';
    });
    state.chain.forEach(function (e) {
      if (String(e.row) !== String(row)) return;
      var c = RF.rangeToCells(e.from, e.to, state.f.turno);
      if (c) html += '<i class="cy" style="left:' + (c[0] * 100 / 144) + '%;width:' + ((c[1] - c[0]) * 100 / 144) + '%"></i>';
    });
    bar.innerHTML = html;
  }

  /* ---------- automatic cycle: Avance -> Lodo 10 -> Montaje -> Lodo 5 -> Avance ... ---------- */
  var ROW_AVANCE = 9, ROW_MONTAJE = 10, ROW_LODO = 13;
  var LODO_DEFAULT = { avance: 10, montaje: 5 };
  var MAIN = {
    avance: { row: ROW_AVANCE, es: 'Avance máquina', en: 'Machine advance', lodo: 'lodoA', next: 'montaje' },
    montaje: { row: ROW_MONTAJE, es: 'Montaje tubo-anillo', en: 'Pipe–ring installation', lodo: 'lodoM', next: 'avance' }
  };
  function toMin(t) { var m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function rel(t) { var m = toMin(t); return m == null ? null : (m - shiftStart() * 60 + 1440) % 1440; }   // minutes since shift start
  function relEnd(t) { var r = rel(t); return r === 0 ? 1440 : r; }
  function shiftEndHm() { return hm(shiftStart() * 60 + 720); }
  function rowName(row) { for (var i = 0; i < TIMES.length; i++) if (String(TIMES[i][0]) === String(row)) return TIMES[i]; return [row, '?', '?']; }
  function chainStart() {
    var c = state.chain;
    return c.length ? c[c.length - 1].to : (state.cy.start || hm(shiftStart() * 60));
  }
  function pendingMain() {
    for (var k = state.chain.length - 1; k >= 0; k--) {
      var kd = state.chain[k].kind;
      if (kd === 'avance' || kd === 'lodoA') return 'montaje';
      if (kd === 'montaje' || kd === 'lodoM') return 'avance';
    }
    return 'avance';
  }
  function currentSel() { var s = state.cy.sel; return (s === undefined || s === null || s === '') ? pendingMain() : s; }
  function entryOk(e) { var a = rel(e.from), b = relEnd(e.to); return a != null && b != null && b > a && b <= 720; }
  // keep the chain continuous: each step starts where the previous ended; slurry steps keep their minutes
  function recompute() {
    var c = state.chain, endRel = 720;
    for (var k = 0; k < c.length; k++) {
      if (k > 0) c[k].from = c[k - 1].to;
      if (c[k].dur != null) {
        var a = rel(c[k].from);
        c[k].to = a == null ? c[k].from : hm(shiftStart() * 60 + Math.min(a + Math.max(0, +c[k].dur || 0), endRel));
      }
    }
  }
  function finishStep() {
    var sel = currentSel(), start = chainStart(), endEl = $('#cyEnd'), end = endEl ? endEl.value : '';
    var a = rel(start), b = relEnd(end);
    if (!end) { status('Indique la hora de fin / Enter the end time', true); if (endEl) endEl.focus(); return; }
    if (a == null || b == null || b <= a || b > 720) {
      status('La hora de fin debe ser posterior a ' + start + ' y dentro del turno / End must be after ' + start + ' and within the shift', true);
      if (endEl) endEl.focus(); return;
    }
    snap(null);
    var m = MAIN[sel];
    state.chain.push({ row: m ? m.row : +sel, from: start, to: end, kind: m ? sel : 'stop' });
    if (m) {
      var lodoEl = $('#cyLodo'), mins = lodoEl ? parseInt(lodoEl.value, 10) : LODO_DEFAULT[sel];
      if (!(mins >= 0)) mins = LODO_DEFAULT[sel];
      if (mins > 0 && b < 720) state.chain.push({ row: ROW_LODO, from: end, to: end, kind: m.lodo, dur: Math.min(mins, 120) });
    }
    state.cy.sel = null;
    recompute();
    renderCycle(); renderTimeline(); drawAllBars(); persist();
    var nxt = currentSel();
    status('✓ ' + (m ? m.es : rowName(sel)[1]) + ' ' + start + '–' + end + ' · Siguiente / Next: ' + (MAIN[nxt] ? MAIN[nxt].es : rowName(nxt)[1]) + ' ' + chainStart());
  }
  function drawAllBars() { TIMES.forEach(function (t) { if ($('#bar' + t[0])) drawBar(t[0]); }); }
  function actLabel(sel) { var m = MAIN[sel]; if (m) return [m.es, m.en]; var t = rowName(sel); return [t[1], t[2]]; }

  function renderCycle() {
    var box = $('#cycle'); if (!box) return;
    var sel = currentSel(), start = chainStart(), done = relEnd(start) >= 720 && state.chain.length > 0, l = actLabel(sel), m = MAIN[sel];
    var h = '';
    if (done) {
      h += '<div class="cy-now done"><span class="cy-tag">✓</span><div><b>Turno completo</b><small>Shift complete · ' + esc(shiftEndHm()) + '</small></div></div>';
    } else {
      h += '<div class="cy-now"><span class="cy-tag">Ahora<small>Now</small></span><div><b>' + esc(l[0]) + '</b><small>' + esc(l[1]) + '</small></div>' +
        '<div class="cy-from">desde<small>from</small><b>' + esc(start) + '</b></div></div>';
      h += '<div class="cy-form">';
      if (!state.chain.length) h += '<label class="fld"><span class="l">' + lab('Inicio del ciclo', 'Cycle start') + '</span><input type="time" step="300" data-cy="start" value="' + esc(start) + '"></label>';
      h += '<label class="fld"><span class="l">' + lab('Hora de fin', 'End time') + '</span><input type="time" step="300" id="cyEnd"></label>';
      if (m) h += '<label class="fld lodo"><span class="l">' + lab('Lodo después (min)', 'Slurry after (min)') + '</span><input type="number" inputmode="numeric" min="0" max="120" step="5" id="cyLodo" value="' + LODO_DEFAULT[sel] + '"></label>';
      h += '<button type="button" class="btn primary cy-go" data-act="cyfinish">Terminar<small>Finish</small></button></div>';
      var after = m ? 'Después: Lodo ' + LODO_DEFAULT[sel] + ' min → ' + MAIN[m.next].es + ' · Then: slurry → ' + MAIN[m.next].en
        : 'Después se continúa con / Then back to: ' + MAIN[pendingMain()].es;
      h += '<p class="count cy-after">' + esc(after) + '</p>';
    }
    if (done) { box.innerHTML = h; return; }
    h += '<p class="l cy-other">' + lab('¿Otra actividad ahora?', 'Something else now?') + '</p><div class="chips cy-chips">';
    TIMES.forEach(function (t) {
      var key = t[0] === ROW_AVANCE ? 'avance' : t[0] === ROW_MONTAJE ? 'montaje' : t[0];
      h += '<button type="button" class="chip' + (isStop(t[0]) ? ' bad' : '') + '" data-act="cysel" data-sel="' + key + '" aria-pressed="' + (String(key) === String(sel)) + '">' + esc(t[1]) + '<small>' + esc(t[2]) + '</small></button>';
    });
    box.innerHTML = h + '</div>';
  }
  function renderTimeline() {
    var box = $('#timeline'); if (!box) return;
    if (!state.chain.length) { box.innerHTML = '<p class="count">Aún no hay pasos. Indique la hora de fin del paso actual y pulse “Terminar”. / No steps yet: enter the end time of the current step and tap Finish.</p>'; return; }
    box.innerHTML = state.chain.map(function (e, i) {
      var n = actLabel(e.kind === 'stop' ? e.row : (MAIN[e.kind] ? e.kind : e.row)), auto = e.dur != null;
      if (auto) n = [e.kind === 'lodoA' ? 'Lodo (tras avance)' : 'Lodo (tras montaje)', 'Slurry change'];
      var from = i === 0 ? '<input type="time" step="300" data-ce="from" data-i="0" value="' + esc(e.from) + '" aria-label="Desde / From">' : '<span class="t">' + esc(e.from) + '</span>';
      var to = auto ? '<span class="t">' + esc(e.to) + '</span><label class="mins"><input type="number" inputmode="numeric" min="0" max="120" step="5" data-ce="dur" data-i="' + i + '" value="' + esc(e.dur) + '" aria-label="Minutos / Minutes"> min</label>'
        : '<input type="time" step="300" data-ce="to" data-i="' + i + '" value="' + esc(e.to) + '" aria-label="Hasta / To">';
      return '<div class="tl' + (auto ? ' auto' : '') + (isStop(e.row) ? ' bad' : '') + (entryOk(e) ? '' : ' invalid') + '">' +
        '<span class="dot"></span><div class="tl-name"><b>' + esc(n[0]) + '</b><small>' + esc(n[1]) + '</small></div>' +
        '<div class="tl-times">' + from + '<span class="dash">–</span>' + to + '</div>' +
        '<button type="button" class="x" data-act="cydel" data-i="' + i + '" aria-label="Quitar / Remove">✕</button>' +
        (entryOk(e) ? '' : '<span class="warn">Revise las horas / Check the times</span>') + '</div>';
    }).join('');
  }
  function onChainEdit(t) {
    var i = +t.dataset.i, e = state.chain[i]; if (!e) return;
    if (t.dataset.ce === 'dur') e.dur = Math.min(120, Math.max(0, parseInt(t.value, 10) || 0));
    else e[t.dataset.ce] = t.value;
    recompute();
    // refresh only the derived times so the field being typed in keeps focus
    Array.prototype.forEach.call(document.querySelectorAll('#timeline .tl'), function (row, k) {
      var c = state.chain[k], spans = row.querySelectorAll('.tl-times .t');
      if (!c) return;
      if (k > 0 && spans[0]) spans[0].textContent = c.from;
      if (c.dur != null && spans[spans.length - 1]) spans[spans.length - 1].textContent = c.to;
      var ok = entryOk(c); row.classList.toggle('invalid', !ok);
      var w = row.querySelector('.warn'); if (!ok && !w) row.insertAdjacentHTML('beforeend', '<span class="warn">Revise las horas / Check the times</span>'); if (ok && w) w.remove();
    });
    drawAllBars(); renderCycleLight();
  }
  function renderCycleLight() {
    var b = document.querySelector('#cycle .cy-from b');
    if (b) b.textContent = chainStart(); else renderCycle();
  }
  function deleteStep(i) {
    var e = state.chain[i]; if (!e) return;
    var n = 1, nx = state.chain[i + 1];
    if (MAIN[e.kind] && nx && nx.kind === MAIN[e.kind].lodo) n = 2;   // its automatic slurry step goes with it
    state.chain.splice(i, n);
    if (i === 0 && state.chain.length) state.chain[0].from = e.from;
    recompute();
  }

  /* ---------- undo ---------- */
  var undoStack = [], lastSnapKey = null, lastSnapAt = 0;
  function snap(key) {
    var now = Date.now();
    if (key && key === lastSnapKey && now - lastSnapAt < 2000) { lastSnapAt = now; return; }
    lastSnapKey = key; lastSnapAt = now;
    undoStack.push(JSON.stringify({ state: state, hour: hourSel }));
    if (undoStack.length > 60) undoStack.shift();
    updateUndo();
  }
  function updateUndo() { var b = $('#btnUndo'); if (b) b.disabled = !undoStack.length; }
  function undo() {
    if (!undoStack.length) return;
    var d = JSON.parse(undoStack.pop());
    if (JSON.stringify(d.state.lines) !== JSON.stringify(state.lines)) linesDirty = true;
    state = d.state; hourSel = d.hour || 0; lastSnapKey = null; paletteFor = -1;
    var y = window.scrollY;
    render(); onScroll(); writeNow(); updateUndo();
    window.scrollTo(0, y);
    status('Deshecho / Undone');
  }

  /* hours */
  function hourHas(h) {
    var f = state.f;
    for (var k in f) { if (f[k] !== '' && f[k] != null && /^h(\d+|29v|29d)_(\d+)$/.test(k) && +k.split('_')[1] === h) return true; }
    return false;
  }
  function renderTabs() {
    var s = shiftStart();
    $('#tabs').innerHTML = Array.apply(null, Array(12)).map(function (_, i) {
      return '<button type="button" class="tab' + (i === hourSel ? ' on' : '') + (hourHas(i) ? ' has' : '') + '" data-act="hour" data-h="' + i + '">' + pad((s + i) % 24) + ':00</button>';
    }).join('');
  }
  function renderHourly() {
    var s = shiftStart(), h = hourSel;
    var html = '<div class="hour-head"><b>' + pad((s + h) % 24) + ':00 – ' + pad((s + h + 1) % 24) + ':00</b><span class="hour-btns"><button type="button" class="sm add" data-act="copyprev">Copiar de la hora anterior con datos<br><small>Copy from previous filled hour</small></button>' +
      '<button type="button" class="sm clear" data-act="clearhour"' + (hourHas(h) ? '' : ' disabled') + '>✕ Borrar esta hora<br><small>Clear this hour</small></button></span></div><div class="vlist">';
    HOURLY.forEach(function (r) {
      var key = 'h' + r[0] + '_' + h;
      html += '<label class="fld"><span class="l">' + lab(r[1], r[2]) + '</span>' + inputHtml(key, r[3]) + '</label>';
    });
    $('#hourly').innerHTML = html + '</div>';
  }
  function copyPrev() {
    var h = hourSel, src = -1;
    for (var i = h - 1; i >= 0; i--) if (hourHas(i)) { src = i; break; }
    if (src < 0) { status('No hay hora anterior con datos / No earlier hour with data', true); return; }
    HOURLY.forEach(function (r) { state.f['h' + r[0] + '_' + h] = state.f['h' + r[0] + '_' + src] || ''; });
    renderHourly(); renderTabs(); persist();
    status('Copiado de ' + pad((shiftStart() + src) % 24) + ':00 / Copied from ' + pad((shiftStart() + src) % 24) + ':00');
  }

  function clearHour() {
    var h = hourSel, label = pad((shiftStart() + h) % 24) + ':00';
    if (!hourHas(h)) return;
    if (!confirm('¿Borrar todos los valores de las ' + label + '? (se puede deshacer)\nClear all values of ' + label + '? (can be undone)')) return;
    snap(null);
    HOURLY.forEach(function (r) { delete state.f['h' + r[0] + '_' + h]; });
    renderHourly(); renderTabs(); persist();
    status('Hora ' + label + ' borrada / Hour ' + label + ' cleared');
  }

  /* geology */
  function renderGeo() {
    $('#geo').innerHTML = GEO.map(function (g, i) {
      return '<button type="button" class="chip" data-act="geo" data-i="' + i + '" aria-pressed="' + (state.geo.indexOf(i) >= 0) + '">' + esc(g[0]) + '<small>' + esc(g[1]) + '</small></button>';
    }).join('');
  }

  /* sheet 2 lines */
  var paletteFor = -1;
  function renderLines() {
    var max = RF.LINE_MAX;
    $('#lines').innerHTML = state.lines.map(function (l, i) {
      var css = lineCss(l.color), st = css ? ' style="background:' + css + '"' : '';
      var h = '<div class="line' + (css ? ' colored' : '') + '"><input type="text" class="num" inputmode="numeric" placeholder="Nº" data-line="n" data-i="' + i + '" value="' + esc(l.n || '') + '" aria-label="Número / Number"' + st + '><textarea data-line="text" data-i="' + i + '" placeholder="Descripción / Description" aria-label="Descripción / Description"' + st + '>' + esc(l.text || '') + '</textarea>' +
        '<button type="button" class="sm color" data-act="linepal" data-i="' + i + '" aria-label="Color" aria-expanded="' + (paletteFor === i) + '" title="Color"><i' + (css ? ' style="background:' + css + '"' : '') + '></i></button>' +
        '<button type="button" class="sm del" data-act="delline" data-i="' + i + '" aria-label="Quitar / Remove">✕</button></div>';
      if (paletteFor === i) {
        h += '<div class="palette" role="group" aria-label="Color de la línea / Line colour">' + LINE_COLORS.map(function (c) {
          return '<button type="button" class="sw' + (c[0] ? '' : ' none') + '" data-act="linecolor" data-i="' + i + '" data-c="' + c[0] + '" aria-pressed="' + ((l.color || '') === c[0]) + '" title="' + esc(c[1] + ' / ' + c[2]) + '" style="background:' + c[3] + '"><span>' + esc(c[1]) + '<small>' + esc(c[2]) + '</small></span></button>';
        }).join('') + '</div>';
      }
      return h;
    }).join('') + '<button type="button" class="sm add" data-act="addline"' + (state.lines.length >= max ? ' disabled' : '') + '>+ Añadir línea / Add line</button> <span class="count">' + state.lines.length + ' / ' + max + '</span>';
  }

  /* ---------- events ---------- */
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!started || !t.closest('#app')) return;
    if (t.id === 'cyEnd' || t.id === 'cyLodo') return;          // read when Finish is tapped
    var key = t.dataset.k ? 'k:' + t.dataset.k : t.dataset.line ? 'l:' + t.dataset.i + t.dataset.line
      : t.dataset.t != null ? 'i:' + (t.closest('.int') || {}).dataset.row + ':' + t.dataset.t
      : t.dataset.ce ? 'c:' + t.dataset.i + t.dataset.ce : t.dataset.cy ? 'cy:' + t.dataset.cy : null;
    if (!key) return;
    snap(key);
    if (t.dataset.ce) { onChainEdit(t); persist(); return; }
    if (t.dataset.cy === 'start') { state.cy.start = t.value; renderCycleLight(); persist(); return; }
    if (t.dataset.k) {
      state.f[t.dataset.k] = t.value;
      if (t.dataset.k === 'turno') { renderCycle(); renderTimeline(); renderTimes(); renderTabs(); renderHourly(); }
      else if (/^h/.test(t.dataset.k)) renderTabsLight();
    } else if (t.dataset.line) {
      state.lines[+t.dataset.i][t.dataset.line] = t.value;
      linesDirty = true;
    } else if (t.dataset.t != null) {
      var d = t.closest('.int'), row = d.dataset.row, i = +d.dataset.i;
      state.times[row][i][+t.dataset.t] = t.value;
      drawBar(row);
    } else return;
    persist();
  });
  function renderTabsLight() {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) { b.classList.toggle('has', hourHas(+b.dataset.h)); });
    var cb = document.querySelector('[data-act="clearhour"]'); if (cb) cb.disabled = !hourHas(hourSel);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || !started) return;
    var act = b.dataset.act, row = b.dataset.row, i = +b.dataset.i;
    if (act === 'cyfinish') { finishStep(); return; }
    if (act !== 'hour' && act !== 'linepal' && act !== 'clearhour') snap(null);
    if (act === 'cysel') {
      var v = b.dataset.sel, cur = currentSel();
      state.cy.sel = (String(v) === String(pendingMain())) ? null : v;
      if (String(v) === String(cur) && state.cy.sel !== null) state.cy.sel = null;   // tap again = back to the cycle
      renderCycle();
    } else if (act === 'cydel') { deleteStep(i); renderCycle(); renderTimeline(); drawAllBars(); }
    else if (act === 'addint') {
      var list = state.times[row] = state.times[row] || [], last = list[list.length - 1], from;
      var m = last && /^(\d+):(\d+)$/.exec(last[1]);
      from = m ? hm(+m[1] * 60 + +m[2]) : hm(shiftStart() * 60);
      var fm = /^(\d+):(\d+)$/.exec(from);
      list.push([from, hm(+fm[1] * 60 + +fm[2] + 30)]);
      renderInts(row);
      var ins = document.querySelectorAll('#ints' + row + ' input'); if (ins.length) ins[ins.length - 2].focus();
    } else if (act === 'delint') { state.times[row].splice(i, 1); renderInts(row); }
    else if (act === 'hour') { hourSel = +b.dataset.h; renderTabs(); renderHourly(); }
    else if (act === 'copyprev') { copyPrev(); return; }
    else if (act === 'clearhour') { clearHour(); return; }
    else if (act === 'geo') { var p = state.geo.indexOf(i); if (p >= 0) state.geo.splice(p, 1); else state.geo.push(i); state.geo.sort(function (a, c) { return a - c; }); renderGeo(); }
    else if (act === 'addline') { if (state.lines.length < RF.LINE_MAX) { state.lines.push({ n: '', text: '' }); paletteFor = -1; renderLines(); var ta = document.querySelectorAll('#lines textarea'); ta[ta.length - 1].focus(); } }
    else if (act === 'delline') { state.lines.splice(i, 1); if (!state.lines.length) state.lines.push({ n: '', text: '' }); paletteFor = -1; linesDirty = true; renderLines(); }
    else if (act === 'linepal') { paletteFor = paletteFor === i ? -1 : i; renderLines(); return; }
    else if (act === 'linecolor') {
      var ln = state.lines[i]; if (!ln) return;
      if (b.dataset.c) ln.color = b.dataset.c; else delete ln.color;
      paletteFor = -1; linesDirty = true; renderLines();
    }
    persist();
  });

  /* nav highlight */
  function onScroll() {
    var cur = SECTIONS[0][0];
    SECTIONS.forEach(function (s) { var e = document.getElementById(s[0]); if (e && e.getBoundingClientRect().top < 160) cur = s[0]; });
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) { a.classList.toggle('on', a.dataset.sec === cur); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- new / save ---------- */
  $('#btnNew').addEventListener('click', function () {
    if (!confirm('¿Empezar un parte nuevo? Se borran tiempos y valores; la descripción de trabajos se copia al nuevo parte.\nStart a new report? Times and values are cleared; the description of works is copied to the new report.')) return;
    snap(null);
    if (linesDirty) saveDescription();
    state = freshState(state.lines); hourSel = 0; paletteFor = -1;
    writeNow();
    render(); window.scrollTo(0, 0); status('Nuevo parte · descripción copiada / New report · description copied');
  });
  $('#btnSave').addEventListener('click', function () {
    var btn = this;
    if (!window.JSZip || !window.TEMPLATE_B64) { status('Falta la plantilla / Template missing', true); return; }
    writeNow();
    var out = JSON.parse(JSON.stringify(state));
    out.lines = out.lines.filter(function (l) { return l && String(l.text || '').trim() !== ''; });
    out.times = mergedTimes(out);
    var name = RF.fileName(out), bridge = window.TBMAndroid;
    btn.disabled = true;
    var job = bridge && bridge.saveFile
      ? RF.buildXlsx(window.JSZip, window.TEMPLATE_B64, out, 'base64').then(function (b64) {
          var res = String(bridge.saveFile(b64, name) || '');
          if (/^error/i.test(res)) throw new Error(res);
          status('Guardado en Descargas / Saved to Downloads: ' + name);
        })
      : RF.buildXlsx(window.JSZip, window.TEMPLATE_B64, out, 'blob').then(function (blob) {
          var a = document.createElement('a'), url = URL.createObjectURL(blob);
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
          status('Descargado / Downloaded: ' + name);
        });
    job.catch(function (err) {
      console.error(err); status('Error: ' + (err && err.message || err), true);
    }).then(function () { btn.disabled = false; });
  });

  // manual intervals + the automatic cycle, as the Excel engine expects them
  function mergedTimes(st) {
    var t = {};
    Object.keys(st.times || {}).forEach(function (r) { t[r] = (st.times[r] || []).map(function (x) { return [x[0], x[1]]; }); });
    (st.chain || []).forEach(function (e) { (t[e.row] = t[e.row] || []).push([e.from, e.to]); });
    return t;
  }
  $('#btnUndo').addEventListener('click', undo);

  /* ---------- entry point, called by portal.js after login ---------- */
  function start(pilot) {
    PILOT = pilot; STORE = pilot.key; started = true;
    var who = $('#who'); if (who) who.textContent = pilot.name;
    undoStack = []; lastSnapKey = null; linesDirty = false; paletteFor = -1;
    var savedAt = load(); render(); onScroll(); savedMark(savedAt, false); updateUndo();
  }
  window.TBMApp = { start: start, flush: function () { if (savePending) writeNow(); }, mergedTimes: function () { return mergedTimes(state); } };
  window.__app = { get state() { return state; } };
})();

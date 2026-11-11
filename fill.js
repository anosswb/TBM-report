/* Fills the production report workbook (same file, same format) from the form state.
   Works on the raw XML of the .xlsx so every style, merge, border and logo is kept. */
(function (root) {
  'use strict';

  var HOUR_COLS = [];
  for (var i = 0; i < 12; i++) HOUR_COLS.push(colName(3 + 12 * i));

  var TIME_ROWS = [9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  var HOURLY_TEXT_ROWS = [22, 23, 24, 25, 26, 27, 28];
  var HOURLY_NUM_ROWS = [31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47];
  var CONS1 = ['O49', 'AM49', 'BK49', 'CI49', 'DG49', 'EE49', 'O50', 'AM50', 'BK50', 'CI50', 'DG50', 'EE50'];
  var CONS2 = { C40: 'm³', C41: 'm³', C42: 'm³', C43: 'kg', C44: 'kg', C45: 'kg', G40: 'L', G41: 'm³', G42: 'kg', G43: 'kg', G44: 'kg', G45: 'kg' };
  var TEXT_AREAS = { locAverias1: 'B52', locAverias2: 'AA52', averias: 'BK52', trabajos1: 'B56', trabajos2: 'AA56', obs1: 'BK56', obs2: 'CU56' };
  var FILL_WHITE = 6, FILL_PAINT = 10, FILL_BREAKDOWN = 13, FILL_GEO = 11;
  var PAINT_FILLS = { 7: 1, 10: 1, 12: 1, 13: 1 };
  var JEFE_PREFIX = 'JEFE DE OBRA:' + new Array(80).join(' ');
  var LINE_FIRST = 4, LINE_LAST = 38;

  function colName(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }
  function clean(v) { return v == null ? '' : String(v).trim(); }
  function asText(v) { v = clean(v); return v === '' ? null : v; }
  function asNum(v) {
    v = clean(v);
    if (v === '') return null;
    if (/^[-+]?\d+([.,]\d+)?$/.test(v)) return Number(v.replace(',', '.'));
    return v;
  }
  function asPct(v) {
    v = clean(v).replace(/\s*%$/, '');
    if (v === '') return null;
    if (/^[-+]?\d+([.,]\d+)?$/.test(v)) return Number(v.replace(',', '.')) / 100;
    return v;
  }
  function withUnit(v, unit) {
    v = clean(v);
    if (v === '') return null;
    return /^[-+]?\d+([.,]\d+)?$/.test(v) ? v + ' ' + unit : v;
  }
  function shiftName(turno) { return turno === 'DAY' ? 'DAY SHIFT' : 'NIGHT SHIFT'; }
  function shiftStart(turno) { return turno === 'DAY' ? 7 * 60 : 19 * 60; }
  function dateParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(iso));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function dateSerial(iso) {
    var p = dateParts(iso);
    return p ? Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000) + 25569 : null;
  }
  function dateText(iso) {
    var p = dateParts(iso);
    return p ? p.d + '/' + p.m + '/' + p.y : '';
  }
  function minutes(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(clean(t));
    return m ? +m[1] * 60 + +m[2] : null;
  }
  /* A time range inside the 12 h shift -> [first, last) 5-minute cells, or null. */
  function rangeToCells(from, to, turno) {
    var a = minutes(from), b = minutes(to), s = shiftStart(turno);
    if (a == null || b == null) return null;
    var ia = Math.floor(((a - s + 1440) % 1440) / 5);
    var ib = Math.ceil(((b - s + 1440) % 1440) / 5);
    if (ib === 0 || ib > 144) ib = 144;
    if (ia >= 144 || ib <= ia) return null;
    return [ia, ib];
  }
  function paintedCells(ranges, turno) {
    var on = [];
    (ranges || []).forEach(function (r) {
      var c = rangeToCells(r[0], r[1], turno);
      if (c) for (var i = c[0]; i < c[1]; i++) on[i] = true;
    });
    return on;
  }

  /* ---- styles: clone an existing cell format with another fill ---- */
  function StyleBook(xml) {
    var m = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    this.xml = xml; this.block = m[0];
    this.xfs = m[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
    this.cache = {};
  }
  StyleBook.prototype.fillOf = function (sid) {
    var m = /fillId="(\d+)"/.exec(this.xfs[sid]);
    return m ? +m[1] : 0;
  };
  StyleBook.prototype.withFill = function (sid, fillId) {
    if (this.fillOf(sid) === fillId) return sid;
    var key = sid + ':' + fillId;
    if (this.cache[key] != null) return this.cache[key];
    var xf = this.xfs[sid];
    var head = /^<xf\b[^>]*?(\/?)>/.exec(xf)[0], rest = xf.slice(head.length);
    var h = head.replace(/\s(fillId|applyFill)="[^"]*"/g, '')
      .replace(/^<xf/, '<xf fillId="' + fillId + '" applyFill="1"');
    this.xfs.push(h + rest);
    return (this.cache[key] = this.xfs.length - 1);
  };
  StyleBook.prototype.toXml = function () {
    return this.xml.replace(this.block,
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>');
  };

  /* ---- sheet patching: one pass over every <c> element ---- */
  function patchSheet(xml, updates, styles) {
    var used = {};
    var out = xml.replace(/<c r="([A-Z]+[0-9]+)"((?:\s[^>]*?)?)(?:\/>|>[\s\S]*?<\/c>)/g, function (all, ref, attrs) {
      var u = updates[ref];
      if (!u) return all;
      used[ref] = true;
      var sm = /\ss="(\d+)"/.exec(attrs), sid = sm ? +sm[1] : 0;
      if (u.fillFn) sid = styles.withFill(sid, u.fillFn(styles.fillOf(sid)));
      var open = '<c r="' + ref + '"' + (sid ? ' s="' + sid + '"' : '');
      var v = u.keep ? undefined : u.v;
      if (u.keep) {
        var body = /^<c [^>]*?>([\s\S]*)<\/c>$/.exec(all);
        var t = /\st="(\w+)"/.exec(attrs);
        return body ? open + (t ? ' t="' + t[1] + '"' : '') + '>' + body[1] + '</c>' : open + '/>';
      }
      if (v == null || v === '') return open + '/>';
      if (typeof v === 'number' && isFinite(v)) return open + '><v>' + v + '</v></c>';
      return open + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    });
    var missing = Object.keys(updates).filter(function (k) { return !used[k]; });
    return { xml: out, missing: missing };
  }
  function setRowHeight(xml, row, ht) {
    return xml.replace(new RegExp('<row r="' + row + '"([^>]*)>'), function (all, attrs) {
      attrs = attrs.replace(/\s(ht|customHeight)="[^"]*"/g, '');
      return '<row r="' + row + '"' + attrs + ' ht="' + ht + '" customHeight="1">';
    });
  }

  /* ---- main: state -> { sheet1, sheet2, styles } ---- */
  function fillReport(files, state) {
    var f = (state && state.f) || {}, turno = f.turno === 'DAY' ? 'DAY' : 'NIGHT';
    var styles = new StyleBook(files.styles);
    var u1 = {}, u2 = {};
    function set(u, ref, v) { u[ref] = { v: v }; }

    // header
    set(u1, 'N2', asText(f.obra)); set(u1, 'CO2', asText(f.maquina)); set(u1, 'DY2', asText(f.contenedor));
    set(u1, 'N3', asText(f.tramo)); set(u1, 'DY3', asNum(f.avance));
    set(u1, 'BS3', '#TUBOS/#ANILLOS COLOCADOS ' + clean(f.colocados));
    set(u1, 'N4', asText(f.piloto)); set(u1, 'CO4', asText(f.tuboInicio)); set(u1, 'DY4', asNum(f.inicio));
    set(u1, 'B5', 'Dia/Noche:' + shiftName(turno) + ' ');
    set(u1, 'N5', dateSerial(f.fecha)); set(u1, 'CO5', asText(f.tuboFin)); set(u1, 'DY5', asNum(f.fin));

    // time grid: painted cells, like the operators do by hand
    TIME_ROWS.forEach(function (row) {
      var on = paintedCells(state.times && state.times[row], turno);
      for (var i = 0; i < 144; i++) {
        var ref = colName(3 + i) + row;
        u1[ref] = { v: null, paint: !!on[i], row: row };
      }
    });
    ['Z11', 'AL11', 'AX11', 'EF11', 'EG11'].forEach(function (r) { set(u1, r, null); });

    // hourly values
    for (var h = 0; h < 12; h++) {
      var c = HOUR_COLS[h];
      HOURLY_TEXT_ROWS.forEach(function (r) { set(u1, c + r, asText(f['h' + r + '_' + h])); });
      HOURLY_NUM_ROWS.forEach(function (r) {
        var raw = f['h' + r + '_' + h];
        set(u1, c + r, r === 42 ? asPct(raw) : asNum(raw));
      });
      set(u1, c + 29, asText(f['h29v_' + h]));
      set(u1, colName(3 + 12 * h + 6) + 29, asText(f['h29d_' + h]));
    }

    // geology: selected option is highlighted
    var geo = state.geo || [];
    HOUR_COLS.forEach(function (c, i) { u1[c + 48] = { keep: true, geo: geo.indexOf(i) >= 0 }; });

    CONS1.forEach(function (ref) { set(u1, ref, asNum(f['c_' + ref])); });
    Object.keys(TEXT_AREAS).forEach(function (k) { set(u1, TEXT_AREAS[k], asText(f[k])); });
    for (var p = 0; p < 12; p++) {
      set(u1, HOUR_COLS[p] + 76, asText(f['p_' + p]));
      set(u1, HOUR_COLS[p] + 78, asText(f['p_' + (12 + p)]));
    }
    set(u1, 'B76', JEFE_PREFIX + clean(f.jefe));

    // resolve fills now that every target is known
    Object.keys(u1).forEach(function (ref) {
      var u = u1[ref];
      if (u.paint != null) u.fillFn = function (cur) {
        if (u.paint) return u.row === 12 ? FILL_BREAKDOWN : FILL_PAINT;
        return PAINT_FILLS[cur] ? FILL_WHITE : cur;
      };
      if (u.geo != null) u.fillFn = function (cur) { return u.geo ? FILL_GEO : (cur === FILL_GEO ? 0 : cur); };
    });
    var s1 = patchSheet(files.sheet1, u1, styles);

    // sheet 2: description of works
    set(u2, 'A3', 'RELEVO : ' + shiftName(turno) + ' ');
    set(u2, 'D3', asText(f.piloto));
    set(u2, 'F3', 'FECHA: ' + dateText(f.fecha) + '   ');
    var lines = (state.lines || []).filter(function (l) { return l && clean(l.text) !== ''; });
    var heights = {};
    for (var r = LINE_FIRST; r <= LINE_LAST; r++) {
      var l = lines[r - LINE_FIRST];
      set(u2, 'A' + r, l ? asNum(l.n) : null);
      set(u2, 'B' + r, l ? ' ' + clean(l.text) : null);
      var n = 1;
      if (l) n = clean(l.text).split('\n').reduce(function (a, s) { return a + Math.max(1, Math.ceil(s.length / 110)); }, 0);
      heights[r] = Math.round(18.75 * n * 100) / 100;
    }
    Object.keys(CONS2).forEach(function (ref) { set(u2, ref, withUnit(f['k_' + ref], CONS2[ref])); });
    for (var t = 0; t < 5; t++) {
      set(u2, 'I' + (41 + t), asNum(f['pt_' + t]));
      set(u2, 'J' + (41 + t), 'N°' + clean(f['pr_' + t]));
      set(u2, 'K' + (41 + t), dateParts(f['pd_' + t]) ? dateText(f['pd_' + t]) : asText(f['pd_' + t]));
    }
    var s2 = patchSheet(files.sheet2, u2, styles);
    var x2 = s2.xml;
    Object.keys(heights).forEach(function (r) { x2 = setRowHeight(x2, r, heights[r]); });

    return { sheet1: s1.xml, sheet2: x2, styles: styles.toXml(), missing: s1.missing.concat(s2.missing), extraLines: Math.max(0, lines.length - (LINE_LAST - LINE_FIRST + 1)) };
  }
  function fileName(state) {
    var f = (state && state.f) || {}, p = dateParts(f.fecha);
    var d = p ? p.d + '-' + p.m + '-' + p.y : 'sin-fecha';
    return 'PRODUCTION_INTAKE_2_' + shiftName(f.turno).replace(' ', '_') + '-' + d + '.xlsx';
  }

  var P1 = 'xl/worksheets/sheet1.xml', P2 = 'xl/worksheets/sheet2.xml', PS = 'xl/styles.xml';
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  /* Template (base64 xlsx) + state -> Promise of the filled workbook (type: 'blob' in browsers, 'nodebuffer' in node). */
  function buildXlsx(JSZip, templateB64, state, type) {
    return JSZip.loadAsync(templateB64, { base64: true }).then(function (zip) {
      return Promise.all([P1, P2, PS].map(function (p) { return zip.file(p).async('string'); })).then(function (x) {
        var r = fillReport({ sheet1: x[0], sheet2: x[1], styles: x[2] }, state);
        if (r.missing.length) throw new Error('Celdas no encontradas / cells not found: ' + r.missing.join(', '));
        zip.file(P1, r.sheet1); zip.file(P2, r.sheet2); zip.file(PS, r.styles);
        return zip.generateAsync({ type: type || 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: XLSX_MIME });
      });
    });
  }

  var api = {
    fillReport: fillReport, buildXlsx: buildXlsx, fileName: fileName, rangeToCells: rangeToCells, colName: colName,
    HOUR_COLS: HOUR_COLS, TIME_ROWS: TIME_ROWS, CONS1: CONS1, CONS2: CONS2, LINE_MAX: LINE_LAST - LINE_FIRST + 1
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReportFill = api;
})(typeof self !== 'undefined' ? self : this);

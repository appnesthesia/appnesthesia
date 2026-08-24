/* ============================================================
   Appnesthesia — Motor de Horario desde Excel (.xlsx)
   ------------------------------------------------------------
   Lee el Excel del horario (servido por el worker) y lo dibuja
   respetando colores de relleno, bordes, fuentes, celdas
   combinadas y anchos de columna del archivo original.

   No depende de visores externos (OneDrive / Google), que ya no
   permiten incrustar. Requiere vendor/fflate.min.js.

   API pública:
     HorarioXLSX.load(url, {force})  -> Promise<workbook>
     HorarioXLSX.sheetNames()        -> string[]
     HorarioXLSX.renderSheet(name)   -> string (HTML)
     HorarioXLSX.meta()              -> {fetchedAt, bytes}
   ============================================================ */
(function (global) {
  'use strict';

  var CACHE_KEY = 'appx_horario_cache_v1';
  var CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

  var wb = null;      // workbook parseado
  var meta = { fetchedAt: 0, bytes: 0 };

  // ---------- utilidades XML ----------
  function parseXML(str) {
    return new DOMParser().parseFromString(str, 'application/xml');
  }
  function attr(el, name, dflt) {
    if (!el) return dflt;
    var v = el.getAttribute(name);
    return v === null ? dflt : v;
  }
  function colLetterToIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref);
    if (!m) return 1;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }
  function rowOfRef(ref) {
    var m = /(\d+)$/.exec(ref);
    return m ? parseInt(m[1], 10) : 1;
  }

  // ---------- color ----------
  function tintHex(hex, tint) {
    var r = parseInt(hex.substr(0, 2), 16) / 255,
        g = parseInt(hex.substr(2, 2), 16) / 255,
        b = parseInt(hex.substr(4, 2), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    if (!tint) tint = 0;
    l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    l = Math.max(0, Math.min(1, l));
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var rr = s === 0 ? l : hue2rgb(p, q, h + 1 / 3),
        gg = s === 0 ? l : hue2rgb(p, q, h),
        bb = s === 0 ? l : hue2rgb(p, q, h - 1 / 3);
    function hx(v) { var t = Math.round(v * 255).toString(16).toUpperCase(); return t.length < 2 ? '0' + t : t; }
    return hx(rr) + hx(gg) + hx(bb);
  }

  var INDEXED = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
    '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000',
    '000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF',
    '660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000',
    '008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99',
    '3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966',
    '003300','333300','993300','993366','333399','333333'];

  function colorOf(el, theme) {
    if (!el) return null;
    var rgb = el.getAttribute('rgb');
    if (rgb) {
      if (rgb.length === 8) {
        if (rgb.substr(0, 2) === '00') return null;
        return '#' + rgb.substr(2);
      }
      return '#' + rgb;
    }
    var th = el.getAttribute('theme');
    if (th !== null) {
      var base = theme[parseInt(th, 10)] || 'FFFFFF';
      var tint = parseFloat(el.getAttribute('tint') || '0');
      return '#' + tintHex(base, tint);
    }
    var ix = el.getAttribute('indexed');
    if (ix !== null) {
      var v = INDEXED[parseInt(ix, 10)];
      return v ? '#' + v : null;
    }
    return null;
  }

  // ---------- estilos ----------
  var BSTYLE = {
    thin: '1px solid', medium: '2px solid', thick: '3px solid', double: '3px double',
    dashed: '1px dashed', dotted: '1px dotted', hair: '1px solid',
    mediumDashed: '2px dashed', dashDot: '1px dashed', mediumDashDot: '2px dashed',
    dashDotDot: '1px dotted', mediumDashDotDot: '2px dotted', slantDashDot: '1px dashed'
  };

  function parseTheme(xml) {
    var fallback = ['FFFFFF','000000','E7E6E6','44546A','4472C4','ED7D31','A5A5A5','FFC000','5B9BD5','70AD47'];
    if (!xml) return fallback;
    try {
      var doc = parseXML(xml);
      var scheme = doc.getElementsByTagName('a:clrScheme')[0] || doc.getElementsByTagName('clrScheme')[0];
      if (!scheme) return fallback;
      var vals = [];
      for (var i = 0; i < scheme.children.length; i++) {
        var el = scheme.children[i];
        var srgb = el.getElementsByTagName('a:srgbClr')[0] || el.getElementsByTagName('srgbClr')[0];
        var sys = el.getElementsByTagName('a:sysClr')[0] || el.getElementsByTagName('sysClr')[0];
        if (srgb) vals.push((srgb.getAttribute('val') || 'FFFFFF').toUpperCase());
        else if (sys) vals.push((sys.getAttribute('lastClr') || 'FFFFFF').toUpperCase());
        else vals.push('FFFFFF');
      }
      if (vals.length < 10) return fallback;
      // el orden del archivo es dk1,lt1,dk2,lt2,...; los índices de celda son lt1,dk1,lt2,dk2,...
      return [vals[1], vals[0], vals[3], vals[2]].concat(vals.slice(4));
    } catch (e) { return fallback; }
  }

  function parseStyles(xml, theme) {
    var doc = parseXML(xml);
    var fills = [], fonts = [], borders = [], xfs = [];

    var fillEls = (doc.getElementsByTagName('fills')[0] || {}).children || [];
    for (var i = 0; i < fillEls.length; i++) {
      var pf = fillEls[i].getElementsByTagName('patternFill')[0];
      var type = pf ? pf.getAttribute('patternType') : null;
      var fg = pf ? (pf.getElementsByTagName('fgColor')[0]) : null;
      fills.push({ type: type, color: type === 'solid' ? colorOf(fg, theme) : null });
    }

    var fontEls = (doc.getElementsByTagName('fonts')[0] || {}).children || [];
    for (var j = 0; j < fontEls.length; j++) {
      var f = fontEls[j];
      fonts.push({
        b: !!f.getElementsByTagName('b')[0],
        i: !!f.getElementsByTagName('i')[0],
        u: !!f.getElementsByTagName('u')[0],
        sz: parseFloat(attr(f.getElementsByTagName('sz')[0], 'val', '11')),
        name: attr(f.getElementsByTagName('name')[0], 'val', 'Calibri'),
        color: colorOf(f.getElementsByTagName('color')[0], theme)
      });
    }

    var borderEls = (doc.getElementsByTagName('borders')[0] || {}).children || [];
    for (var k = 0; k < borderEls.length; k++) {
      var b = borderEls[k], out = {};
      ['left', 'right', 'top', 'bottom'].forEach(function (side) {
        var el = b.getElementsByTagName(side)[0];
        var st = el ? el.getAttribute('style') : null;
        out[side] = st ? { style: st, color: colorOf(el.getElementsByTagName('color')[0], theme) } : null;
      });
      borders.push(out);
    }

    var cellXfs = doc.getElementsByTagName('cellXfs')[0];
    var xfEls = cellXfs ? cellXfs.children : [];
    for (var m = 0; m < xfEls.length; m++) {
      var x = xfEls[m];
      var al = x.getElementsByTagName('alignment')[0];
      xfs.push({
        fillId: parseInt(attr(x, 'fillId', '0'), 10),
        fontId: parseInt(attr(x, 'fontId', '0'), 10),
        borderId: parseInt(attr(x, 'borderId', '0'), 10),
        applyFill: attr(x, 'applyFill', '0') === '1',
        numFmtId: parseInt(attr(x, 'numFmtId', '0'), 10),
        halign: al ? al.getAttribute('horizontal') : null,
        valign: al ? al.getAttribute('vertical') : null,
        wrap: al ? al.getAttribute('wrapText') === '1' : false
      });
    }
    return { fills: fills, fonts: fonts, borders: borders, xfs: xfs };
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    var doc = parseXML(xml), out = [];
    var sis = doc.getElementsByTagName('si');
    for (var i = 0; i < sis.length; i++) {
      var ts = sis[i].getElementsByTagName('t'), s = '';
      for (var j = 0; j < ts.length; j++) {
        // ignora los <t> dentro de <rPh> (fonética japonesa)
        if (ts[j].parentNode && ts[j].parentNode.nodeName === 'rPh') continue;
        s += ts[j].textContent;
      }
      out.push(s);
    }
    return out;
  }

  // fecha serial de Excel -> texto dd-mm-aaaa
  function excelDate(n) {
    var ms = Math.round((n - 25569) * 86400 * 1000);
    var d = new Date(ms);
    if (isNaN(d.getTime())) return String(n);
    var p = function (v) { return v < 10 ? '0' + v : String(v); };
    return p(d.getUTCDate()) + '-' + p(d.getUTCMonth() + 1) + '-' + d.getUTCFullYear();
  }

  function parseSheet(xml, shared, styles) {
    var doc = parseXML(xml);
    var cols = [], rows = [], merges = [];

    var colEls = doc.getElementsByTagName('col');
    for (var i = 0; i < colEls.length; i++) {
      cols.push({
        min: parseInt(attr(colEls[i], 'min', '1'), 10),
        max: parseInt(attr(colEls[i], 'max', '1'), 10),
        width: parseFloat(attr(colEls[i], 'width', '8.43')),
        hidden: attr(colEls[i], 'hidden', '0') === '1'
      });
    }

    var mergeEls = doc.getElementsByTagName('mergeCell');
    for (var mm = 0; mm < mergeEls.length; mm++) {
      var ref = attr(mergeEls[mm], 'ref', '');
      var parts = ref.split(':');
      if (parts.length !== 2) continue;
      merges.push({
        r1: rowOfRef(parts[0]), c1: colLetterToIndex(parts[0]),
        r2: rowOfRef(parts[1]), c2: colLetterToIndex(parts[1])
      });
    }

    var rowEls = doc.getElementsByTagName('row');
    for (var r = 0; r < rowEls.length; r++) {
      var rEl = rowEls[r];
      var row = {
        n: parseInt(attr(rEl, 'r', String(r + 1)), 10),
        h: rEl.getAttribute('ht') ? parseFloat(rEl.getAttribute('ht')) : null,
        hidden: attr(rEl, 'hidden', '0') === '1',
        cells: []
      };
      var cEls = rEl.getElementsByTagName('c');
      for (var c = 0; c < cEls.length; c++) {
        var cEl = cEls[c];
        var t = cEl.getAttribute('t');
        var v = '';
        if (t === 'inlineStr') {
          var isEl = cEl.getElementsByTagName('is')[0];
          if (isEl) {
            var tt = isEl.getElementsByTagName('t');
            for (var q = 0; q < tt.length; q++) v += tt[q].textContent;
          }
        } else {
          var vEl = cEl.getElementsByTagName('v')[0];
          var raw = vEl ? vEl.textContent : '';
          if (t === 's') v = shared[parseInt(raw, 10)] || '';
          else if (raw !== '') {
            var num = parseFloat(raw);
            var xf = styles.xfs[parseInt(attr(cEl, 's', '0'), 10)];
            var fmt = xf ? xf.numFmtId : 0;
            var isDate = (fmt >= 14 && fmt <= 22) || (fmt >= 165 && fmt <= 180);
            if (!isNaN(num) && isDate && num > 20000) v = excelDate(num);
            else if (!isNaN(num)) v = (num === Math.round(num)) ? String(Math.round(num)) : String(num);
            else v = raw;
          }
        }
        row.cells.push({
          c: colLetterToIndex(attr(cEl, 'r', 'A1')),
          s: parseInt(attr(cEl, 's', '0'), 10),
          v: v
        });
      }
      rows.push(row);
    }
    return { cols: cols, rows: rows, merges: merges };
  }

  // ---------- render ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function borderCss(side) {
    if (!side || !side.style) return '0';
    return (BSTYLE[side.style] || '1px solid') + ' ' + (side.color || '#000');
  }

  function styleFor(sIdx, styles) {
    var xf = styles.xfs[sIdx];
    if (!xf) return '';
    var out = [];
    var fill = styles.fills[xf.fillId];
    if (fill && fill.type === 'solid' && fill.color && fill.color.toUpperCase() !== '#FFFFFF') {
      out.push('background:' + fill.color);
    }
    var f = styles.fonts[xf.fontId];
    if (f) {
      if (f.b) out.push('font-weight:700');
      if (f.i) out.push('font-style:italic');
      if (f.u) out.push('text-decoration:underline');
      if (f.sz) out.push('font-size:' + Math.round(f.sz) + 'px');
      if (f.name) out.push("font-family:'" + f.name + "',Calibri,sans-serif");
      if (f.color) out.push('color:' + f.color);
    }
    var b = styles.borders[xf.borderId];
    if (b) {
      out.push('border-top:' + borderCss(b.top));
      out.push('border-bottom:' + borderCss(b.bottom));
      out.push('border-left:' + borderCss(b.left));
      out.push('border-right:' + borderCss(b.right));
    }
    if (xf.halign) out.push('text-align:' + ({ center: 'center', right: 'right', left: 'left' }[xf.halign] || 'left'));
    if (xf.valign) out.push('vertical-align:' + ({ center: 'middle', top: 'top', bottom: 'bottom' }[xf.valign] || 'middle'));
    if (xf.wrap) out.push('white-space:normal');
    return out.join(';');
  }

  function renderSheet(name) {
    if (!wb || !wb.sheets[name]) return '<p class="gp-empty">No se encontró la hoja.</p>';
    var sh = wb.sheets[name], styles = wb.styles;

    // ancho por columna
    var widths = {};
    var maxCol = 1;
    sh.cols.forEach(function (c) {
      for (var i = c.min; i <= c.max; i++) widths[i] = c.hidden ? 0 : Math.max(8, Math.round(c.width * 7.5));
    });
    sh.rows.forEach(function (r) {
      r.cells.forEach(function (c) { if (c.c > maxCol) maxCol = c.c; });
    });

    // celdas cubiertas por merges
    var skip = {}, span = {};
    sh.merges.forEach(function (m) {
      span[m.r1 + ':' + m.c1] = { rs: m.r2 - m.r1 + 1, cs: m.c2 - m.c1 + 1 };
      for (var r = m.r1; r <= m.r2; r++)
        for (var c = m.c1; c <= m.c2; c++)
          if (!(r === m.r1 && c === m.c1)) skip[r + ':' + c] = true;
    });

    var cls = {}, css = [], html = [];
    function classOf(sIdx) {
      var key = styleFor(sIdx, styles);
      if (!key) return '';
      // el selector incluye .hx-table td para ganarle a la regla base de la app
      if (!cls[key]) { cls[key] = 'hx' + css.length; css.push('.hx-table td.' + cls[key] + '{' + key + '}'); }
      return cls[key];
    }

    html.push('<colgroup>');
    for (var i = 1; i <= maxCol; i++) html.push('<col style="width:' + (widths[i] === undefined ? 64 : widths[i]) + 'px">');
    html.push('</colgroup>');

    sh.rows.forEach(function (row) {
      if (row.hidden) return;
      var byCol = {};
      row.cells.forEach(function (c) { byCol[c.c] = c; });
      var h = row.h ? Math.round(row.h * 1.34) : 22;
      html.push('<tr style="height:' + h + 'px">');
      for (var c = 1; c <= maxCol; c++) {
        if (skip[row.n + ':' + c]) continue;
        var cell = byCol[c] || { s: 0, v: '' };
        var sp = span[row.n + ':' + c];
        var attrs = '';
        if (sp) {
          if (sp.rs > 1) attrs += ' rowspan="' + sp.rs + '"';
          if (sp.cs > 1) attrs += ' colspan="' + sp.cs + '"';
        }
        var k = classOf(cell.s);
        html.push('<td' + attrs + (k ? ' class="' + k + '"' : '') + '>' + esc(cell.v) + '</td>');
      }
      html.push('</tr>');
    });

    return '<style>' + css.join('') + '</style><div class="hx-scroll"><table class="hx-table">' + html.join('') + '</table></div>';
  }

  // ---------- carga ----------
  function unzip(buf) {
    var files = global.fflate.unzipSync(new Uint8Array(buf));
    var out = {};
    var dec = new TextDecoder('utf-8');
    Object.keys(files).forEach(function (name) {
      out[name] = files[name];
    });
    out.__text = function (name) {
      return files[name] ? dec.decode(files[name]) : null;
    };
    return out;
  }

  function parseWorkbook(buf) {
    var z = unzip(buf);
    var theme = parseTheme(z.__text('xl/theme/theme1.xml'));
    var styles = parseStyles(z.__text('xl/styles.xml'), theme);
    var shared = parseSharedStrings(z.__text('xl/sharedStrings.xml'));

    // nombres de hoja -> archivo
    var wbDoc = parseXML(z.__text('xl/workbook.xml'));
    var relsDoc = parseXML(z.__text('xl/_rels/workbook.xml.rels'));
    var relMap = {};
    var rels = relsDoc.getElementsByTagName('Relationship');
    for (var i = 0; i < rels.length; i++) {
      relMap[rels[i].getAttribute('Id')] = rels[i].getAttribute('Target');
    }
    var sheets = {}, order = [];
    var shEls = wbDoc.getElementsByTagName('sheet');
    for (var j = 0; j < shEls.length; j++) {
      var nm = shEls[j].getAttribute('name');
      var rid = shEls[j].getAttribute('r:id') || shEls[j].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      var target = relMap[rid] || ('worksheets/sheet' + (j + 1) + '.xml');
      if (target.charAt(0) === '/') target = target.substr(1);
      else if (target.indexOf('xl/') !== 0) target = 'xl/' + target;
      var xml = z.__text(target);
      if (!xml) continue;
      sheets[nm] = parseSheet(xml, shared, styles);
      order.push(nm);
    }
    return { sheets: sheets, order: order, styles: styles };
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.at || !o.b64) return null;
      return o;
    } catch (e) { return null; }
  }
  function writeCache(buf) {
    try {
      var bytes = new Uint8Array(buf), bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), b64: btoa(bin) }));
    } catch (e) { /* cuota llena: seguimos sin caché */ }
  }
  function bufFromCache(o) {
    var bin = atob(o.b64), len = bin.length, u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  function load(url, opts) {
    opts = opts || {};
    var cached = opts.force ? null : readCache();
    if (cached && (Date.now() - cached.at) < CACHE_TTL_MS && !opts.force) {
      try {
        wb = parseWorkbook(bufFromCache(cached));
        meta = { fetchedAt: cached.at, bytes: cached.b64.length * 0.75, fromCache: true };
        return Promise.resolve(wb);
      } catch (e) { /* caché corrupta: bajamos de nuevo */ }
    }
    return fetch(url, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        wb = parseWorkbook(buf);
        meta = { fetchedAt: Date.now(), bytes: buf.byteLength, fromCache: false };
        writeCache(buf);
        return wb;
      })
      .catch(function (err) {
        // sin red: intentamos con lo último que tengamos guardado
        var c = readCache();
        if (c) {
          wb = parseWorkbook(bufFromCache(c));
          meta = { fetchedAt: c.at, bytes: 0, fromCache: true, stale: true };
          return wb;
        }
        throw err;
      });
  }

  function forget() {
    wb = null;
    meta = { fetchedAt: 0, bytes: 0 };
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  global.HorarioXLSX = {
    load: load,
    forget: forget,
    renderSheet: renderSheet,
    sheetNames: function () { return wb ? wb.order.slice() : []; },
    meta: function () { return meta; },
    isLoaded: function () { return !!wb; }
  };
})(window);

/* Pilot portal: login per pilot, per-pilot drafts, migration of the old single draft,
   and the remote on/off switch read from status.json (edited by the owner on GitHub). */
(function () {
  'use strict';

  var PILOTS = [
    { id: 'imad', name: 'IMAD OUATTAB', hash: 'fe9914538cd4ffc2a6222b0044177a498578346704bf5899e4f7c832678115ef' },
    { id: 'abdelfattah', name: 'ABDELFATTAH OUATTAB', hash: 'e0329e51253c209832ed92389061f9b5c28f682a20cb7a13a7878227c9d2786a' },
    { id: 'marouane', name: 'MAROUANE BEN MBAREK', hash: '71456c32607a138fbeec3733f70613d1ba136acda2f469f9e720c16dc456281a' },
    { id: 'mohammed', name: 'MOHAMMED BERGHACH', hash: '9755c09f7b9169e4e69c574013c47be75f3c585a96ab58f64fff2ffeef277bcc' }
  ];
  var OLD_DRAFT = 'tbm-report-draft-v1';       // single draft used before the portal existed
  var MIGRATED = 'tbm-migrated-v1';
  var SESSION = 'tbm-session-v1';
  var LAST_STATUS = 'tbm-status-v1';
  var SESSION_HOURS = 14;
  var CHECK_EVERY_MS = 3 * 60 * 1000;

  function draftKey(id) { return 'tbm-draft-v2:' + id; }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pilotById(id) { for (var i = 0; i < PILOTS.length; i++) if (PILOTS[i].id === id) return PILOTS[i]; return null; }

  /* ---------- 1. keep the draft written before the portal existed ---------- */
  function matchPilot(name) {
    var n = String(name || '').toUpperCase();
    if (/ABDELFATTAH|ABDELFATAH/.test(n)) return 'abdelfattah';
    if (/MAROUANE|MARWANE|MBAREK/.test(n)) return 'marouane';
    if (/MOHAMM?ED|BERGHACH/.test(n)) return 'mohammed';
    return 'imad';
  }
  function migrateOldDraft() {
    var raw = get(OLD_DRAFT);
    if (!raw) return;
    var flag = null;
    try { flag = JSON.parse(get(MIGRATED) || 'null'); } catch (e) { flag = null; }
    if (!flag) {
      var target = 'imad';
      try { target = matchPilot(JSON.parse(raw).state.f.piloto); } catch (e) { /* keep imad */ }
      var existing = get(draftKey(target));
      if (existing == null) put(draftKey(target), raw);
      put(MIGRATED, JSON.stringify({ to: target, src: raw, dst: existing == null ? raw : existing }));
      return;
    }
    // an old tab kept writing after migration: carry that over if the pilot has not edited since
    if (flag.src !== raw && get(draftKey(flag.to)) === flag.dst) {
      put(draftKey(flag.to), raw);
      put(MIGRATED, JSON.stringify({ to: flag.to, src: raw, dst: raw }));
    }
    // the old draft itself is never deleted: it stays as a backup
  }

  /* ---------- 2. remote switch ---------- */
  function parseStatus(text) {
    try {
      var s = JSON.parse(text);
      return { active: s.active !== false, pilots: s.pilots || {}, es: s.mensaje || s.message_es || '', en: s.message || s.message_en || '' };
    } catch (e) {
      // a typo in the file must not stop an intended shutdown
      if (/"active"\s*:\s*false/i.test(text)) return { active: false, pilots: {}, es: '', en: '' };
      return null;
    }
  }
  function lastStatus() {
    try { return JSON.parse(get(LAST_STATUS) || 'null'); } catch (e) { return null; }
  }
  function fetchStatus() {
    if (location.protocol === 'file:') return Promise.resolve(lastStatus());
    return fetch('status.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      var s = parseStatus(t);
      if (s) put(LAST_STATUS, JSON.stringify(s));
      return s || lastStatus();
    }).catch(function () { return lastStatus(); });   // offline: use the last known answer
  }
  function allowed(s, pilotId) {
    if (!s) return true;
    if (!s.active) return false;
    return !(pilotId && s.pilots && s.pilots[pilotId] === false);
  }

  /* ---------- 3. password check ---------- */
  function sha256Hex(str) {
    var data = new TextEncoder().encode(str);
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest('SHA-256', data).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    return Promise.resolve(sha256Fallback(data));
  }
  function sha256Fallback(bytes) {
    var K = [], H = [], i, j;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
    for (var n = 2, c = 0; c < 64; n++) {
      var prime = true;
      for (j = 2; j * j <= n; j++) if (n % j === 0) { prime = false; break; }
      if (prime) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); K[c++] = frac(Math.pow(n, 1 / 3)); }
    }
    var l = bytes.length, words = [];
    for (i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    var nw = (((l + 8) >> 6) + 1) * 16;
    words[nw - 1] = l * 8;
    for (i = 0; i < nw; i++) words[i] = words[i] | 0;
    function rot(x, s) { return (x >>> s) | (x << (32 - s)); }
    for (i = 0; i < nw; i += 16) {
      var w = words.slice(i, i + 16), a = H.slice(0);
      for (j = 0; j < 64; j++) {
        if (j >= 16) {
          var w15 = w[j - 15], w2 = w[j - 2];
          w[j] = (w[j - 16] + (rot(w15, 7) ^ rot(w15, 18) ^ (w15 >>> 3)) + w[j - 7] + (rot(w2, 17) ^ rot(w2, 19) ^ (w2 >>> 10))) | 0;
        }
        var t1 = (a[7] + (rot(a[4], 6) ^ rot(a[4], 11) ^ rot(a[4], 25)) + ((a[4] & a[5]) ^ (~a[4] & a[6])) + K[j] + w[j]) | 0;
        var t2 = ((rot(a[0], 2) ^ rot(a[0], 13) ^ rot(a[0], 22)) + ((a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]))) | 0;
        a = [(t1 + t2) | 0].concat(a.slice(0, 7)); a[4] = (a[4] + t1) | 0;
      }
      for (j = 0; j < 8; j++) H[j] = (H[j] + a[j]) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ---------- 4. screens ---------- */
  var current = null, timer = null;

  function showOnly(id) {
    ['#login', '#blocked', '#app'].forEach(function (s) { var e = $(s); if (e) e.hidden = (s !== id); });
  }
  function showBlocked(s) {
    $('#blockedMsg').innerHTML = esc(s && s.es || 'La aplicación ha sido desactivada por el responsable.') +
      '<small>' + esc(s && s.en || 'The app has been switched off by the manager.') + '</small>';
    showOnly('#blocked');
  }
  function renderLogin(msg) {
    var h = PILOTS.map(function (p) {
      return '<button type="button" class="pilot" data-pilot="' + p.id + '"><span class="ini">' + esc(p.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' + esc(p.name) + '</button>';
    }).join('');
    $('#pilots').innerHTML = h;
    $('#pilots').hidden = false;
    $('#pinBox').hidden = true;
    $('#loginMsg').innerHTML = msg || '';
    showOnly('#login');
  }
  function askPin(id) {
    var p = pilotById(id);
    $('#pinWho').textContent = p.name;
    $('#pinBox').hidden = false;
    $('#pilots').hidden = true;
    $('#loginMsg').textContent = '';
    var inp = $('#pin'); inp.value = ''; inp.dataset.pilot = id;
    setTimeout(function () { inp.focus(); }, 50);
  }
  function tryPin() {
    var inp = $('#pin'), id = inp.dataset.pilot, p = pilotById(id), pin = inp.value.replace(/\D/g, '');
    if (!p) return;
    sha256Hex('tbm|' + id + '|' + pin).then(function (h) {
      if (h !== p.hash) {
        inp.value = '';
        $('#loginMsg').innerHTML = '<b class="err">Contraseña incorrecta<small>Wrong password</small></b>';
        inp.focus();
        return;
      }
      if (!allowed(lastStatus(), id)) { renderLogin('<b class="err">Acceso desactivado para este piloto<small>Access switched off for this pilot</small></b>'); return; }
      put(SESSION, JSON.stringify({ id: id, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
      enter(p);
    });
  }
  function sessionPilot() {
    try {
      var s = JSON.parse(get(SESSION) || 'null');
      if (s && s.exp > Date.now()) return pilotById(s.id);
    } catch (e) { /* none */ }
    return null;
  }
  function enter(p) {
    current = p;
    showOnly('#app');
    window.TBMApp.start({ id: p.id, name: p.name, key: draftKey(p.id) });
  }
  function logout() {
    if (window.TBMApp && window.TBMApp.flush) window.TBMApp.flush();
    del(SESSION);
    location.reload();
  }

  function apply(s) {
    if (!s) return;
    if (!s.active) { if (window.TBMApp && window.TBMApp.flush) window.TBMApp.flush(); showBlocked(s); return; }
    if (current && !allowed(s, current.id)) {
      if (window.TBMApp && window.TBMApp.flush) window.TBMApp.flush();
      del(SESSION);
      location.reload();
      return;
    }
    if (!$('#blocked').hidden) {
      if (current) { showOnly('#app'); return; }
      var p = sessionPilot();
      if (p && allowed(s, p.id)) enter(p);
      else { if (p) del(SESSION); renderLogin(); }
    }
  }
  function check() { return fetchStatus().then(apply); }

  /* ---------- 5. boot ---------- */
  function boot() {
    if (window.TBMAndroid) document.documentElement.classList.add('in-app');
    migrateOldDraft();
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pilot]');
      if (b) { askPin(b.dataset.pilot); return; }
      if (e.target.closest('#pinBack')) { renderLogin(); return; }
      if (e.target.closest('#pinGo')) { tryPin(); return; }
      if (e.target.closest('#btnLogout')) { logout(); }
    });
    $('#pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryPin(); });
    $('#pin').addEventListener('input', function () { if (this.value.replace(/\D/g, '').length === 6) tryPin(); });

    var known = lastStatus();
    if (known && !known.active) showBlocked(known);
    else {
      var p = sessionPilot();
      if (p && allowed(known, p.id)) enter(p); else renderLogin();
    }
    check();
    timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    window.addEventListener('online', check);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
    }
  }

  window.TBMPortal = { recheck: check, pilots: PILOTS, migrateOldDraft: migrateOldDraft, sha256Fallback: sha256Fallback };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

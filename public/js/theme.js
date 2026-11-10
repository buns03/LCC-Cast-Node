/* LCCAST — theme + accent (runs in <head>, before first paint) */
(function () {
  "use strict";
  var KEY = "lccast.theme", DEFAULT = "#5B5CEB", HEX = /^#[0-9a-f]{6}$/i;
  var root = document.documentElement;
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  function clean(o) {
    o = o || {};
    return {
      mode: ["light", "dark", "system"].indexOf(o.mode) > -1 ? o.mode : "system",
      accent: HEX.test(o.accent || "") ? o.accent.toUpperCase() : null,
    };
  }
  function read() { try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return clean(); } }
  function same(a, b) { return a.mode === b.mode && a.accent === b.accent; }

  var saved = read();
  var current = saved;

  /* ---------- color math ---------- */
  function toRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function toHex(r) { return "#" + r.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }).join("").toUpperCase(); }
  function lum(r) {
    var a = r.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function rgb2hsl(r) {
    var R = r[0] / 255, G = r[1] / 255, B = r[2] / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    var l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (!s) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  function mix(a, b, t) { return a.map(function (v, i) { return v * (1 - t) + b[i] * t; }); }

  /* keep the accent readable: white text on it (light) / visible against dark surfaces (dark) */
  function fit(hex, dark) {
    var min = dark ? 0.17 : 0, max = dark ? 0.30 : 0.18;
    var hsl = rgb2hsl(toRgb(hex)), i = 0;
    while (i++ < 80) {
      var L = lum(hsl2rgb(hsl[0], hsl[1], hsl[2]));
      if (L > max) hsl[2] -= 0.01; else if (L < min) hsl[2] += 0.01; else break;
      hsl[2] = Math.max(0, Math.min(1, hsl[2]));
    }
    return toHex(hsl2rgb(hsl[0], hsl[1], hsl[2]));
  }

  function resolved(mode) { return mode === "system" ? (mq.matches ? "dark" : "light") : mode; }

  function apply() {
    var theme = resolved(current.mode), dark = theme === "dark";
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-mode", current.mode);
    root.style.colorScheme = theme;

    var p = fit(current.accent || DEFAULT, dark), rgb = toRgb(p);
    var hover = toHex(mix(rgb, dark ? [255, 255, 255] : [0, 0, 0], 0.12));
    var base = dark ? [23, 27, 44] : [255, 255, 255];
    var s = root.style;
    s.setProperty("--primary", p);
    s.setProperty("--primary-hover", hover);
    s.setProperty("--primary-rgb", rgb.join(","));
    s.setProperty("--primary-soft", toHex(mix(base, rgb, dark ? 0.22 : 0.10)));
    s.setProperty("--primary-soft-2", toHex(mix(base, rgb, dark ? 0.32 : 0.18)));

    if (window.Chart && window.Chart.defaults) {           // charts follow the theme
      window.Chart.defaults.color = dark ? "#A2AAC2" : "#64748B";
      window.Chart.defaults.borderColor = dark ? "#2A3047" : "#E8EAF2";
    }
    window.dispatchEvent(new CustomEvent("lccast-themechange", { detail: { theme: theme } }));
  }

  mq.addEventListener && mq.addEventListener("change", function () { if (current.mode === "system") apply(); });
  apply();

  /* ---------- public API (used by the Appearance tab) ---------- */
  window.LCCTheme = {
    get: function () { return { saved: saved, current: current }; },
    adjusted: function (accent) { return fit(accent || DEFAULT, resolved(current.mode) === "dark"); },
    preview: function (mode, accent) {
      root.classList.add("theme-anim");
      current = clean({ mode: mode, accent: accent });
      apply();
      setTimeout(function () { root.classList.remove("theme-anim"); }, 300);
    },
    save: function (mode, accent) {
      var next = clean({ mode: mode, accent: accent });
      return fetch("/api/preferences", {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeMode: next.mode, accentColor: next.accent }),
      }).then(function (r) {
        if (!r.ok) return false;
        saved = current = next;
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
        return true;
      }).catch(function () { return false; });
    },
    revert: function () { current = saved; apply(); },
  };

  /* ---------- load the account's saved preference (skips the login pages) ---------- */
  if (!/^\/(login|forgot-password)/.test(location.pathname)) {
    fetch("/api/preferences", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok && (r.headers.get("content-type") || "").indexOf("json") > -1 ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var next = clean({ mode: j.themeMode, accent: j.accentColor });
        var previewing = !same(current, saved);
        saved = next;
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
        if (!previewing) current = next;
        apply();
        window.dispatchEvent(new CustomEvent("lccast-theme-sync"));
      })
      .catch(function () {});
  }
})();
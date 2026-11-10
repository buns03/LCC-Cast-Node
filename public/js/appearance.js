/* LCCAST — Appearance tab (all roles) */
(function () {
  var DEFAULT = "#5B5CEB";
  var PRESETS = [["Indigo", "#5B5CEB"], ["Blue", "#2563EB"], ["Teal", "#0D9488"], ["Green", "#16A34A"],
                 ["Orange", "#EA580C"], ["Rose", "#E11D48"], ["Purple", "#9333EA"], ["Slate", "#475569"]];
  var MODES = [["light", "Light", "bi-sun", "Bright surfaces"],
               ["dark", "Dark", "bi-moon-stars", "Soft, low glare"],
               ["system", "System", "bi-circle-half", "Matches your device"]];
  var HEX = /^#[0-9a-f]{6}$/i;

  document.addEventListener("DOMContentLoaded", function () {
    // tab switching for pages that don't already have the superadmin tab system
    var tabs = document.querySelectorAll(".ap-tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.toggle("active", x === t); });
        document.querySelectorAll(".voter-settings-content > .settings-panel").forEach(function (p) {
          p.classList.toggle("active", p.id === t.dataset.apTarget);
        });
      });
    });

    var mount = document.getElementById("appearanceMount");
    if (mount && window.LCCTheme) render(mount);
  });

  function render(m) {
    var s = LCCTheme.get().saved;
    var cur = { mode: s.mode, accent: s.accent };

    m.innerHTML =
      '<div class="settings-card">' +
        '<div class="settings-card-header"><h2><i class="bi bi-palette"></i> Appearance</h2>' +
        '<p>Choose how LCC Cast looks. Your choice is saved to your account.</p></div>' +
        '<div class="ap-body">' +
          '<div class="ap-section"><h3 class="ap-title">Theme</h3>' +
            '<p class="ap-sub">System follows your device and switches automatically.</p>' +
            '<div class="ap-modes">' + MODES.map(function (x) {
              return '<button type="button" class="ap-mode" data-mode="' + x[0] + '"><i class="bi ' + x[2] + '"></i>' +
                     x[1] + '<small>' + x[3] + '</small></button>';
            }).join("") + '</div></div>' +
          '<div class="ap-section"><h3 class="ap-title">Accent color</h3>' +
            '<p class="ap-sub">Changes buttons, active tabs and highlights. Backgrounds stay the same.</p>' +
            '<div class="ap-swatches">' + PRESETS.map(function (p) {
              return '<button type="button" class="ap-swatch" data-color="' + p[1] + '" title="' + p[0] +
                     '" style="--sw:' + p[1] + '"><i class="bi bi-check-lg"></i></button>';
            }).join("") + '</div>' +
            '<div class="ap-custom"><label for="apColor">Custom</label>' +
              '<input type="color" id="apColor" value="' + DEFAULT + '">' +
              '<input type="text" id="apHex" maxlength="7" placeholder="#5B5CEB" spellcheck="false"></div>' +
            '<small class="ap-note" id="apNote"></small>' +
            '<div class="ap-preview"><button type="button" class="ap-preview-btn" tabindex="-1">Primary button</button>' +
              '<span class="ap-preview-chip">Highlight</span><span class="ap-preview-link">Link text</span></div>' +
          '</div>' +
          '<div class="settings-form-actions">' +
            '<button type="button" class="discard-btn" id="apReset"><i class="bi bi-arrow-counterclockwise"></i> Reset to default</button>' +
            '<button type="button" class="save-btn" id="apSave"><i class="bi bi-check-lg"></i> Save appearance</button>' +
          '</div>' +
          '<div class="ap-status" id="apStatus"></div>' +
        '</div></div>';

    var $ = function (id) { return document.getElementById(id); };

    function mark(preview) {
      m.querySelectorAll(".ap-mode").forEach(function (b) { b.classList.toggle("active", b.dataset.mode === cur.mode); });
      var a = (cur.accent || DEFAULT).toUpperCase();
      m.querySelectorAll(".ap-swatch").forEach(function (b) { b.classList.toggle("active", b.dataset.color === a); });
      $("apColor").value = a.toLowerCase();
      if (document.activeElement !== $("apHex")) $("apHex").value = a;
      if (preview) LCCTheme.preview(cur.mode, cur.accent);
      var shown = LCCTheme.adjusted(cur.accent);
      $("apNote").textContent = shown.toUpperCase() !== a
        ? "Adjusted slightly so text stays readable in " + (document.documentElement.dataset.theme || "this") + " mode."
        : "";
    }

    m.addEventListener("click", function (e) {
      var mode = e.target.closest("[data-mode]"), sw = e.target.closest("[data-color]");
      if (mode) { cur.mode = mode.dataset.mode; mark(true); }
      if (sw) { cur.accent = sw.dataset.color === DEFAULT ? null : sw.dataset.color; mark(true); }
    });
    $("apColor").addEventListener("input", function () { cur.accent = this.value.toUpperCase(); mark(true); });
    $("apHex").addEventListener("input", function () {
      var v = this.value.trim(); if (v[0] !== "#") v = "#" + v;
      if (HEX.test(v)) { cur.accent = v.toUpperCase(); mark(true); }
    });
    $("apReset").addEventListener("click", function () { cur = { mode: "system", accent: null }; $("apStatus").textContent = ""; mark(true); });
    $("apSave").addEventListener("click", function () {
      var st = $("apStatus"); st.className = "ap-status"; st.textContent = "Saving...";
      LCCTheme.save(cur.mode, cur.accent).then(function (ok) {
        st.className = "ap-status " + (ok ? "ok" : "err");
        st.textContent = ok ? "Appearance saved. It will follow you on every device." : "Could not save. Please try again.";
      });
    });

    // account preference finished loading after the panel rendered
    window.addEventListener("lccast-theme-sync", function () {
      var sv = LCCTheme.get().saved; cur = { mode: sv.mode, accent: sv.accent }; mark(false);
    });
    mark(false);
  }
})();
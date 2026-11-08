/* =========================================================
   LCCAST - DOCUMENT PREVIEW RATIO
   Background / Campaign previews adapt to:
   8.5x11, 4:3, 8.5x14 (portrait or landscape)
========================================================= */

(function () {
  const PRESETS = [
    { ratio: 8.5 / 14, label: "8.5×14 · Portrait" },
    { ratio: 8.5 / 11, label: "8.5×11 · Portrait" },
    { ratio: 3 / 4,    label: "4:3 · Portrait" },
    { ratio: 4 / 3,    label: "4:3 · Landscape" },
    { ratio: 11 / 8.5, label: "8.5×11 · Landscape" },
    { ratio: 14 / 8.5, label: "8.5×14 · Landscape" },
  ];

  const DEFAULT_PRESET = PRESETS[1]; // 8.5x11 portrait

  function nearestPreset(ratio) {
    if (!ratio || !isFinite(ratio)) return DEFAULT_PRESET;

    let best = PRESETS[0];
    let bestDiff = Infinity;

    PRESETS.forEach(preset => {
      const diff = Math.abs(Math.log(ratio / preset.ratio));
      if (diff < bestDiff) {
        best = preset;
        bestDiff = diff;
      }
    });

    return best;
  }

  function setPreset(preview, body, preset) {
    body.style.setProperty("--fp-ratio", preset.ratio.toFixed(4));
    body.dataset.orientation = preset.ratio < 1 ? "portrait" : "landscape";

    const tag = preview.querySelector(".doc-ratio-tag");
    if (tag) tag.textContent = preset.label;
  }

  // Re-place the popup after the ratio changes (its height changed)
  function reposition(preview, type) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!preview.isConnected) return;

        const row = preview.closest(".member-row");

        if (row && typeof positionMemberFilePreview === "function") {
          positionMemberFilePreview(row, preview, type);
          return;
        }

        // "existing member" preview lives on <body>: keep it inside the viewport
        const rect = preview.getBoundingClientRect();
        const gap = 12;

        let top = rect.top;
        let left = rect.left;

        if (top + rect.height > window.innerHeight - gap) {
          top = window.innerHeight - rect.height - gap;
        }
        if (left + rect.width > window.innerWidth - gap) {
          left = window.innerWidth - rect.width - gap;
        }

        preview.style.setProperty("top", `${Math.max(gap, top)}px`, "important");
        preview.style.setProperty("left", `${Math.max(gap, left)}px`, "important");
      });
    });
  }

  function ratioFromImage(img, done) {
    const run = () => done(img.naturalWidth / img.naturalHeight);

    if (img.complete && img.naturalWidth) {
      run();
    } else {
      img.addEventListener("load", run, { once: true });
    }
  }

  async function ratioFromPdf(src, done) {
    try {
      if (!src || typeof pdfjsLib === "undefined") return;

      const pdf = await pdfjsLib.getDocument({ url: src }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });

      done(viewport.width / viewport.height);
      pdf.destroy();
    } catch (error) {
      console.warn("Could not read PDF page size, using 8.5x11:", error);
    }
  }

  window.applyDocumentPreviewRatio = function (preview, type) {
    if (!preview) return;
    if (type !== "campaign" && type !== "background") return;

    const body = preview.querySelector(".file-preview-body");
    if (!body) return;

    preview.classList.add("doc-popover");
    body.classList.add("doc-preview");

    const header = preview.querySelector(".file-preview-header");

    if (header && !header.querySelector(".doc-ratio-tag")) {
      const tag = document.createElement("span");
      tag.className = "doc-ratio-tag";
      header.insertBefore(tag, header.querySelector(".file-preview-close"));
    }

    setPreset(preview, body, DEFAULT_PRESET);

    const apply = ratio => {
      if (!body.isConnected) return;
      setPreset(preview, body, nearestPreset(ratio));
      reposition(preview, type);
    };

    const img = body.querySelector("img");
    const frame = body.querySelector("iframe");

    if (img) {
      ratioFromImage(img, apply);
    } else if (frame) {
      ratioFromPdf(frame.getAttribute("src"), apply);
    }
  };
})();
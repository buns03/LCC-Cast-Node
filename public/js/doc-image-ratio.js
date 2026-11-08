/* =========================================================
   LCCAST - DOCUMENT IMAGE RATIO (voter + candidate)
   Snaps a frame to: 8.5x14 / 8.5x11 / 4:3, portrait or landscape
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
  const DEFAULT_PRESET = PRESETS[1];

  function nearestPreset(ratio) {
    if (!ratio || !isFinite(ratio)) return DEFAULT_PRESET;
    let best = PRESETS[0], bestDiff = Infinity;
    PRESETS.forEach((p) => {
      const diff = Math.abs(Math.log(ratio / p.ratio));
      if (diff < bestDiff) { best = p; bestDiff = diff; }
    });
    return best;
  }

  function setPreset(frame, preset) {
    frame.style.setProperty("--fp-ratio", preset.ratio.toFixed(4));
    frame.dataset.orientation = preset.ratio < 1 ? "portrait" : "landscape";
    frame.dataset.format = preset.label;
  }

  /*
   * Call ONCE per frame/img pair. It re-adapts automatically
   * every time img.src changes (modal reuse, re-upload).
   */
  window.applyDocImageRatio = function (frame, img) {
    if (!frame || !img || img._docRatioBound) return;
    img._docRatioBound = true;

    frame.classList.add("doc-ratio-frame");
    setPreset(frame, DEFAULT_PRESET);

    const run = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      setPreset(frame, nearestPreset(img.naturalWidth / img.naturalHeight));
    };

    img.addEventListener("load", run);
    if (img.complete && img.naturalWidth) run();
  };
})();
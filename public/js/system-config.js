/* LCCAST — campus / program lists, read from the database */
window.SystemConfig = (function () {
  let data = { campuses: [], programs: [] };
  let loaded = false;
  let inflight = null;

  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  async function load(force = false) {
    if (loaded && !force) return data;
    if (inflight && !force) return inflight;
    inflight = fetch("/api/config/options", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load campuses and programs.");
        data = await res.json();
        loaded = true;
        return data;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  const campuses = () => data.campuses;
  const programs = () => data.programs;
  const lower = (v) => String(v ?? "").trim().toLowerCase();

  const campusById = (id) => data.campuses.find((c) => c.id === id) || null;
  const campusByName = (name) => data.campuses.find((c) => lower(c.name) === lower(name)) || null;

  // ref can be a campus id or a campus name; unknown/empty = every program
  function programsForCampus(ref) {
    const c = campusById(ref) || campusByName(ref);
    if (!c) return data.programs;
    const ids = new Set(c.programIds);
    return data.programs.filter((p) => ids.has(p.id));
  }

  const programLabel = (p) => `${p.acronym} — ${p.fullName}`;

  // <option> list only (callers add their own placeholder option)
  function campusOptionsHtml({ selected = "", valueKey = "name" } = {}) {
    const sel = lower(selected);
    return data.campuses
      .map((c) => {
        const value = valueKey === "id" ? c.id : c.name;
        return `<option value="${esc(value)}"${sel && lower(value) === sel ? " selected" : ""}>${esc(c.name)}</option>`;
      })
      .join("");
  }

  function programOptionsHtml({ campus = null, selected = "" } = {}) {
    let list = campus ? programsForCampus(campus) : data.programs;
    const sel = String(selected || "").toUpperCase();
    let html = list
      .map((p) => `<option value="${esc(p.acronym)}"${sel === p.acronym.toUpperCase() ? " selected" : ""}>${esc(programLabel(p))}</option>`)
      .join("");
    // keep a saved value visible even if this campus no longer offers it
    if (sel && !list.some((p) => p.acronym.toUpperCase() === sel)) {
      html += `<option value="${esc(selected)}" selected>${esc(selected)}</option>`;
    }
    return html;
  }
    // same key analyticsService.ts builds for a campus: lowercase, spaces become hyphens
  const campusKey = (name) => String(name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const campusIdOf = (ref) => (campusById(ref) || campusByName(ref))?.id || ref;
  const campusNameOf = (id) => campusById(id)?.name || "";

  return { load, campuses, programs, campusById, campusByName, programsForCampus, programLabel, campusOptionsHtml, programOptionsHtml, esc, campusKey, campusIdOf, campusNameOf };
})();
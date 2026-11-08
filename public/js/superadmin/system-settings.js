/* LCCAST — SYSTEM SETTINGS TAB (campuses, programs, per-campus program lists) */
(function () {
  const API = "/superadmin/api/system-config";
  const $ = (id) => document.getElementById(id);
  const esc = (v) => SystemConfig.esc(v);

  let editingCampusId = null;
  let editingProgramId = null;
  let pendingDelete = null; // { kind: "campus" | "program", id }
  let programsCampus = null; // campus open in the programs modal

  document.addEventListener("DOMContentLoaded", async () => {
    if (!$("systemSettings")) return;
    bindButtons();
    try {
      await SystemConfig.load();
      renderAll();
    } catch (err) {
      console.error(err);
    }
  });

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error((await res.text()) || "Request failed.");
  }

  // reload the lists and refresh every place on this page that uses them
  async function reloadAll() {
    await SystemConfig.load(true);
    renderAll();
    if (typeof fillStaticConfigSelects === "function")
      fillStaticConfigSelects();
    if (typeof fetchAdmins === "function") fetchAdmins();
  }

  function renderAll() {
    renderCampuses();
    renderPrograms();
  }

  function setError(input, message) {
    const group = input.closest(".form-group");
    if (!group) return;
    group.classList.add("has-error");
    const small = group.querySelector(".field-error");
    if (small) small.textContent = message;
  }

  function clearErrors(form) {
    form
      .querySelectorAll(".form-group.has-error")
      .forEach((g) => g.classList.remove("has-error"));
  }

  /* ------------------------------------------------------------ render */

  function renderCampuses() {
    const list = $("campusConfigList");
    if (!list) return;

    const campuses = SystemConfig.campuses();
    const total = SystemConfig.programs().length;

    if (!campuses.length) {
      list.innerHTML = `<div class="config-empty">No campuses yet.</div>`;
      return;
    }

    list.innerHTML = campuses
      .map((c) => {
        const mode = c.customPrograms
          ? `Custom list: ${c.programIds.length} of ${total} programs`
          : `All programs (${total})`;
        return `
          <article class="config-row" data-id="${esc(c.id)}">
            <div class="config-row-main">
              <h3>${esc(c.name)}${c.customPrograms ? ' <span class="config-badge">Custom programs</span>' : ""}</h3>
              <span>${esc(c.description || "No description")}</span>
              <span>${esc(mode)}</span>
            </div>
            <div class="config-row-actions">
              <button type="button" class="admin-icon campus-programs" title="Programs offered"><i class="bi bi-list-check"></i></button>
              <button type="button" class="admin-icon campus-edit" title="Edit campus"><i class="bi bi-pencil"></i></button>
              <button type="button" class="admin-icon delete-admin campus-delete" title="Delete campus"><i class="bi bi-trash"></i></button>
            </div>
          </article>`;
      })
      .join("");
  }

  function renderPrograms() {
    const list = $("programConfigList");
    if (!list) return;

    const programs = SystemConfig.programs();
    if (!programs.length) {
      list.innerHTML = `<div class="config-empty">No programs yet.</div>`;
      return;
    }

    list.innerHTML = programs
      .map(
        (p) => `
          <article class="config-row" data-id="${esc(p.id)}">
            <div class="config-row-main">
              <h3>${esc(p.acronym)}</h3>
              <span>${esc(p.fullName)}</span>
                            ${p.aliases && p.aliases.length ? `<span>Also counted as: ${esc(p.aliases.join(", "))}</span>` : ""}
            </div>
            <div class="config-row-actions">
              <button type="button" class="admin-icon program-edit" title="Edit program"><i class="bi bi-pencil"></i></button>
              <button type="button" class="admin-icon delete-admin program-delete" title="Delete program"><i class="bi bi-trash"></i></button>
            </div>
          </article>`,
      )
      .join("");
  }

  /* ------------------------------------------------------------ buttons */

  function bindButtons() {
    $("addCampusBtn")?.addEventListener("click", () => openCampusModal(null));
    $("addProgramBtn")?.addEventListener("click", () => openProgramModal(null));

    $("campusModalSave")?.addEventListener("click", saveCampus);
    $("programModalSave")?.addEventListener("click", saveProgram);
    $("campusProgramsSave")?.addEventListener("click", saveCampusPrograms);
    $("configDeleteConfirm")?.addEventListener("click", confirmDelete);

    $("campusForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveCampus();
    });
    $("programForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveProgram();
    });

    $("programAcronymInput")?.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
    $("campusCustomToggle")?.addEventListener("change", syncChecklistState);

    $("campusConfigList")?.addEventListener("click", (e) => {
      const row = e.target.closest(".config-row");
      const btn = e.target.closest("button");
      if (!row || !btn) return;
      const campus = SystemConfig.campusById(row.dataset.id);
      if (!campus) return;

      if (btn.classList.contains("campus-programs")) openCampusPrograms(campus);
      else if (btn.classList.contains("campus-edit")) openCampusModal(campus);
      else if (btn.classList.contains("campus-delete"))
        askDelete("campus", campus.id, campus.name);
    });

    $("programConfigList")?.addEventListener("click", (e) => {
      const row = e.target.closest(".config-row");
      const btn = e.target.closest("button");
      if (!row || !btn) return;
      const program = SystemConfig.programs().find(
        (p) => p.id === row.dataset.id,
      );
      if (!program) return;

      if (btn.classList.contains("program-edit")) openProgramModal(program);
      else if (btn.classList.contains("program-delete"))
        askDelete("program", program.id, program.acronym);
    });
  }

  /* ------------------------------------------------------------ campus add / edit */

  function openCampusModal(campus) {
    editingCampusId = campus ? campus.id : null;
    $("campusModalTitle").textContent = campus ? "Edit Campus" : "Add Campus";
    $("campusNameInput").value = campus ? campus.name : "";
    $("campusDescriptionInput").value = campus ? campus.description || "" : "";
    clearErrors($("campusForm"));
    openSettingsModal("campusModal");
  }

  async function saveCampus() {
    const nameEl = $("campusNameInput");
    const name = nameEl.value.trim();
    clearErrors($("campusForm"));
    if (!name) return setError(nameEl, "Campus name is required.");

    const body = {
      name,
      description: $("campusDescriptionInput").value.trim(),
    };
    const editing = editingCampusId;

    closeSettingsModal("campusModal");
    showActionLoading(
      "Saving Campus",
      "Please wait while the campus is being saved...",
    );
    try {
      await api(
        editing ? "PUT" : "POST",
        editing ? `/campuses/${editing}` : "/campuses",
        body,
      );
      await reloadAll();
      showSuccessToast("Campus Saved", "The campus was saved successfully.");
    } catch (err) {
      showSuccessToast(
        "Save Failed",
        err.message || "Could not save the campus.",
      );
    } finally {
      hideActionLoading();
    }
  }

  /* ------------------------------------------------------------ program add / edit */

  function openProgramModal(program) {
    editingProgramId = program ? program.id : null;
    $("programModalTitle").textContent = program
      ? "Edit Program"
      : "Add Program";
    $("programAcronymInput").value = program ? program.acronym : "";
    $("programFullNameInput").value = program ? program.fullName : "";
    $("programAliasesInput").value = program
      ? (program.aliases || []).join(", ")
      : "";
    clearErrors($("programForm"));
    openSettingsModal("programModal");
  }

  async function saveProgram() {
    const acronymEl = $("programAcronymInput");
    const fullNameEl = $("programFullNameInput");
    clearErrors($("programForm"));

    const acronym = acronymEl.value.trim().toUpperCase();
    const fullName = fullNameEl.value.trim();
    let ok = true;
    if (!acronym) {
      setError(acronymEl, "Acronym is required.");
      ok = false;
    }
    if (!fullName) {
      setError(fullNameEl, "Full name is required.");
      ok = false;
    }
    if (!ok) return;

    const editing = editingProgramId;

    closeSettingsModal("programModal");
    showActionLoading(
      "Saving Program",
      "Please wait while the program is being saved...",
    );
    try {
      await api(
        editing ? "PUT" : "POST",
        editing ? `/programs/${editing}` : "/programs",
        {
          acronym,
          fullName,
          aliases: $("programAliasesInput").value,
        },
      );
      await reloadAll();
      showSuccessToast("Program Saved", "The program was saved successfully.");
    } catch (err) {
      showSuccessToast(
        "Save Failed",
        err.message || "Could not save the program.",
      );
    } finally {
      hideActionLoading();
    }
  }

  /* ------------------------------------------------------------ campus program list */

  function openCampusPrograms(campus) {
    programsCampus = campus;
    $("campusProgramsTitle").textContent = `${campus.name} — Programs`;
    $("campusCustomToggle").checked = campus.customPrograms;

    const selected = new Set(campus.programIds);
    $("campusProgramChecklist").innerHTML = SystemConfig.programs()
      .map(
        (p) => `
          <label class="config-check">
            <input type="checkbox" value="${esc(p.id)}" ${selected.has(p.id) ? "checked" : ""} />
            <span>${esc(SystemConfig.programLabel(p))}</span>
          </label>`,
      )
      .join("");

    syncChecklistState();
    openSettingsModal("campusProgramsModal");
  }

  function syncChecklistState() {
    const on = $("campusCustomToggle").checked;
    const box = $("campusProgramChecklist");
    box.classList.toggle("disabled", !on);
    box.querySelectorAll("input").forEach((i) => (i.disabled = !on));
  }

  async function saveCampusPrograms() {
    if (!programsCampus) return;

    const custom = $("campusCustomToggle").checked;
    const ids = [
      ...$("campusProgramChecklist").querySelectorAll("input:checked"),
    ].map((i) => i.value);

    if (custom && ids.length === 0) {
      showSuccessToast(
        "Select Programs",
        "Select at least one program for this campus.",
      );
      return;
    }

    const id = programsCampus.id;
    closeSettingsModal("campusProgramsModal");
    showActionLoading(
      "Saving Programs",
      "Please wait while the campus programs are being saved...",
    );
    try {
      await api("PUT", `/campuses/${id}/programs`, {
        customPrograms: custom,
        programIds: ids,
      });
      await reloadAll();
      showSuccessToast(
        "Programs Saved",
        "The campus program list was saved successfully.",
      );
    } catch (err) {
      showSuccessToast(
        "Save Failed",
        err.message || "Could not save the program list.",
      );
    } finally {
      hideActionLoading();
    }
  }

  /* ------------------------------------------------------------ delete */

  function askDelete(kind, id, label) {
    pendingDelete = { kind, id };
    $("configDeleteTitle").textContent =
      kind === "campus" ? "Delete Campus?" : "Delete Program?";
    $("configDeleteMessage").textContent =
      `Are you sure you want to delete ${label}?`;
    openSettingsModal("configDeleteModal");
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { kind, id } = pendingDelete;
    pendingDelete = null;

    closeSettingsModal("configDeleteModal");
    showActionLoading("Deleting", "Please wait...");
    try {
      await api(
        "DELETE",
        kind === "campus" ? `/campuses/${id}` : `/programs/${id}`,
      );
      await reloadAll();
      showSuccessToast(
        "Deleted",
        kind === "campus"
          ? "The campus was deleted."
          : "The program was deleted.",
      );
    } catch (err) {
      showSuccessToast("Delete Failed", err.message || "Could not delete it.");
    } finally {
      hideActionLoading();
    }
  }
})();

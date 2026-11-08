document.addEventListener("DOMContentLoaded", async () => {
  initializeElectionTabs();
  initializeConfirmModals();
  initializeSuccessToast();
  initializeActionLoadingModal();
  initializeDefaultSchoolYear();

  await loadExistingElectionsFromApi();

  initializeElectionCards();
  initializeExistingElectionSearch();
  initializeSelectionModal();
  initializeEditForms();
  initializeCreateElectionSave();
  initializeDiscardElection();

  initializeElectionEmailModal();
  connectElectionsSocket();
});

const ELECTION_API = "/admin-ssc/api/elections";
const PARTYLIST_API = "/admin-ssc/api/partylists";

const $ = (id) => document.getElementById(id);
const ADMIN_CAMPUS_ID = document.body.dataset.adminCampusId || "";
const ADMIN_CAMPUS_NAME = document.body.dataset.adminCampusName || "";

// School year starts in June (month index 5). Change this if your cutoff differs.
const SCHOOL_YEAR_START_MONTH = 5;

function getCurrentSchoolYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function initializeDefaultSchoolYear() {
  const input = $("electionSchoolYear");
  if (!input) return;
  const sy = getCurrentSchoolYear();
  input.defaultValue = sy; // form.reset() will restore this
  input.value = sy;        // still editable by the admin
}

function showFieldError(field, message) {
  const formGroup = field?.closest(".form-group");
  if (!formGroup) return;
  formGroup.classList.add("has-error");
  const error = formGroup.querySelector(".selection-error");
  if (error) error.textContent = message;
}

function clearFieldError(field) {
  const formGroup = field?.closest(".form-group");
  if (!formGroup) return;
  formGroup.classList.remove("has-error");
  const error = formGroup.querySelector(".selection-error");
  if (error) error.textContent = "";
}

function clearAllElectionErrors(form) {
  form.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
  form.querySelectorAll(".selection-error").forEach((el) => (el.textContent = ""));
}

function showSelectionError(section, message) {
  if (!section) return;
  section.classList.add("has-error");
  const error = section.querySelector(".selection-error");
  if (error) error.textContent = message;
}

function getSelectedItems(container) {
  return [...container.querySelectorAll(".chip")].map((chip) => ({
    id: chip.dataset.id,
    name: chip.textContent.trim(),
  }));
}

function getSelectedIds(container) {
  return getSelectedItems(container).map((item) => item.id).filter(Boolean);
}

function clearContainer(container, placeholder) {
  if (!container) return;
  container.innerHTML = `<span class="placeholder">${placeholder}</span>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ==========================================================
   REAL-TIME UPDATES
========================================================== */

function connectElectionsSocket() {
  if (typeof StompJs === "undefined" || typeof SockJS === "undefined") {
    console.error("StompJs/SockJS not loaded — real-time election updates disabled.");
    return;
  }

  const topic = ADMIN_CAMPUS_ID
    ? `/topic/elections/campus/${ADMIN_CAMPUS_ID}`
    : "/topic/elections";

  const client = new StompJs.Client({
    webSocketFactory: () => new SockJS("/ws-analytics"),
    reconnectDelay: 4000,
    onConnect: () => {
      client.subscribe(topic, () => loadExistingElectionsFromApi(false, true));
    },
  });

  client.activate();
}

function formatScheduledEmailDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/* ============ TABS ============ */

let existingElectionsLoaded = false;

function initializeElectionTabs() {
  const tabs = document.querySelectorAll(".election-tab");
  const sections = document.querySelectorAll(".election-section");
  if (!tabs.length || !sections.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", async (event) => {
      event.preventDefault();
      tabs.forEach((t) => t.classList.remove("active"));
      sections.forEach((s) => s.classList.remove("active"));
      tab.classList.add("active");
      $(tab.dataset.section)?.classList.add("active");

      if (tab.dataset.section === "existingElections" && !existingElectionsLoaded) {
        existingElectionsLoaded = true;
        await loadExistingElectionsFromApi(true);
      }
    });
  });
}

/* ============ LOAD / RENDER ============ */

async function loadExistingElectionsFromApi(showLoading = false, force = false) {
  const container = $("existingElections");
  if (!container) return;

  if (showLoading) {
    window.showActionLoading("Loading Elections...", "Please wait while the existing elections are being loaded.");
  }

  try {
     const elections = await SoftCache.load(ELECTION_API, {
      force,
      onRevalidated: (fresh) => {
        // Don't rebuild cards while one is being edited or expanded
        if (document.querySelector(
          "#existingElections .election-item.editing, #existingElections .election-item.show"
        )) return;
        renderExistingElections(fresh);
        initializeElectionCards();
        initializeExistingElectionSearch();
        initializeEditForms();
      },
    });
    renderExistingElections(elections);

    initializeElectionCards();
    initializeExistingElectionSearch();
    initializeEditForms();
  } catch (error) {
    console.error("Error loading elections:", error);
  } finally {
    if (showLoading) window.hideActionLoading();
  }
}

function renderExistingElections(elections) {
  const container = document.querySelector("#existingElections .election-list");
  if (!container) return;

  container.innerHTML = "";

  if (!elections || elections.length === 0) {
    container.innerHTML = `<div class="empty-state">No elections found.</div>`;
    return;
  }

  elections.forEach((election) => {
    const card = document.createElement("div");
    const status = election.status || "ACTIVE";
    const normalizedStatus = status.toLowerCase();
    const statusClass =
      normalizedStatus === "active" ? "active" :
      normalizedStatus === "ongoing" ? "ongoing" :
      normalizedStatus === "concluded" ? "concluded" : "";

    card.className = "election-item";
    card.dataset.electionId = election.id || "";
    card.dataset.electionTitle = election.title || "";
    card.dataset.schoolYear = election.schoolYear || "";
    card.dataset.status = normalizedStatus;

    card.innerHTML = `
      <div class="election-header">
        <div class="election-title">
          <h3>${escapeHtml(election.title || "Untitled Election")}</h3>
          <small>Student Supreme Council</small>
        </div>
        <div class="election-controls">
          <span class="status ${statusClass}">${escapeHtml(status)}</span>

          <button
                type="button"
                class="secondary-email-btn send-election-email"
                title="Send Election Email"
                aria-label="Send election email"
              >
                <i class="bi bi-envelope"></i>
                <span>Send Email</span>
          </button>


          <button type="button" class="icon-btn edit-election" title="Edit Election"><i class="bi bi-pencil"></i></button>
          <button type="button" class="icon-btn archive-election" title="Archive Election"><i class="bi bi-archive"></i></button>
          <button type="button" class="icon-btn delete-election" title="Delete Election"><i class="bi bi-trash3"></i></button>
          <button type="button" class="icon-btn expand-election" title="Expand Election"><i class="bi bi-chevron-down"></i></button>
        </div>
      </div>

      <div class="election-details">
        <div class="info-grid">
          <div class="info-card"><label>School Year</label><span>${escapeHtml(election.schoolYear || "—")}</span></div>
          <div class="info-card"><label>Campus</label><span>${escapeHtml(ADMIN_CAMPUS_NAME)}</span></div>
          <div class="info-card">
            <label>Schedule</label>
            <span>${escapeHtml(formatScheduledEmailDate(election.startAt))} - ${escapeHtml(formatScheduledEmailDate(election.endAt))}</span>
          </div>
          <div class="info-card">
            <label>Partylists</label>
            <span>${election.partylistNames?.length ? election.partylistNames.map(escapeHtml).join(", ") : "—"}</span>
          </div>
        </div>
      </div>

      <div class="edit-panel">
        <form class="edit-election-form election-form" data-election-id="${escapeHtml(election.id || "")}">
          <div class="form-section">
            <h3>Election Information</h3>
            <div class="form-group">
              <label>Election Title</label>
              <input type="text" class="edit-election-title" value="${escapeHtml(election.title || "")}">
              <span class="selection-error"></span>
            </div>
            <div class="form-group">
              <label>Election Category</label>
              <input type="text" value="Student Supreme Council" disabled>
            </div>
            <div class="form-group">
              <label>School Year</label>
              <input type="text" class="edit-election-school-year" value="${escapeHtml(election.schoolYear || "")}" placeholder="2026-2027">
              <span class="selection-error"></span>
            </div>
            <div class="form-group">
              <label>Campus</label>
              <input type="text" value="${escapeHtml(ADMIN_CAMPUS_NAME)}" disabled>
            </div>
          </div>

          <div class="form-section">
            <h3>Schedule</h3>
            <div class="form-group">
              <label>Start Date</label>
              <input type="datetime-local" class="edit-election-start" value="${toDateTimeLocalValue(election.startAt)}">
              <span class="selection-error"></span>
            </div>
            <div class="form-group">
              <label>End Date</label>
              <input type="datetime-local" class="edit-election-end" value="${toDateTimeLocalValue(election.endAt)}">
              <span class="selection-error"></span>
            </div>
          </div>

          <div class="form-section selection-group">
            <div class="section-header">
              <h3>Partylists</h3>
              <button type="button" class="secondary-btn edit-partylist-btn"><i class="bi bi-plus-lg"></i> Select Partylists</button>
            </div>
            <div class="selected-container">
              ${
                election.partylistIds?.length
                  ? election.partylistIds.map((id, i) => `
                      <span class="chip" data-id="${escapeHtml(id)}">${escapeHtml(election.partylistNames?.[i] || id)}</span>
                    `).join("")
                  : `<span class="placeholder">No partylists selected.</span>`
              }
            </div>
            <span class="selection-error"></span>
          </div>

          <div class="form-buttons">
            <button type="button" class="discard-btn cancel-edit"><i class="bi bi-x-lg"></i> Cancel</button>
            <button type="submit" class="save-btn"><i class="bi bi-check-lg"></i> Save Changes</button>
          </div>
        </form>
      </div>
    `;

    container.appendChild(card);
  });
}

/* ============ CARDS (expand / edit / archive / delete) ============ */

function initializeElectionCards() {
  const cards = document.querySelectorAll("#existingElections .election-item");

  function updateExpandIcon(card) {
    const icon = card.querySelector(".expand-election i");
    if (!icon) return;
    icon.className = card.classList.contains("show") ? "bi bi-chevron-up" : "bi bi-chevron-down";
  }

  function closeOtherCards(current) {
    cards.forEach((card) => {
      if (card === current) return;
      card.classList.remove("show", "editing");
      updateExpandIcon(card);
    });
  }

  function getTitle(card) {
    return card.querySelector(".election-title h3")?.textContent.trim() || "Election";
  }

  cards.forEach((card) => {
    const expand = card.querySelector(".expand-election");
    const edit = card.querySelector(".edit-election");
    const archive = card.querySelector(".archive-election");
    const remove = card.querySelector(".delete-election");

    archive?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const title = getTitle(card);
      const electionId = card.dataset.electionId;

      window.openArchiveModal("Archive Election?", `Are you sure you want to archive "${title}"?`, async () => {
        window.showActionLoading("Archiving Election...", `Please wait while "${title}" is being archived.`);
        try {
          const response = await fetch(`${ELECTION_API}/${electionId}/archive`, { method: "PUT", headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Failed to archive election (${response.status}).`);
          await loadExistingElectionsFromApi();
          window.showSuccessToast("Election Archived", `"${title}" was archived successfully.`);
        } catch (error) {
          console.error("Archive election failed:", error);
          window.showSuccessToast("Archive Failed", error.message || "Unable to archive the election.");
        } finally {
          window.hideActionLoading();
        }
      });
    });

    remove?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const title = getTitle(card);
      const electionId = card.dataset.electionId;

      window.openDeleteModal("Delete Election?", `Are you sure you want to delete "${title}"? This action cannot be undone.`, async () => {
        window.showActionLoading("Deleting Election...", `Please wait while "${title}" is being deleted.`);
        try {
          const response = await fetch(`${ELECTION_API}/${electionId}`, { method: "DELETE", headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error(`Failed to delete election (${response.status}).`);
          await loadExistingElectionsFromApi();
          window.showSuccessToast("Election Deleted", `"${title}" was moved to trash successfully.`);
        } catch (error) {
          console.error("Delete election failed:", error);
          window.showSuccessToast("Delete Failed", error.message || "Unable to delete the election.");
        } finally {
          window.hideActionLoading();
        }
      });
    });

    expand?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = card.classList.contains("show");
      closeOtherCards(card);
      card.classList.toggle("show", !isOpen);
      updateExpandIcon(card);
    });

    edit?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isEditing = card.classList.contains("editing");
      if (isEditing) {
        card.classList.remove("editing");
        card.classList.add("show");
        updateExpandIcon(card);
        return;
      }
      closeOtherCards(card);
      card.classList.add("editing", "show");
      updateExpandIcon(card);
    });

    updateExpandIcon(card);
  });
}

/* ============ SEARCH ============ */

function initializeExistingElectionSearch() {
  const searchInput = $("electionSearch");
  const clearButton = $("clearElectionSearch");
  const statusFilter = $("electionStatusFilter");
  const cards = document.querySelectorAll("#existingElections .election-item");
  if (!searchInput || !statusFilter || !cards.length) return;

  function filterElections() {
    const search = searchInput.value.toLowerCase().trim();
    const status = statusFilter.value;

    cards.forEach((card) => {
      const searchableText = [card.dataset.electionTitle, card.dataset.schoolYear].join(" ").toLowerCase();
      const matchesSearch = !search || searchableText.includes(search);
      const matchesStatus = status === "all" || card.dataset.status?.toLowerCase() === status;
      card.style.display = matchesSearch && matchesStatus ? "" : "none";
    });

    if (clearButton) clearButton.hidden = !searchInput.value;
  }

  searchInput.addEventListener("input", filterElections);
  statusFilter.addEventListener("change", filterElections);
  clearButton?.addEventListener("click", () => {
    searchInput.value = "";
    filterElections();
    searchInput.focus();
  });
}

/* ============ CONFIRM MODALS ============ */

function createConfirmModal({ modalId, titleId, messageId, cancelId, confirmId, openName, closeName }) {
  const modal = $(modalId);
  if (!modal) return;

  const title = $(titleId);
  const message = $(messageId);
  const cancel = $(cancelId);
  const confirm = $(confirmId);
  let pendingAction = null;

  function open(modalTitle, modalMessage, action = null) {
    if (title) title.textContent = modalTitle;
    if (message) message.textContent = modalMessage;
    pendingAction = action;
    modal.classList.add("show");
  }

  function close() {
    modal.classList.remove("show");
    pendingAction = null;
  }

  cancel?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); close(); });
  confirm?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof pendingAction === "function") pendingAction();
    close();
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("show")) close(); });

  window[openName] = open;
  window[closeName] = close;
}

function initializeConfirmModals() {
  createConfirmModal({ modalId: "deleteModal", titleId: "deleteModalTitle", messageId: "deleteModalMessage", cancelId: "deleteCancel", confirmId: "deleteConfirm", openName: "openDeleteModal", closeName: "closeDeleteModal" });
  createConfirmModal({ modalId: "archiveModal", titleId: "archiveModalTitle", messageId: "archiveModalMessage", cancelId: "archiveCancel", confirmId: "archiveConfirm", openName: "openArchiveModal", closeName: "closeArchiveModal" });
  createConfirmModal({ modalId: "saveModal", titleId: "saveModalTitle", messageId: "saveModalMessage", cancelId: "saveCancel", confirmId: "saveConfirm", openName: "openSaveModal", closeName: "closeSaveModal" });
}

/* ============ TOAST / LOADING ============ */

function initializeSuccessToast() {
  const toast = $("successToast");
  if (!toast) return;
  const title = $("successToastTitle");
  const message = $("successToastMessage");
  const close = $("successToastClose");
  let toastTimer = null;

  function show(toastTitle = "Success", toastMessage = "Changes saved successfully.") {
    if (title) title.textContent = toastTitle;
    if (message) message.textContent = toastMessage;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  function hide() {
    toast.classList.remove("show");
    clearTimeout(toastTimer);
  }

  close?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); hide(); });
  window.showSuccessToast = show;
  window.closeSuccessToast = hide;
}

function initializeActionLoadingModal() {
  const modal = $("actionLoadingModal");
  if (!modal) return;
  const title = $("actionLoadingTitle");
  const message = $("actionLoadingMessage");

  function showLoading(loadingTitle = "Processing...", loadingMessage = "Please wait while we process your request.") {
    if (title) title.textContent = loadingTitle;
    if (message) message.textContent = loadingMessage;
    modal.classList.add("show");
    document.body.classList.add("modal-loading");
  }

  function hideLoading() {
    modal.classList.remove("show");
    document.body.classList.remove("modal-loading");
  }

  window.showActionLoading = showLoading;
  window.hideActionLoading = hideLoading;
}

/* ============ SELECTION MODAL (partylists only) ============ */

async function initializeSelectionModal() {
  const modal = $("selectionModal");
  if (!modal) return;

  let partylistData = [];

  await loadSelectionData();

  const title = $("modalTitle");
  const subtitle = $("modalSubtitle");
  const list = $("modalList");
  const preview = $("selectedPreview");
  const closeModal = $("closeModal");
  const cancelModal = $("cancelModal");
  const saveSelection = $("saveSelection");
  const searchInput = $("modalSearch");

  let selected = [];
  let targetContainer = null;
  let selectedSchoolYear = "";

  function normalizeSchoolYear(value) {
    return String(value || "").replace(/\s+/g, "").replace(/-/g, "");
  }

  function getSchoolYearFromForm(form) {
    return form?.querySelector(".edit-election-school-year")?.value || $("electionSchoolYear")?.value || "";
  }

  function openModal(target, existingItems, schoolYear) {
    targetContainer = target;
    selectedSchoolYear = schoolYear;

    selected = existingItems
      .map((item) => (typeof item === "object" ? item : partylistData.find((p) => p.name === item)))
      .filter(Boolean);

    title.textContent = "Select Partylists";
    subtitle.textContent = "Choose participating partylists.";
    searchInput.value = "";
    modal.classList.add("show");
    renderList();
    renderPreview();
  }

  function closeModalFunction() {
    modal.classList.remove("show");
    targetContainer = null;
  }

  $("btnPartylist")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const schoolYear = $("electionSchoolYear")?.value || "";
    if (!schoolYear) {
      showFieldError($("electionSchoolYear"), "Please enter a school year first.");
      return;
    }
    openModal($("selectedPartylist"), getSelectedItems($("selectedPartylist")), schoolYear);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".edit-partylist-btn");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const form = button.closest(".edit-election-form");
    const target = button.closest(".form-section")?.querySelector(".selected-container");
    const schoolYear = getSchoolYearFromForm(form);

    if (!schoolYear) {
      showFieldError(form?.querySelector(".edit-election-school-year"), "Please enter a school year first.");
      return;
    }

    openModal(target, getSelectedItems(target), schoolYear);
  });

  async function loadSelectionData() {
    try {
      const data = await SoftCache.load(PARTYLIST_API);

      partylistData = data.map((item) => ({
        id: item.id,
        name: item.name,
        schoolYear: item.schoolYear || item.school_year || "",
      }));
    } catch (error) {
      console.error("Failed to load partylists:", error);
    }
  }

  function renderList(filter = "") {
    list.innerHTML = "";
    const search = filter.toLowerCase().trim();

    const items = partylistData.filter((item) => {
      if (selectedSchoolYear && normalizeSchoolYear(item.schoolYear) !== normalizeSchoolYear(selectedSchoolYear)) {
        return false;
      }
      return item.name.toLowerCase().includes(search);
    });

    if (items.length === 0) {
      list.innerHTML = `<div class="modal-empty">No partylists available for this school year.</div>`;
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "modal-item";
      const isSelected = selected.some((s) => s.id === item.id);

      row.innerHTML = `
        <span>${escapeHtml(item.name)}</span>
        <button type="button" class="add-item" ${isSelected ? "disabled" : ""}>
          <i class="bi ${isSelected ? "bi-check-lg" : "bi-plus-lg"}"></i>
        </button>
      `;

      row.querySelector(".add-item").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selected.some((s) => s.id === item.id)) {
          selected.push(item);
          renderList(searchInput.value);
          renderPreview();
        }
      });

      list.appendChild(row);
    });
  }

  function renderPreview() {
    preview.innerHTML = "";
    if (selected.length === 0) {
      preview.innerHTML = `<span class="placeholder">Nothing selected.</span>`;
      return;
    }

    selected.forEach((item) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `${escapeHtml(item.name)} <i class="bi bi-x-lg"></i>`;

      chip.querySelector("i").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selected = selected.filter((s) => s.id !== item.id);
        renderList(searchInput.value);
        renderPreview();
      });

      preview.appendChild(chip);
    });
  }

  searchInput?.addEventListener("input", () => renderList(searchInput.value));

  saveSelection?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!targetContainer) {
      closeModalFunction();
      return;
    }

    targetContainer.innerHTML = "";
    if (selected.length === 0) {
      targetContainer.innerHTML = `<span class="placeholder">No partylists selected.</span>`;
    } else {
      selected.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.dataset.id = item.id;
        chip.textContent = item.name;
        targetContainer.appendChild(chip);
      });

      const selectionGroup = targetContainer.closest(".selection-group");
      if (selectionGroup) {
        selectionGroup.classList.remove("has-error");
        const error = selectionGroup.querySelector(".selection-error");
        if (error) error.textContent = "";
      }
    }

    closeModalFunction();
  });

  closeModal?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeModalFunction(); });
  cancelModal?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeModalFunction(); });
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModalFunction(); });
}

/* ============ VALIDATION (shared create + edit) ============ */

function validateElectionCore({ titleEl, schoolYearEl, startDateEl, endDateEl, partylistContainer }) {
  let valid = true;

  if (!titleEl?.value.trim()) {
    showFieldError(titleEl, "Election title is required.");
    valid = false;
  }

  if (!schoolYearEl?.value.trim()) {
    showFieldError(schoolYearEl, "School year is required.");
    valid = false;
  } else if (!/^\d{4}-\d{4}$/.test(schoolYearEl.value.trim())) {
    showFieldError(schoolYearEl, "Enter a valid school year (e.g. 2026-2027).");
    valid = false;
  } else {
    const [startYear, endYear] = schoolYearEl.value.trim().split("-").map(Number);
    if (endYear !== startYear + 1) {
      showFieldError(schoolYearEl, "School year must contain consecutive years.");
      valid = false;
    }
  }

  if (!startDateEl?.value) {
    showFieldError(startDateEl, "Start date is required.");
    valid = false;
  }

  if (!endDateEl?.value) {
    showFieldError(endDateEl, "End date is required.");
    valid = false;
  }

  if (startDateEl?.value && endDateEl?.value && new Date(endDateEl.value) <= new Date(startDateEl.value)) {
    showFieldError(endDateEl, "End date must be later than the start date.");
    valid = false;
  }

  const partylists = getSelectedIds(partylistContainer);
  if (partylists.length < 2) {
    showSelectionError(partylistContainer?.closest(".form-section"), "Select at least 2 partylists to create an election.");
    valid = false;
  }

  return valid;
}

/* ============ EDIT FORMS ============ */

function initializeEditForms() {
  document.querySelectorAll("#existingElections .election-item").forEach((card) => {
    const form = card.querySelector(".edit-election-form");
    if (!form) return;

    form.querySelector(".cancel-edit")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove("editing");
      card.classList.add("show");
      const icon = card.querySelector(".expand-election i");
      if (icon) icon.className = "bi bi-chevron-up";
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      clearAllElectionErrors(form);

      const electionId = form.dataset.electionId;
      const titleEl = form.querySelector(".edit-election-title");
      const schoolYearEl = form.querySelector(".edit-election-school-year");
      const startDateEl = form.querySelector(".edit-election-start");
      const endDateEl = form.querySelector(".edit-election-end");
      const partylistContainer = form.querySelector(".selected-container");

      const valid = validateElectionCore({ titleEl, schoolYearEl, startDateEl, endDateEl, partylistContainer });
      if (!valid) return;

      window.openSaveModal("Save Changes?", "Are you sure you want to save these election changes?", async () => {
        window.showActionLoading("Saving Changes...", "Please wait while the election is being updated.");

        try {
          const payload = {
            title: titleEl.value.trim(),
            schoolYear: schoolYearEl.value.trim(),
            startAt: new Date(startDateEl.value).toISOString(),
            endAt: new Date(endDateEl.value).toISOString(),
            partylistIds: getSelectedIds(partylistContainer),
          };

          const response = await fetch(`${ELECTION_API}/${electionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            let message = `Failed to update election (${response.status}).`;
            try {
              const errorJson = await response.json();
              if (errorJson?.message) message = errorJson.message;
            } catch (_) {}
            showSelectionError(partylistContainer?.closest(".form-section"), message);
            throw new Error(message);
          }

          await loadExistingElectionsFromApi();
          window.showSuccessToast("Election Updated", "The election was updated successfully.");
        } catch (error) {
          console.error("Update election failed:", error);
          window.showSuccessToast("Update Failed", error.message || "Unable to update the election.");
        } finally {
          window.hideActionLoading();
        }
      });
    });

    form.querySelectorAll("input, select").forEach((field) => {
      field.addEventListener("input", () => clearFieldError(field));
      field.addEventListener("change", () => clearFieldError(field));
    });
  });
}

/* ============ CREATE ELECTION — SAVE ============ */

function initializeCreateElectionSave() {
  const form = document.querySelector("#createElection .election-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearAllElectionErrors(form);

    const titleEl = $("electionTitle");
    const schoolYearEl = $("electionSchoolYear");
    const startDateEl = $("electionStartDate");
    const endDateEl = $("electionEndDate");
    const partylistContainer = $("selectedPartylist");

    const valid = validateElectionCore({ titleEl, schoolYearEl, startDateEl, endDateEl, partylistContainer });
    if (!valid) return;

    window.openSaveModal("Save Election?", "Are you sure you want to save this election?", () => {
      window.showActionLoading("Saving Election...", "Please wait while the election is being saved.");

      (async () => {
        try {
          const payload = {
            title: titleEl.value.trim(),
            schoolYear: schoolYearEl.value.trim(),
            startAt: new Date(startDateEl.value).toISOString(),
            endAt: new Date(endDateEl.value).toISOString(),
            partylistIds: getSelectedIds(partylistContainer),
          };

          const response = await fetch(ELECTION_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            let message = `Failed to create election (${response.status}).`;
            try {
              const errorJson = await response.json();
              if (errorJson?.message) message = errorJson.message;
            } catch (_) {}
            showSelectionError(partylistContainer?.closest(".form-section"), message);
            throw new Error(message);
          }

          form.reset();
          clearContainer($("selectedPartylist"), "No partylists selected.");
          clearAllElectionErrors(form);

          await loadExistingElectionsFromApi(false);
          window.showSuccessToast("Election Saved", "The election was saved successfully.");
        } catch (error) {
          console.error("Create election failed:", error);
          window.showSuccessToast("Save Failed", error.message || "Unable to save the election.");
        } finally {
          window.hideActionLoading();
        }
      })();
    });
  });

  form.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("input", () => clearFieldError(field));
    field.addEventListener("change", () => clearFieldError(field));
  });
}

/* ============ CREATE ELECTION — DISCARD ============ */

function initializeDiscardElection() {
  const discard = $("discardElection");
  const form = document.querySelector("#createElection .election-form");
  if (!discard || !form) return;

  discard.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    window.openDeleteModal(
      "Discard Election?",
      "Are you sure you want to discard this election? All entered information will be cleared.",
      () => {
        window.showActionLoading("Discarding Election...", "Please wait while the election information is being cleared.");
        setTimeout(() => {
          form.reset();
          clearContainer($("selectedPartylist"), "No partylists selected.");
          clearAllElectionErrors(form);
          window.hideActionLoading();
          window.showSuccessToast("Election Discarded", "The election information was discarded successfully.");
        }, 600);
      }
    );
  });
}

/* ==========================================================
   ELECTION EMAIL MODAL
========================================================== */

function initializeElectionEmailModal() {
  const modal = $("emailElectionModal");
  if (!modal) {
    console.error("Email modal #emailElectionModal was not found.");
    return;
  }

  const title = $("emailElectionTitle");
  const details = $("emailElectionDetails");
  const subtitle = $("emailElectionSubtitle");
  const close = $("closeEmailElectionModal");
  const cancel = $("cancelEmailElection");
  const confirm = $("confirmEmailElection");
  const scheduledGroup = $("scheduledEmailGroup");
  const scheduledDate = $("scheduledEmailDate");
  const cancelScheduledEmail = $("cancelScheduledEmail");
  const scheduledBanner = $("scheduledEmailBanner");
  const scheduledDisplayDate = $("scheduledEmailDisplayDate");

  let selectedElection = null;

  async function openEmailModal(card) {
    selectedElection = card;

    const electionId = card.dataset.electionId;
    const electionTitle =
      card.querySelector(".election-title h3")?.textContent.trim() || "Election";
    const schoolYear = card.dataset.schoolYear || "";
    const schedule =
      card.querySelector(".info-card:nth-child(3)")?.textContent.trim() || "";

    const sendNowOption = modal.querySelector('input[name="emailScheduleOption"][value="now"]');
    const scheduleOption = modal.querySelector('input[name="emailScheduleOption"][value="schedule"]');
    if (sendNowOption) sendNowOption.checked = true;
    if (scheduleOption) scheduleOption.checked = false;
    if (scheduledGroup) scheduledGroup.hidden = true;
    if (scheduledDate) scheduledDate.value = "";
    if (title) title.textContent = electionTitle;
    if (subtitle) subtitle.textContent = `Notify eligible voters about ${electionTitle}.`;

    let statusData = { eligibleVoterCount: null, scheduled: false };

    try {
      const res = await fetch(`${ELECTION_API}/${electionId}/email/status`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) statusData = await res.json();
    } catch (error) {
      console.error("Failed to load email status:", error);
    }

    if (details) {
      details.innerHTML = `
        <strong>Student Supreme Council</strong><br>
        School Year: ${escapeHtml(schoolYear)}<br>
        Campus: ${escapeHtml(ADMIN_CAMPUS_NAME)}<br>
        ${escapeHtml(schedule)}<br>
        Eligible Voters: ${statusData.eligibleVoterCount ?? "—"}
      `;
    }

    if (statusData.scheduled) {
      if (scheduledBanner) scheduledBanner.hidden = false;
      if (scheduledDisplayDate) scheduledDisplayDate.textContent = formatScheduledEmailDate(statusData.scheduledAt);
    } else {
      if (scheduledBanner) scheduledBanner.hidden = true;
      if (scheduledDisplayDate) scheduledDisplayDate.textContent = "—";
    }

    modal.classList.add("show");
  }

  function closeEmailModal() {
    modal.classList.remove("show");
    selectedElection = null;
    if (scheduledDate) scheduledDate.value = "";
    clearFieldError(scheduledDate);
  }

  modal.querySelectorAll('input[name="emailScheduleOption"]').forEach((option) => {
    option.addEventListener("change", () => {
      const scheduleSelected = option.value === "schedule" && option.checked;
      if (scheduledGroup) scheduledGroup.hidden = !scheduleSelected;
      if (confirm) {
        confirm.innerHTML = scheduleSelected
          ? `<i class="bi bi-calendar-check"></i> Schedule Email`
          : `<i class="bi bi-envelope"></i> Send Email`;
      }
    });
  });

  confirm?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!selectedElection) return;

    const electionId = selectedElection.dataset.electionId;
    const electionTitle =
      selectedElection.querySelector(".election-title h3")?.textContent.trim() || "Election";

    const option = modal.querySelector('input[name="emailScheduleOption"]:checked')?.value;

    if (option === "schedule") {
      if (!scheduledDate?.value) {
        showFieldError(scheduledDate, "Please select a date and time.");
        return;
      }
      if (new Date(scheduledDate.value) <= new Date()) {
        showFieldError(scheduledDate, "Scheduled email must be set for a future date and time.");
        return;
      }

      const scheduledAtIso = new Date(scheduledDate.value).toISOString();
      closeEmailModal();

      window.showActionLoading(
        "Scheduling Election Email...",
        `Please wait while the email for "${electionTitle}" is being scheduled.`
      );

      try {
        const res = await fetch(`${ELECTION_API}/${electionId}/email/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ scheduledAt: scheduledAtIso }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed to schedule email (${res.status}).`);
        }

        showSuccessToast("Email Scheduled", "The election email was scheduled successfully.");
      } catch (error) {
        console.error("Schedule email failed:", error);
        showSuccessToast("Schedule Failed", error.message || "Unable to schedule the email.");
      } finally {
        window.hideActionLoading();
      }

      return;
    }

    // Send now — runs in the background with a progress toast
       closeEmailModal();

       window.EmailProgress.start({
         electionId,
         title: electionTitle,
         baseUrl: ELECTION_API,
       });
  });

  close?.addEventListener("click", closeEmailModal);
  cancel?.addEventListener("click", closeEmailModal);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeEmailModal(); });

  cancelScheduledEmail?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedElection) return;

    const electionId = selectedElection.dataset.electionId;

    window.showActionLoading(
      "Cancelling Scheduled Email...",
      "Please wait while the scheduled email is being cancelled."
    );

    try {
      const res = await fetch(`${ELECTION_API}/${electionId}/email/schedule`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to cancel scheduled email (${res.status}).`);
      }

      if (scheduledBanner) scheduledBanner.hidden = true;
      if (scheduledDisplayDate) scheduledDisplayDate.textContent = "—";

      showSuccessToast("Email Cancelled", "The scheduled election email was cancelled successfully.");
    } catch (error) {
      console.error("Cancel scheduled email failed:", error);
      showSuccessToast("Cancel Failed", error.message || "Unable to cancel the scheduled email.");
    } finally {
      window.hideActionLoading();
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".send-election-email");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const card = button.closest(".election-item");
    if (!card) {
      console.error("Send Email: Election card not found.");
      return;
    }

    openEmailModal(card);
  });

  window.openElectionEmailModal = openEmailModal;
  window.closeElectionEmailModal = closeEmailModal;
}

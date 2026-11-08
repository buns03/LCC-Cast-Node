/* ==========================================================
   LCCAST — ELECTIONS PAGE
========================================================== */

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

/* ==========================================================
   SHARED HELPERS
========================================================== */

const $ = (id) => document.getElementById(id);

const ADMIN_CAMPUS_ID = document.body.dataset.adminCampusId || "";
const ADMIN_DEPARTMENT_CODE = (document.body.dataset.adminDepartmentCode || "")
  .trim()
  .toUpperCase();

  /* ==========================================================
     REAL-TIME UPDATES
  ========================================================== */

  function connectElectionsSocket() {
      if (typeof SockJS === "undefined") {
          console.error("SockJS not loaded — real-time election updates disabled.");
          return;
      }

      const topic = ADMIN_CAMPUS_ID
          ? `/topic/elections/campus/${ADMIN_CAMPUS_ID}`
          : "/topic/elections";

      if (typeof StompJs !== "undefined") {
          const client = new StompJs.Client({
              webSocketFactory: () => new SockJS("/ws-analytics"),
              reconnectDelay: 4000,
          });
          client.onConnect = () => client.subscribe(topic, () => loadExistingElectionsFromApi(false, true));
          client.activate();
      } else if (typeof Stomp !== "undefined") {
          const socket = new SockJS("/ws-analytics");
          const client = Stomp.over(socket);
          client.debug = () => {};
          client.connect({}, () => client.subscribe(topic, () => loadExistingElectionsFromApi(false, true)));
      } else {
          console.error("No STOMP client library found — real-time election updates disabled.");
      }
  }

function extractProgramCode(title) {
  if (!title) return "";
  return title.split("-")[0].trim().toUpperCase();
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
  form
    .querySelectorAll(".has-error")
    .forEach((el) => el.classList.remove("has-error"));
  form
    .querySelectorAll(".selection-error")
    .forEach((el) => (el.textContent = ""));
}

function showSelectionError(section, message) {
  if (!section) return;
  section.classList.add("has-error");
  const error = section.querySelector(".selection-error");
  if (error) error.textContent = message;
}

function getSelectedItems(container) {
    return [...container.querySelectorAll(".chip")].map(chip => ({
        id: chip.dataset.id,
        name: chip.textContent.trim(),
        electionType: chip.dataset.electionType || ""
    }));
}

function getSelectedIds(container) {
  return getSelectedItems(container)
    .map((item) => item.id)
    .filter(Boolean);
}
function clearContainer(container, placeholder) {
  if (!container) return;

  container.innerHTML = `
    <span class="placeholder">${placeholder}</span>
  `;
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

const pad = (number) => String(number).padStart(2, "0");

return (
`${date.getFullYear()}-` +
`${pad(date.getMonth() + 1)}-` +
`${pad(date.getDate())}T` +
`${pad(date.getHours())}:` +
`${pad(date.getMinutes())}`
);
}

function normalizeDepartmentType(value) {
  return String(value || "").trim().toUpperCase();
}

// School year starts in June (month index 5). Keep this the same on every page.
const SCHOOL_YEAR_START_MONTH = 5;

function getCurrentSchoolYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function initializeDefaultSchoolYear() {
  const input = $("electionSchoolYear");
  if (!input) return;

  const schoolYear = getCurrentSchoolYear();
  input.defaultValue = schoolYear; // form.reset() restores this
  input.value = schoolYear;        // still editable
}

/* ==========================================================
   ELECTION TABS (CREATE / EXISTING)
========================================================== */


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

      if (
        tab.dataset.section === "existingElections" &&
        !existingElectionsLoaded
      ) {
        existingElectionsLoaded = true;
        await loadExistingElectionsFromApi(true);
      }
    });
  });
}

let existingElectionsLoaded = false;

/* ==========================================================
   ELECTION CARDS (expand / edit / archive / delete)
========================================================== */

function initializeElectionCards() {
  const cards = document.querySelectorAll(
    "#existingElections .election-item"
  );

  function updateExpandIcon(card) {
    const icon = card.querySelector(".expand-election i");

    if (!icon) return;

    icon.className = card.classList.contains("show")
      ? "bi bi-chevron-up"
      : "bi bi-chevron-down";
  }

  function closeOtherCards(current) {
    cards.forEach((card) => {
      if (card === current) return;

      card.classList.remove("show");
      card.classList.remove("editing");

      updateExpandIcon(card);
    });
  }

  function getTitle(card) {
    return (
      card.querySelector(".election-title h3")?.textContent.trim() ||
      "Election"
    );
  }

  cards.forEach((card) => {
    const expand = card.querySelector(".expand-election");
    const edit = card.querySelector(".edit-election");
    const archive = card.querySelector(".archive-election");
    const remove = card.querySelector(".delete-election");

    /* ======================================================
       ARCHIVE
    ====================================================== */

    archive?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const title = getTitle(card);
      const electionId = card.dataset.electionId;

      window.openArchiveModal(
        "Archive Election?",
        `Are you sure you want to archive "${title}"?`,
        async () => {
          window.showActionLoading(
            "Archiving Election...",
            `Please wait while "${title}" is being archived.`
          );

          try {
            const response = await fetch(
              `/admin-dept/api/elections/${electionId}/archive`,
              {
                method: "PUT",
                headers: {
                  Accept: "application/json",
                },
              }
            );

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(
                `Failed to archive election (${response.status}): ${errorText}`
              );
            }

            await loadExistingElectionsFromApi();
            initializeElectionCards();
            initializeExistingElectionSearch();
            initializeEditForms();

            window.hideActionLoading();

            window.showSuccessToast(
              "Election Archived",
              `"${title}" was archived successfully.`
            );
          } catch (error) {
            console.error("Archive election failed:", error);

            window.hideActionLoading();

            window.showSuccessToast(
              "Archive Failed",
              error.message || "Unable to archive the election."
            );
          }
        }
      );
    });

    /* ======================================================
       DELETE
    ====================================================== */

    remove?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const title = getTitle(card);
      const electionId = card.dataset.electionId;

      window.openDeleteModal(
        "Delete Election?",
        `Are you sure you want to delete "${title}"? This action cannot be undone.`,
        async () => {
          window.showActionLoading(
            "Deleting Election...",
            `Please wait while "${title}" is being deleted.`
          );

          try {
            const response = await fetch(
              `/admin-dept/api/elections/${electionId}`,
              {
                method: "DELETE",
                headers: {
                  Accept: "application/json",
                },
              }
            );

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(
                `Failed to delete election (${response.status}): ${errorText}`
              );
            }

            await loadExistingElectionsFromApi();
            initializeElectionCards();
            initializeExistingElectionSearch();
            initializeEditForms();

            window.hideActionLoading();

            window.showSuccessToast(
              "Election Deleted",
              `"${title}" was moved to trash successfully.`
            );
          } catch (error) {
            console.error("Delete election failed:", error);

            window.hideActionLoading();

            window.showSuccessToast(
              "Delete Failed",
              error.message || "Unable to delete the election."
            );
          }
        }
      );
    });

    /* ======================================================
       EXPAND / COLLAPSE
    ====================================================== */

    expand?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = card.classList.contains("show");

      closeOtherCards(card);

      if (isOpen) {
        card.classList.remove("show");
      } else {
        card.classList.add("show");
      }

      updateExpandIcon(card);
    });

    /* ======================================================
       EDIT
    ====================================================== */

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

      card.classList.add("editing");
      card.classList.add("show");

      updateExpandIcon(card);
    });

    updateExpandIcon(card);
  });
}

/* ==========================================================
   LOAD ELECTIONS FROM BACKEND
========================================================== */

async function loadExistingElectionsFromApi(showLoading = false, force = false) {
  const container = $("existingElections");
  if (!container) return;

  if (showLoading) {
    window.showActionLoading(
      "Loading Elections...",
      "Please wait while the existing elections are being loaded."
    );
  }

  try {
    const elections = await SoftCache.load("/admin-dept/api/elections", {
      force,
      onRevalidated: (fresh) => {
        // Don't rebuild cards while one is being edited or expanded
        if (document.querySelector(
          "#existingElections .election-item.editing, #existingElections .election-item.show"
        )) return;
        window.existingElections = fresh;
        renderExistingElections(fresh);
        initializeElectionCards();
        initializeExistingElectionSearch();
        initializeEditForms();
      },
    });

    console.log("Loaded elections:", elections);

    window.existingElections = elections;

    renderExistingElections(elections);

    initializeElectionCards();
    initializeExistingElectionSearch();
    initializeEditForms();

  } catch (error) {
    console.error("Error loading elections:", error);

  } finally {
    if (showLoading) {
      window.hideActionLoading();
    }
  }
}

/* ==========================================================
   RENDER ELECTIONS
========================================================== */

function renderExistingElections(elections) {
const container = document.querySelector("#existingElections .election-list");
if (!container) return;

container.innerHTML = "";

if (!elections || elections.length === 0) {
container.innerHTML = `       <div class="empty-state">
        No elections found.       </div>
    `;
return;
}

elections.forEach((election) => {

  console.log("FULL ELECTION:", election);
  console.log("PARTYLIST IDS:", election.partylistIds);
  console.log("DEPARTMENT IDS:", election.departmentIds);

  const card = document.createElement("div");


const category = "Department Election";

const campus =
  election.campusName ||
  election.campus?.name ||
  election.campusId ||
  "";

const status = election.status || "ACTIVE";

const normalizedStatus = status.toLowerCase();

const statusClass =
  normalizedStatus === "active"
    ? "active"
    : normalizedStatus === "ongoing"
      ? "ongoing"
      : normalizedStatus === "concluded"
        ? "concluded"
        : "";

card.className = "election-item";

card.dataset.electionId = election.id || "";
card.dataset.electionTitle = election.title || "";
card.dataset.category = category;
card.dataset.schoolYear = election.schoolYear || "";
card.dataset.campus = campus;
card.dataset.status = normalizedStatus;

card.innerHTML = `
  <!-- ==================================================
       ELECTION HEADER
  ================================================== -->

  <div class="election-header">

    <div class="election-title">
      <h3>${escapeHtml(election.title || "Untitled Election")}</h3>
      <small>${escapeHtml(category)}</small>
    </div>

    <div class="election-controls">

      <!-- STATUS -->
      <span class="status ${statusClass}">
        ${escapeHtml(status)}
      </span>

    <!-- SEND EMAIL -->
    <button
        type="button"
        class="secondary-email-btn send-election-email"
        title="Send Election Email"
        aria-label="Send election email"
    >
        <i class="bi bi-envelope"></i>
        <span>Send Email</span>
    </button>

      <!-- EDIT -->
      <button
        type="button"
        class="icon-btn edit-election"
        title="Edit Election"
        aria-label="Edit election"
      >
        <i class="bi bi-pencil"></i>
      </button>

      <!-- ARCHIVE -->
      <button
        type="button"
        class="icon-btn archive-election"
        title="Archive Election"
        aria-label="Archive election"
      >
        <i class="bi bi-archive"></i>
      </button>

      <!-- DELETE -->
      <button
        type="button"
        class="icon-btn delete-election"
        title="Delete Election"
        aria-label="Delete election"
      >
        <i class="bi bi-trash3"></i>
      </button>

      <!-- EXPAND -->
      <button
        type="button"
        class="icon-btn expand-election"
        title="Expand Election"
        aria-label="Expand election details"
      >
        <i class="bi bi-chevron-down"></i>
      </button>

    </div>
  </div>


    <!-- ==================================================
         ELECTION DETAILS
    ================================================== -->

    <div class="election-details">

      <div class="info-grid">

        <div class="info-card">
          <label>School Year</label>
          <span>${escapeHtml(election.schoolYear || "—")}</span>
        </div>

        <div class="info-card">
          <label>Campus</label>
          <span>${escapeHtml(campus || "—")}</span>
        </div>

        <div class="info-card">
          <label>Schedule</label>
          <span>
            ${escapeHtml(formatScheduledEmailDate(election.startAt))}
            -
            ${escapeHtml(formatScheduledEmailDate(election.endAt))}
          </span>
        </div>

                <div class="info-card">
                  <label>Departments</label>
                  <span>
                    ${
                      election.departmentNames?.length
                        ? election.departmentNames
                            .map((name) => escapeHtml(name))
                            .join(", ")
                        : "—"
                    }
                  </span>
                </div>

      </div>

    </div>


  <!-- ==================================================
       EDIT PANEL
  ================================================== -->

  <div class="edit-panel">

    <form
      class="edit-election-form election-form"
      data-election-id="${escapeHtml(election.id || "")}"
    >

      <div class="form-section">

        <h3>Election Information</h3>

        <div class="form-group">
          <label>Election Title</label>
          <input
            type="text"
            class="edit-election-title"
            value="${escapeHtml(election.title || "")}"
          >
          <span class="selection-error"></span>
        </div>

                <div class="form-group">
                  <label>Election Category</label>
                  <select class="edit-election-category" disabled>
                    <option value="DEPARTMENT" selected>Department Election</option>
                  </select>
                  <span class="selection-error"></span>
                </div>

        <div class="form-group">
          <label>School Year</label>
          <input
            type="text"
            class="edit-election-school-year"
            value="${escapeHtml(election.schoolYear || "")}"
            placeholder="2026-2027"
          >
          <span class="selection-error"></span>
        </div>

                <div class="form-group">
                  <label>Campus</label>
                  <select class="edit-election-campus" disabled>
                    <option value="${escapeHtml(ADMIN_CAMPUS_ID)}" selected>${escapeHtml(campus)}</option>
                  </select>
                  <span class="selection-error"></span>
                </div>

      </div>


      <div class="form-section">

        <h3>Schedule</h3>

        <div class="form-group">
          <label>Start Date</label>
          <input
            type="datetime-local"
            class="edit-election-start"
            value="${toDateTimeLocalValue(election.startAt)}"
          >
          <span class="selection-error"></span>
        </div>

        <div class="form-group">
          <label>End Date</label>
          <input
            type="datetime-local"
            class="edit-election-end"
            value="${toDateTimeLocalValue(election.endAt)}"
          >
          <span class="selection-error"></span>
        </div>

      </div>


      <div class="form-section selection-group">

        <div class="section-header">
          <h3>Departments</h3>

          <button
            type="button"
            class="secondary-btn edit-department-btn"
          >
            <i class="bi bi-plus-lg"></i>
            Select Departments
          </button>
        </div>

        <div class="selected-container">
          ${
            election.departmentIds?.length
              ? election.departmentIds.map((id, index) => `
                  <span
                    class="chip"
                    data-id="${escapeHtml(id)}"
                    data-election-type="${escapeHtml(
                      election.departmentTypes?.[index] || ""
                    )}"
                  >
                    ${escapeHtml(election.departmentNames?.[index] || id)}
                  </span>
                `).join("")
              : `<span class="placeholder">No departments selected.</span>`
          }
        </div>

        <span class="selection-error"></span>

      </div>


      <div class="form-buttons">

        <button
          type="button"
          class="discard-btn cancel-edit"
        >
          <i class="bi bi-x-lg"></i>
          Cancel
        </button>

        <button
          type="submit"
          class="save-btn"
        >
          <i class="bi bi-check-lg"></i>
          Save Changes
        </button>

      </div>

    </form>

  </div>
`;



container.appendChild(card);


});
}


/* ==========================================================
   EXISTING ELECTION SEARCH + STATUS FILTER
========================================================== */

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
      const searchableText = [
        card.dataset.electionTitle,
        card.dataset.category,
        card.dataset.schoolYear,
        card.dataset.campus,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !search || searchableText.includes(search);
      const matchesStatus =
        status === "all" || card.dataset.status?.toLowerCase() === status;

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

/* ==========================================================
   CONFIRM MODALS (delete / archive / save)
   One factory drives all three reusable confirm dialogs.
========================================================== */

function createConfirmModal({
  modalId,
  titleId,
  messageId,
  cancelId,
  confirmId,
  openName,
  closeName,
}) {
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

  cancel?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  confirm?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof pendingAction === "function") pendingAction();
    close();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) close();
  });

  window[openName] = open;
  window[closeName] = close;
}

function initializeConfirmModals() {
  createConfirmModal({
    modalId: "deleteModal",
    titleId: "deleteModalTitle",
    messageId: "deleteModalMessage",
    cancelId: "deleteCancel",
    confirmId: "deleteConfirm",
    openName: "openDeleteModal",
    closeName: "closeDeleteModal",
  });

  createConfirmModal({
    modalId: "archiveModal",
    titleId: "archiveModalTitle",
    messageId: "archiveModalMessage",
    cancelId: "archiveCancel",
    confirmId: "archiveConfirm",
    openName: "openArchiveModal",
    closeName: "closeArchiveModal",
  });

  createConfirmModal({
    modalId: "saveModal",
    titleId: "saveModalTitle",
    messageId: "saveModalMessage",
    cancelId: "saveCancel",
    confirmId: "saveConfirm",
    openName: "openSaveModal",
    closeName: "closeSaveModal",
  });
}

/* ==========================================================
   SUCCESS TOAST
========================================================== */

function initializeSuccessToast() {
  const toast = $("successToast");
  if (!toast) return;

  const title = $("successToastTitle");
  const message = $("successToastMessage");
  const close = $("successToastClose");
  let toastTimer = null;

  function show(
    toastTitle = "Success",
    toastMessage = "Changes saved successfully.",
  ) {
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

  close?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hide();
  });

  window.showSuccessToast = show;
  window.closeSuccessToast = hide;
}

/* ==========================================================
   GLOBAL ACTION LOADING MODAL
========================================================== */

function initializeActionLoadingModal() {
  const modal = $("actionLoadingModal");

  if (!modal) {
    console.error("Action loading modal #actionLoadingModal was not found.");
    return;
  }

  const title = $("actionLoadingTitle");
  const message = $("actionLoadingMessage");

  function showLoading(
    loadingTitle = "Processing...",
    loadingMessage = "Please wait while we process your request.",
  ) {
    if (title) {
      title.textContent = loadingTitle;
    }

    if (message) {
      message.textContent = loadingMessage;
    }

    modal.classList.add("show");

    // Prevent interaction with the page while processing
    document.body.classList.add("modal-loading");
  }

  function hideLoading() {
    modal.classList.remove("show");

    document.body.classList.remove("modal-loading");
  }

  window.showActionLoading = showLoading;
  window.hideActionLoading = hideLoading;
}

/* ==========================================================
   SELECTION MODAL (partylists / departments — create & edit)
========================================================== */

async function initializeSelectionModal() {
  const modal = $("selectionModal");
  if (!modal) return;

            const database = {
              department: [],
            };

            let departmentData = [];

      await loadSelectionData();

  const title = $("modalTitle");
  const subtitle = $("modalSubtitle");
  const list = $("modalList");
  const preview = $("selectedPreview");
  const closeModal = $("closeModal");
  const cancelModal = $("cancelModal");
  const saveSelection = $("saveSelection");
  const searchInput = $("modalSearch");



  let mode = "";
  let selected = [];
  let targetContainer = null;
  let selectedCampus = "";
  let selectedSchoolYear = "";

  /* Reset selections when the create-election campus changes */
  $("electionCampus")?.addEventListener("change", (event) => {
    selectedCampus = event.target.value;
    clearContainer($("selectedPartylist"), "No partylists selected.");
    clearContainer($("selectedDepartment"), "No departments selected.");
  });

  $("electionSchoolYear")?.addEventListener("change", (event) => {
    selectedSchoolYear = event.target.value;

    clearContainer($("selectedPartylist"), "No partylists selected.");
    clearContainer($("selectedDepartment"), "No departments selected.");
  });

  function getSelectedText(container) {
    return getSelectedItems(container);
  }

  function getCampusFromForm(form) {
    return form?.querySelector(".edit-election-campus")?.value || "";
  }

  function getSchoolYearFromForm(form) {
    return (
      form?.querySelector(".edit-election-school-year")?.value ||
      $("electionSchoolYear")?.value ||
      ""
    );
  }

  function normalizeSchoolYear(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/-/g, "");
  }

  function openModal(
    type,
    target = null,
    existingItems = [],
    campus = "",
    schoolYear = ""
  ) {
    mode = type;
    targetContainer = target;
    selectedCampus = campus;
    selectedSchoolYear = schoolYear;

    selected = existingItems
      .map((item) => {
        if (typeof item === "object") {
          return item;
        }

        const found = database[type].find(
          (entry) => entry.name === item
        );

        return found || null;
      })
      .filter(Boolean);

    title.textContent =
      type === "partylist" ? "Select Partylists" : "Select Departments";

    subtitle.textContent =
      type === "partylist"
        ? "Choose participating partylists."
        : "Choose participating departments.";

    searchInput.value = "";

    modal.classList.add("show");

    renderList();
    renderPreview();
  }

  function closeModalFunction() {
    modal.classList.remove("show");
    targetContainer = null;
  }

  /* --- wiring for the "select X" buttons, shared by create + edit --- */

  function wireSelectionButton(
    button,
    type,
    getTarget,
    getCampus,
    getSchoolYear
  ) {
    button?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const campus = getCampus();
      const schoolYear =
        type === "partylist" || type === "department"
          ? getSchoolYear()
          : "";
      const campusField =
        type === "partylist" ? $("electionCampus") : $("electionCampus");

      if (!campus) {
        showFieldError(
          button
            .closest(".edit-election-form")
            ?.querySelector(".edit-election-campus") || campusField,
          "Please select a campus first.",
        );
        return;
      }

      const target = getTarget();
      openModal(
        type,
        target,
        getSelectedText(target),
        campus,
        schoolYear
      );
    });
  }

  wireSelectionButton(
    $("btnDepartment"),
    "department",
    () => $("selectedDepartment"),
    () => $("electionCampus")?.value || "",
    () => $("electionSchoolYear")?.value || "",
  );

    document.addEventListener("click", (event) => {
      const departmentButton = event.target.closest(".edit-department-btn");

      if (!departmentButton) return;

      event.preventDefault();
      event.stopPropagation();

      const button = departmentButton;
      const type = "department";

    const form = button.closest(".edit-election-form");

    const target = button
      .closest(".form-section")
      ?.querySelector(".selected-container");

    const campus = getCampusFromForm(form);
    const schoolYear = getSchoolYearFromForm(form);

    if (!campus) {
      showFieldError(
        form?.querySelector(".edit-election-campus"),
        "Please select a campus first."
      );
      return;
    }

    openModal(
      type,
      target,
      getSelectedText(target),
      campus,
      schoolYear
    );
  });

    async function loadSelectionData() {
      try {
        departmentData = await SoftCache.load("/admin-dept/api/departments");

        const scopedDepartmentData = ADMIN_DEPARTMENT_CODE
          ? departmentData.filter((item) => {
              const code = item.code?.trim()
                ? item.code.trim().toUpperCase()
                : extractProgramCode(item.title);
              return code === ADMIN_DEPARTMENT_CODE;
            })
          : departmentData;

        database.department = scopedDepartmentData.map((item) => ({
          id: item.id,
          name: item.title,
          campusId: item.campusId || item.campus?.id || item.campus?.campusId,
          campus: item.campusName || item.campus?.name || "",
          schoolYear: item.schoolYear || item.school_year || "",
          electionType:
            item.votingType ||
            item.electionType ||
            item.departmentType ||
            item.type ||
            item.category ||
            "",
        }));
      } catch (error) {
        console.error("Failed to load election selections:", error);
      }
    }

  /* --- render available items --- */

  function renderList(filter = "") {
    list.innerHTML = "";
    const search = filter.toLowerCase().trim();

    const firstSelectedDepartment =
      mode === "department" && selected.length > 0
        ? normalizeDepartmentType(selected[0].electionType)
        : "";

    const items = database[mode].filter((item) => {
      /* ======================================================
         CAMPUS FILTER
      ====================================================== */

      if (
        selectedCampus &&
        String(item.campusId || "").toLowerCase() !==
          String(selectedCampus || "").toLowerCase()
      ) {
        return false;
      }

      /* ======================================================
         SCHOOL YEAR FILTER
      ====================================================== */

      if (
        selectedSchoolYear &&
        normalizeSchoolYear(item.schoolYear) !==
          normalizeSchoolYear(selectedSchoolYear)
      ) {
        return false;
      }

      /* ======================================================
         DEPARTMENT ELECTION TYPE FILTER

         First selected department determines the type.
         PARTYLIST  -> only PARTYLIST departments
         REPRESENTATIVE -> only REPRESENTATIVE departments
      ====================================================== */

      if (mode === "department" && firstSelectedDepartment) {
        const itemType = normalizeDepartmentType(item.electionType);

        if (firstSelectedDepartment === "REPRESENTATIVE") {
          return item.id === selected[0].id;
        }

        if (itemType !== firstSelectedDepartment) return false;
      }

      /* ======================================================
         SEARCH
      ====================================================== */

      return item.name.toLowerCase().includes(search);
    });

    if (items.length === 0) {
      const label = mode === "partylist" ? "partylists" : "departments";

      list.innerHTML = `
        <div class="modal-empty">
          No ${label} available for this campus.
        </div>
      `;

      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "modal-item";

      const isSelected = selected.some(
        (selectedItem) => selectedItem.id === item.id
      );

      row.innerHTML = `
        <span>${escapeHtml(item.name)}</span>

        <button
          type="button"
          class="add-item"
          ${isSelected ? "disabled" : ""}
        >
          <i class="bi ${
            isSelected ? "bi-check-lg" : "bi-plus-lg"
          }"></i>
        </button>
      `;

      row.querySelector(".add-item").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        /* ====================================================
           DEPARTMENT TYPE LOCK
        ==================================================== */

       if (mode === "department") {
         const itemType = normalizeDepartmentType(item.electionType);

         if (selected.length > 0) {
           const firstSelected = selected[0];
           const selectedType = normalizeDepartmentType(firstSelected.electionType);

           if (selectedType === "REPRESENTATIVE") {
             return;
           }

           if (itemType !== selectedType) return;

           if (item.id === firstSelected.id) return;
         }
       }

        if (
          !selected.some(
            (selectedItem) => selectedItem.id === item.id
          )
        ) {
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
      preview.innerHTML = `
        <span class="placeholder">Nothing selected.</span>
      `;
      return;
    }

    selected.forEach((item) => {
      const chip = document.createElement("div");
      chip.className = "chip";

      chip.innerHTML = `
        ${item.name}
        <i class="bi bi-x-lg"></i>
      `;

      chip.querySelector("i").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        selected = selected.filter(
          (selectedItem) => selectedItem.id !== item.id
        );

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
      const label = mode === "partylist" ? "partylists" : "departments";
      targetContainer.innerHTML = `<span class="placeholder">No ${label} selected.</span>`;
    } else {
      selected.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.dataset.id = item.id;
        chip.dataset.electionType = item.electionType || "";
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

  closeModal?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeModalFunction();
  });

  cancelModal?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeModalFunction();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModalFunction();
  });
}

/* ==========================================================
   SHARED ELECTION FORM VALIDATION (create + edit)
========================================================== */

function validateElectionCore({
  titleEl,
  categoryEl,
  schoolYearEl,
  campusEl,
  startDateEl,
  endDateEl,
  departmentContainer,
}) {
  let valid = true;

  if (!titleEl?.value.trim()) {
    showFieldError(titleEl, "Election title is required.");
    valid = false;
  }

  if (!categoryEl?.value) {
    showFieldError(categoryEl, "Please select an election category.");
    valid = false;
  }

  if (!schoolYearEl?.value.trim()) {
    showFieldError(schoolYearEl, "School year is required.");
    valid = false;
  } else if (!/^\d{4}-\d{4}$/.test(schoolYearEl.value.trim())) {
    showFieldError(schoolYearEl, "Enter a valid school year (e.g. 2026-2027).");
    valid = false;
  } else {
    const [startYear, endYear] = schoolYearEl.value
      .trim()
      .split("-")
      .map(Number);
    if (endYear !== startYear + 1) {
      showFieldError(
        schoolYearEl,
        "School year must contain consecutive years.",
      );
      valid = false;
    }
  }

  if (!campusEl?.value) {
    showFieldError(campusEl, "Please select a campus.");
    valid = false;
  }

  if (!startDateEl?.value) {
    showFieldError(startDateEl, "Start date is required.");
    valid = false;
  }

  if (!endDateEl?.value) {
    showFieldError(endDateEl, "End date is required.");
    valid = false;
  }

  if (startDateEl?.value && endDateEl?.value) {
    if (new Date(endDateEl.value) <= new Date(startDateEl.value)) {
      showFieldError(endDateEl, "End date must be later than the start date.");
      valid = false;
    }
  }

const selectedDepartmentItems = getSelectedItems(departmentContainer);

if (selectedDepartmentItems.length === 0) {
  showSelectionError(
    departmentContainer?.closest(".form-section"),
    "Select at least 1 department.",
  );
  valid = false;
} else {
  const departmentType = normalizeDepartmentType(
    selectedDepartmentItems[0]?.electionType
  );

  if (departmentType === "PARTYLIST") {
    if (selectedDepartmentItems.length < 2) {
      showSelectionError(
        departmentContainer?.closest(".form-section"),
        "Select at least 2 departments for a PARTYLIST election."
      );
      valid = false;
    }
  } else if (departmentType === "REPRESENTATIVE") {
    if (selectedDepartmentItems.length < 1) {
      showSelectionError(
        departmentContainer?.closest(".form-section"),
        "Select at least 1 department for a REPRESENTATIVE election.",
      );
      valid = false;
    }
  }
}

  return valid;
}

/* ==========================================================
   EDIT FORMS
========================================================== */

function initializeEditForms() {
  document
    .querySelectorAll("#existingElections .election-item")
    .forEach((card) => {
      const form = card.querySelector(".edit-election-form");
      if (!form) return;

      form.querySelector(".cancel-edit")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        card.classList.remove("editing");
        card.classList.add("show"); // keep card open so context isn't lost

        const icon = card.querySelector(".expand-election i");
        if (icon) icon.className = "bi bi-chevron-up";
      });

      form.addEventListener("submit", (event) => {
        event.preventDefault();

        clearAllElectionErrors(form);

        const electionId = form.dataset.electionId;

        const titleEl = form.querySelector('input[type="text"]');
        const categoryEl = form.querySelector(
          "select:not(.edit-election-campus)"
        );
        const schoolYearEl = form.querySelector(".edit-election-school-year");
        const campusEl = form.querySelector(".edit-election-campus");

        const [startDateEl, endDateEl] = form.querySelectorAll(
          'input[type="datetime-local"]'
        );

        const departmentContainer = form.querySelector(".selected-container");

                const valid = validateElectionCore({
                  titleEl,
                  categoryEl,
                  schoolYearEl,
                  campusEl,
                  startDateEl,
                  endDateEl,
                  departmentContainer,
                });

        if (!valid) return;

        window.openSaveModal(
          "Save Changes?",
          "Are you sure you want to save these election changes?",
          async () => {
            window.showActionLoading(
              "Saving Changes...",
              "Please wait while the election is being updated."
            );

            try {
                            const payload = {
                              title: titleEl.value.trim(),
                              category: categoryEl.value,
                              campusId: campusEl.value,
                              schoolYear: schoolYearEl.value.trim(),
                              startAt: new Date(startDateEl.value).toISOString(),
                              endAt: new Date(endDateEl.value).toISOString(),
                              partylistIds: [],
                              departmentIds: getSelectedIds(departmentContainer),
                            };

              console.log("Update election payload:", payload);

              const response = await fetch(
                `/admin-dept/api/elections/${electionId}`,
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify(payload),
                }
              );

              if (!response.ok) {
                let message = `Failed to update election (${response.status}).`;

                try {
                  const errorJson = await response.json();
                  if (errorJson?.message) message = errorJson.message;
                } catch (_) {}

                showSelectionError(
                  departmentContainer?.closest(".form-section") ||
                    partylistContainer?.closest(".form-section"),
                  message
                );

                throw new Error(message);
              }

              const updatedElection = await response.json();

              console.log("Election updated:", updatedElection);

              await loadExistingElectionsFromApi();

              window.hideActionLoading();

              window.showSuccessToast(
                "Election Updated",
                "The election was updated successfully."
              );


            } catch (error) {
              console.error("Update election failed:", error);

              window.showSuccessToast(
                "Update Failed",
                error.message || "Unable to update the election."
              );

            } finally {
              window.hideActionLoading();
            }
          }
        );
      });

      form.querySelectorAll("input, select").forEach((field) => {
        field.addEventListener("input", () => clearFieldError(field));
        field.addEventListener("change", () => clearFieldError(field));
      });
    });
}

/* ==========================================================
   CREATE ELECTION — SAVE
========================================================== */

function initializeCreateElectionSave() {
  const form = document.querySelector("#createElection .election-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    clearAllElectionErrors(form);

    const titleEl = $("electionTitle");
    const categoryEl = $("electionCategory");
    const schoolYearEl = $("electionSchoolYear");
    const campusEl = $("electionCampus");
    const startDateEl = $("electionStartDate");
    const endDateEl = $("electionEndDate");

        const departmentContainer = $("selectedDepartment");

        const valid = validateElectionCore({
          titleEl,
          categoryEl,
          schoolYearEl,
          campusEl,
          startDateEl,
          endDateEl,
          departmentContainer,
        });

    if (!valid) return;

    window.openSaveModal(
      "Save Election?",
      "Are you sure you want to save this election?",
      () => {
        window.showActionLoading(
          "Saving Election...",
          "Please wait while the election is being saved.",
        );

        async function saveElection() {
          try {
                        const payload = {
                          title: titleEl.value.trim(),
                          category: categoryEl.value,
                          campusId: campusEl.value,
                          schoolYear: schoolYearEl.value.trim(),
                          startAt: new Date(startDateEl.value).toISOString(),
                          endAt: new Date(endDateEl.value).toISOString(),
                          partylistIds: [],
                          departmentIds: getSelectedIds(departmentContainer),
                        };

            console.log("Election payload:", payload);

            const response = await fetch("/admin-dept/api/elections", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              body: JSON.stringify(payload),
            });

            if (!response.ok) {
              let message = `Failed to create election (${response.status}).`;

              try {
                const errorJson = await response.json();
                if (errorJson?.message) message = errorJson.message;
              } catch (_) {}

              showSelectionError(
                departmentContainer?.closest(".form-section") ||
                  partylistContainer?.closest(".form-section"),
                message
              );

              throw new Error(message);
            }

            const savedElection = await response.json();

            console.log("Election created:", savedElection);

                        form.reset();

                        clearContainer(
                          $("selectedDepartment"),
                          "No departments selected.",
                        );

                        clearAllElectionErrors(form);

                        await loadExistingElectionsFromApi(false);

            window.showSuccessToast(
              "Election Saved",
              "The election was saved successfully.",
            );

          } catch (error) {
            console.error("Create election failed:", error);

            window.showSuccessToast(
              "Save Failed",
              error.message || "Unable to save the election.",
            );

          } finally {
            window.hideActionLoading();
          }
        }

        saveElection();
      },
    );
  });

  form.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("input", () => {
      clearFieldError(field);
    });

    field.addEventListener("change", () => {
      clearFieldError(field);
    });
  });
}

/* ==========================================================
   CREATE ELECTION — DISCARD
========================================================== */

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
        window.showActionLoading(
          "Discarding Election...",
          "Please wait while the election information is being cleared.",
        );

                setTimeout(() => {
                  form.reset();

                  clearContainer($("selectedDepartment"), "No departments selected.");

                  clearAllElectionErrors(form);

                  window.hideActionLoading();



          window.showSuccessToast(
            "Election Discarded",
            "The election information was discarded successfully.",
          );
        }, 1000);
      },
    );
  });
}

/* ==========================================================
   ELECTION EMAIL MODAL
========================================================== */

function formatScheduledEmailDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
    const category =
      card.dataset.category ||
      card.querySelector(".election-title small")?.textContent.trim() || "";
    const schoolYear = card.dataset.schoolYear || "";
    const campus = card.dataset.campus || "";
    const schedule =
      card.querySelector(".info-card:nth-child(3)")?.textContent.trim() || "";

    const sendNowOption = modal.querySelector(
      'input[name="emailScheduleOption"][value="now"]',
    );
    const scheduleOption = modal.querySelector(
      'input[name="emailScheduleOption"][value="schedule"]',
    );
    if (sendNowOption) sendNowOption.checked = true;
    if (scheduleOption) scheduleOption.checked = false;
    if (scheduledGroup) scheduledGroup.hidden = true;
    if (scheduledDate) scheduledDate.value = "";
    if (title) title.textContent = electionTitle;
    if (subtitle)
      subtitle.textContent = `Notify eligible voters about ${electionTitle}.`;

    let statusData = { eligibleVoterCount: null, scheduled: false };

    try {
      const res = await fetch(
        `/admin-dept/api/elections/${electionId}/email/status`,
        { headers: { Accept: "application/json" } },
      );
      if (res.ok) statusData = await res.json();
    } catch (error) {
      console.error("Failed to load email status:", error);
    }

    if (details) {
      details.innerHTML = `
                <strong>${category}</strong><br>
                School Year: ${schoolYear}<br>
                Campus: ${campus}<br>
                ${schedule}<br>
                Eligible Voters: ${statusData.eligibleVoterCount ?? "—"}
            `;
    }

    if (statusData.scheduled) {
      if (scheduledBanner) scheduledBanner.hidden = false;
      if (scheduledDisplayDate)
        scheduledDisplayDate.textContent = formatScheduledEmailDate(
          statusData.scheduledAt,
        );
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

  modal
    .querySelectorAll('input[name="emailScheduleOption"]')
    .forEach((option) => {
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
      selectedElection.querySelector(".election-title h3")?.textContent.trim() ||
      "Election";

    const option = modal.querySelector(
      'input[name="emailScheduleOption"]:checked',
    )?.value;

    if (option === "schedule") {
      if (!scheduledDate?.value) {
        showFieldError(scheduledDate, "Please select a date and time.");
        return;
      }
      if (new Date(scheduledDate.value) <= new Date()) {
        showFieldError(
          scheduledDate,
          "Scheduled email must be set for a future date and time.",
        );
        return;
      }

      const scheduledAtIso = new Date(scheduledDate.value).toISOString();
      closeEmailModal();

      window.showActionLoading(
        "Scheduling Election Email...",
        `Please wait while the email for "${electionTitle}" is being scheduled.`,
      );

      try {
        const res = await fetch(
          `/admin-dept/api/elections/${electionId}/email/schedule`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ scheduledAt: scheduledAtIso }),
          },
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed to schedule email (${res.status}).`);
        }

        window.showSuccessToast(
          "Email Scheduled",
          "The election email was scheduled successfully.",
        );
      } catch (error) {
        console.error("Schedule email failed:", error);
        window.showSuccessToast(
          "Schedule Failed",
          error.message || "Unable to schedule the email.",
        );
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
          baseUrl: "/admin-dept/api/elections",
        });
  });

  close?.addEventListener("click", closeEmailModal);
  cancel?.addEventListener("click", closeEmailModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeEmailModal();
  });

  cancelScheduledEmail?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedElection) return;

    const electionId = selectedElection.dataset.electionId;

    window.showActionLoading(
      "Cancelling Scheduled Email...",
      "Please wait while the scheduled email is being cancelled.",
    );

    try {
      const res = await fetch(
        `/admin-dept/api/elections/${electionId}/email/schedule`,
        { method: "DELETE", headers: { Accept: "application/json" } },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.message || `Failed to cancel scheduled email (${res.status}).`,
        );
      }

      if (scheduledBanner) scheduledBanner.hidden = true;
      if (scheduledDisplayDate) scheduledDisplayDate.textContent = "—";

      window.showSuccessToast(
        "Email Cancelled",
        "The scheduled election email was cancelled successfully.",
      );
    } catch (error) {
      console.error("Cancel scheduled email failed:", error);
      window.showSuccessToast(
        "Cancel Failed",
        error.message || "Unable to cancel the scheduled email.",
      );
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


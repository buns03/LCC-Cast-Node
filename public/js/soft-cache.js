/* =========================================================
   LCCAST - VOTERS PAGE
========================================================= */

document.addEventListener("DOMContentLoaded", initializeVoters);

/* =========================================================
   SAMPLE VOTER DATA
========================================================= */
const VOTER_API = "/superadmin/api/voters";

let voters = []; // holds only the CURRENT PAGE now, not everything
let votersRequestId = 0;
let totalPages = 1;
let totalElements = 0;

/* =========================================================
   STATE
========================================================= */

const FILTER_TYPES = ["sscStatus", "departmentStatus", "year", "program", "section", "campus"];

const voterState = {
  search: "",
  sscStatus: [], departmentStatus: [], year: [], program: [], section: [], campus: [],
  nameSort: "default",
  timeSort: "default",
  page: 1,
  perPage: 10,
  pendingDeleteId: null,
  pendingArchiveId: null,
  pendingDeleteAll: false,
  pendingArchiveAll: false,
  pendingEditId: null,
};

/* =========================================================
   SMALL HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(value).replace(/[&<>"']/g, (ch) => map[ch]);
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Wires backdrop-click + Escape to close a modal. */
function wireModalDismiss(modal, closeFn) {
  if (!modal) return;
  modal.addEventListener("click", (e) => { if (e.target === modal) closeFn(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeFn();
  });
}

/* =========================================================
   INITIALIZE
========================================================= */

function initializeVoters() {
  initializeStatusModal();
  initializeEditModal();
  initializeDeleteModal();
  initializeArchiveModal();
  initializeSuccessToast();
  initializeActionLoadingModal();
  initializeSearch();
  initializeFiltersPanel();
  loadFacets();
  initializePagination();
  initializeExport();
  initializeImport();
  initializeDeleteAndArchive();
  loadVoters();
}

async function loadFacets() {
  try {
    const response = await fetch(`${VOTER_API}/facets`, { credentials: "same-origin" });
    const data = await response.json();
    renderProgramFilterOptions(data.programs || []);
    renderSectionFilterOptions(data.sections || []);
  } catch (e) {
    console.error("Failed to load filter facets:", e);
  }
}

function renderProgramFilterOptions(programs) {
  const container = $("multiProgramOptions");
  if (!container) return;
  container.innerHTML = "";
  programs.forEach((program) => {
    const label = document.createElement("label");
    label.className = "filter-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = program;
    input.dataset.filterType = "program";
    const span = document.createElement("span");
    span.textContent = program;
    label.append(input, span);
    container.appendChild(label);
  });
}

function renderSectionFilterOptions(sections) {
  const container = $("multiSectionOptions");
  if (!container) return;
  container.innerHTML = "";
  sections.forEach((section) => {
    const label = document.createElement("label");
    label.className = "filter-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = section;
    input.dataset.filterType = "section";
    const span = document.createElement("span");
    span.textContent = section;
    label.append(input, span);
    container.appendChild(label);
  });
}

async function refreshSectionFacets() {
  const selectedPrograms = getSelectedProgramsFromPanel();

  try {
    const params = new URLSearchParams();
    selectedPrograms.forEach(p => params.append("program", p));
    const response = await fetch(`${VOTER_API}/facets?${params.toString()}`, { credentials: "same-origin" });
    const data = await response.json();
    renderSectionFilterOptions(data.sections || []);
  } catch (e) {
    console.error("Failed to refresh section facets:", e);
  }

  updatePendingFilterCount();
}

/* =========================================================
   SUCCESS TOAST
========================================================= */

function initializeSuccessToast() {
  if (!$("successToast")) return;
  $("successToastClose")?.addEventListener("click", hideSuccessToast);
}

function showSuccessToast(title, message) {
  const toast = $("successToast");
  if (!toast || !$("successToastTitle") || !$("successToastMessage")) return;

  $("successToastTitle").textContent = title;
  $("successToastMessage").textContent = message;
  toast.classList.add("show");

  clearTimeout(window.successToastTimer);
  window.successToastTimer = setTimeout(hideSuccessToast, 3500);
}

function hideSuccessToast() {
  $("successToast")?.classList.remove("show");
}

/* =========================================================
   SEARCH + AUTOCOMPLETE
========================================================= */

function initializeSearch() {
  const input = $("voterSearch");
  const autocomplete = $("autocompleteList");
  if (!input || !autocomplete) return;

  input.addEventListener("input", () => {
    voterState.search = input.value.trim().toLowerCase();
    voterState.page = 1;
    renderAutocomplete();
    loadVoters();
  });

  input.addEventListener("focus", renderAutocomplete);

  document.addEventListener("click", (e) => {
    if (!input.parentElement.contains(e.target)) autocomplete.classList.remove("show");
  });
}

function renderAutocomplete() {
  const input = $("voterSearch");
  const list = $("autocompleteList");
  if (!input || !list) return;

  const query = input.value.trim().toLowerCase();
  const matches = query
    ? voters
        .filter((v) => [v.name, v.id, v.program].some((f) => f.toLowerCase().includes(query)))
        .slice(0, 6)
    : [];

  if (!matches.length) {
    list.innerHTML = "";
    list.classList.remove("show");
    return;
  }

  list.innerHTML = matches
    .map(
      (v) => `
        <button type="button" class="autocomplete-item" data-name="${escapeHTML(v.name)}">
            <strong>${escapeHTML(v.name)}</strong>
            <span>${escapeHTML(v.id)} &middot; ${escapeHTML(v.program)}</span>
        </button>`
    )
    .join("");

  list.classList.add("show");

  list.querySelectorAll(".autocomplete-item").forEach((item) => {
    item.addEventListener("click", () => {
      input.value = item.dataset.name;
      voterState.search = item.dataset.name.toLowerCase();
      voterState.page = 1;
      list.classList.remove("show");
      renderVoters();
    });
  });
}

/* =========================================================
   FILTER PANEL
========================================================= */

function initializeFiltersPanel() {
  const button = $("filtersMainButton");
  const panel = $("filtersPanel");
  if (!button || !panel) return;

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("show");
    button.classList.toggle("active", panel.classList.contains("show"));
  });

  $("filtersApplyBtn")?.addEventListener("click", () => {
    applySelectedFilters();
    voterState.page = 1;
    panel.classList.remove("show");
    button.classList.remove("active");
    loadVoters();
  });

  $("filtersClearBtn")?.addEventListener("click", clearAllFilters);

  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && !button.contains(e.target)) {
      panel.classList.remove("show");
      button.classList.remove("active");
    }
  });

    panel.addEventListener("change", (e) => {
        if (e.target.matches('input[data-filter-type="program"]')) {
          refreshSectionFacets();
          return;
        }
        updatePendingFilterCount();
    });
}

function applySelectedFilters() {
  const panel = $("filtersPanel");
  if (!panel) return;

  const newFilters = { sscStatus: [], departmentStatus: [], year: [], program: [], section: [], campus: [], nameSort: "default", timeSort: "default" };

  panel.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
    const type = input.dataset.filterType;
    if (newFilters[type]) newFilters[type].push(input.value);
  });

  // (deleted section-validation block)

  newFilters.nameSort = panel.querySelector('input[name="nameSort"]:checked')?.value || "default";
  newFilters.timeSort = panel.querySelector('input[name="timeSort"]:checked')?.value || "default";

  Object.assign(voterState, newFilters);
  updateFilterCount();
}

function getSelectedFilterCount() {
  let count = FILTER_TYPES.reduce((sum, type) => sum + voterState[type].length, 0);
  if (voterState.nameSort !== "default") count++;
  if (voterState.timeSort !== "default") count++;
  return count;
}

function updatePendingFilterCount() {
  const panel = $("filtersPanel");
  const selectedText = $("filtersSelectedCount");
  if (!panel || !selectedText) return;

  let count = FILTER_TYPES.reduce(
    (sum, type) => sum + panel.querySelectorAll(`input[data-filter-type="${type}"]:checked`).length,
    0
  );
  if (panel.querySelector('input[name="nameSort"]:checked')) count++;
  if (panel.querySelector('input[name="timeSort"]:checked')) count++;

  selectedText.textContent = `${count} selected`;
}

function updateFilterCount() {
  const count = getSelectedFilterCount();
  const label = $("filtersMainLabel");
  const selectedText = $("filtersSelectedCount");
  const button = $("filtersMainButton");

  if (label) label.textContent = count === 0 ? "Filter" : `Filter (${count})`;
  if (selectedText) selectedText.textContent = `${count} selected`;
  button?.classList.toggle("has-filters", count > 0);
}

function clearAllFilters() {
  const panel = $("filtersPanel");
  if (!panel) return;

  panel.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((input) => {
    input.checked = false;
  });

  FILTER_TYPES.forEach((type) => (voterState[type] = []));
  voterState.nameSort = "default";
  voterState.timeSort = "default";
  voterState.page = 1;

  updateFilterCount();
  loadVoters();
}

function normalizeBackendVoter(voter) {
  return {
    uuid: voter.id,
    id: voter.studentId ?? "",

    name:
      voter.fullName ??
      [voter.firstName, voter.middleName, voter.lastName]
        .filter(Boolean)
        .join(" "),

    program: voter.programCourse ?? "",
    year: voter.yearLevel ?? "",
    section: voter.section ?? "",

    campusId: voter.campusId ?? "",
    campus: voter.campus ?? getCampusName(voter.campusId) ?? "",

    email: voter.email ?? "",

    sscStatus: voter.sscVotingStatus === "VOTED" ? "Voted" : "Not Voted",
    sscTime: voter.sscVotedAt ?? null,

    departmentStatus: voter.departmentVotingStatus === "VOTED" ? "Voted" : "Not Voted",
    departmentTime: voter.departmentVotedAt ?? null,

    createdOn: voter.createdAt ?? null,
    updatedOn: voter.updatedAt ?? null,

    archived: voter.status === "ARCHIVED"
  };
}

function showVotersSkeleton() {
  $("votersSkeleton")?.classList.remove("hidden");
  $("votersContent")?.classList.add("hidden");
}

function hideVotersSkeleton() {
  $("votersSkeleton")?.classList.add("hidden");
  $("votersContent")?.classList.remove("hidden");
}

async function loadVoters() {
  const requestId = ++votersRequestId;
  showVotersSkeleton();
  try {
    const params = new URLSearchParams({
      page: String(voterState.page - 1),
      size: String(voterState.perPage),
    });

    // admin-ssc / superadmin only — admin-dept omits this block
    const campusUUIDMap = { "Kaypian": "62a45c28-56c9-4f39-b4a3-9bc3de5ce5a8", "Muzon": "9bc86421-63ce-4a7e-94ae-fc1bc6328956" };
    if (voterState.campus.length === 1) {
      params.set("campusId", campusUUIDMap[voterState.campus[0]] || voterState.campus[0]);
    }

    if (voterState.program.length === 1) params.set("program", voterState.program[0]);
    if (voterState.section.length === 1) params.set("section", voterState.section[0]);
    if (voterState.year.length === 1) params.set("yearLevel", voterState.year[0]);
    if (voterState.search) params.set("search", voterState.search);
    if (voterState.sscStatus.length === 1) params.set("sscStatus", voterState.sscStatus[0]);
    if (voterState.departmentStatus.length === 1) params.set("departmentStatus", voterState.departmentStatus[0]);

    const response = await fetch(`${VOTER_API}/page?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });

    const result = await response.json();

    if (requestId !== votersRequestId) return; // a newer request has already started — drop this stale response

    if (!response.ok) throw new Error(result?.message || `Failed to load voters. HTTP ${response.status}`);

    voters = (result.content || []).map(normalizeBackendVoter);
    totalPages = result.totalPages || 1;
    totalElements = result.totalElements || 0;

    renderVoters();
  } catch (error) {
    if (requestId !== votersRequestId) return; // stale error — a newer request superseded this one
    console.error("Failed to load voters:", error);
    showVotersStatusModal("error", "Failed to Load Voters", error.message || "Unable to load voter records.");
  } finally {
    if (requestId === votersRequestId) hideVotersSkeleton();
  }
}

/* =========================================================
   PAGINATION
========================================================= */

function initializePagination() {
  $("previousPage")?.addEventListener("click", () => {
    if (voterState.page <= 1) return;
    voterState.page--;
    loadVoters();
  });

  $("nextPage")?.addEventListener("click", () => {
    if (voterState.page >= totalPages) return;   // CHANGED — was getTotalPages()
    voterState.page++;
    loadVoters();
  });
}


function updatePagination() {                    // CHANGED — no longer takes a param
  const previous = $("previousPage");
  const next = $("nextPage");
  if ($("paginationText")) $("paginationText").textContent = `Page ${voterState.page} / ${totalPages}`;
  if (previous) previous.disabled = voterState.page <= 1;
  if (next) next.disabled = voterState.page >= totalPages;
}

/* =========================================================
   FILTER + SORT DATA
========================================================= */


/* =========================================================
   RENDER VOTERS
========================================================= */

function renderVoters() {
  const list = $("voterList");
  const empty = $("votersEmpty");
  if (!list || !empty) return;

  list.innerHTML = "";
  empty.classList.toggle("show", !voters.length);
  voters.forEach((voter) => list.appendChild(createVoterElement(voter)));

  updatePagination(totalPages);
}

const DETAIL_ROWS = [
  ["Program", (v) => v.program || "—"],
  ["Year", (v) => v.year || "—"],
  ["Section", (v) => v.section || "—"],
  ["Campus", (v) => v.campus || getCampusName(v.campusId) || "—"],
  ["Email", (v) => v.email || "—"],
];

function getCampusName(campusId) {
  const campusMap = {
    "62a45c28-56c9-4f39-b4a3-9bc3de5ce5a8": "Kaypian",
    "9bc86421-63ce-4a7e-94ae-fc1bc6328956": "Muzon"
  };

  return campusMap[campusId] || "";
}

function createVoterElement(voter) {
  const article = document.createElement("article");
  article.className = "voter-item";

  const sscStatusClass = voter.sscStatus === "Voted" ? "voted" : "not-voted";
  const sscTime = voter.sscTime ? formatDateTime(voter.sscTime) : "—";

  const departmentStatusClass = voter.departmentStatus === "Voted" ? "voted" : "not-voted";
  const departmentTime = voter.departmentTime ? formatDateTime(voter.departmentTime) : "—";

  const detailRows = DETAIL_ROWS.map(
    ([label, get]) => `
        <div class="voter-detail-row"><span>${label}</span><span>${escapeHTML(get(voter))}</span></div>`
  ).join("");

  article.innerHTML = `
    <div class="voter-summary">
      <div class="voter-summary-info">
        <span class="voter-id">${escapeHTML(voter.id)}</span>
        <span class="voter-divider">|</span>
        <strong class="voter-name">${escapeHTML(voter.name)}</strong>
      </div>
      <div class="voter-summary-status">
        <span class="voter-status ${sscStatusClass}" title="SSC">SSC: ${escapeHTML(voter.sscStatus)}</span>
        <span class="voter-status ${departmentStatusClass}" title="Department">Dept: ${escapeHTML(voter.departmentStatus)}</span>
      </div>
      <div class="voter-summary-actions">
        <button type="button" class="voter-action-btn edit" title="Edit voter" aria-label="Edit voter"><i class="bi bi-pencil"></i></button>
        <button type="button" class="voter-action-btn archive" title="Archive voter" aria-label="Archive voter"><i class="bi bi-archive"></i></button>
        <button type="button" class="voter-action-btn delete" title="Delete voter" aria-label="Delete voter"><i class="bi bi-trash3"></i></button>
        <button type="button" class="voter-action-btn expand" title="Expand card" aria-label="expand card"><i class="bi bi-chevron-down voter-summary-arrow"></i></button>
      </div>
    </div>
    <div class="voter-details">
      <div class="voter-details-inner">
        ${detailRows}
        <div class="voter-detail-row"><span>SSC Voting Status</span><span class="voter-status ${sscStatusClass}">${escapeHTML(voter.sscStatus)}</span></div>
        <div class="voter-detail-row"><span>SSC Time Voted</span><span>${escapeHTML(sscTime)}</span></div>
        <div class="voter-detail-row"><span>Department Voting Status</span><span class="voter-status ${departmentStatusClass}">${escapeHTML(voter.departmentStatus)}</span></div>
        <div class="voter-detail-row"><span>Department Time Voted</span><span>${escapeHTML(departmentTime)}</span></div>
        <div class="voter-detail-row"><span>Created On</span><span>${voter.createdOn ? escapeHTML(formatDateTime(voter.createdOn)) : "—"}</span></div>
        <div class="voter-detail-row"><span>Updated On</span><span>${voter.updatedOn ? escapeHTML(formatDateTime(voter.updatedOn)) : "—"}</span></div>
      </div>
    </div>`;

  article.querySelector(".voter-summary").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleVoter(article);
    }
  });

  const bind = (selector, handler) =>
    article.querySelector(selector)?.addEventListener("click", (e) => {
      e.stopPropagation();
      handler();
    });

  bind(".voter-action-btn.edit", () => editVoter(voter.uuid));
  bind(".voter-action-btn.archive", () => archiveVoter(voter.uuid));
  bind(".voter-action-btn.delete", () => deleteVoter(voter.uuid));
  bind(".voter-action-btn.expand", () => toggleVoter(article));

  return article;
}

function toggleVoter(article) {
  const isExpanded = article.classList.contains("expanded");
  document.querySelectorAll(".voter-item.expanded").forEach((item) => item.classList.remove("expanded"));
  if (!isExpanded) article.classList.add("expanded");
}

/* =========================================================
   SECTION FILTER OPTIONS
========================================================= */

function getSelectedProgramsFromPanel() {
  const panel = $("filtersPanel");
  if (!panel) return [];
  return [...panel.querySelectorAll('input[data-filter-type="program"]:checked')].map((i) => i.value);
}

/* =========================================================
   STATUS MODAL (generic info/success/error popup)
========================================================= */

function initializeStatusModal() {
  const modal = $("votersStatusModal");
  if (!modal) return;

  $("closeVotersStatusModal")?.addEventListener("click", closeVotersStatusModal);
  $("votersStatusOk")?.addEventListener("click", closeVotersStatusModal);
  wireModalDismiss(modal, closeVotersStatusModal);
}

function showVotersStatusModal(type, title, message) {
  const modal = $("votersStatusModal");
  const icon = $("votersStatusIcon");
  if (!modal || !$("votersStatusTitle") || !$("votersStatusMessage") || !icon) return;

  modal.classList.remove("success", "error");
  modal.classList.add(type, "show");
  $("votersStatusTitle").textContent = title;
  $("votersStatusMessage").textContent = message;
  icon.innerHTML = type === "success" ? `<i class="bi bi-check-lg"></i>` : `<i class="bi bi-x-lg"></i>`;
}

function closeVotersStatusModal() {
  $("votersStatusModal")?.classList.remove("show");
}

/* =========================================================
   EDIT MODAL
========================================================= */

const EDIT_FIELDS = ["Id", "Name", "Program", "Year", "Section", "Campus", "Email"];

function initializeEditModal() {
  const modal = $("editVoterModal");
  if (!modal) return;

  $("closeEditVoterModal")?.addEventListener("click", closeEditVoterModal);
  $("cancelEditVoter")?.addEventListener("click", closeEditVoterModal);
  $("saveEditVoter")?.addEventListener("click", saveEditedVoter);
  wireModalDismiss(modal, closeEditVoterModal);
}

function closeEditVoterModal() {
  $("editVoterModal")?.classList.remove("show");
  voterState.pendingEditId = null;
  clearEditVoterErrors();
}

function clearEditVoterErrors() {
  EDIT_FIELDS.forEach((field) => {
    $(`editVoter${field}`)?.classList.remove("error");
    const error = $(`editVoter${field}Error`);
    if (error) error.textContent = "";
  });
}

function showEditVoterError(field, message) {
  $(`editVoter${field}`)?.classList.add("error");
  const error = $(`editVoter${field}Error`);
  if (error) error.textContent = message;
}

function editVoter(uuid) {
  const voter = voters.find((v) => v.uuid === uuid);
  if (!voter) return;

  voterState.pendingEditId = uuid;
  clearEditVoterErrors();

  $("editVoterId").value = voter.id;
  $("editVoterName").value = voter.name;
  $("editVoterProgram").value = voter.program;
  $("editVoterYear").value = voter.year;
  $("editVoterSection").value = voter.section;
  $("editVoterCampus").value = voter.campusId;
  $("editVoterEmail").value = voter.email;

  $("editVoterModal")?.classList.add("show");
}

async function saveEditedVoter() {
  const uuid = voterState.pendingEditId;
  if (!uuid) return;

  const voter = voters.find((v) => v.uuid === uuid);
  if (!voter) return;

  clearEditVoterErrors();

  const studentId = $("editVoterId").value.trim();
  const fullName = $("editVoterName").value.trim();
  const programCourse = $("editVoterProgram").value.trim();
  const yearLevel = $("editVoterYear").value.trim();
  const section = $("editVoterSection").value.trim();
  const campusId = $("editVoterCampus").value.trim();
  const email = $("editVoterEmail").value.trim();

  let valid = true;

  if (!studentId) {
    showEditVoterError("Id", "Student ID is required.");
    valid = false;
  }

  if (!fullName) {
    showEditVoterError("Name", "Full name is required.");
    valid = false;
  }

  if (!programCourse) {
    showEditVoterError("Program", "Course is required.");
    valid = false;
  }

  if (!yearLevel) {
    showEditVoterError("Year", "Year level is required.");
    valid = false;
  }

  if (!section) {
    showEditVoterError("Section", "Section is required.");
    valid = false;
  }

  if (!campusId) {
    showEditVoterError("Campus", "Campus is required.");
    valid = false;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showEditVoterError("Email", "Please enter a valid email address.");
    valid = false;
  }

  if (!valid) return;

  const nameParts = fullName.split(/\s+/);

  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1
    ? nameParts[nameParts.length - 1]
    : "";
  const middleName = nameParts.length > 2
    ? nameParts.slice(1, -1).join(" ")
    : "";

  const payload = {
    studentId,
    lastName,
    firstName,
    middleName,
    fullName,
    email,
    programCourse,
    yearLevel,
    section,
    campusId
  };

  window.showActionLoading(
    "Saving Voter...",
    "Please wait while the voter information is being saved."
  );

  try {
    const response = await fetch(`${VOTER_API}/${uuid}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message || "Failed to update voter."
      );
    }

    await loadVoters();

    voterState.page = 1;

    closeEditVoterModal();

    showSuccessToast(
      "Voter Updated",
      `${fullName}'s information was updated successfully.`
    );

  } catch (error) {
    console.error("Update voter failed:", error);

    showVotersStatusModal(
      "error",
      "Save Failed",
      error.message || "Unable to update voter."
    );

  } finally {
    window.hideActionLoading();
  }
}

/* =========================================================
   DELETE MODAL
========================================================= */

function initializeDeleteModal() {
  const modal = $("deleteVoterModal");
  if (!modal) return;

  $("deleteVoterCancel")?.addEventListener("click", closeDeleteModal);

  $("deleteVoterConfirm")?.addEventListener("click", () => {

    if (voterState.pendingDeleteAll) {
      window.showActionLoading(
        "Moving Voters to Trash...",
        "Please wait while the voters are being moved to trash."
      );

      performDeleteAllVoters();
      return;
    }

    if (!voterState.pendingDeleteId) return;

    window.showActionLoading(
      "Moving Voter to Trash...",
      "Please wait while the voter is being moved to trash."
    );

    performDeleteVoter(voterState.pendingDeleteId);
  });

  wireModalDismiss(modal, closeDeleteModal);
}

function closeDeleteModal() {
  $("deleteVoterModal")?.classList.remove("show");
  voterState.pendingDeleteId = null;
  voterState.pendingDeleteAll = false;
  if ($("deleteVoterTitle")) $("deleteVoterTitle").textContent = "Delete Voter?";
}

function deleteVoter(uuid) {
  const voter = voters.find((v) => v.uuid === uuid);
  if (!voter) return;

  voterState.pendingDeleteId = uuid;
  voterState.pendingDeleteAll = false;

  if ($("deleteVoterMessage")) {
    $("deleteVoterMessage").textContent =
      `Are you sure you want to move ${voter.name} to trash?`;
  }

  $("deleteVoterModal")?.classList.add("show");
}

function deleteAllVoters() {
  voterState.pendingDeleteId = null;
  voterState.pendingDeleteAll = true;

  if ($("deleteVoterMessage")) {
    $("deleteVoterMessage").textContent =
      `Are you sure you want to permanently delete all voters matching the current filters? This action cannot be undone.`;
  }
  if ($("deleteVoterTitle")) $("deleteVoterTitle").textContent = "Delete All Voters?";
  $("deleteVoterModal")?.classList.add("show");
}

async function performDeleteVoter(id) {
  if (!id) {
    window.hideActionLoading();
    return;
  }

  try {
    const response = await fetch(`${VOTER_API}/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message || "Failed to delete voter."
      );
    }

    const voter = voters.find((v) => v.uuid === id);
    const voterName = voter?.name || "Voter";

    closeDeleteModal();

    await loadVoters();

    showSuccessToast(
      "Voter Moved to Trash",
      `${voterName} was moved to trash successfully.`
    );

  } catch (error) {
    console.error("Delete voter failed:", error);

    closeDeleteModal();

    showVotersStatusModal(
      "error",
      "Delete Failed",
      error.message || "Unable to delete voter."
    );

  } finally {
    window.hideActionLoading();
  }
}

async function performDeleteAllVoters() {
  const filter = {
    program: voterState.program[0] || null,
    yearLevel: voterState.year[0] || null,
    section: voterState.section[0] || null,
    search: voterState.search || null,
  };

  try {
    const response = await fetch(`${VOTER_API}/delete-matching`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(filter),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Failed to delete voters.");

    closeDeleteModal();
    voterState.page = 1;
    await loadVoters();

    showSuccessToast("Voters Moved to Trash", `${result.count ?? 0} voter(s) were moved to trash successfully.`);
  } catch (error) {
    console.error("Delete all voters failed:", error);
    closeDeleteModal();
    showVotersStatusModal("error", "Delete Failed", error.message || "Unable to delete voters.");
  } finally {
    window.hideActionLoading();
  }
}

/* =========================================================
   ARCHIVE MODAL
========================================================= */

function initializeArchiveModal() {
  const modal = $("archiveVoterModal");
  if (!modal) return;

  $("archiveVoterCancel")?.addEventListener("click", closeArchiveModal);

  $("archiveVoterConfirm")?.addEventListener("click", () => {

    if (voterState.pendingArchiveAll) {
      window.showActionLoading(
        "Archiving Voters...",
        "Please wait while the voters are being archived."
      );

      performArchiveAllVoters();
      return;
    }

    if (!voterState.pendingArchiveId) return;

    window.showActionLoading(
      "Archiving Voter...",
      "Please wait while the voter is being archived."
    );

    performArchiveVoter(voterState.pendingArchiveId);
  });

  wireModalDismiss(modal, closeArchiveModal);
}

function closeArchiveModal() {
  $("archiveVoterModal")?.classList.remove("show");
  voterState.pendingArchiveId = null;
  voterState.pendingArchiveAll = false;
  if ($("archiveVoterTitle")) $("archiveVoterTitle").textContent = "Archive Voter?";
}

function archiveVoter(uuid) {
  const voter = voters.find((v) => v.uuid === uuid);
  if (!voter) return;

  voterState.pendingArchiveId = uuid;
  voterState.pendingArchiveAll = false;

  if ($("archiveVoterMessage")) {
    $("archiveVoterMessage").textContent =
      `Are you sure you want to archive ${voter.name}?`;
  }

  $("archiveVoterModal")?.classList.add("show");
}

function archiveAllVoters() {
  const activeVoters = getFilteredVoters();
  if (!activeVoters.length) {
    showSuccessToast("Archive Failed", "There are no active voters to archive.");
    return;
  }

  voterState.pendingArchiveId = null;
  voterState.pendingArchiveAll = true;
  if ($("archiveVoterMessage")) {
    $("archiveVoterMessage").textContent = `Are you sure you want to archive all ${activeVoters.length} active voters?`;
  }
  if ($("archiveVoterTitle")) $("archiveVoterTitle").textContent = "Archive All Voters?";
  $("archiveVoterModal")?.classList.add("show");
}

async function performArchiveVoter(id) {
  if (!id) {
    window.hideActionLoading();
    return;
  }

  try {
    const voter = voters.find((v) => v.uuid === id);

    if (!voter) {
      throw new Error("Voter record was not found.");
    }

    const response = await fetch(`${VOTER_API}/${id}/archive`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
      },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message || "Failed to archive voter."
      );
    }

    closeArchiveModal();

    await loadVoters();

    showSuccessToast(
      "Voter Archived",
      `${voter.name} was archived successfully.`
    );

  } catch (error) {
    console.error("Archive voter failed:", error);

    closeArchiveModal();

    showVotersStatusModal(
      "error",
      "Archive Failed",
      error.message || "Unable to archive voter."
    );

  } finally {
    window.hideActionLoading();
  }
}

async function performArchiveAllVoters() {
  const votersToArchive = getFilteredVoters();

  const ids = votersToArchive.map(voter => voter.uuid);

  if (!ids.length) {
    closeArchiveModal();
    window.hideActionLoading();
    return;
  }

  try {
    const response = await fetch(`${VOTER_API}/archive`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(ids)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message || "Failed to archive voters."
      );
    }

    const count = result.count ?? ids.length;

    closeArchiveModal();

    await loadVoters();

    showSuccessToast(
      "Voters Archived",
      `${count} voter(s) were archived successfully.`
    );

  } catch (error) {
    console.error("Archive all voters failed:", error);

    closeArchiveModal();

    showVotersStatusModal(
      "error",
      "Archive Failed",
      error.message || "Unable to archive voters."
    );

  } finally {
    window.hideActionLoading();
  }
}

function initializeDeleteAndArchive() {
  $("deleteAllVoters")?.addEventListener("click", deleteAllVoters);
  $("archiveAllVoters")?.addEventListener("click", archiveAllVoters);
}

async function restoreVoter(uuid) {
  const voter = voters.find((v) => v.uuid === uuid);
  if (!voter) return;

  window.showActionLoading(
    "Restoring Voter...",
    "Please wait while the voter is being restored."
  );

  try {
    const response = await fetch(`${VOTER_API}/${uuid}/restore`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
      },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message || "Failed to restore voter."
      );
    }

    await loadVoters();

    showSuccessToast(
      "Voter Restored",
      `${voter.name} was restored successfully.`
    );

  } catch (error) {
    console.error("Restore voter failed:", error);

    showVotersStatusModal(
      "error",
      "Restore Failed",
      error.message || "Unable to restore voter."
    );

  } finally {
    window.hideActionLoading();
  }
}

/* =========================================================
   GLOBAL ACTION LOADING MODAL
========================================================= */

function initializeActionLoadingModal() {
  const modal = $("actionLoadingModal");
  const title = $("actionLoadingTitle");
  const message = $("actionLoadingMessage");
  if (!modal || !title || !message) return;

  window.showActionLoading = (loadingTitle, loadingMessage) => {
    title.textContent = loadingTitle || "Processing...";
    message.textContent = loadingMessage || "Please wait while your request is being processed.";
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-loading");
  };

  window.hideActionLoading = () => {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-loading");
  };
}

/* =========================================================
   EXPORT
========================================================= */

function initializeExport() {
  $("exportVoters")?.addEventListener("click", () => {
    const params = new URLSearchParams();
    const campusUUIDMap = { "Kaypian": "62a45c28-56c9-4f39-b4a3-9bc3de5ce5a8", "Muzon": "9bc86421-63ce-4a7e-94ae-fc1bc6328956" };
    if (voterState.campus.length === 1) {
      params.set("campusId", campusUUIDMap[voterState.campus[0]] || voterState.campus[0]);
    }
    if (voterState.program[0]) params.set("program", voterState.program[0]);
    if (voterState.section[0]) params.set("section", voterState.section[0]);
    if (voterState.year[0]) params.set("yearLevel", voterState.year[0]);
    if (voterState.search) params.set("search", voterState.search);

    window.location.href = `${VOTER_API}/export?${params.toString()}`;
  });
}

/* =========================================================
   IMPORT
========================================================= */

function initializeImport() {
  const button = $("importVoters");
  const input = $("voterFileInput");
  if (!button || !input) return;

  button.addEventListener("click", () => input.click());

  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importVoterFile(file);
    input.value = "";
  });
}

async function importVoterFile(file) {
  window.showActionLoading(
    "Importing Voters...",
    "Please wait while the voter file is being processed."
  );

  try {
    const buffer = await file.arrayBuffer();

    const isCSV = file.name.toLowerCase().endsWith(".csv");

    const workbook = XLSX.read(buffer, {
      type: "array",
      raw: false,
      codepage: 65001
    });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    console.log("IMPORT FILE:", file.name);
    console.log("IMPORT SHEETS:", workbook.SheetNames);
    console.log("IMPORT RANGE:", sheet["!ref"]);

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    console.log("IMPORT LAST ROW:", range.e.r + 1);

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      blankrows: false
    });

    console.log("IMPORT ROW COUNT:", rows.length);

    rows.forEach((row, index) => {
      console.log(
        `IMPORT ROW ${index + 2}:`,
        row["Student ID"],
        row["Full Name"]
      );
    });

    console.log("IMPORT RAW ROWS:", rows);

    const imported = rows
      .map(normalizeImportedVoter)
      .filter(Boolean);

    console.log("IMPORT PAYLOAD:", imported);

    if (!imported.length) {
      throw new Error("No valid voter records were found.");
    }

    const response = await fetch(VOTER_API + "/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(imported)
    });

    console.log("IMPORT STATUS:", response.status);

    const result = await response.json().catch(() => ({}));

    console.log("IMPORT RESPONSE:", result);

    if (!response.ok) {
      throw new Error(
        result.message ||
        `Import failed. HTTP ${response.status}`
      );
    }

    await loadVoters();

    showVotersStatusModal(
      "success",
      "Import Successful",
      `Added: ${result.added ?? 0}
Updated: ${result.updated ?? 0}
Skipped: ${result.skipped ?? 0}`
    );

  } catch (error) {
    console.error("IMPORT ERROR:", error);

    showVotersStatusModal(
      "error",
      "Import Failed",
      error.message || "Unable to import voters."
    );

  } finally {
    window.hideActionLoading();
  }
}



function pickField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}

function normalizeImportedVoter(row) {
  const get = (name) => {
    const key = Object.keys(row).find(
      k => k.trim().toLowerCase() === name.toLowerCase()
    );
    return key ? String(row[key] ?? "").trim() : "";
  };

  const studentId = get("Student ID");
  const fullName = get("Full Name");
  const email = get("Email");
  const programCourse = get("Course") || get("Program");
  const yearLevel = get("Year Level") || get("Year");
  const section = get("Section");
  const campusValue = get("Campus");

  if (!studentId || !fullName) return null;

  const parts = fullName.split(/\s+/);

  const firstName = parts[0] || "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  const middleName = parts.length > 2
    ? parts.slice(1, -1).join(" ")
    : "";

  if (!firstName || !lastName) return null;

  const campusMap = {
    "Kaypian": "62a45c28-56c9-4f39-b4a3-9bc3de5ce5a8",
    "Muzon": "9bc86421-63ce-4a7e-94ae-fc1bc6328956"
  };

  return {
    studentId,
    lastName,
    firstName,
    middleName,
    fullName,
    email,
    programCourse,
    yearLevel,
    section,
    campusId: campusMap[campusValue] || campusValue
  };
}
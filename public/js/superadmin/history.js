/* ==========================================================
   LCCAST — HISTORY PAGE
========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // UI wiring first — must succeed regardless of network/socket state
  initializeHistoryTabs();
  initializeHistoryFilters();
  initializeVoteAdvancedFilters();
  initializeHistorySearch();
  initializeHistoryExports();
  initializeHistoryModals();
  initializeArchiveFilterButton();
  initializeArchiveViewActions();
  initializeTrashEmptyButton();
  initializeHistoryToast();
  initializeActionDetailsRecordSearch();

  loadVoteLogFilterOptions();
  loadCampusFilterOptions();

  loadActionFilterOptions();

  // Data fetches
  fetchVoteLogs(1);
  fetchActions(1);
  fetchArchives(1);
  fetchTrash(1);

  // Real-time — isolated so a socket failure can't break the rest of the page
  try {
    connectHistorySocket();
  } catch (err) {
    console.error("Failed to connect history socket", err);
  }
});

/* ==========================================================
   SAMPLE DATA
========================================================== */
async function loadCampusFilterOptions() {
  const select = document.getElementById("voteCampusFilter");
  if (!select) return;

  try {
    await SystemConfig.load();
    const prev = select.value;
    select.innerHTML =
      `<option value="">All Campuses</option>` +
      SystemConfig.campusOptionsHtml({ valueKey: "id", selected: prev });
  } catch (error) {
    console.error("Failed to load campuses:", error);
  }
}
/* ==========================================================
   API STATE
========================================================== */

const historyPageState = {
  voteLogs: 1,
  actions: 1,
  archives: 1,
  trash: 1,
};

let historyActionsCache = []; // last-fetched page of actions, for the details modal
let historyArchivesCache = []; // ADD

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, value);
    }
  });
  return query.toString();
}

async function apiGet(path, options = {}) {
  return SoftCache.load(path, { ttl: 20000, swr: false, ...options });
}
/* ==========================================================
   REAL-TIME (WEBSOCKET)
========================================================== */

let historyStompClient = null;

function connectHistorySocket() {
  if (typeof StompJs === "undefined" || typeof SockJS === "undefined") {
    console.error("StompJs/SockJS not loaded — real-time history updates disabled.");
    return;
  }

  historyStompClient = new StompJs.Client({
    webSocketFactory: () => new SockJS("/ws-analytics"),
    reconnectDelay: 4000,
    onConnect: () => {
        historyStompClient.subscribe("/topic/history/vote-logs", () => {
          SoftCache.clear();
          fetchVoteLogs(historyPageState.voteLogs);
        });
        historyStompClient.subscribe("/topic/history/actions", () => {
          SoftCache.clear();
          fetchActions(historyPageState.actions);
        });
        historyStompClient.subscribe("/topic/history/archives", () => {
          SoftCache.clear();
          fetchArchives(historyPageState.archives);
        });
        historyStompClient.subscribe("/topic/history/trash", () => {
          SoftCache.clear();
          fetchTrash(historyPageState.trash);
        });
    },
    onStompError: (frame) => {
      console.error("STOMP error", frame);
    },
    onWebSocketError: (event) => {
      console.error("WebSocket error", event);
    },
  });

  historyStompClient.activate();
}

async function fetchVoteLogs(page = historyPageState.voteLogs) {
renderHistoryTableSkeleton("voteLogsTable", 9);
  const search = document.getElementById("voteLogSearch")?.value.trim() || "";
    const program = document.getElementById("voteProgramFilter")?.value || "";
    const section = document.getElementById("voteSectionFilter")?.value || "";
    const year = document.getElementById("voteYearLevelFilter")?.value || "";
    const category = document.getElementById("voteElectionFilter")?.value || ""; // ADD
    const campusId = document.getElementById("voteCampusFilter")?.value || "";
    const sort = document.getElementById("voteSortFilter")?.value || "time-down";

    const query = buildQuery({ ...getVoteLogSearchParams(search), program, section, year, category, campusId, sort, page });

  try {
    const data = await apiGet(`/superadmin/api/history/vote-logs?${query}`);
    historyPageState.voteLogs = data.page;
    renderVoteLogs(data.items);
    renderHistoryPaginationControls("voteLogs", data.page, data.totalPages, resolveHistoryTotal(data));
    updateHistoryEmptyStateForItems(document.getElementById("voteLogs"), data.items.length);
  } catch (err) {
    console.error("Failed to load vote logs", err);
  }
}

async function fetchArchives(page = historyPageState.archives) {
renderHistoryCardSkeleton("archivesList");
  const search = document.getElementById("archiveSearch")?.value.trim() || "";
  const type = document.getElementById("archiveTypeFilter")?.value || "";

  const query = buildQuery({ search, type, page });

  try {
    const data = await apiGet(`/superadmin/api/history/archives?${query}`);
    historyPageState.archives = data.page;
    historyArchivesCache = data.items;
    renderArchives(data.items);
    renderHistoryPaginationControls("archives", data.page, data.totalPages, resolveHistoryTotal(data));
    updateHistoryEmptyStateForItems(document.getElementById("archives"), data.items.length);
  } catch (err) {
    console.error("Failed to load archives", err);
  }
}

async function fetchTrash(page = historyPageState.trash) {
renderHistoryCardSkeleton("trashList");
  const search = document.getElementById("trashSearch")?.value.trim() || "";
  const type = document.getElementById("trashTypeFilter")?.value || "";

  const query = buildQuery({ search, type, page });

  try {
    const data = await apiGet(`/superadmin/api/history/trash?${query}`);
    historyPageState.trash = data.page;
    renderTrash(data.items);
    renderHistoryPaginationControls("trash", data.page, data.totalPages, resolveHistoryTotal(data));
    updateHistoryEmptyStateForItems(document.getElementById("trash"), data.items.length);
  } catch (err) {
    console.error("Failed to load trash", err);
  }
}

async function fetchActions(page = historyPageState.actions) {
renderHistoryTableSkeleton("actionsTable", 6);
  const search = document.getElementById("actionSearch")?.value.trim() || "";
  const role = document.getElementById("actionRoleFilter")?.value || "";
  const action = document.getElementById("actionTypeFilter")?.value || "";

  const query = buildQuery({ search, role, action, page });

  try {
    const data = await apiGet(`/superadmin/api/history/actions?${query}`);
    historyPageState.actions = data.page;
    historyActionsCache = data.items;
    renderActions(data.items);
    renderHistoryPaginationControls("actions", data.page, data.totalPages, resolveHistoryTotal(data));
    updateHistoryEmptyStateForItems(document.getElementById("actions"), data.items.length);
  } catch (err) {
    console.error("Failed to load actions", err);
  }
}

function updateHistoryEmptyStateForItems(section, itemCount) {
  if (!section) return;

  let emptyState = section.querySelector(".history-empty");

  if (itemCount > 0) {
    if (emptyState) emptyState.style.display = "none";
    return;
  }

  if (!emptyState) {
    emptyState = document.createElement("div");
    emptyState.className = "history-empty";
    emptyState.innerHTML = `
            <div class="history-empty-icon"><i class="bi bi-inbox"></i></div>
            <h3>No records found</h3>
            <p>No records match your current search or filter.</p>
        `;

    const container =
      section.querySelector(".history-table-container") ||
      section.querySelector(".history-card-list");

    container?.appendChild(emptyState);
  }

  emptyState.style.display = "block";
}

const HISTORY_TABLE_SKELETON_ROWS = 8;

function renderHistoryTableSkeleton(tbodyId, columnCount) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: HISTORY_TABLE_SKELETON_ROWS })
    .map(
      () => `
      <tr class="history-skeleton-row">
        ${Array.from({ length: columnCount })
          .map((_, i) =>
            i === 0
              ? `<td><div class="history-skeleton-avatar-row">
                   <div class="skeleton history-skeleton-avatar"></div>
                   <div class="skeleton history-skeleton-line"></div>
                 </div></td>`
              : `<td><div class="skeleton history-skeleton-line"></div></td>`,
          )
          .join("")}
      </tr>`,
    )
    .join("");
}

function renderHistoryCardSkeleton(containerId, count = 4) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = Array.from({ length: count })
    .map(
      () => `
      <div class="history-skeleton-card">
        <div class="skeleton history-skeleton-card-icon"></div>
        <div class="history-skeleton-card-content">
          <div class="skeleton history-skeleton-card-title"></div>
          <div class="skeleton history-skeleton-card-meta"></div>
        </div>
      </div>`,
    )
    .join("");
}

function escapeActionDetailsHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* the server's total, under whichever name it uses; with a single page it is simply the item count */
function resolveHistoryTotal(data) {
  const raw = data.total ?? data.totalItems ?? data.totalElements ?? data.totalCount ?? data.count;
  if (raw !== null && raw !== undefined && Number.isFinite(Number(raw))) return Number(raw);
  if ((data.totalPages || 1) <= 1) return (data.items || []).length;
  return null; // unknown: the server has to send it
}

function setHistoryTabCount(sectionId, total) {
  const tab = document.querySelector(`.history-tab[data-section="${sectionId}"]`);
  if (!tab) return;

  let badge = tab.querySelector(".history-tab-count");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "history-tab-count";
    tab.appendChild(badge);
  }
  badge.textContent = total === null ? "" : total.toLocaleString();
}

function renderHistoryPaginationControls(sectionId, page, totalPages, totalCount = null) {
  const pages = Math.max(totalPages || 1, 1);

    const text = document.getElementById(`${sectionId}PaginationText`);
  if (text) text.textContent = `Page ${page} / ${pages}`;

  setHistoryTabCount(sectionId, totalCount);

  const capitalized = sectionId.charAt(0).toUpperCase() + sectionId.slice(1);
  const prevButton = document.getElementById(`previous${capitalized}Page`);
  const nextButton = document.getElementById(`next${capitalized}Page`);

  if (prevButton) {
    prevButton.disabled = page <= 1;
    prevButton.onclick = () => fetchForSection(sectionId, page - 1);
  }
  if (nextButton) {
    nextButton.disabled = page >= pages;
    nextButton.onclick = () => fetchForSection(sectionId, page + 1);
  }
}

function fetchForSection(sectionId, page) {
  if (sectionId === "voteLogs") fetchVoteLogs(page);
  if (sectionId === "actions") fetchActions(page);
  if (sectionId === "archives") fetchArchives(page);
  if (sectionId === "trash") fetchTrash(page);
}

/* ==========================================================
   TOAST
========================================================== */

let historyToastTimer = null;

function initializeHistoryToast() {
  const toast = document.getElementById("historySuccessToast");
  const closeButton = document.getElementById("historyToastClose");
  if (!toast) return;
  closeButton?.addEventListener("click", closeHistoryToast);
}

function showHistoryToast(
  title = "Success",
  message = "Action completed successfully.",
) {
  const toast = document.getElementById("historySuccessToast");
  if (!toast) return;

  const titleEl = document.getElementById("historyToastTitle");
  const messageEl = document.getElementById("historyToastMessage");
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;

  toast.classList.add("show");
  clearTimeout(historyToastTimer);
  historyToastTimer = setTimeout(closeHistoryToast, 3500);
}

function closeHistoryToast() {
  const toast = document.getElementById("historySuccessToast");
  if (!toast) return;
  toast.classList.remove("show");
  clearTimeout(historyToastTimer);
}

/* ==========================================================
   ACTION LOADING MODAL
========================================================== */

function showHistoryActionLoading(
  title = "Processing...",
  message = "Please wait while we process your request.",
) {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) return;

  const titleElement = document.getElementById("actionLoadingTitle");
  const messageElement = document.getElementById("actionLoadingMessage");

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }

  modal.classList.add("show");
  document.body.classList.add("modal-loading");
}

function hideHistoryActionLoading() {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) return;

  modal.classList.remove("show");
  document.body.classList.remove("modal-loading");
}

function runHistoryActionWithLoading(title, message, callback) {
    showHistoryActionLoading(title, message);

    setTimeout(() => {
        try {
            callback?.();
        } finally {
            hideHistoryActionLoading();
        }
    }, 500);
}

/* ==========================================================
   TABS
========================================================== */

function initializeHistoryTabs() {
  const tabs = document.querySelectorAll(".history-tab");
  const sections = document.querySelectorAll(".history-section");
  if (!tabs.length || !sections.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      tabs.forEach((item) => item.classList.remove("active"));
      sections.forEach((section) => section.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.section)?.classList.add("active");
    });
  });
}

/* ==========================================================
   FILTERS
========================================================== */

const VOTE_ADVANCED_FILTER_IDS = [
  "voteProgramFilter",
  "voteSectionFilter",
  "voteYearLevelFilter",
  "voteCampusFilter",
  "voteSortFilter",
];

function initializeHistoryFilters() {
  document.querySelectorAll(".history-filter").forEach((filter) => {
    filter.addEventListener("change", () => {
      const section = filter.closest(".history-section");
      if (!section) return;

      if (section.id === "voteLogs" && VOTE_ADVANCED_FILTER_IDS.includes(filter.id)) {
        return; // applied via the Apply button in initializeVoteAdvancedFilters
      }

      fetchForSection(section.id, 1);
    });
  });
}

function initializeVoteAdvancedFilters() {
  const button = document.getElementById("voteAdvancedFilterBtn");
  const dropdown = document.getElementById("voteAdvancedFilterDropdown");
  const closeButton = document.getElementById("closeVoteFilters");
  const clearButton = document.getElementById("clearVoteFilters");
  const applyButton = document.getElementById("applyVoteFilters");
  const section = document.getElementById("voteLogs");
  if (!button || !dropdown || !section) return;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    dropdown.classList.toggle("show");
    button.classList.toggle("active", dropdown.classList.contains("show"));
  });

  closeButton?.addEventListener("click", closeVoteFilterDropdown);

  section
    .querySelectorAll(VOTE_ADVANCED_FILTER_IDS.map((id) => `#${id}`).join(", "))
    .forEach((filter) =>
      filter.addEventListener("change", updateVoteFilterCount),
    );

    applyButton?.addEventListener("click", () => {
      fetchVoteLogs(1);
      updateVoteFilterCount();
      closeVoteFilterDropdown();
    });

    clearButton?.addEventListener("click", () => {
      section.querySelectorAll(".history-filter").forEach((filter) => {
        if (VOTE_ADVANCED_FILTER_IDS.includes(filter.id)) filter.value = "";
      });
      fetchVoteLogs(1);
      updateVoteFilterCount();
    });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target) && !button.contains(event.target)) {
      closeVoteFilterDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeVoteFilterDropdown();
  });

  updateVoteFilterCount();
}

function closeVoteFilterDropdown() {
  document
    .getElementById("voteAdvancedFilterDropdown")
    ?.classList.remove("show");
  document.getElementById("voteAdvancedFilterBtn")?.classList.remove("active");
}

function updateVoteFilterCount() {
  const countElement = document.getElementById("voteFilterCount");
  if (!document.getElementById("voteLogs") || !countElement) return;

  const count = VOTE_ADVANCED_FILTER_IDS.filter(
    (id) => document.getElementById(id)?.value,
  ).length;

  countElement.textContent = count;
  countElement.classList.toggle("visible", count > 0);
}

/* ==========================================================
   SEARCH
========================================================== */

let historySearchDebounce = null;

function debouncedFetch(fn) {
  clearTimeout(historySearchDebounce);
  historySearchDebounce = setTimeout(fn, 300);
}

function initializeHistorySearch() {
  document.getElementById("voteLogSearch")?.addEventListener("input", () =>
    debouncedFetch(() => fetchVoteLogs(1)),
  );
  document.getElementById("actionSearch")?.addEventListener("input", () =>
    debouncedFetch(() => fetchActions(1)),
  );
  document.getElementById("archiveSearch")?.addEventListener("input", () =>
    debouncedFetch(() => fetchArchives(1)),
  );
  document.getElementById("trashSearch")?.addEventListener("input", () =>
    debouncedFetch(() => fetchTrash(1)),
  );
}

const HISTORY_SEARCH_INPUT_IDS = {
  voteLogs: "voteLogSearch",
  actions: "actionSearch",
  archives: "archiveSearch",
  trash: "trashSearch",
};

/* ==========================================================
   APPLY FILTERS
========================================================== */

function applyHistoryFilters(section) {
  if (!section) return;

  const rows = section.querySelectorAll(".history-row");
  if (!rows.length) return;

  const searchInputId = HISTORY_SEARCH_INPUT_IDS[section.id];
  const searchInput = searchInputId
    ? document.getElementById(searchInputId)
    : null;
  const search = searchInput ? searchInput.value.toLowerCase().trim() : "";

  const filters = section.querySelectorAll(".history-filter");

  rows.forEach((row) => {
    let visible = true;

    if (search && !row.textContent.toLowerCase().includes(search)) {
      visible = false;
    }

    filters.forEach((filter) => {
      if (!visible || !filter.value || filter.dataset.filter === "sort") return;

      const rowValue = row.dataset[filter.dataset.filter];
      if (rowValue && rowValue.toLowerCase() !== filter.value.toLowerCase()) {
        visible = false;
      }
    });

    row.dataset.historyFiltered = visible ? "true" : "false";
    row.style.display = visible ? "" : "none";
  });

  if (section.id === "voteLogs") sortVoteLogs();

  updateHistoryEmptyState(section);

  if (["voteLogs", "actions", "archives", "trash"].includes(section.id)) {
    historyPaginationState[section.id] = 1;
    renderHistoryPagination(section);
  }
}

function sortVoteLogs() {
  const sortFilter = document.getElementById("voteSortFilter");
  const tbody = document.getElementById("voteLogsTable");
  if (!sortFilter?.value || !tbody) return;

  const rows = [...tbody.querySelectorAll(".history-row")];
  const sort = sortFilter.value;

  rows.sort((a, b) => {
    if (sort === "az" || sort === "za") {
      const aName =
        a
          .querySelector(".history-user strong")
          ?.textContent.trim()
          .toLowerCase() || "";
      const bName =
        b
          .querySelector(".history-user strong")
          ?.textContent.trim()
          .toLowerCase() || "";
      return sort === "az"
        ? aName.localeCompare(bName)
        : bName.localeCompare(aName);
    }

    if (sort === "time-up" || sort === "time-down") {
      const aTime = new Date(a.dataset.time).getTime();
      const bTime = new Date(b.dataset.time).getTime();
      return sort === "time-up" ? aTime - bTime : bTime - aTime;
    }

    return 0;
  });

  rows.forEach((row) => tbody.appendChild(row));
}

/* ==========================================================
   EMPTY STATE
========================================================== */

function updateHistoryEmptyState(section) {
  if (!section) return;

  const rows = section.querySelectorAll(".history-row");
  let emptyState = section.querySelector(".history-empty");
  const hasVisibleRows = [...rows].some((row) => row.style.display !== "none");

  if (hasVisibleRows) {
    if (emptyState) emptyState.style.display = "none";
    return;
  }

  if (!emptyState) {
    emptyState = document.createElement("div");
    emptyState.className = "history-empty";
    emptyState.innerHTML = `
            <div class="history-empty-icon"><i class="bi bi-inbox"></i></div>
            <h3>No records found</h3>
            <p>No records match your current search or filter.</p>
        `;

    const container =
      section.querySelector(".history-table-container") ||
      section.querySelector(".history-card-list");

    container?.appendChild(emptyState);
  }

  emptyState.style.display = "block";
}

/* ==========================================================
   EXPORT
========================================================== */

/* ==========================================================
   EXPORT (CSV / EXCEL / PDF)
========================================================== */

// admin-ssc:   HISTORY_API_BASE  (already defined at the top of that file)
// admin-dept:  replace the next line with:  const HISTORY_EXPORT_API = "/api/admin-dept/history";
// superadmin:  replace the next line with:  const HISTORY_EXPORT_API = "/superadmin/api/history";
const HISTORY_EXPORT_API = "/superadmin/api/history";

/** Archives/Trash have no "all" mode, so walk every page with the existing endpoints. */
function initializeHistoryExports() {
  const val = (id) => document.getElementById(id)?.value || "";

  HistoryExport.init({
    /* ---------------- VOTE LOGS ---------------- */
    voteLogs: {
      buttonId: "exportVoteLogs",
      menuId: "exportVoteLogsMenu",
      getData: async () => {
        const query = buildQuery({
          ...getVoteLogSearchParams(val("voteLogSearch").trim()),
          program: val("voteProgramFilter"),
          section: val("voteSectionFilter"),
          year: val("voteYearLevelFilter"),
          category: val("voteElectionFilter"),
          campusId: val("voteCampusFilter"),
          sort: val("voteSortFilter") || "time-down",
          all: true,
        });

        const data = await apiGet(`${HISTORY_EXPORT_API}/vote-logs?${query}`, { force: true });

        return {
          title: "Vote Logs",
          filename: "lccast-vote-logs",
          emptyMessage: "There are no vote log records to export.",
          filters: HistoryExport.describeFilters([
            ["Search", "voteLogSearch"],
            ["Election", "voteElectionFilter"],
            ["Program", "voteProgramFilter"],
            ["Section", "voteSectionFilter"],
            ["Year Level", "voteYearLevelFilter"],
            ["Campus", "voteCampusFilter"],
            ["Sort", "voteSortFilter"],
          ]),
          headers: ["Voter", "Student ID", "Reference ID", "Program", "Section", "Year Level", "Campus", "Election", "Date & Time"],
          rows: data.items.map((r) => [
            r.fullName,
            r.studentId,
            buildHistoryReferenceNumber(r),
            r.programCourse || "",
            r.section || "",
            r.yearLevel || "",
            r.campusName || "",
            formatHistoryElection(r),
            formatDateTime(r.votedAt),
          ]),
        };
      },
    },

    /* ---------------- ACTIONS ---------------- */
    actions: {
      buttonId: "exportActions",
      menuId: "exportActionsMenu",
      getData: async () => {
        const query = buildQuery({
          search: val("actionSearch").trim(),
          role: val("actionRoleFilter"),
          action: val("actionTypeFilter"),
          all: true,
        });

        const data = await apiGet(`${HISTORY_EXPORT_API}/actions?${query}`, { force: true });

        return {
          title: "Actions",
          filename: "lccast-actions",
          emptyMessage: "There are no action records to export.",
          filters: HistoryExport.describeFilters([
            ["Search", "actionSearch"],
            ["Role", "actionRoleFilter"],
            ["Action", "actionTypeFilter"],
          ]),
          headers: ["User", "Role", "Action", "Description", "Date & Time"],
          rows: data.items.map((r) => [
            r.user,
            r.role,
            r.action,
            r.description,
            formatDateTime(r.createdAt),
          ]),
        };
      },
    },
  });
}

function downloadCSV(headers, rows, filename) {
  const csvField = (value) =>
    `"${String(value ?? "").replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`;
  const csv = [headers.map(csvField).join(","), ...rows.map((row) => row.map(csvField).join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ==========================================================
   MODALS
========================================================== */

let historyDeleteCallback = null;
let historyRestoreCallback = null;

let currentActionDetails = [];
let currentActionDetailsPage = 1;
const ACTION_DETAILS_PAGE_SIZE = 5;

function initializeHistoryModals() {
  initializeActionDetailsModal();

  const deleteModal = document.getElementById("historyDeleteModal");
  const restoreModal = document.getElementById("historyRestoreModal");

  document
    .getElementById("historyDeleteCancel")
    ?.addEventListener("click", closeHistoryDeleteModal);
  document.getElementById("historyDeleteConfirm")?.addEventListener("click", () => {
    const callback = historyDeleteCallback;

    closeHistoryDeleteModal();

    runHistoryActionWithLoading(
        "Deleting...",
        "Please wait while the record is being deleted.",
        callback
    );
});

  document
    .getElementById("historyRestoreCancel")
    ?.addEventListener("click", closeHistoryRestoreModal);
  document.getElementById("historyRestoreConfirm")?.addEventListener("click", () => {
    const callback = historyRestoreCallback;

    closeHistoryRestoreModal();

    runHistoryActionWithLoading(
        "Restoring...",
        "Please wait while the record is being restored.",
        callback
    );
});

  [deleteModal, restoreModal].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) modal.classList.remove("show");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeHistoryDeleteModal();
    closeHistoryRestoreModal();
  });
}

/* ==========================================================
   ACTION DETAILS — RECORD SEARCH
========================================================== */

function initializeActionDetailsRecordSearch() {
  const searchInput = document.getElementById("actionDetailsRecordSearch");

  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    // Always go back to page 1 when searching
    currentActionDetailsPage = 1;

    renderActionDetailsRecords();
  });
}

function initializeActionDetailsModal() {
  const modal = document.getElementById("historyActionDetailsModal");

  if (!modal) return;



  /*
   * HEADER CLOSE BUTTON
   */
  document
    .getElementById("actionDetailsClose")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      closeActionDetailsModal();
    });

  /*
   * FOOTER CLOSE BUTTON
   */
  document
    .getElementById("actionDetailsCloseBtn")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      closeActionDetailsModal();
    });

  /*
   * SEARCH CLEAR BUTTON
   */
  document
    .getElementById("actionDetailsSearchClear")
    ?.addEventListener("click", (event) => {
      event.preventDefault();

      const searchInput = document.getElementById("actionDetailsRecordSearch");

      if (!searchInput) return;

      searchInput.value = "";

      currentActionDetailsPage = 1;

      renderActionDetailsRecords();

      searchInput.focus();
    });

  /*
   * CLOSE WHEN CLICKING THE OVERLAY
   */
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeActionDetailsModal();
    }
  });

  /*
   * CLOSE WITH ESCAPE
   */
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) {
      closeActionDetailsModal();
    }
  });
}
/* ==========================================================
   ACTION DETAILS MODAL
========================================================== */

function openActionDetailsModal(record) {
  const modal = document.getElementById("historyActionDetailsModal");

  if (!modal || !record) return;

  /*
   * TITLE
   */
  const title = document.getElementById("actionDetailsTitle");

  if (title) {
    title.textContent = record.action || "Action Details";
  }

  /*
   * SUBTITLE
   */
  const subtitle = document.getElementById("actionDetailsSubtitle");

  if (subtitle) {
    subtitle.textContent =
      record.description || "Review the records affected by this action.";
  }

  /*
   * SUMMARY
   */
  const summary = document.getElementById("actionDetailsSummary");

  if (summary) {
    const icon = record.icon || "bi-activity";

    const description = escapeActionDetailsHTML(
      record.description || "No description available.",
    );

    const user = escapeActionDetailsHTML(record.user || "Unknown user");

    const role = escapeActionDetailsHTML(record.role || "Unknown role");

    const dateTime = escapeActionDetailsHTML(record.dateTime || "Unknown date");

    summary.innerHTML = `

            <div class="action-details-summary-icon">

                <i class="bi ${icon}"></i>

            </div>

            <div class="action-details-summary-info">

                <strong>
                    ${description}
                </strong>

                <div class="action-details-summary-meta">

                    <span>
                        <i class="bi bi-person"></i>
                        ${user}
                    </span>

                    <span>
                        <i class="bi bi-shield"></i>
                        ${role}
                    </span>

                    <span>
                        <i class="bi bi-clock"></i>
                        ${dateTime}
                    </span>

                </div>

            </div>

        `;
  }

  /*
   * AFFECTED RECORDS
   */
  currentActionDetails = Array.isArray(record.details) ? record.details : [];

  currentActionDetailsPage = 1;

  /*
   * RESET SEARCH
   */
  const recordSearch = document.getElementById("actionDetailsRecordSearch");

  if (recordSearch) {
    recordSearch.value = "";
  }

  /*
   * RENDER RECORDS
   */
  renderActionDetailsRecords();

  /*
   * OPEN MODAL
   */
  modal.classList.add("show");

  document.body.classList.add("modal-open");
}

function renderActionDetailsRecords() {
  const list = document.getElementById("actionDetailsRecordList");

  const count = document.getElementById("actionDetailsSearchCount");

  const pagination = document.getElementById("actionDetailsRecordPagination");

  const searchInput = document.getElementById("actionDetailsRecordSearch");

  if (!list) return;

  const search = searchInput ? searchInput.value.toLowerCase().trim() : "";

  /*
   * FILTER RECORDS
   */
  const filtered = currentActionDetails.filter((record) => {
    if (!search) return true;

    return [record.target, record.field, record.from, record.to]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });

  /*
   * UPDATE COUNT
   */
  if (count) {
    count.textContent = `${filtered.length} ${
      filtered.length === 1 ? "record" : "records"
    }`;
  }

  /*
   * EMPTY STATE
   */
  if (!filtered.length) {
    list.innerHTML = `

            <div class="action-details-record-empty">

                <div class="action-details-record-empty-icon">
                    <i class="bi bi-search"></i>
                </div>

                <strong>
                    No affected records found
                </strong>

                <span>
                    Try searching by name, ID, or changed value.
                </span>

            </div>

        `;

    if (pagination) {
      pagination.innerHTML = "";
    }

    return;
  }

  /*
   * PAGINATION
   */
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / ACTION_DETAILS_PAGE_SIZE),
  );

  if (currentActionDetailsPage > totalPages) {
    currentActionDetailsPage = totalPages;
  }

  const startIndex = (currentActionDetailsPage - 1) * ACTION_DETAILS_PAGE_SIZE;

  const pageRecords = filtered.slice(
    startIndex,
    startIndex + ACTION_DETAILS_PAGE_SIZE,
  );

  /*
   * RENDER RECORDS
   */
  list.innerHTML = pageRecords
    .map((record) => {
      const target = escapeActionDetailsHTML(record.target || "Unknown record");

      const field = escapeActionDetailsHTML(record.field || "Changed field");

      const from = escapeActionDetailsHTML(record.from ?? "—");

      const to = escapeActionDetailsHTML(record.to ?? "—");

      return `

                <div class="action-details-record-item">

                    <div class="action-details-record-icon">

                        <i class="bi bi-person"></i>

                    </div>


                    <div class="action-details-record-info">

                        <strong>
                            ${target}
                        </strong>

                        <span>
                            ${field}
                        </span>

                    </div>


                    <div class="action-details-record-change">

                        <span class="action-details-record-old">
                            ${from}
                        </span>

                        <i class="bi bi-arrow-right action-details-record-arrow"></i>

                        <strong class="action-details-record-new">
                            ${to}
                        </strong>

                    </div>

                </div>

            `;
    })
    .join("");

  /*
   * PAGINATION
   */
  if (!pagination) return;

  if (totalPages <= 1) {
    pagination.innerHTML = "";

    return;
  }

  pagination.innerHTML = `

        <button
            type="button"
            class="action-details-pagination-btn"
            data-page="previous"
            ${currentActionDetailsPage === 1 ? "disabled" : ""}
            aria-label="Previous page"
        >
            <i class="bi bi-chevron-left"></i>
        </button>


        <span>
            Page ${currentActionDetailsPage} / ${totalPages}
        </span>


        <button
            type="button"
            class="action-details-pagination-btn"
            data-page="next"
            ${currentActionDetailsPage === totalPages ? "disabled" : ""}
            aria-label="Next page"
        >
            <i class="bi bi-chevron-right"></i>
        </button>

    `;

  pagination
    .querySelector('[data-page="previous"]')
    ?.addEventListener("click", () => {
      if (currentActionDetailsPage <= 1) {
        return;
      }

      currentActionDetailsPage--;

      renderActionDetailsRecords();
    });

  pagination
    .querySelector('[data-page="next"]')
    ?.addEventListener("click", () => {
      if (currentActionDetailsPage >= totalPages) {
        return;
      }

      currentActionDetailsPage++;

      renderActionDetailsRecords();
    });
}

function closeActionDetailsModal() {
  const modal = document.getElementById("historyActionDetailsModal");

  if (!modal) return;

  modal.classList.remove("show");

  document.body.classList.remove("modal-open");
}

/* ==========================================================
   DELETE / RESTORE MODALS
========================================================== */

function openHistoryDeleteModal(title, message, callback) {
  const modal = document.getElementById("historyDeleteModal");
  if (!modal) return;

  const titleEl = document.getElementById("historyDeleteModalTitle");
  const messageEl = document.getElementById("historyDeleteModalMessage");
  if (titleEl) titleEl.textContent = title || "Delete Record?";
  if (messageEl)
    messageEl.textContent =
      message || "Are you sure you want to delete this record?";

  historyDeleteCallback = callback || null;
  modal.classList.add("show");
}

function closeHistoryDeleteModal() {
  document.getElementById("historyDeleteModal")?.classList.remove("show");
  historyDeleteCallback = null;
}

function openHistoryRestoreModal(title, message, callback) {
  const modal = document.getElementById("historyRestoreModal");
  if (!modal) return;

  const titleEl = document.getElementById("historyRestoreModalTitle");
  const messageEl = document.getElementById("historyRestoreModalMessage");
  if (titleEl) titleEl.textContent = title || "Restore Record?";
  if (messageEl)
    messageEl.textContent =
      message || "Are you sure you want to restore this record?";

  historyRestoreCallback = callback || null;
  modal.classList.add("show");
}

function closeHistoryRestoreModal() {
  document.getElementById("historyRestoreModal")?.classList.remove("show");
  historyRestoreCallback = null;
}

/* ==========================================================
   RENDER SAMPLE DATA
========================================================== */

function renderHistorySampleData() {
  renderVoteLogs();
  renderActions();
  renderArchives();
  renderTrash();
}


function buildHistoryReferenceNumber(record) {
  if (!record.ballotId) return "N/A";
  const shortId = record.ballotId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const prefix = (record.electionCategory || "").toUpperCase() === "SSC" ? "SSC" : "DEPT";
  return `VS-${prefix}-${shortId}`;
}

// "SSC - [Election Name]" or "Department - [Election Name]"
function formatHistoryElection(record) {
  const type =
    (record.electionCategory || "").toUpperCase() === "SSC" ? "SSC" : "Department";
  const name = record.electionName || "";
  return name ? `${type} | ${name}` : type;
}

// Reference IDs look like VS-SSC-1A2B3C4D / VS-DEPT-1A2B3C4D.
// The last part is the first 8 hex chars of the ballot UUID (dashes removed),
// so the server can match it as a ballot ID prefix.
// Only a complete reference like VS-SSC-3940DB2B (or VS-DEPT-...) searches by reference.
// Anything else is treated as a normal name/ID search.
function getVoteLogSearchParams(rawSearch) {
  const search = (rawSearch || "").trim();
  const match = search.match(/^VS-(?:SSC|DEPT)-([0-9A-F]{8})$/i);

  if (match) return { ballotRef: match[1].toLowerCase() };
  return { search };
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function renderVoteLogs(items) {
  const tbody = document.getElementById("voteLogsTable");
  if (!tbody) return;

  tbody.innerHTML = items
    .map(
      (record) => `
        <tr class="history-row" data-id="${record.id}">
            <td>
                <div class="history-user">
                    <div class="history-avatar">${record.initials}</div>
                    <div>
                        <strong>${escapeActionDetailsHTML(record.fullName)}</strong>
                        <small>${escapeActionDetailsHTML(record.email || "")}</small>
                    </div>
                </div>
            </td>
            <td>${escapeActionDetailsHTML(record.studentId)}</td>
            <td>${escapeActionDetailsHTML(buildHistoryReferenceNumber(record))}</td>
            <td>${escapeActionDetailsHTML(record.programCourse || "")}</td>
            <td>${escapeActionDetailsHTML(record.section || "")}</td>
            <td>${escapeActionDetailsHTML(record.yearLevel || "")}</td>
            <td>${escapeActionDetailsHTML(record.campusName || "")}</td>
            <td>${escapeActionDetailsHTML(formatHistoryElection(record))}</td>
            <td>${formatDateTime(record.votedAt)}</td>
        </tr>
    `,
    )
    .join("");
}

/*
   * View Details buttons
   *
   * These buttons are created by renderActions().
   */
  function bindActionDetailsButtons() {
    document.querySelectorAll(".action-details-btn").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const id = button.dataset.actionId;
        const record = historyActionsCache.find((r) => r.id === id);

        if (!record) return;

        openActionDetailsModal(record);
      });
    });
  }

  // Profile picture when the user has one; initials otherwise (also if the image fails to load)
  function renderHistoryAvatar(record) {
    const initials = escapeActionDetailsHTML(record.initials);

    if (!record.profilePictureUrl) {
      return `<div class="history-avatar">${initials}</div>`;
    }

    return `<div class="history-avatar">
              <span>${initials}</span>
              <img src="${escapeActionDetailsHTML(record.profilePictureUrl)}"
                   alt=""
                   loading="lazy"
                   onerror="this.remove()" />
            </div>`;
  }

function renderActions(items) {
  const tbody = document.getElementById("actionsTable");
  if (!tbody) return;

  tbody.innerHTML = items
    .map((record) => {
      const badge = getActionBadgeInfo(record.action);
      const actionClass = badge.class;
      const icon = badge.icon;

      return `
            <tr class="history-row" data-id="${record.id}">
                <td>
                    <div class="history-user">
                        ${renderHistoryAvatar(record)}
                        <div>
                            <strong>${escapeActionDetailsHTML(record.user)}</strong>
                            <small>${escapeActionDetailsHTML(record.role)}</small>
                        </div>
                    </div>
                </td>
                <td><span class="role-badge ${record.roleClass || ""}">${escapeActionDetailsHTML(record.role)}</span></td>
                <td>
                    <span class="action-badge ${actionClass}">
                        <i class="bi ${icon}"></i>
                        ${escapeActionDetailsHTML(record.action)}
                    </span>
                </td>
                <td><div class="action-description"><span>${escapeActionDetailsHTML(record.description)}</span></div></td>
                <td>${formatDateTime(record.createdAt)}</td>
            </tr>
        `;
    })
    .join("");
}

const ENTITY_ICONS = {
  Elections: "bi-calendar-event",
  Partylists: "bi-people",
  Departments: "bi-building",
  Students: "bi-person",
  Candidates: "bi-person-badge",
  Admins: "bi-person-gear",
};

const ACTION_BADGE_RULES = [
  { match: /fail|denied|invalid|locked/i,                  class: "failed",   icon: "bi-exclamation-triangle" },
  { match: /login|sign in/i,                               class: "login",    icon: "bi-box-arrow-in-right" },
  { match: /logout|sign out/i,                             class: "logout",   icon: "bi-box-arrow-right" },
  { match: /password|security|otp|reset/i,                 class: "security", icon: "bi-shield-lock" },
  { match: /restor/i,                                      class: "restore",  icon: "bi-arrow-counterclockwise" },
  { match: /archiv/i,                                      class: "archive",  icon: "bi-archive" },
  { match: /delet|remov|trash|purge|\b(empty|emptied)\b/i, class: "delete",   icon: "bi-trash3" },
  { match: /import/i,                                      class: "import",   icon: "bi-upload" },
  { match: /export|download/i,                             class: "export",   icon: "bi-download" },
  { match: /vote|ballot/i,                                 class: "vote",     icon: "bi-check2-square" },
  { match: /\b(start|started|open|opened|publish|published|launch|launched|activate|activated)\b/i, class: "start", icon: "bi-play-circle" },
  { match: /\b(end|ended|close|closed|stop|stopped|deactivate|deactivated)\b/i, class: "end", icon: "bi-stop-circle" },
  { match: /\b(creat\w*|add\w*|register\w*)/i,             class: "create",   icon: "bi-plus-circle" },
  { match: /updat|edit|chang|modif/i,                      class: "update",   icon: "bi-pencil-square" },
];

function getActionBadgeInfo(actionName) {
  const text = String(actionName || "").replace(/_/g, " ");
  return (
    ACTION_BADGE_RULES.find((rule) => rule.match.test(text)) || {
      class: "default",
      icon: "bi-activity",
    }
  );
}

function renderArchives(items) {
  const container = document.getElementById("archivesList");
  if (!container) return;

  container.innerHTML = items
    .map(
      (record) => `
        <article class="history-card history-row" data-id="${record.id}">
            <div class="history-card-icon archive"><i class="bi ${ENTITY_ICONS[record.entityType] || "bi-archive"}"></i></div>
            <div class="history-card-content">
                <div class="history-card-header">
                    <div>
                        <h3>${escapeActionDetailsHTML(record.entityName || "Untitled")}</h3>
                        <small>${escapeActionDetailsHTML(record.entityType)}</small>
                    </div>
                    <span class="archive-status">Archived</span>
                </div>
                <div class="history-card-meta">
                    <span><i class="bi bi-calendar"></i> Archived ${formatDateTime(record.archivedAt)}</span>
                    <span><i class="bi bi-person"></i> By ${escapeActionDetailsHTML(record.archivedBy)}</span>
                </div>
            </div>
            <div class="history-card-actions">
                <button type="button" class="icon-btn view-archive"><i class="bi bi-eye"></i></button>
                <button type="button" class="icon-btn restore-archive"><i class="bi bi-arrow-counterclockwise"></i></button>
            </div>
        </article>
    `,
    )
    .join("");

  bindHistoryTrashActions();
}

function renderTrash(items) {
  const container = document.getElementById("trashList");
  if (!container) return;

  container.innerHTML = items
    .map(
      (record) => `
        <article class="history-card trash-card history-row" data-id="${record.id}">
            <div class="history-card-icon trash"><i class="bi ${ENTITY_ICONS[record.entityType] || "bi-trash3"}"></i></div>
            <div class="history-card-content">
                <div class="history-card-header">
                    <div>
                        <h3>${escapeActionDetailsHTML(record.entityName || "Untitled")}</h3>
                        <small>${escapeActionDetailsHTML(record.entityType)}</small>
                    </div>
                    <span class="trash-expiration"><i class="bi bi-clock"></i> ${record.daysRemaining} days remaining</span>
                </div>
                <div class="history-card-meta">
                    <span><i class="bi bi-trash3"></i> Deleted ${formatDateTime(record.deletedAt)}</span>
                    <span><i class="bi bi-person"></i> By ${escapeActionDetailsHTML(record.deletedBy)}</span>
                </div>
            </div>
            <div class="history-card-actions">
                <button type="button" class="icon-btn restore-trash"><i class="bi bi-arrow-counterclockwise"></i></button>
                <button type="button" class="icon-btn permanent-delete"><i class="bi bi-trash3"></i></button>
            </div>
        </article>
    `,
    )
    .join("");

  bindHistoryTrashActions();
}

function formatActionLabel(value) {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function loadActionFilterOptions() {
  const select = document.getElementById("actionTypeFilter");
  if (!select) return;

  try {
    const values = await apiGet(`/superadmin/api/history/actions/filter-options`, { ttl: 300000 });
    const previous = select.value;

    select.innerHTML =
      `<option value="">All Actions</option>` +
      (values || [])
        .map(
          (v) =>
            `<option value="${escapeActionDetailsHTML(v)}">${escapeActionDetailsHTML(formatActionLabel(v))}</option>`,
        )
        .join("");

    if ((values || []).includes(previous)) select.value = previous;
  } catch (err) {
    console.error("Failed to load action filter options", err);
  }
}

async function loadVoteLogFilterOptions() {
  try {
    const data = await apiGet(`/superadmin/api/history/vote-logs/filter-options`);
    populateFilterSelect("voteProgramFilter", data.programs, "All Program/Courses");
    populateFilterSelect("voteSectionFilter", data.sections, "All Sections");
    populateFilterSelect("voteYearLevelFilter", data.yearLevels, "All Year Levels");
  } catch (err) {
    console.error("Failed to load vote log filter options", err);
  }
}

function populateFilterSelect(selectId, values, allLabel) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const previousValue = select.value;

  select.innerHTML =
    `<option value="">${allLabel}</option>` +
    (values || [])
      .map((v) => `<option value="${escapeActionDetailsHTML(v)}">${escapeActionDetailsHTML(v)}</option>`)
      .join("");

  if (values && values.includes(previousValue)) {
    select.value = previousValue;
  }
}

/* ==========================================================
   PAGINATION
========================================================== */

const HISTORY_PAGE_SIZE = 10;
const HISTORY_SECTION_IDS = ["voteLogs", "actions", "archives", "trash"];

const historyPaginationState = {
  voteLogs: 1,
  actions: 1,
  archives: 1,
  trash: 1,
};

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function initializeHistoryPagination() {
  HISTORY_SECTION_IDS.forEach((sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const previousButton = document.getElementById(
      `previous${capitalize(sectionId)}Page`,
    );
    const nextButton = document.getElementById(
      `next${capitalize(sectionId)}Page`,
    );

    previousButton?.addEventListener("click", () => {
      if (historyPaginationState[sectionId] <= 1) return;
      historyPaginationState[sectionId]--;
      renderHistoryPagination(section);
    });

    nextButton?.addEventListener("click", () => {
      const totalPages = getHistoryTotalPages(section);
      if (historyPaginationState[sectionId] >= totalPages) return;
      historyPaginationState[sectionId]++;
      renderHistoryPagination(section);
    });

    renderHistoryPagination(section);
  });
}

function getHistoryPaginationRows(section) {
  if (!section) return [];
  return [...section.querySelectorAll(".history-row")].filter(
    (row) => row.dataset.historyFiltered !== "false",
  );
}

function getHistoryTotalPages(section) {
  return Math.max(
    1,
    Math.ceil(getHistoryPaginationRows(section).length / HISTORY_PAGE_SIZE),
  );
}

function renderHistoryPagination(section) {
  if (!section || !HISTORY_SECTION_IDS.includes(section.id)) return;

  const sectionId = section.id;
  const rows = getHistoryPaginationRows(section);
  const totalPages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE));

  let currentPage = historyPaginationState[sectionId] || 1;
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  historyPaginationState[sectionId] = currentPage;

  // Hide every row, then reveal only the current page's slice.
  section.querySelectorAll(".history-row").forEach((row) => {
    row.style.display = "none";
  });

  const startIndex = (currentPage - 1) * HISTORY_PAGE_SIZE;
  rows.slice(startIndex, startIndex + HISTORY_PAGE_SIZE).forEach((row) => {
    row.style.display = "";
  });

  const paginationText = document.getElementById(`${sectionId}PaginationText`);
  if (paginationText)
    paginationText.textContent = `Page ${currentPage} / ${totalPages}`;

  const previousButton = document.getElementById(
    `previous${capitalize(sectionId)}Page`,
  );
  const nextButton = document.getElementById(
    `next${capitalize(sectionId)}Page`,
  );
  if (previousButton) previousButton.disabled = currentPage <= 1;
  if (nextButton) nextButton.disabled = currentPage >= totalPages;
}

/* ==========================================================
   ARCHIVE / TRASH ACTIONS
========================================================== */

function bindHistoryTrashActions() {
  document.querySelectorAll(".restore-archive").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const card = button.closest(".history-card");
      const id = card?.dataset.id;
      if (!id) return;

      const name = card.querySelector("h3")?.textContent.trim() || "this archive";

      openHistoryRestoreModal(
        "Restore Archive?",
        `Are you sure you want to restore "${name}"?`,
        async () => {
          try {
            const res = await fetch(`/superadmin/api/history/archives/${id}/restore`, {
              method: "POST",
            });
            if (!res.ok) throw new Error(`Restore failed: ${res.status}`);
            await fetchArchives(historyPageState.archives);
            showHistoryToast("Archive Restored", `"${name}" has been restored successfully.`);
          } catch (err) {
            console.error(err);
            showHistoryToast("Restore Failed", `Could not restore "${name}". Please try again.`);
          }
        },
      );
    });
  });

  document.querySelectorAll(".restore-trash").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const card = button.closest(".history-card");
      const id = card?.dataset.id;
      if (!id) return;

      const name = card.querySelector("h3")?.textContent.trim() || "this record";

      openHistoryRestoreModal(
        "Restore Record?",
        `Are you sure you want to restore "${name}"?`,
        async () => {
          try {
            const res = await fetch(`/superadmin/api/history/trash/${id}/restore`, {
              method: "POST",
            });
            if (!res.ok) throw new Error(`Restore failed: ${res.status}`);
            await fetchTrash(historyPageState.trash);
            showHistoryToast("Record Restored", `"${name}" has been restored successfully.`);
          } catch (err) {
            console.error(err);
            showHistoryToast("Restore Failed", `Could not restore "${name}". Please try again.`);
          }
        },
      );
    });
  });

  document.querySelectorAll(".permanent-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const card = button.closest(".history-card");
      const id = card?.dataset.id;
      if (!id) return;

      const name = card.querySelector("h3")?.textContent.trim() || "this record";

      openHistoryDeleteModal(
        "Delete Permanently?",
        `Are you sure you want to permanently delete "${name}"? This action cannot be undone.`,
        async () => {
          try {
            const res = await fetch(`/superadmin/api/history/trash/${id}`, {
              method: "DELETE",
            });
            if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
            await fetchTrash(historyPageState.trash);
            showHistoryToast("Record Deleted", `"${name}" has been deleted successfully.`);
          } catch (err) {
            console.error(err);
            showHistoryToast("Delete Failed", `Could not delete "${name}". Please try again.`);
          }
        },
      );
    });
  });
}

/* ==========================================================
   ARCHIVE — CLEAR FILTERS
========================================================== */

function initializeArchiveFilterButton() {
  const button = document.getElementById("archiveFilterBtn");
  if (!button) return;

  button.addEventListener("click", (event) => {
    event.preventDefault();

    const section = document.getElementById("archives");
    if (!section) return;

    const search = document.getElementById("archiveSearch");
    if (search) search.value = "";

    section.querySelectorAll(".history-filter").forEach((filter) => {
      filter.value = "";
    });

        fetchArchives(1);
        showHistoryToast(
          "Filters Cleared",
          "Archive filters have been cleared successfully.",
        );
  });
}

/* ==========================================================
   ARCHIVE — VIEW MODAL
========================================================== */

function initializeArchiveViewActions() {
  const modal = document.getElementById("historyArchiveViewModal");
  const list = document.getElementById("archivesList");
  if (!modal || !list) return;

  list.addEventListener("click", (event) => {
    const button = event.target.closest(".view-archive");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const card = button.closest(".history-card");
    const id = card?.dataset.id;
    const record = historyArchivesCache.find((r) => r.id === id);
    if (!record) return;

    openArchiveViewModal(record);
  });

  document.getElementById("archiveViewClose")?.addEventListener("click", closeArchiveViewModal);
  document.getElementById("archiveViewCloseBtn")?.addEventListener("click", closeArchiveViewModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeArchiveViewModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) closeArchiveViewModal();
  });
}

let archiveViewRequestId = 0;

async function openArchiveViewModal(record) {
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText("archiveViewTitle", record.entityName || "Archived Record");
  setText("archiveViewType", record.entityType || "Archive");
  setText("archiveViewDate", record.archivedAt ? formatDateTime(record.archivedAt) : "—");
  setText("archiveViewBy", record.archivedBy || "Unknown user");

  const details = document.getElementById("archiveViewDescription");
  if (details) details.textContent = "Loading details...";

  document.getElementById("historyArchiveViewModal")?.classList.add("show");

  const requestId = ++archiveViewRequestId;

  try {
    const res = await fetch(`/superadmin/api/history/archives/${record.id}/details`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Details failed: ${res.status}`);
    const data = await res.json();

    if (requestId !== archiveViewRequestId || !details) return; // another record was opened meanwhile

    const fields = Array.isArray(data.fields) ? data.fields : [];

    if (!fields.length) {
      details.textContent = "No details available for this record.";
      return;
    }

    details.innerHTML = `
      <dl class="archive-details-list">
        ${fields
          .map(
            (f) => `
          <div class="archive-details-row">
            <dt>${escapeActionDetailsHTML(f.label)}</dt>
            <dd>${escapeActionDetailsHTML(f.value)}</dd>
          </div>`,
          )
          .join("")}
      </dl>`;
  } catch (err) {
    console.error("Failed to load archive details", err);
    if (requestId === archiveViewRequestId && details) {
      details.textContent = "Could not load details for this record.";
    }
  }
}

function closeArchiveViewModal() {
  document.getElementById("historyArchiveViewModal")?.classList.remove("show");
}

/* ==========================================================
   EMPTY TRASH
========================================================== */

function initializeTrashEmptyButton() {
  const button = document.getElementById("emptyTrash");
  if (!button) return;

  button.addEventListener("click", (event) => {
    event.preventDefault();

    const trash = document.getElementById("trash");
    if (!trash) return;

    const cards = trash.querySelectorAll(".trash-card");
    if (!cards.length) {
      alert("Trash is already empty.");
      return;
    }

    openHistoryDeleteModal(
      "Empty Trash?",
      "Are you sure you want to permanently delete all records in Trash? This action cannot be undone.",
      async () => {
        try {
          const res = await fetch(`/superadmin/api/history/trash`, { method: "DELETE" });
          if (!res.ok) throw new Error(`Empty trash failed: ${res.status}`);
          await fetchTrash(1);
          showHistoryToast("Trash Emptied", "All records in Trash have been permanently deleted.");
        } catch (err) {
          console.error(err);
          showHistoryToast("Empty Trash Failed", "Could not empty trash. Please try again.");
        }
      },
    );
  });
}

/* ==========================================================
   GLOBAL REFRESH
========================================================== */

function refreshHistory() {
  const activeSection = document.querySelector(".history-section.active");
  if (!activeSection) return;
  fetchForSection(activeSection.id, historyPageState[activeSection.id] || 1);
}

window.refreshHistory = refreshHistory;

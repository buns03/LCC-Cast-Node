/* Shared "View details" for the Actions tab (superadmin, admin-ssc, admin-dept).
   The page sets window.HISTORY_ACTIONS_API before loading this file.
   Loaded AFTER the page's history.js, so these functions replace the old copies. */

function renderActions(items) {
  const tbody = document.getElementById("actionsTable");
  if (!tbody) return;

  tbody.innerHTML = items
    .map((record) => {
      const badge = getActionBadgeInfo(record.action);
      return `
        <tr class="history-row" data-id="${escapeActionDetailsHTML(record.id)}">
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
            <span class="action-badge ${badge.class}">
              <i class="bi ${badge.icon}"></i>
              ${escapeActionDetailsHTML(record.action)}
            </span>
          </td>
          <td><div class="action-description"><span>${escapeActionDetailsHTML(record.description)}</span></div></td>
          <td>${formatDateTime(record.createdAt)}</td>
          <td>
            <button type="button" class="action-details-btn" data-action-id="${escapeActionDetailsHTML(record.id)}">
              <i class="bi bi-eye"></i> View details
            </button>
          </td>
        </tr>`;
    })
    .join("");
}

/* list of changes / affected records: handles "old -> new", "new only" and "old only" */
function renderActionDetailsRecords() {
  const list = document.getElementById("actionDetailsRecordList");
  const count = document.getElementById("actionDetailsSearchCount");
  const pagination = document.getElementById("actionDetailsRecordPagination");
  const searchInput = document.getElementById("actionDetailsRecordSearch");
  if (!list) return;

  if (!currentActionDetails.length) {
    if (count) count.textContent = "0 records";
    if (pagination) pagination.innerHTML = "";
    list.innerHTML = `
      <div class="action-details-record-empty">
        <div class="action-details-record-empty-icon"><i class="bi bi-info-circle"></i></div>
        <strong>No further details</strong>
        <span>This action did not record any additional information.</span>
      </div>`;
    return;
  }

  const search = searchInput ? searchInput.value.toLowerCase().trim() : "";
  const filtered = currentActionDetails.filter((r) =>
    !search || [r.target, r.field, r.from, r.to].filter(Boolean).some((v) => String(v).toLowerCase().includes(search)),
  );

  if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`;

  if (!filtered.length) {
    if (pagination) pagination.innerHTML = "";
    list.innerHTML = `
      <div class="action-details-record-empty">
        <div class="action-details-record-empty-icon"><i class="bi bi-search"></i></div>
        <strong>No matching records</strong>
        <span>Try searching by name, ID, or changed value.</span>
      </div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ACTION_DETAILS_PAGE_SIZE));
  if (currentActionDetailsPage > totalPages) currentActionDetailsPage = totalPages;
  const start = (currentActionDetailsPage - 1) * ACTION_DETAILS_PAGE_SIZE;

  list.innerHTML = filtered
    .slice(start, start + ACTION_DETAILS_PAGE_SIZE)
    .map((r) => {
      const hasFrom = r.from != null && r.from !== "";
      const hasTo = r.to != null && r.to !== "";
      const change =
        hasFrom && hasTo
          ? `<span class="action-details-record-old">${escapeActionDetailsHTML(r.from)}</span>
             <i class="bi bi-arrow-right action-details-record-arrow"></i>
             <strong class="action-details-record-new">${escapeActionDetailsHTML(r.to)}</strong>`
          : hasTo
            ? `<strong class="action-details-record-new">${escapeActionDetailsHTML(r.to)}</strong>`
            : hasFrom
              ? `<span class="action-details-record-old">${escapeActionDetailsHTML(r.from)}</span>`
              : "";
      return `
        <div class="action-details-record-item">
          <div class="action-details-record-icon"><i class="bi bi-person"></i></div>
          <div class="action-details-record-info">
            <strong>${escapeActionDetailsHTML(r.target || "Record")}</strong>
            <span>${escapeActionDetailsHTML(r.field || "")}</span>
          </div>
          <div class="action-details-record-change">${change}</div>
        </div>`;
    })
    .join("");

  if (!pagination) return;
  if (totalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }
  pagination.innerHTML = `
    <button type="button" class="action-details-pagination-btn" data-page="previous" ${currentActionDetailsPage === 1 ? "disabled" : ""} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>
    <span>Page ${currentActionDetailsPage} / ${totalPages}</span>
    <button type="button" class="action-details-pagination-btn" data-page="next" ${currentActionDetailsPage === totalPages ? "disabled" : ""} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>`;
  pagination.querySelector('[data-page="previous"]')?.addEventListener("click", () => {
    if (currentActionDetailsPage > 1) { currentActionDetailsPage--; renderActionDetailsRecords(); }
  });
  pagination.querySelector('[data-page="next"]')?.addEventListener("click", () => {
    if (currentActionDetailsPage < totalPages) { currentActionDetailsPage++; renderActionDetailsRecords(); }
  });
}

/* number cards for bulk actions / imports */
function showActionDetailsStats(stats) {
  let box = document.getElementById("actionDetailsStats");
  if (!box) {
    box = document.createElement("div");
    box.id = "actionDetailsStats";
    box.className = "action-details-import-summary";
    document.getElementById("actionDetailsSummary")?.insertAdjacentElement("afterend", box);
  }
  const list = Array.isArray(stats) ? stats : [];
  box.innerHTML = `<div class="import-summary-grid">${list
    .map((s) => `<div class="import-summary-card"><span>${escapeActionDetailsHTML(s.label)}</span><strong>${escapeActionDetailsHTML(s.value)}</strong></div>`)
    .join("")}</div>`;
  box.classList.toggle("show", list.length > 0);
}

const ACTION_DETAIL_LABELS = {
  update: ["Changes", "What was changed, from the previous value to the new one."],
  create: ["Created With", "The details this record was created with."],
  bulk: ["Affected Records", "Records included in this action."],
  import: ["Import Summary", "Totals for this import."],
  other: ["Details", "Information recorded for this action."],
};

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".action-details-btn");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const id = button.dataset.actionId;
  const cached = (typeof historyActionsCache !== "undefined" ? historyActionsCache : []).find((r) => r.id === id) || {};

  button.disabled = true;
  try {
    const res = await fetch(`${window.HISTORY_ACTIONS_API}/actions/${id}/details`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Details failed: ${res.status}`);
    const data = await res.json();

    openActionDetailsModal({
      ...data,
      user: cached.user || data.user,
      role: cached.role || data.role,
      icon: getActionBadgeInfo(data.action).icon,
      dateTime: formatDateTime(data.createdAt),
      details: data.rows,
    });

    showActionDetailsStats(data.stats);

    const modal = document.getElementById("historyActionDetailsModal");
    const [label, hint] = ACTION_DETAIL_LABELS[data.kind] || ACTION_DETAIL_LABELS.other;
    const labelEl = modal?.querySelector(".action-details-section-label");
    const hintEl = modal?.querySelector(".action-details-section-header p");
    if (labelEl) labelEl.textContent = label;
    if (hintEl) hintEl.textContent = hint;

    const section = modal?.querySelector(".action-details-section");
    if (section) section.style.display = !data.rows.length && data.stats.length ? "none" : "";
  } catch (err) {
    console.error("Failed to load action details", err);
    showHistoryToast("Details Failed", "Could not load details for this action. Please try again.");
  } finally {
    button.disabled = false;
  }
});
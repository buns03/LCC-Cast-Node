/* LCCAST - Departments Page */

/* =========================================================
   GLOBAL ACTION LOADING MODAL
========================================================= */

const DEPARTMENT_API = "/admin-dept/api/departments";

/** server errors may be plain text or JSON ({message} / {error}); always show just the sentence */
function errorMessageFrom(text, fallback) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") return j.message || j.error || fallback;
  } catch {
    /* not JSON: plain text */
  }
  return (text || "").trim() || fallback;
}

// School year starts in June (month index 5). Keep this the same on every page.
const SCHOOL_YEAR_START_MONTH = 5;

function getCurrentSchoolYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear =
    date.getMonth() >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function initializeDefaultSchoolYear() {
  const input = document.getElementById("departmentsSchoolYear");
  if (!input) return;

  const schoolYear = getCurrentSchoolYear();
  input.defaultValue = schoolYear; // form.reset() restores this
  input.value = schoolYear; // still editable
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeDepartmentsTabs();
  initializeDepartmentsCards();
  initializeCreatePositions();
  initializeCreateMembers();
  initializeEditForms();
  initializeDeleteDiscardModals();
  initializeSelectionModalButtons();
  initializeDepartmentsFileUploads();
  initializeExistingMemberFiles();
  initializeSuccessToast();
  initializeValidationBindings();
  initializeDepartmentTitlePrefix();
  initializeDefaultSchoolYear();

  initializeVotingType();

  await loadExistingDepartments();
  connectDepartmentsSocket();
});

const DEFAULT_POSITIONS = [
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "PRO Internal",
  "PRO External",
];

function sortMembersByPosition(members) {
  return [...members].sort((a, b) => {
    const posA = DEFAULT_POSITIONS.indexOf(a.position);
    const posB = DEFAULT_POSITIONS.indexOf(b.position);
    // Unknown/custom positions (e.g. "Member", "Others" text) fall after the known ones, keeping their relative order
    const rankA = posA === -1 ? DEFAULT_POSITIONS.length : posA;
    const rankB = posB === -1 ? DEFAULT_POSITIONS.length : posB;
    return rankA - rankB;
  });
}

let pendingDeleteCard = null;
let pendingArchiveCard = null;
let pendingSaveAction = null;
let successToastTimeout = null;
let discardToastTimeout = null;

async function loadExistingDepartments(force = false) {
  const list = document.querySelector("#existingDepartments .departments-list");

  if (!list) return;

  try {
    const departments = await SoftCache.load(DEPARTMENT_API, {
      force,
      onRevalidated: () => {
        // Don't rebuild the DOM while the admin is editing or has a card open
        if (
          document.querySelector(
            "#existingDepartments .departments-item.editing, #existingDepartments .departments-item.show",
          )
        )
          return;
        loadExistingDepartments();
      },
    });

    list.innerHTML = "";

    if (!Array.isArray(departments) || departments.length === 0) {
      list.innerHTML = `
                <div class="empty-state">
                    No active departments found.
                </div>
            `;
      refreshExisting();
      return;
    }

    for (const department of departments) {
      const card = document.createElement("article");

      card.className = "departments-item";
      card.dataset.id = department.id || "";
      card.dataset.campus = department.campus?.id || "";

      const campusName = department.campus?.name || "";

      card.innerHTML = `
                <div class="departments-item-header">

                    <div class="departments-item-title">

                        <div class="departments-logo-small">

                            ${
                              department.posterLogoUrl
                                ? `
                                        <img
                                            class="departments-logo-image"
                                            src="${esc(getProtectedFileUrl(department.posterLogoUrl))}"
                                            alt="${esc(department.name || "")} Logo"
                                        >
                                      `
                                : `
                                        <span class="departments-logo-initials">
                                            ${esc(getDepartmentsInitials(department.name))}
                                        </span>
                                      `
                            }

                        </div>

                        <div class="departments-title-text">

                            <h3>${esc(department.title || "")}</h3>

                            <span class="departments-description">
                                ${esc(department.description || "")}
                            </span>

                        </div>

                    </div>

                    <div class="departments-header-right">

                        <div class="departments-campus">
                            <i class="bi bi-building"></i>
                            <span>${esc(campusName)}</span>
                        </div>

                        <div class="departments-controls">

                            <button
                                type="button"
                                class="icon-btn edit-departments"
                                title="Edit">
                                <i class="bi bi-pencil"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn archive-departments"
                                title="Archive">
                                <i class="bi bi-archive"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn delete-departments"
                                title="Delete">
                                <i class="bi bi-trash"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn expand-departments"
                                title="Expand">
                                <i class="bi bi-chevron-down"></i>
                            </button>

                        </div>

                    </div>

                </div>

                <section class="departments-details">

                    <div class="departments-info">

                        <div class="departments-expanded-content">

                            <div class="departments-poster-preview">

                                <div class="departments-preview-title">
                                    <span>Poster</span>
                                </div>

                                <div class="departments-file-preview existing-poster-preview">

                                    ${createFileDisplay(
                                      department.posterImageUrl,
                                      "poster",
                                      `${department.name || ""} Poster`,
                                    )}

                                </div>

                            </div>

                            <div class="departments-expanded-details">

                                <div class="departments-info-row">
                                    <label>Campus:</label>
                                    <span class="existing-departments-campus">
                                        ${esc(campusName)}
                                    </span>
                                </div>

                                <div class="departments-info-row">
                                    <label>Description:</label>
                                    <span>
                                        ${esc(department.description || "—")}
                                    </span>
                                </div>

                                <div class="departments-info-row">
                                    <label>School Year:</label>
                                    <span>
                                        ${esc(department.schoolYear || "")}
                                    </span>
                                </div>

                                <div class="departments-info-row">
                                    <label>Voting Type:</label>
                                    <span>
                                        ${esc(
                                          department.votingType ===
                                            "REPRESENTATIVE"
                                            ? "Representative"
                                            : department.votingType ===
                                                "PARTYLIST"
                                              ? "Partylist"
                                              : "—",
                                        )}
                                    </span>
                                </div>

                                <div class="departments-info-row members-info-row">

                                    <label>Members:</label>

                                    <div class="existing-member-list">
                                        Loading members...
                                    </div>

                                </div>

                            </div>

                        </div>

                    </div>

                </section>
            `;

      const details = card.querySelector(".departments-details");

      if (details) {
        details.insertAdjacentHTML(
          "beforeend",
          createEditDepartmentPanel(department),
        );

        const editPanel = details.querySelector(".edit-departments-panel");

        if (editPanel) {
          initializeEditVotingType(editPanel);
        }
      }

      list.appendChild(card);

      card._departmentData = department;

      bindDepartmentsCard(card);
      initializeDepartmentsFileUploads(card);
      bindEditForm(card);
      initializeEditPositions(card, department);

      await loadDepartmentMembers(card, department.id, force);
    }

    refreshExisting();
  } catch (error) {
    console.error("Error loading departments:", error);

    list.innerHTML = `
            <div class="empty-state">
                Unable to load departments.
            </div>
        `;
  }

  initializeDepartmentTitlePrefix();
}

async function loadDepartmentMembers(card, departmentId, force = false) {
  const memberList = card.querySelector(".existing-member-list");

  if (!memberList || !departmentId) return;

  try {
    const rawMembers = await SoftCache.load(
      `${DEPARTMENT_API}/${departmentId}/members`,
      {
        force,
        onRevalidated: () => {
          if (card.isConnected && !card.classList.contains("editing")) {
            loadDepartmentMembers(card, departmentId);
          }
        },
      },
    );
    const members = Array.isArray(rawMembers)
      ? sortMembersByPosition(rawMembers)
      : rawMembers;

    memberList.innerHTML = "";

    if (!Array.isArray(members) || members.length === 0) {
      memberList.innerHTML = `
                <div class="existing-member empty-member">
                    No members.
                </div>
            `;

      return;
    }

    members.forEach((member) => {
      const fullName = [member.firstName, member.middleName, member.lastName]
        .filter(Boolean)
        .join(" ");

      const element = document.createElement("div");

      element.className = "existing-member";

      element.dataset.studentId = member.studentId || "";
      element.dataset.firstName = member.firstName || "";
      element.dataset.middleName = member.middleName || "";
      element.dataset.lastName = member.lastName || "";
      element.dataset.position = member.position || "";
      element.dataset.photo = member.photoImageUrl || "";
      element.dataset.background = member.backgroundImageUrl || "";
      element.dataset.campaign = member.campaignImageUrl || "";

      element.innerHTML = `
                                       <span class="existing-member-student-id">
                                           ${esc(member.studentId || "")}
                                       </span>

                                       <span class="existing-member-name">
                                           ${esc(fullName)}
                                       </span>

                                       ${member.position ? `<span class="existing-member-position">${esc(member.position)}</span>` : ""}

                                       <div class="existing-member-files">

                   <button
                       type="button"
                       class="existing-file-btn view-member-campaign"
                       title="View Campaign">
                       <i class="bi bi-megaphone"></i>
                       Campaign
                   </button>

                   <button
                       type="button"
                       class="existing-file-btn view-member-background"
                       title="View Background">
                       <i class="bi bi-file-earmark-text"></i>
                       Background
                   </button>

                   <button
                       type="button"
                       class="existing-file-btn view-member-photo"
                       title="View Photo">
                       <i class="bi bi-image"></i>
                       Photo
                   </button>

               </div>
           `;

      memberList.appendChild(element);
    });

    /*
     * Use ONE delegated click handler for dynamically
     * generated member buttons.
     */
    if (memberList.dataset.previewBound !== "true") {
      memberList.dataset.previewBound = "true";

      memberList.addEventListener("click", (e) => {
        const campaignButton = e.target.closest(".view-member-campaign");

        const backgroundButton = e.target.closest(".view-member-background");

        const photoButton = e.target.closest(".view-member-photo");

        if (!campaignButton && !backgroundButton && !photoButton) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const memberElement = e.target.closest(".existing-member");

        if (!memberElement) return;

        if (campaignButton) {
          showExistingMemberFile(memberElement, "campaign");
          return;
        }

        if (backgroundButton) {
          showExistingMemberFile(memberElement, "background");
          return;
        }

        if (photoButton) {
          showExistingMemberFile(memberElement, "photo");
        }
      });
    }
  } catch (error) {
    console.error("Failed to load members:", error);

    memberList.innerHTML = `
            <div class="existing-member empty-member">
                Unable to load members.
            </div>
        `;
  }
}

function showExistingMemberFile(memberElement, type) {
  const campaignUrl = memberElement.dataset.campaign || "";

  const photoUrl = memberElement.dataset.photo || "";

  const backgroundUrl = memberElement.dataset.background || "";

  const url =
    type === "campaign"
      ? campaignUrl
      : type === "photo"
        ? photoUrl
        : backgroundUrl;

  if (!url) {
    let message = "No file uploaded.";

    if (type === "campaign") {
      message = "No campaign/platform image uploaded.";
    } else if (type === "photo") {
      message = "No member photo uploaded.";
    } else if (type === "background") {
      message = "No background/COC uploaded.";
    }

    showFileErrorToast(message);
    return;
  }

  // IMPORTANT:
  // Convert the Supabase storage path into the protected backend URL.
  const protectedUrl = getProtectedFileUrl(url);

  document
    .querySelectorAll(".existing-member-preview")
    .forEach((element) => element.remove());

  const fileName = getFileName(url);

  const isPDF = fileName.toLowerCase().endsWith(".pdf");

  let title = "Member Photo";

  if (type === "campaign") {
    title = "Campaign / Platform";
  } else if (type === "background") {
    title = "Background / COC";
  }

  const preview = document.createElement("div");

  preview.className = "existing-member-preview member-file-preview show";

  preview.innerHTML = `
        <div class="file-preview-header">

            <strong>${esc(title)}</strong>

            <button
                type="button"
                class="file-preview-close"
                title="Close">

                <i class="bi bi-x-lg"></i>

            </button>

        </div>

        ${
          isPDF
            ? `
                    <div class="file-preview-filename">

                        <i class="bi bi-file-earmark-pdf"></i>

                        <span>
                            ${esc(fileName)}
                        </span>

                    </div>
                  `
            : ""
        }

        <div class="file-preview-body ${
          isPDF ? "background-preview-body" : "photo-preview-body"
        }">

            ${
              isPDF
                ? `
                        <iframe
                            src="${esc(protectedUrl)}"
                            title="${esc(title)} Preview">
                        </iframe>
                      `
                : `
                        <img
                            src="${esc(protectedUrl)}"
                            alt="${esc(title)}">
                      `
            }

        </div>

        <div class="file-preview-actions">

            <a
                href="${esc(protectedUrl)}"
                target="_blank"
                rel="noopener noreferrer"
                class="file-change-btn">

                <i class="bi bi-box-arrow-up-right"></i>
                Open

            </a>

        </div>
    `;

  document.body.appendChild(preview);
  applyDocumentPreviewRatio(preview, type);

  const clickedButton =
    type === "campaign"
      ? memberElement.querySelector(".view-member-campaign")
      : type === "photo"
        ? memberElement.querySelector(".view-member-photo")
        : memberElement.querySelector(".view-member-background");

  if (!clickedButton) {
    return;
  }

  const buttonRect = clickedButton.getBoundingClientRect();

  preview.style.setProperty("position", "fixed", "important");

  preview.style.setProperty("z-index", "99999", "important");

  requestAnimationFrame(() => {
    const previewRect = preview.getBoundingClientRect();

    const gap = 12;

    let left = buttonRect.right + gap;

    let top = buttonRect.top;

    if (left + previewRect.width > window.innerWidth - gap) {
      left = buttonRect.left - previewRect.width - gap;
    }

    if (top + previewRect.height > window.innerHeight - gap) {
      top = window.innerHeight - previewRect.height - gap;
    }

    if (top < gap) {
      top = gap;
    }

    if (left < gap) {
      left = gap;
    }

    preview.style.setProperty("left", `${left}px`, "important");

    preview.style.setProperty("top", `${top}px`, "important");
  });

  preview
    .querySelector(".file-preview-close")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      preview.remove();
    });
}

async function archiveDepartment(id) {
  try {
    showActionLoading("Archiving Department", "Please wait...");

    const response = await fetch(`${DEPARTMENT_API}/${id}/archive`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to archive department.");
    }

    hideActionLoading();

    await loadExistingDepartments();

    return true;
  } catch (error) {
    console.error("Archive failed:", error);

    hideActionLoading();

    alert(error.message || "Failed to archive department.");

    return false;
  }
}

async function deleteDepartment(id) {
  try {
    showActionLoading("Deleting Department", "Please wait...");

    const response = await fetch(`${DEPARTMENT_API}/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to delete department.");
    }

    hideActionLoading();

    await loadExistingDepartments();

    return true;
  } catch (error) {
    console.error("Delete failed:", error);

    hideActionLoading();

    alert(error.message || "Failed to delete department.");

    return false;
  }
}

// Departments Cards
function initializeDepartmentsCards() {
  document
    .querySelectorAll("#existingDepartments .departments-item")
    .forEach(bindDepartmentsCard);
}

function bindDepartmentsCard(card) {
  if (!card || card.dataset.bound === "true") return;
  card.dataset.bound = "true";
  updateDepartmentsLogo(card);

  const expand = card.querySelector(".expand-departments");
  const edit = card.querySelector(".edit-departments");
  const remove = card.querySelector(".delete-departments");
  const archive = card.querySelector(".archive-departments");

  // Expand
  expand?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isOpen = card.classList.contains("show");

    allDepartmentsCards().forEach((other) => {
      if (other === card) return;
      other.classList.remove("show", "editing");
      const icon = other.querySelector(".expand-departments i");
      if (icon) icon.className = "bi bi-chevron-down";
    });

    card.classList.toggle("show", !isOpen);

    const icon = expand.querySelector("i");
    if (icon)
      icon.className = card.classList.contains("show")
        ? "bi bi-chevron-up"
        : "bi bi-chevron-down";

    refreshExisting();
  });

  // Edit
  edit?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isEditing = card.classList.contains("editing");

    allDepartmentsCards().forEach((other) => {
      if (other === card) return;
      other.classList.remove("editing", "show");
      const otherIcon = other.querySelector(".expand-departments i");
      if (otherIcon) otherIcon.className = "bi bi-chevron-down";
    });

    if (isEditing) {
      card.classList.remove("editing");
    } else {
      // Enter edit mode - hide the normal expanded details
      card.classList.remove("show");
      card.classList.add("editing");

      // Keep expand icon pointing down since details are collapsed
      const icon = card.querySelector(".expand-departments i");
      if (icon) icon.className = "bi bi-chevron-down";

      initializeEditPositions(
        card,
        JSON.parse(
          card.querySelector(".edit-departments-form")?.dataset.positions ||
            "[]",
        ),
      );

      initializeEditMembers(card);
    }

    refreshExisting();
  });

  // Delete
  remove?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openDeleteModal(card);
  });

  // Archive
  archive?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openArchiveModal(card);
  });
}

// Member File Preview
function toggleMemberFilePreview(row, type) {
  if (!row) return;

  const preview = row.querySelector(".member-file-preview");

  if (!preview) return;

  const isOpen = preview.classList.contains("show");

  // Close every other member preview
  document.querySelectorAll(".member-file-preview.show").forEach((element) => {
    element.classList.remove("show");
  });

  // If this one was already open, just close it
  if (isOpen) {
    preview.classList.remove("show");
    return;
  }

  showMemberFilePreview(row, type);
}

function showMemberFilePreview(row, type) {
  const preview = row.querySelector(".member-file-preview");

  if (!preview) return;

  let file = null;

  if (type === "campaign") {
    file = row._campaignFile || row.dataset.campaign || null;
  }

  if (type === "background") {
    file = row._backgroundFile || row.dataset.background || null;
  }

  if (type === "photo") {
    file = row._photoFile || row.dataset.photo || null;
  }

  if (!file) {
    preview.classList.remove("show");
    preview.innerHTML = "";
    return;
  }

  const fileUrl =
    file instanceof File
      ? URL.createObjectURL(file)
      : getProtectedFileUrl(file);

  const fileName = file instanceof File ? file.name : getFileName(file);

  const mimeType = file instanceof File ? file.type : "";

  const isPDF =
    mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  let title = "Member Photo";

  if (type === "campaign") {
    title = "Campaign / Platform";
  } else if (type === "background") {
    title = "Background / COC";
  }

  let previewContent = "";

  /*
   * =========================================================
   * PDF
   * =========================================================
   */

  if (isPDF) {
    previewContent = `
            <iframe
                src="${esc(fileUrl)}"
                title="${esc(title)} Preview"
                class="member-pdf-preview">
            </iframe>
        `;

    /*
     * =========================================================
     * IMAGE
     * =========================================================
     */
  } else {
    previewContent = `
            <img
                src="${esc(fileUrl)}"
                alt="${esc(title)}"
                class="member-image-preview"
            >
        `;
  }

  preview.innerHTML = `
        <div class="file-preview-header">

            <strong>
                ${esc(title)}
            </strong>

            <button
                type="button"
                class="file-preview-close"
                title="Close">

                <i class="bi bi-x-lg"></i>

            </button>

        </div>

        ${
          isPDF
            ? `
                    <div class="file-preview-filename">
                        <i class="bi bi-file-earmark-pdf"></i>
                        <span>${esc(fileName)}</span>
                    </div>
                  `
            : ""
        }

        <div class="file-preview-body ${
          isPDF ? "background-preview-body" : "photo-preview-body"
        }">

            ${previewContent}

        </div>

        <div class="file-preview-actions">

            <button
                type="button"
                class="file-change-btn">

                <i class="bi bi-arrow-repeat"></i>
                Change

            </button>

            <button
                type="button"
                class="file-delete-btn">

                <i class="bi bi-trash"></i>
                Delete

            </button>

        </div>
    `;

  preview.classList.add("show");

  /*
   * =========================================================
   * CLOSE
   * =========================================================
   */

  preview
    .querySelector(".file-preview-close")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      closeMemberFilePreview(row);
    });

  /*
   * =========================================================
   * CHANGE
   * =========================================================
   */

  preview.querySelector(".file-change-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    let input = null;

    if (type === "photo") {
      input = row.querySelector(".photo-input");
    }

    if (type === "campaign") {
      input = row.querySelector(".campaign-input");
    }

    if (type === "background") {
      input = row.querySelector(".background-input");
    }

    input?.click();
  });

  /*
   * =========================================================
   * DELETE
   * =========================================================
   */

  preview.querySelector(".file-delete-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    deleteMemberFile(row, type);
  });

  applyDocumentPreviewRatio(preview, type);

  requestAnimationFrame(() => {
    positionMemberFilePreview(row, preview, type);
  });
}

function createEditDepartmentPanel(department) {
  const campusId = department.campus?.id || "";

  const votingType = department.votingType || "";

  const members = department.members || [];

  const positions =
    Array.isArray(department.positions) && department.positions.length
      ? department.positions
      : [...DEFAULT_POSITIONS];

  return `
        <section class="edit-departments-panel">

            <form
                class="departments-form edit-departments-form"
                novalidate
                data-positions='${esc(JSON.stringify(positions))}'
            >

                <div class="form-section">

                    <div class="form-group">

                        <label>Department Name</label>

                            <input
                                type="text"
                                class="edit-departments-name-input"
                                value="${esc(department.name || "")}"
                                disabled
                            >


                        <small
                            class="inline-error edit-departments-name-error"
                        ></small>

                    </div>

                    <div class="form-group">

                        <label>Department Title</label>

                        <input
                            type="text"
                            value="${esc(department.title || "")}"
                            class="edit-departments-title-input"
                        >

                        <small
                            class="inline-error edit-departments-title-error"
                        ></small>

                    </div>

                    <div class="form-group">

                        <label>Description</label>

                        <input
                            type="text"
                            value="${esc(department.description || "")}"
                            class="edit-departments-description-input"
                        >

                    </div>

                    <div class="form-group">

                        <label>School Year</label>

                        <input
                            type="text"
                            value="${esc(department.schoolYear || "")}"
                            class="edit-departments-schoolyear-input"
                        >

                        <small
                            class="inline-error edit-departments-schoolyear-error"
                        ></small>

                    </div>

                    <div class="form-group">
                        <label>Voting Type</label>

                        <select class="edit-departments-voting-type">
                            <option value="">Select Voting Type</option>
                            <option value="PARTYLIST" ${votingType === "PARTYLIST" ? "selected" : ""}>Partylist</option>
                            <option value="REPRESENTATIVE" ${votingType === "REPRESENTATIVE" ? "selected" : ""}>Representative</option>
                        </select>

                        <small class="inline-error edit-departments-voting-type-error"></small>
                    </div>

                    <div class="form-group">

                        <label>Campus</label>


                        <input
                            type="text"
                            class="edit-departments-campus"
                            value="${esc(department.campus?.name || "")}"
                            disabled
                        >

                        <small
                            class="inline-error edit-departments-campus-error"
                        ></small>

                    </div>

                    <div class="form-group">

                        <label>Department Poster</label>

                        <div class="departments-file-upload">

                            <input
                                type="file"
                                class="departments-poster-input edit-poster-input"
                                accept="image/*,.pdf,application/pdf"
                                hidden
                                data-url="${esc(department.posterImageUrl || "")}"
                            >

                            <button
                                type="button"
                                class="departments-file-btn"
                            >
                                <i class="bi bi-file-earmark-image"></i>
                                <span>Change Poster</span>
                            </button>

                            <div class="departments-file-preview"></div>

                        </div>

                    </div>

                    <div class="form-group">

                        <label>
                            Department Logo
                            <span class="optional-label">
                                (Optional)
                            </span>
                        </label>

                        <div class="departments-file-upload">

                            <input
                                type="file"
                                class="departments-logo-input edit-logo-input"
                                accept="image/*"
                                hidden
                                data-url="${esc(department.posterLogoUrl || "")}"
                            >

                            <button
                                type="button"
                                class="departments-file-btn"
                            >
                                <i class="bi bi-image"></i>
                                <span>Change Logo</span>
                            </button>

                            <div class="departments-file-preview"></div>

                        </div>

                    </div>

                </div>

                                <div class="form-section positions-section">

                                    <div class="departments-divider"></div>

                                    <h3>Positions</h3>

                                    <div class="positions-list edit-positions-list"></div>

                                    <div class="add-position-row">

                                        <input
                                            type="text"
                                            class="new-position-input"
                                            placeholder="Add position"
                                            autocomplete="off"
                                        >

                                        <button
                                            type="button"
                                            class="add-position-btn"
                                        >
                                            <i class="bi bi-plus-lg"></i>
                                            Add Position
                                        </button>

                                    </div>

                                </div>

                                                <div class="form-section members-section" id="editMembersSection-${esc(department.id || "")}">

                                                    <div class="departments-divider"></div>

                                                    <h3>Members</h3>

                    <div class="members-list edit-members-list"></div>

                    <button
                        type="button"
                        class="add-member-btn edit-add-member"
                    >
                        <i class="bi bi-plus-lg"></i>
                        Add More Member
                    </button>

                </div>

                <div class="form-buttons">

                    <button
                        type="button"
                        class="discard-btn cancel-departments-edit"
                    >
                        Cancel
                    </button>

                    <button
                        type="submit"
                        class="save-btn"
                    >
                        <i class="bi bi-check-circle"></i>
                        Save Changes
                    </button>

                </div>

            </form>

        </section>
    `;
}

async function saveEditedDepartments(card) {
  if (!card) {
    throw new Error("Department card is missing.");
  }

  const form = card.querySelector(".edit-departments-form");

  if (!form) {
    throw new Error("Edit form is missing.");
  }

  const departmentId = card.dataset.id;

  if (!departmentId) {
    throw new Error("Department ID is missing.");
  }

  const nameInput = form.querySelector(".edit-departments-name-input");

  const positionsList = form.querySelector(".edit-positions-list");

  const descriptionInput = form.querySelector(
    ".edit-departments-description-input",
  );

  const titleInput = form.querySelector(".edit-departments-title-input");

  const schoolYearInput = form.querySelector(
    ".edit-departments-schoolyear-input",
  );

  const votingTypeInput = form.querySelector(".edit-departments-voting-type");

  const campusSelect = form.querySelector(".edit-departments-campus");

  const memberList = form.querySelector(".edit-members-list");

  const members = memberList
    ? [...memberList.querySelectorAll(".member-row")]
        .map(collectMemberData)
        .map((member) => ({
          studentId: member.studentId,
          firstName: member.firstName,
          middleName: member.middleName || null,
          lastName: member.lastName,
          position: member.position || null,

          campaignImageUrl: member.campaign || null,

          backgroundImageUrl: member.background || null,

          photoImageUrl: member.photo || null,
        }))
    : [];

  const posterInput = form.querySelector(".edit-poster-input");

  const logoInput = form.querySelector(".edit-logo-input");

  const payload = {
    name: nameInput?.value.trim() || "",
    title: titleInput?.value.trim() || "",
    positions: getPositions(positionsList),
    description: descriptionInput?.value.trim() || "",
    schoolYear: schoolYearInput?.value.trim() || "",
    votingType: votingTypeInput?.value || "",

    posterImageUrl:
      posterInput?.dataset.deleted === "true"
        ? null
        : posterInput?.dataset.url || null,

    posterLogoUrl:
      logoInput?.dataset.deleted === "true"
        ? null
        : logoInput?.dataset.url || null,

    members: members,
  };

  try {
    showActionLoading(
      "Updating Department",
      "Please wait while the changes are being saved.",
    );

    const response = await fetch(`${DEPARTMENT_API}/${departmentId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();

      throw new Error(
        errorMessageFrom(message, "Failed to update department."),
      );
    }

    const updated = await response.json();

    card.classList.remove("editing", "show");

    const icon = card.querySelector(".expand-departments i");

    if (icon) {
      icon.className = "bi bi-chevron-down";
    }

    hideActionLoading();

    showSuccessToast(
      "Updated",
      `${updated.name || payload.name} was updated successfully.`,
    );

    await loadExistingDepartments();

    return updated;
  } catch (error) {
    console.error("Department update failed:", error);

    hideActionLoading();

    showSuccessToast(
      "Save Failed",
      error.message || "Unable to update the department.",
    );

    return false;
  }
}

async function saveNewDepartments(form) {
  if (!form) return;

  const name = document.getElementById("departmentsName")?.value.trim() || "";

  const title = document.getElementById("departmentsTitle")?.value.trim() || "";
  const description =
    document.getElementById("departmentsDescription")?.value.trim() || "";
  const schoolYear =
    document.getElementById("departmentsSchoolYear")?.value.trim() || "";
  const votingType =
    document.getElementById("departmentsVotingType")?.value || "";

  const memberList = document.getElementById("createMembersList");

  const members = memberList
    ? [...memberList.querySelectorAll(".member-row")].map(collectMemberData)
    : [];

  const posterInput = document.getElementById("departmentsPoster");

  const logoInput = document.getElementById("departmentsLogo");

  const posterFile =
    posterInput?.files?.[0] || posterInput?._uploadedFile || null;

  const logoFile = logoInput?.files?.[0] || logoInput?._uploadedFile || null;

  try {
    showActionLoading(
      "Saving Department",
      "Please wait while the department files are being uploaded.",
    );

    // =====================================================
    // UPLOAD DEPARTMENT POSTER
    // =====================================================

    let posterImageUrl = null;

    if (posterFile) {
      posterImageUrl = await uploadDepartmentFile(posterFile, "poster");
    }

    // =====================================================
    // UPLOAD DEPARTMENT LOGO
    // =====================================================

    let posterLogoUrl = null;

    if (logoFile) {
      posterLogoUrl = await uploadDepartmentFile(logoFile, "logo");
    }

    // =====================================================
    // MEMBERS
    // =====================================================

    const positionsList = document.getElementById("createPositionsList");

    const payload = {
      name,
      title,
      description,
      schoolYear,
      votingType,

      status: "ACTIVE",

      positions: getPositions(positionsList),

      // IMPORTANT
      posterImageUrl: posterImageUrl || posterInput?.dataset.url || null,

      posterLogoUrl: posterLogoUrl || logoInput?.dataset.url || null,

      members: members.map((member) => ({
        studentId: member.studentId,
        lastName: member.lastName,
        firstName: member.firstName,
        middleName: member.middleName || null,
        position: member.position || null,

        campaignImageUrl: member.campaign || null,

        backgroundImageUrl: member.background || null,

        photoImageUrl: member.photo || null,
      })),
    };

    // =====================================================
    // SAVE DEPARTMENT
    // =====================================================

    showActionLoading(
      "Saving Department",
      "Please wait while the department and members are being saved.",
    );

    const response = await fetch(DEPARTMENT_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Department save failed:", response.status, errorText);

      throw new Error(
        errorMessageFrom(errorText, "Failed to save department."),
      );
    }

    await response.json();

    hideActionLoading();

    resetCreateForm();
    clearAllInlineErrors();

    showSuccessToast("Added", `${name} was added successfully.`);

    await loadExistingDepartments();
  } catch (error) {
    console.error("Department creation failed:", error);

    hideActionLoading();

    showSuccessToast(
      "Save Failed",
      error.message || "Unable to save the department.",
    );
  }
}

function resetCreateForm() {
  const form = document.getElementById("createDepartmentsForm");
  if (!form) return;

  form.reset();

  document
    .querySelectorAll("#createDepartments .departments-file-upload")
    .forEach((upload) => {
      const preview = upload.querySelector(".departments-file-preview");
      const button = upload.querySelector(".departments-file-btn");
      const isLogo = upload.querySelector(".departments-logo-input") !== null;

      if (preview) {
        preview.innerHTML = "";
        preview.classList.remove("show");
      }

      if (button) {
        button.classList.remove("has-file");
        button.innerHTML = isLogo
          ? `<i class="bi bi-image"></i><span>Upload Logo</span>`
          : `<i class="bi bi-file-earmark-image"></i><span>Upload Poster</span>`;
      }
    });

  const positionsList = document.getElementById("createPositionsList");
  renderPositionsList(positionsList, [...DEFAULT_POSITIONS]);

  const list = document.getElementById("createMembersList");
  if (!list) return;

  list.innerHTML = "";
  DEFAULT_POSITIONS.forEach((position) =>
    addMemberRow(list, { position }, false, DEFAULT_POSITIONS, position),
  );
  updateRemoveButtons(list);
}

// Close file preview when clicking outside
document.addEventListener("click", (e) => {
  if (
    e.target.closest(".member-file-preview") ||
    e.target.closest(".photo-btn") ||
    e.target.closest(".campaign-btn") ||
    e.target.closest(".background-btn") ||
    e.target.closest(".existing-member-preview") ||
    e.target.closest(".view-member-campaign") ||
    e.target.closest(".view-member-photo") ||
    e.target.closest(".view-member-background")
  ) {
    return;
  }

  document.querySelectorAll(".member-file-preview.show").forEach((preview) => {
    preview.classList.remove("show");
  });
});

// Departments Tabs
function initializeDepartmentsTabs() {
  const tabs = document.querySelectorAll(".departments-tab");
  const sections = document.querySelectorAll(".departments-section");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const section = tab.dataset.section;

      tabs.forEach((item) => item.classList.remove("active"));
      sections.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      if (section === "create") {
        document.getElementById("createDepartments")?.classList.add("active");
      }

      if (section === "existing") {
        document.getElementById("existingDepartments")?.classList.add("active");
      }
    });
  });
}

function initializeDepartmentTitlePrefix() {
  function setupTitle(nameInput, titleInput) {
    if (!nameInput || !titleInput) return;

    function getPrefix() {
      const name = nameInput.value.trim();
      return name ? `${name} - ` : "";
    }

    function getTitleWithoutPrefix(value) {
      return (value || "")
        .replace(/^[A-Za-z0-9]+(?:\s*-\s*)+/i, "")
        .trimStart();
    }

    let prefix = getPrefix();

    // Clean any previously duplicated prefix immediately
    let titleText = getTitleWithoutPrefix(titleInput.value);

    titleInput.value = prefix + titleText;

    // Department changed
    nameInput.addEventListener("change", () => {
      const currentTitle = getTitleWithoutPrefix(titleInput.value);

      prefix = getPrefix();

      titleInput.value = prefix + currentTitle;
    });

    // Protect prefix while typing
    titleInput.addEventListener("keydown", (e) => {
      if (!prefix) return;

      const start = titleInput.selectionStart ?? 0;

      const end = titleInput.selectionEnd ?? 0;

      if (
        (e.key === "Backspace" && start <= prefix.length) ||
        (e.key === "Delete" && start < prefix.length)
      ) {
        e.preventDefault();

        titleInput.setSelectionRange(prefix.length, prefix.length);

        return;
      }

      if (start < prefix.length && end > 0) {
        e.preventDefault();

        titleInput.setSelectionRange(prefix.length, prefix.length);
      }
    });

    // Prevent duplicate prefixes from paste/input
    titleInput.addEventListener("input", () => {
      if (!prefix) return;

      const currentTitle = getTitleWithoutPrefix(titleInput.value);

      titleInput.value = prefix + currentTitle;

      requestAnimationFrame(() => {
        if (document.activeElement === titleInput) {
          const position = titleInput.value.length;

          titleInput.setSelectionRange(position, position);
        }
      });
    });
  }

  // CREATE FORM
  setupTitle(
    document.getElementById("departmentsName"),
    document.getElementById("departmentsTitle"),
  );

  // EDIT FORMS
  document
    .querySelectorAll("#existingDepartments .departments-item")
    .forEach((card) => {
      setupTitle(
        card.querySelector(".edit-departments-name-input"),
        card.querySelector(".edit-departments-title-input"),
      );
    });
}

function initializeVotingType() {
  const votingType = document.getElementById("departmentsVotingType");
  const positionsSection = document.querySelector(
    "#createDepartments .positions-section",
  );
  const membersSection = document.getElementById("createMembersSection");

  if (votingType) {
    const updateCreateVisibility = () => {
      const showPositions = votingType.value === "REPRESENTATIVE";
      const showMembers =
        votingType.value === "REPRESENTATIVE" ||
        votingType.value === "PARTYLIST";

      if (positionsSection)
        positionsSection.style.display = showPositions ? "" : "none";
      if (membersSection)
        membersSection.style.display = showMembers ? "" : "none";

      updateMemberPositionVisibility(
        document.getElementById("createMembersList"),
      );
    };

    votingType.addEventListener("change", updateCreateVisibility);
    updateCreateVisibility();
  }
}

function initializeEditVotingType(editPanel) {
  const votingType = editPanel.querySelector(".edit-departments-voting-type");
  const positions = editPanel.querySelector(".positions-section");
  const members = editPanel.querySelector(".members-section");

  if (!votingType) return;

  const updateVisibility = () => {
    const showPositions = votingType.value === "REPRESENTATIVE";
    const showMembers =
      votingType.value === "REPRESENTATIVE" || votingType.value === "PARTYLIST";

    if (positions) {
      positions.style.display = showPositions ? "" : "none";
    }

    if (members) {
      members.style.display = showMembers ? "" : "none";
    }

    updateMemberPositionVisibility(
      editPanel.querySelector(".edit-members-list"),
    );
  };

  votingType.addEventListener("change", updateVisibility);

  updateVisibility();
}

function showFileErrorToast(message) {
  let toast = document.getElementById("fileErrorToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "fileErrorToast";
    toast.className = "success-toast error";

    toast.innerHTML = `
            <div class="success-toast-icon">
                <i class="bi bi-exclamation-circle-fill"></i>
            </div>

            <div class="success-toast-content">
                <strong>No File Uploaded</strong>
                <span id="fileErrorToastMessage"></span>
            </div>

            <button
                type="button"
                class="success-toast-close"
                id="fileErrorToastClose"
                aria-label="Close notification">
                <i class="bi bi-x-lg"></i>
            </button>
        `;

    document.body.appendChild(toast);

    toast
      .querySelector("#fileErrorToastClose")
      ?.addEventListener("click", () => toast.classList.remove("show"));
  }

  toast.querySelector("#fileErrorToastMessage").textContent = message;

  requestAnimationFrame(() => toast.classList.add("show"));

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove("show"), 4000);
}

/* ==========================================================
   REAL-TIME UPDATES
========================================================== */

function connectDepartmentsSocket() {
  if (typeof SockJS === "undefined") {
    console.error("SockJS not loaded — real-time department updates disabled.");
    return;
  }

  const campusId = document.body.dataset.adminCampusId || "";
  const topic = campusId
    ? `/topic/departments/campus/${campusId}`
    : "/topic/departments";

  if (typeof StompJs !== "undefined") {
    const client = new StompJs.Client({
      webSocketFactory: () => new SockJS("/ws-analytics"),
      reconnectDelay: 4000,
    });
    client.onConnect = () =>
      client.subscribe(topic, () => loadExistingDepartments(true));
    client.activate();
  } else if (typeof Stomp !== "undefined") {
    const socket = new SockJS("/ws-analytics");
    const client = Stomp.over(socket);
    client.debug = () => {};
    client.connect({}, () =>
      client.subscribe(topic, () => loadExistingDepartments(true)),
    );
  } else {
    console.error(
      "No STOMP client library found — real-time department updates disabled.",
    );
  }
}

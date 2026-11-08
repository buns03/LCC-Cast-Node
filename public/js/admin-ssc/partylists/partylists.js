/* LCCAST - Partylists Page */

/* =========================================================
   GLOBAL ACTION LOADING MODAL
========================================================= */

const PARTYLIST_API = "/admin-ssc/api/partylists";
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
const ADMIN_CAMPUS_ID = document.body.dataset.adminCampusId || "";

function getProtectedFileUrl(storagePath) {
  if (!storagePath) return "";

  return `${PARTYLIST_API}/file?path=${encodeURIComponent(storagePath)}`;
}

// School year starts in June (month index 5). Keep this the same as the elections page.
const SCHOOL_YEAR_START_MONTH = 5;

function getCurrentSchoolYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear =
    date.getMonth() >= SCHOOL_YEAR_START_MONTH ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function initializeDefaultSchoolYear() {
  const input = document.getElementById("partylistsSchoolYear");
  if (!input) return;

  const schoolYear = getCurrentSchoolYear();
  input.defaultValue = schoolYear; // form.reset() restores this
  input.value = schoolYear; // still editable
}

function showActionLoading(title, message) {
  const modal = document.getElementById("actionLoadingModal");
  const titleElement = document.getElementById("actionLoadingTitle");
  const messageElement = document.getElementById("actionLoadingMessage");

  if (!modal) {
    console.error("actionLoadingModal not found.");
    return;
  }

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }

  modal.classList.add("show");
  document.body.classList.add("modal-loading");
}

function hideActionLoading() {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) {
    return;
  }

  modal.classList.remove("show");
  document.body.classList.remove("modal-loading");
}

document.addEventListener("DOMContentLoaded", async () => {
  initializePartylistsTabs();
  initializePartylistsCards();
  initializeCreateMembers();
  initializeEditForms();
  initializeDeleteDiscardModals();
  initializeSelectionModalButtons();
  initializePartylistsFileUploads();
  initializeExistingMemberFiles();
  initializeCampusFilter();
  initializeSuccessToast();
  initializeValidationBindings();
  initializeDefaultSchoolYear();

  await loadExistingPartylists();
  connectPartylistsSocket();
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

let partylistsLoadId = 0;
async function loadExistingPartylists(force = false) {
  const list = document.querySelector("#existingPartylists .partylists-list");

  if (!list) return;

  const loadId = ++partylistsLoadId;

  try {
    const partylists = await SoftCache.load(PARTYLIST_API, {
      force,
      onRevalidated: () => {
        // Don't rebuild the DOM while the admin is editing or has a card open
        if (
          document.querySelector(
            "#existingPartylists .partylists-item.editing, #existingPartylists .partylists-item.show",
          )
        )
          return;
        loadExistingPartylists();
      },
    });

    if (loadId !== partylistsLoadId) return;

    const fragment = document.createDocumentFragment();

    if (!Array.isArray(partylists) || partylists.length === 0) {
      list.innerHTML = "";
      list.innerHTML = `
                <div class="empty-state">
                    No active partylists found.
                </div>
            `;
      refreshExisting();
      return;
    }

    for (const partylist of partylists) {
      const card = document.createElement("article");

      card.className = "partylists-item";
      card.dataset.id = partylist.id || "";
      card.dataset.campus = partylist.campus?.id || "";

      const campusName = partylist.campus?.name || "";

      card.innerHTML = `
                <div class="partylists-item-header">

                    <div class="partylists-item-title">

                        <div class="partylists-logo-small">

                            ${
                              partylist.posterLogoUrl
                                ? `
                                        <img
                                            class="partylists-logo-image"
                                            src="${esc(getProtectedFileUrl(partylist.posterLogoUrl))}"
                                            alt="${esc(partylist.name || "")} Logo"
                                        >
                                      `
                                : `
                                        <span class="partylists-logo-initials">
                                            ${esc(getPartylistsInitials(partylist.name))}
                                        </span>
                                      `
                            }

                        </div>

                        <div class="partylists-title-text">

                            <h3>${esc(partylist.name || "")}</h3>

                            <span class="partylists-description">
                                ${esc(partylist.description || "")}
                            </span>

                        </div>

                    </div>

                    <div class="partylists-header-right">

                        <div class="partylists-campus">
                            <i class="bi bi-building"></i>
                            <span>${esc(campusName)}</span>
                        </div>

                        <div class="partylists-controls">

                            <button
                                type="button"
                                class="icon-btn edit-partylists"
                                title="Edit">
                                <i class="bi bi-pencil"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn archive-partylists"
                                title="Archive">
                                <i class="bi bi-archive"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn delete-partylists"
                                title="Delete">
                                <i class="bi bi-trash"></i>
                            </button>

                            <button
                                type="button"
                                class="icon-btn expand-partylists"
                                title="Expand">
                                <i class="bi bi-chevron-down"></i>
                            </button>

                        </div>

                    </div>

                </div>

                <section class="partylists-details">

                    <div class="partylists-info">

                        <div class="partylists-expanded-content">

                            <div class="partylists-poster-preview">

                                <div class="partylists-preview-title">
                                    <span>Poster</span>
                                </div>

                                <div class="partylists-file-preview existing-poster-preview">

                                    ${createFileDisplay(
                                      partylist.posterImageUrl,
                                      "poster",
                                      `${partylist.name || ""} Poster`,
                                    )}

                                </div>

                            </div>

                            <div class="partylists-expanded-details">

                                <div class="partylists-info-row">
                                    <label>Campus:</label>
                                    <span class="existing-partylists-campus">
                                        ${esc(campusName)}
                                    </span>
                                </div>

                                <div class="partylists-info-row">
                                    <label>Description:</label>
                                    <span>
                                        ${esc(partylist.description || "—")}
                                    </span>
                                </div>

                                <div class="partylists-info-row">
                                    <label>School Year:</label>
                                    <span>
                                        ${esc(partylist.schoolYear || "")}
                                    </span>
                                </div>

                                <div class="partylists-info-row members-info-row">

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

      const details = card.querySelector(".partylists-details");

      if (details) {
        details.insertAdjacentHTML(
          "beforeend",
          createEditPartylistPanel(partylist),
        );
      }

      fragment.appendChild(card);

      bindPartylistsCard(card);
      initializePartylistsFileUploads(card);
      bindEditForm(card);

      await loadPartylistMembers(card, partylist.id, force);
    }

    // only the newest load is allowed to touch the page
    if (loadId !== partylistsLoadId) return;

    list.innerHTML = "";
    list.appendChild(fragment);

    refreshExisting();
  } catch (error) {
    console.error("Error loading partylists:", error);

    list.innerHTML = `
            <div class="empty-state">
                Unable to load partylists.
            </div>
        `;
  }
}

/* ==========================================================
   REAL-TIME UPDATES
========================================================== */

function connectPartylistsSocket() {
  if (typeof StompJs === "undefined" || typeof SockJS === "undefined") {
    console.error(
      "StompJs/SockJS not loaded — real-time partylist updates disabled.",
    );
    return;
  }

  const topic = ADMIN_CAMPUS_ID
    ? `/topic/partylists/campus/${ADMIN_CAMPUS_ID}`
    : "/topic/partylists";

  const client = new StompJs.Client({
    webSocketFactory: () => new SockJS("/ws-analytics"),
    reconnectDelay: 4000,
    onConnect: () => {
      client.subscribe(topic, () => loadExistingPartylists(true));
    },
  });

  client.activate();
}

async function loadPartylistMembers(card, partylistId, force = false) {
  const memberList = card.querySelector(".existing-member-list");

  if (!memberList || !partylistId) return;

  try {
    const rawMembers = await SoftCache.load(
      `${PARTYLIST_API}/${partylistId}/members`,
      {
        force,
        onRevalidated: () => {
          if (card.isConnected && !card.classList.contains("editing")) {
            loadPartylistMembers(card, partylistId);
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

               <span class="existing-member-position">
                   ${esc(member.position || "")}
               </span>

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

async function loadCampuses() {
  const campusSelect = document.getElementById("partylistsCampus");

  if (!campusSelect) return;

  try {
    const response = await fetch(`${PARTYLIST_API}/campuses`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to load campuses.");
    }

    const campuses = await response.json();

    campusSelect.innerHTML = `
            <option value="">Select Campus</option>
        `;

    campuses.forEach((campus) => {
      if (!campus.id) return;

      const option = document.createElement("option");

      option.value = campus.id;
      option.textContent = campus.name || "";

      campusSelect.appendChild(option);
    });
  } catch (error) {
    console.error("Failed to load campuses:", error);

    campusSelect.innerHTML = `
            <option value="">Unable to load campuses</option>
        `;
  }
}

async function createPartylist(form) {
  const campusId = document.getElementById("partylistsCampus")?.value;

  const members = [
    ...document.querySelectorAll("#createMembersList .member-row"),
  ].map(collectMemberData);

  const payload = {
    name: document.getElementById("partylistsName")?.value.trim() || "",

    description:
      document.getElementById("partylistsDescription")?.value.trim() || "",

    schoolYear:
      document.getElementById("partylistsSchoolYear")?.value.trim() || "",

    campus: {
      id: campusId,
    },

    status: "ACTIVE",

    posterImageUrl:
      document.getElementById("partylistsPoster")?.dataset.url || null,

    posterLogoUrl:
      document.getElementById("partylistsLogo")?.dataset.url || null,

    members: members.map((member) => ({
      studentId: member.studentId,
      lastName: member.lastName,
      firstName: member.firstName,
      middleName: member.middleName || null,
      position: member.position,

      campaignImageUrl: member.campaign || null,
      backgroundImageUrl: member.background || null,
      photoImageUrl: member.photo || null,
    })),
  };

  try {
    showActionLoading("Creating Partylist", "Saving partylist information...");

    const response = await fetch(PARTYLIST_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();

      throw new Error(
        errorMessageFrom(message, `Create failed: ${response.status}`),
      );
    }

    await response.json();

    hideActionLoading();

    await loadExistingPartylists();

    return true;
  } catch (error) {
    console.error("Create partylist failed:", error);

    hideActionLoading();

    alert(error.message || "Failed to create partylist.");

    return false;
  }
}

async function archivePartylist(id) {
  try {
    showActionLoading("Archiving Partylist", "Please wait...");

    const response = await fetch(`${PARTYLIST_API}/${id}/archive`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to archive partylist.");
    }

    hideActionLoading();

    await loadExistingPartylists();

    return true;
  } catch (error) {
    console.error("Archive failed:", error);

    hideActionLoading();

    alert(error.message || "Failed to archive partylist.");

    return false;
  }
}

async function deletePartylist(id) {
  try {
    showActionLoading("Deleting Partylist", "Please wait...");

    const response = await fetch(`${PARTYLIST_API}/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to delete partylist.");
    }

    hideActionLoading();

    await loadExistingPartylists();

    return true;
  } catch (error) {
    console.error("Delete failed:", error);

    hideActionLoading();

    alert(error.message || "Failed to delete partylist.");

    return false;
  }
}

// Partylists Initials
function getPartylistsInitials(name) {
  if (!name) return "";
  const words = name.trim().split(/\s+/);
  return words.length === 1
    ? words[0].substring(0, 2).toUpperCase()
    : words
        .map((word) => word[0])
        .join("")
        .toUpperCase();
}

function createFileDisplay(url, type = "image", alt = "") {
  if (!url) {
    return `
            <div class="file-preview-empty">
                No file uploaded.
            </div>
        `;
  }

  const fileName = getFileName(url);

  const isPDF = type === "pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (isPDF) {
    return `
            <div class="file-display-pdf">

                <iframe
                    src="${esc(getProtectedFileUrl(url))}"
                    title="${esc(alt || "PDF Preview")}"
                    loading="lazy">
                </iframe>

            </div>
        `;
  }

  return `
        <img
            src="${esc(getProtectedFileUrl(url))}"
            alt="${esc(alt)}"
            loading="lazy"
        >
    `;
}

function updatePartylistsLogo(card) {
  const logoContainer = card.querySelector(".partylists-logo-small");
  const logoImage = card.querySelector(".partylists-logo-image");
  const initials = card.querySelector(".partylists-logo-initials");

  if (!logoContainer || !initials) return;

  const title = card.querySelector(".partylists-item-title h3");
  const partyName = title?.textContent.trim() || "";

  if (logoImage && logoImage.getAttribute("src")) {
    logoImage.style.display = "block";
    initials.style.display = "none";
    return;
  }

  if (logoImage) {
    logoImage.style.display = "none";
  }

  initials.textContent = getPartylistsInitials(partyName);
  initials.style.display = "flex";
}

// Partylists Cards
function initializePartylistsCards() {
  document
    .querySelectorAll("#existingPartylists .partylists-item")
    .forEach(bindPartylistsCard);
}

function bindPartylistsCard(card) {
  if (!card || card.dataset.bound === "true") return;
  card.dataset.bound = "true";
  updatePartylistsLogo(card);

  const expand = card.querySelector(".expand-partylists");
  const edit = card.querySelector(".edit-partylists");
  const remove = card.querySelector(".delete-partylists");
  const archive = card.querySelector(".archive-partylists");

  // Expand
  expand?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isOpen = card.classList.contains("show");

    allPartylistsCards().forEach((other) => {
      if (other === card) return;
      other.classList.remove("show", "editing");
      const icon = other.querySelector(".expand-partylists i");
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

    allPartylistsCards().forEach((other) => {
      if (other === card) return;
      other.classList.remove("editing", "show");
      const otherIcon = other.querySelector(".expand-partylists i");
      if (otherIcon) otherIcon.className = "bi bi-chevron-down";
    });

    if (isEditing) {
      card.classList.remove("editing");
    } else {
      // Enter edit mode - hide the normal expanded details
      card.classList.remove("show");
      card.classList.add("editing");

      // Keep expand icon pointing down since details are collapsed
      const icon = card.querySelector(".expand-partylists i");
      if (icon) icon.className = "bi bi-chevron-down";

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

function allPartylistsCards() {
  return document.querySelectorAll("#existingPartylists .partylists-item");
}

// Create Members
function initializeCreateMembers() {
  const list = document.getElementById("createMembersList");
  const add = document.getElementById("addMemberBtn");
  if (!list || !add) return;

  DEFAULT_POSITIONS.forEach((position) =>
    addMemberRow(list, { position }, false),
  );

  add.addEventListener("click", () => {
    addMemberRow(list, { position: "Member" }, true);
    updateRemoveButtons(list);
  });
}

// Add Member Row
function addMemberRow(list, member = {}, removable = true) {
  const row = document.createElement("div");
  row.className = removable ? "member-row can-remove" : "member-row";

  const position = member.position || "Member";
  const existingPhoto = member.photo || "";
  const existingBackground = member.background || "";
  const isOtherPosition =
    !DEFAULT_POSITIONS.includes(position) && position !== "Member";

  row.innerHTML = `
        <div class="member-field-group">
            <input type="text" class="member-student-id" placeholder="Student No. / ID"
                value="${esc(member.studentId || "")}" autocomplete="off" inputmode="text">
            <small class="inline-error member-student-id-error"></small>
        </div>

        <div class="member-field-group">
            <input type="text" class="member-last-name" placeholder="Last Name" value="${esc(member.lastName || "")}">
            <small class="inline-error member-last-name-error"></small>
        </div>

        <div class="member-field-group">
            <input type="text" class="member-first-name" placeholder="First Name" value="${esc(member.firstName || "")}">
            <small class="inline-error member-first-name-error"></small>
        </div>

        <div class="member-field-group">
            <input type="text" class="member-middle-name" placeholder="Middle Name" value="${esc(member.middleName || "")}">
        </div>

        <div class="member-field-group">
            <div class="position-wrapper">
                <select class="member-position">${positionOptions(position)}</select>
                <input type="text" class="other-position-input" placeholder="Enter position"
                    value="${isOtherPosition ? esc(position) : ""}" ${isOtherPosition ? "" : "hidden"}>
                <small class="inline-error member-position-error"></small>
            </div>
        </div>

        <input type="file" class="campaign-input" accept="image/*" hidden>

        <button type="button" class="campaign-btn" title="Upload Campaign / Platform">
            <span>Campaign</span>
        </button>

        <input type="file" class="background-input"
       accept="application/pdf,image/*" hidden>

        <button type="button" class="background-btn" title="Upload Background">
            <span>Background</span>
        </button>

        <input type="file" class="photo-input" accept="image/*" hidden>

        <button type="button" class="photo-btn" title="Upload member photo">
            <i class="bi bi-person-bounding-box"></i>
            <span>Photo</span>
        </button>


        <button type="button" class="remove-member" title="Remove member">
            <i class="bi bi-x-lg"></i>
        </button>

        <div class="member-file-preview"></div>
    `;

  // Student ID / key
  // =========================================================
  // STUDENT ID AUTOFILL
  // =========================================================

  const studentIdInput = row.querySelector(".member-student-id");

  let studentLookupTimer = null;

  studentIdInput?.addEventListener("input", () => {
    const campusSelect =
      list
        .closest("form")
        ?.querySelector("#partylistsCampus, .edit-partylists-campus") ||
      document.getElementById("partylistsCampus");

    const selectedCampus = campusSelect?.value || "";

    if (!selectedCampus) {
      studentIdInput.value = "";
      showInlineError(studentIdInput, "Please select a campus first.");
      return;
    }

    const studentId = studentIdInput.value.trim();

    const lastNameInput = row.querySelector(".member-last-name");

    const firstNameInput = row.querySelector(".member-first-name");

    const middleNameInput = row.querySelector(".member-middle-name");

    // Clear previous timer
    clearTimeout(studentLookupTimer);

    // If Student ID was cleared, clear autofilled names too
    if (!studentId) {
      lastNameInput.value = "";
      firstNameInput.value = "";
      middleNameInput.value = "";

      clearInlineError(studentIdInput);
      return;
    }

    // Clear error while typing
    clearInlineError(studentIdInput);

    // Wait until user stops typing
    studentLookupTimer = setTimeout(async () => {
      try {
        showActionLoading(
          "Finding Student",
          "Please wait while we retrieve the student information.",
        );

        const student = await lookupStudentById(studentId, selectedCampus);

        if (!student) {
          showInlineError(studentIdInput, "Student ID was not found.");

          return;
        }

        // =================================================
        // AUTOFILL
        // =================================================

        lastNameInput.value = student.lastName || "";

        firstNameInput.value = student.firstName || "";

        middleNameInput.value = student.middleName || "";

        clearInlineError(studentIdInput);
        clearInlineError(lastNameInput);
        clearInlineError(firstNameInput);
      } catch (error) {
        console.error("Student lookup failed:", error);

        showInlineError(
          studentIdInput,
          "Unable to retrieve student information.",
        );
      } finally {
        hideActionLoading();
      }
    }, 500);
  });

  // Position
  const positionSelect = row.querySelector(".member-position");
  const otherInput = row.querySelector(".other-position-input");

  positionSelect.addEventListener("change", () => {
    if (positionSelect.value === "Others") {
      otherInput.hidden = false;
      otherInput.focus();
    } else {
      otherInput.hidden = true;
      otherInput.value = "";
    }
  });

  // Campaign / Platform Image
  const campaignFile = row.querySelector(".campaign-input");
  const campaignButton = row.querySelector(".campaign-btn");

  campaignButton?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (row._campaignFile || row.dataset.campaign) {
      toggleMemberFilePreview(row, "campaign");
      return;
    }

    campaignFile?.click();
  });

  campaignFile?.addEventListener("change", async () => {
    const file = campaignFile.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      campaignFile.value = "";
      return;
    }

    try {
      showActionLoading(
        "Uploading Campaign",
        "Please wait while the campaign image is being uploaded.",
      );

      const url = await uploadPartylistFile(file, "campaign");

      row._campaignFile = file;
      row.dataset.campaign = url;

      campaignButton.classList.add("has-campaign");
      campaignButton.innerHTML = `
                <i class="bi bi-check-lg"></i>
                <span>Campaign</span>
            `;

      showMemberFilePreview(row, "campaign");
      refreshExisting();
    } catch (error) {
      console.error("Campaign upload failed:", error);

      alert(error.message || "Failed to upload campaign image.");

      campaignFile.value = "";
    } finally {
      hideActionLoading();
    }
  });

  // Background Image
  const backgroundFile = row.querySelector(".background-input");
  const backgroundButton = row.querySelector(".background-btn");

  backgroundButton?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const hasBackground = !!row._backgroundFile || !!row.dataset.background;

    if (hasBackground) {
      toggleMemberFilePreview(row, "background");
      return;
    }

    backgroundFile?.click();
  });

  backgroundFile?.addEventListener("change", async () => {
    const file = backgroundFile.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      alert("Please select an image or PDF file.");
      backgroundFile.value = "";
      return;
    }

    try {
      showActionLoading(
        "Uploading Background",
        "Please wait while the background file is being uploaded.",
      );

      const url = await uploadPartylistFile(file, "background");

      row._backgroundFile = file;
      row.dataset.background = url;

      backgroundButton.classList.add("has-background");
      backgroundButton.innerHTML = `
                <i class="bi bi-check-lg"></i>
                <span>Background</span>
            `;

      showMemberFilePreview(row, "background");
      refreshExisting();
    } catch (error) {
      console.error("Background upload failed:", error);

      alert(error.message || "Failed to upload background file.");

      backgroundFile.value = "";
    } finally {
      hideActionLoading();
    }
  });

  // Photo
  const photoFile = row.querySelector(".photo-input");
  const photoButton = row.querySelector(".photo-btn");

  photoButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (row._photoFile || row.dataset.photo) {
      toggleMemberFilePreview(row, "photo");
      return;
    }

    photoFile.click();
  });

  photoFile.addEventListener("change", async () => {
    const file = photoFile.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      photoFile.value = "";
      return;
    }

    try {
      showActionLoading(
        "Uploading Photo",
        "Please wait while the member photo is being uploaded.",
      );

      const url = await uploadPartylistFile(file, "photo");

      row._photoFile = file;
      row.dataset.photo = url;

      photoButton.classList.add("has-photo");
      photoButton.innerHTML = `
                <i class="bi bi-check-lg"></i>
                <span>Photo</span>
            `;

      showMemberFilePreview(row, "photo");
      refreshExisting();
    } catch (error) {
      console.error("Photo upload failed:", error);

      alert(error.message || "Failed to upload member photo.");

      photoFile.value = "";
    } finally {
      hideActionLoading();
    }
  });

  // Remove
  row.querySelector(".remove-member").addEventListener("click", () => {
    row.remove();
    updateRemoveButtons(list);
    refreshAccordion(list.closest(".accordion"));
  });

  list.appendChild(row);
  const existingCampaign = member.campaign || "";

  if (existingCampaign) {
    row.dataset.campaign = existingCampaign;
    row._campaignFile = null;

    campaignButton?.classList.add("has-campaign");

    if (campaignButton) {
      campaignButton.innerHTML = `
            <i class="bi bi-check-lg"></i>
            <span>Campaign</span>
        `;
    }
  }

  if (existingBackground) {
    row.dataset.background = existingBackground;
    row._backgroundFile = null;

    backgroundButton?.classList.add("has-background");

    if (backgroundButton) {
      backgroundButton.innerHTML = `
            <i class="bi bi-check-lg"></i>
            <span>Background</span>
        `;
    }
  }

  if (existingPhoto) {
    row.dataset.photo = existingPhoto;
    row._photoFile = null;

    photoButton?.classList.add("has-photo");

    if (photoButton) {
      photoButton.innerHTML = `<i class="bi bi-check-lg"></i><span>Photo</span>`;
    }
  }
}

// Student Lookup (backend-ready, not connected yet)
async function lookupStudentById(studentId) {
  if (!studentId) return null;
  try {
    const response = await fetch(
      `${PARTYLIST_API}/members/student/${encodeURIComponent(studentId)}`,
    );
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("Student lookup failed:", error);
    return null;
  }
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

async function validatePartylistMembers(
  memberList,
  schoolYear,
  partylistId = null,
  campusId = null,
) {
  if (!memberList) return true;

  const rows = [...memberList.querySelectorAll(".member-row")];

  const members = rows.map(collectMemberData);

  // Clear previous member assignment errors
  rows.forEach((row) => {
    clearInlineError(row.querySelector(".member-student-id"));
  });

  // =========================================================
  // SAME STUDENT IN SAME PARTYLIST
  // =========================================================

  const seen = new Map();

  for (const row of rows) {
    const input = row.querySelector(".member-student-id");

    const studentId = input?.value.trim().toLowerCase() || "";

    if (!studentId) continue;

    if (seen.has(studentId)) {
      showInlineError(
        input,
        "This student cannot hold multiple positions in the same partylist.",
      );

      showInlineError(
        seen.get(studentId),
        "This student cannot hold multiple positions in the same partylist.",
      );

      return false;
    }

    seen.set(studentId, input);
  }

  // =========================================================
  // CHECK BACKEND
  // =========================================================

  try {
    const response = await fetch(`${PARTYLIST_API}/validate-members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: partylistId,
        campus: {
          id: campusId,
        },
        schoolYear: schoolYear,
        members: members.map((member) => ({
          studentId: member.studentId,
        })),
      }),
    });

    if (response.ok) {
      return true;
    }

    const data = await response.json();

    const message = data.error || "Invalid member assignment.";

    const match = message.match(
      /Student\s+(.+?)\s+(?:is already|does not belong)/i,
    );

    if (match) {
      const duplicateId = match[1].trim().toLowerCase();

      const row = rows.find(
        (row) =>
          row
            .querySelector(".member-student-id")
            ?.value.trim()
            .toLowerCase() === duplicateId,
      );

      if (row) {
        showInlineError(row.querySelector(".member-student-id"), message);

        return false;
      }
    }

    return false;
  } catch (error) {
    console.error("Member validation failed:", error);

    return false;
  }
}

// Edit Forms
function initializeEditForms() {
  document
    .querySelectorAll("#existingPartylists .partylists-item")
    .forEach((card) => bindEditForm(card));

  // Create form
  const form = document.getElementById("createPartylistsForm");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllInlineErrors();

    showActionLoading("Validating", "Checking member details...");

    const nameInput = document.getElementById("partylistsName");
    const schoolYearInput = document.getElementById("partylistsSchoolYear");
    const campusSelect = document.getElementById("partylistsCampus");
    const memberList = document.getElementById("createMembersList");

    let isValid = true;

    if (
      !nameInput ||
      !validateRequiredField(nameInput, "Partylists name is required.")
    )
      isValid = false;
    if (
      !schoolYearInput ||
      !validateRequiredField(
        schoolYearInput,
        "Partylists school year is required.",
      )
    )
      isValid = false;
    if (
      !campusSelect ||
      !validateRequiredField(campusSelect, "Please select a campus.")
    )
      isValid = false;
    if (memberList && !validateMembers(memberList)) {
      isValid = false;
    }

    if (!isValid) {
      hideActionLoading();
      return;
    }

    const membersValid = await validatePartylistMembers(
      memberList,
      schoolYearInput.value.trim(),
      null,
      campusSelect.value,
    );

    if (!membersValid) {
      hideActionLoading();
      return;
    }

    pendingSaveAction = { type: "create", form };

    hideActionLoading();
    openModal("savePartylistsModal");
  });

  // Discard
  document
    .getElementById("discardPartylists")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      openDiscardModal();
    });
}
function bindEditForm(card) {
  if (!card || card.dataset.editBound === "true") return;
  card.dataset.editBound = "true";

  const form = card.querySelector(".edit-partylists-form");
  const list = card.querySelector(".edit-members-list");
  const add = card.querySelector(".edit-add-member");
  const cancel = card.querySelector(".cancel-partylists-edit");

  if (!form) return;

  const campusSelect = form.querySelector(".edit-partylists-campus");

  initializeExistingPartylistFiles(card);

  // Add member
  add?.addEventListener("click", (e) => {
    e.preventDefault();

    addMemberRow(list, { position: "Member" }, true);

    updateRemoveButtons(list);
    refreshExisting();
  });

  // Cancel
  cancel?.addEventListener("click", (e) => {
    e.preventDefault();

    clearAllInlineErrors();

    card.classList.remove("editing", "show");

    const icon = card.querySelector(".expand-partylists i");

    if (icon) {
      icon.className = "bi bi-chevron-down";
    }

    refreshExisting();
  });

  // Save
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    clearAllInlineErrors();

    showActionLoading("Validating", "Checking member details...");

    const nameInput = form.querySelector(".edit-partylists-name-input");

    const descriptionInput = form.querySelector(
      ".edit-partylists-description-input",
    );

    const schoolYearInput = form.querySelector(
      ".edit-partylists-schoolyear-input",
    );

    const campusSelect = form.querySelector(".edit-partylists-campus");

    const editList = form.querySelector(".edit-members-list");

    let isValid = true;

    if (
      !nameInput ||
      !validateRequiredField(nameInput, "Partylists name is required.")
    ) {
      isValid = false;
    }

    if (
      !schoolYearInput ||
      !validateRequiredField(
        schoolYearInput,
        "Partylists school year is required.",
      )
    ) {
      isValid = false;
    }

    if (
      !campusSelect ||
      !validateRequiredField(campusSelect, "Please select a campus.")
    ) {
      isValid = false;
    }

    if (editList && !validateMembers(editList)) {
      isValid = false;
    }

    if (!isValid) {
      hideActionLoading();
      return;
    }

    const membersValid = await validatePartylistMembers(
      editList,
      schoolYearInput.value.trim(),
      card.dataset.id,
      campusSelect.value,
    );

    if (!membersValid) {
      hideActionLoading();
      return;
    }

    pendingSaveAction = {
      type: "edit",
      card: card,
    };

    hideActionLoading();
    openModal("savePartylistsModal");
  });
}

function initializeExistingPartylistFiles(card) {
  const uploads = card.querySelectorAll(".partylists-file-upload");

  uploads.forEach((upload) => {
    const input = upload.querySelector('input[type="file"]');

    const button = upload.querySelector(".partylists-file-btn");

    const preview = upload.querySelector(".partylists-file-preview");

    if (!input || !button || !preview) return;

    const url = input.dataset.url || "";

    const isLogo = input.classList.contains("partylists-logo-input");

    const isPoster = input.classList.contains("partylists-poster-input");

    if (!isLogo && !isPoster) return;

    /*
     * =====================================================
     * NO EXISTING FILE
     * =====================================================
     */

    if (!url) {
      preview.innerHTML = "";
      preview.classList.remove("show");

      button.classList.remove("has-file");

      button.innerHTML = isLogo
        ? `
                    <i class="bi bi-image"></i>
                    <span>Upload Logo</span>
                  `
        : `
                    <i class="bi bi-file-earmark-image"></i>
                    <span>Upload Poster</span>
                  `;

      return;
    }

    /*
     * =====================================================
     * EXISTING FILE
     * =====================================================
     */

    upload.dataset.url = url;

    input.dataset.url = url;
    input.dataset.deleted = "false";

    button.classList.add("has-file");

    button.innerHTML = isLogo
      ? `
                <i class="bi bi-check-lg"></i>
                <span>Logo Uploaded</span>
              `
      : `
                <i class="bi bi-check-lg"></i>
                <span>Poster Uploaded</span>
              `;

    /*
     * =====================================================
     * CREATE ACTUAL FILE PREVIEW
     * =====================================================
     */

    const fileName = getFileName(url);

    const protectedUrl = getProtectedFileUrl(url);

    const isPDF = fileName.toLowerCase().endsWith(".pdf");

    preview.innerHTML = `
            <div class="file-preview-header">

                <strong>
                    ${isLogo ? "Partylist Logo" : "Partylist Poster"}
                </strong>

                <button
                    type="button"
                    class="file-preview-close"
                    title="Remove preview">

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
                                title="${
                                  isLogo ? "Partylist Logo" : "Partylist Poster"
                                } Preview">
                            </iframe>
                          `
                    : `
                            <img
                                src="${esc(protectedUrl)}"
                                alt="${
                                  isLogo ? "Partylist Logo" : "Partylist Poster"
                                }"
                                loading="lazy">
                          `
                }

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
     * =====================================================
     * CLOSE PREVIEW
     * =====================================================
     */

    preview
      .querySelector(".file-preview-close")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        preview.classList.remove("show");
      });

    /*
     * =====================================================
     * CHANGE FILE
     * =====================================================
     */

    preview
      .querySelector(".file-change-btn")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        input.click();
      });

    /*
     * =====================================================
     * DELETE FILE
     * ===================================================== */

    preview
      .querySelector(".file-delete-btn")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        input.dataset.url = "";
        input.dataset.deleted = "true";

        upload.dataset.url = "";

        preview.innerHTML = "";
        preview.classList.remove("show");

        button.classList.remove("has-file");

        button.innerHTML = isLogo
          ? `
                        <i class="bi bi-image"></i>
                        <span>Upload Logo</span>
                      `
          : `
                        <i class="bi bi-file-earmark-image"></i>
                        <span>Upload Poster</span>
                      `;
      });
  });
}

function createPartylistCard(partylist) {
  const card = document.createElement("article");

  card.className = "partylists-item";
  card.dataset.id = partylist.id;
  card.dataset.campus = partylist.campus?.id || "";

  const members = partylist.members || [];

  card.innerHTML = `
        <div class="partylists-item-header">

            <div class="partylists-item-title">

                <div class="partylists-logo-small">

                    ${
                      partylist.posterLogoUrl
                        ? `<img
                                class="partylists-logo-image"
                                src="${esc(getProtectedFileUrl(partylist.posterLogoUrl))}"
                                alt="${esc(partylist.name)} Logo"
                              >`
                        : `<img
                                class="partylists-logo-image"
                                src="/images/default-partylists.png"
                                alt="${esc(partylist.name)} Logo"
                              >`
                    }

                    <span class="partylists-logo-initials">
                        ${esc(getPartylistsInitials(partylist.name))}
                    </span>

                </div>

                <div class="partylists-title-text">

                    <h3>${esc(partylist.name)}</h3>

                    <span class="partylists-description">
                        ${esc(partylist.description || "")}
                    </span>

                </div>

            </div>

            <div class="partylists-header-right">

                <div class="partylists-campus">
                    <i class="bi bi-building"></i>
                    <span>${esc(partylist.campus?.name || "")}</span>
                </div>

                <div class="partylists-controls">

                    <button
                        type="button"
                        class="icon-btn edit-partylists"
                        title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>

                    <button
                        type="button"
                        class="icon-btn archive-partylists"
                        title="Archive">
                        <i class="bi bi-archive"></i>
                    </button>

                    <button
                        type="button"
                        class="icon-btn delete-partylists"
                        title="Delete">
                        <i class="bi bi-trash"></i>
                    </button>

                    <button
                        type="button"
                        class="icon-btn expand-partylists"
                        title="Expand">
                        <i class="bi bi-chevron-down"></i>
                    </button>

                </div>

            </div>

        </div>

        <section class="partylists-details">

            <div class="partylists-info">

                <div class="partylists-expanded-content">

                    <div class="partylists-poster-preview">

                        <div class="partylists-preview-title">
                            <span>Poster</span>
                        </div>

                        <div class="partylists-file-preview existing-poster-preview">

                            ${createFileDisplay(
                              partylist.posterImageUrl,
                              "poster",
                              `${partylist.name || ""} Poster`,
                            )}

                        </div>

                    </div>

                    <div class="partylists-expanded-details">

                        <div class="partylists-info-row">
                            <label>Campus:</label>
                            <span class="existing-partylists-campus">
                                ${esc(partylist.campus?.name || "")}
                            </span>
                        </div>

                        <div class="partylists-info-row">
                            <label>Description:</label>
                            <span>
                                ${esc(partylist.description || "—")}
                            </span>
                        </div>

                        <div class="partylists-info-row">
                            <label>School Year:</label>
                            <span>
                                ${esc(partylist.schoolYear || "—")}
                            </span>
                        </div>

                        <div class="partylists-info-row members-info-row">

                            <label>Members:</label>

                            <div class="existing-member-list">

                                ${members
                                  .map(
                                    (member) => `
                                    <div
                                        class="existing-member"
                                        data-student-id="${esc(member.studentId || "")}"
                                        data-first-name="${esc(member.firstName || "")}"
                                        data-middle-name="${esc(member.middleName || "")}"
                                        data-last-name="${esc(member.lastName || "")}"
                                        data-position="${esc(member.position || "")}"
                                        data-photo="${esc(member.photoImageUrl || "")}"
                                        data-campaign="${esc(member.campaignImageUrl || "")}"
                                        data-background="${esc(member.backgroundImageUrl || "")}"
                                    >

                                        <span class="existing-member-student-id">
                                            ${esc(member.studentId)}
                                        </span>

                                        <span class="existing-member-name">
                                            ${esc(
                                              [
                                                member.firstName,
                                                member.middleName,
                                                member.lastName,
                                              ]
                                                .filter(Boolean)
                                                .join(" "),
                                            )}
                                        </span>

                                        <span class="existing-member-position">
                                            ${esc(member.position)}
                                        </span>

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

                                    </div>
                                `,
                                  )
                                  .join("")}

                            </div>

                        </div>

                    </div>

                </div>

            </div>

            <section class="edit-partylists-panel">

                <form class="partylists-form edit-partylists-form" novalidate>

                    <div class="form-section">

                        <div class="form-group">

                            <label>Partylist Name</label>

                            <input
                                type="text"
                                value="${esc(partylist.name)}"
                                class="edit-partylists-name-input"
                            >

                            <small class="inline-error edit-partylists-name-error"></small>

                        </div>

                        <div class="form-group">

                            <label>Description</label>

                            <input
                                type="text"
                                value="${esc(partylist.description || "")}"
                                class="edit-partylists-description-input"
                            >

                        </div>

                        <div class="form-group">

                            <label>School Year</label>

                            <input
                                type="text"
                                value="${esc(partylist.schoolYear)}"
                                class="edit-partylists-schoolyear-input"
                            >

                            <small class="inline-error edit-partylists-schoolyear-error"></small>

                        </div>

                        <div class="form-group">

                            <label>Campus</label>

                            <select
                                class="edit-partylists-campus"
                                data-campus-id="${esc(partylist.campus?.id || "")}"
                                required
                            >
                                <option value="">Loading campuses...</option>
                            </select>

                            <small class="inline-error edit-partylists-campus-error"></small>

                        </div>

                    </div>

                    <div class="form-section members-section">

                        <div class="partylists-divider"></div>

                        <h3>Members</h3>

                        <div class="members-list edit-members-list"></div>

                        <button
                            type="button"
                            class="add-member-btn edit-add-member">
                            <i class="bi bi-plus-lg"></i>
                            Add More Member
                        </button>

                    </div>

                    <div class="form-buttons">

                        <button
                            type="button"
                            class="discard-btn cancel-partylists-edit">
                            Cancel
                        </button>

                        <button
                            type="submit"
                            class="save-btn">
                            <i class="bi bi-check-circle"></i>
                            Save Changes
                        </button>

                    </div>

                </form>

            </section>

        </section>
    `;

  return card;
}

function createEditPartylistPanel(partylist) {
  const campusId = partylist.campus?.id || "";

  const members = partylist.members || [];

  return `
        <section class="edit-partylists-panel">

            <form
                class="partylists-form edit-partylists-form"
                novalidate
            >

                <div class="form-section">

                    <div class="form-group">

                        <label>Partylist Name</label>

                        <input
                            type="text"
                            value="${esc(partylist.name || "")}"
                            class="edit-partylists-name-input"
                        >

                        <small
                            class="inline-error edit-partylists-name-error"
                        ></small>

                    </div>

                    <div class="form-group">

                        <label>Description</label>

                        <input
                            type="text"
                            value="${esc(partylist.description || "")}"
                            class="edit-partylists-description-input"
                        >

                    </div>

                    <div class="form-group">

                        <label>School Year</label>

                        <input
                            type="text"
                            value="${esc(partylist.schoolYear || "")}"
                            class="edit-partylists-schoolyear-input"
                        >

                        <small
                            class="inline-error edit-partylists-schoolyear-error"
                        ></small>

                    </div>

                    <div class="form-group">

                        <label>Campus</label>

                        <input type="hidden" class="edit-partylists-campus" value="${esc(campusId)}">

                        <small
                            class="inline-error edit-partylists-campus-error"
                        ></small>

                    </div>

                    <div class="form-group">

                        <label>Partylist Poster</label>

                        <div class="partylists-file-upload">

                            <input
                                type="file"
                                class="partylists-poster-input edit-poster-input"
                                accept="image/*,.pdf,application/pdf"
                                hidden
                                data-url="${esc(partylist.posterImageUrl || "")}"
                            >

                            <button
                                type="button"
                                class="partylists-file-btn"
                            >
                                <i class="bi bi-file-earmark-image"></i>
                                <span>Change Poster</span>
                            </button>

                            <div class="partylists-file-preview"></div>

                        </div>

                    </div>

                    <div class="form-group">

                        <label>
                            Partylist Logo
                            <span class="optional-label">
                                (Optional)
                            </span>
                        </label>

                        <div class="partylists-file-upload">

                            <input
                                type="file"
                                class="partylists-logo-input edit-logo-input"
                                accept="image/*"
                                hidden
                                data-url="${esc(partylist.posterLogoUrl || "")}"
                            >

                            <button
                                type="button"
                                class="partylists-file-btn"
                            >
                                <i class="bi bi-image"></i>
                                <span>Change Logo</span>
                            </button>

                            <div class="partylists-file-preview"></div>

                        </div>

                    </div>

                </div>

                <div class="form-section members-section">

                    <div class="partylists-divider"></div>

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
                        class="discard-btn cancel-partylists-edit"
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

async function saveEditedPartylists(card) {
  if (!card) {
    throw new Error("Partylist card is missing.");
  }

  const form = card.querySelector(".edit-partylists-form");

  if (!form) {
    throw new Error("Edit form is missing.");
  }

  const partylistId = card.dataset.id;

  if (!partylistId) {
    throw new Error("Partylist ID is missing.");
  }

  const nameInput = form.querySelector(".edit-partylists-name-input");

  const descriptionInput = form.querySelector(
    ".edit-partylists-description-input",
  );

  const schoolYearInput = form.querySelector(
    ".edit-partylists-schoolyear-input",
  );

  const campusSelect = form.querySelector(".edit-partylists-campus");

  const memberList = form.querySelector(".edit-members-list");

  const campusId = campusSelect?.value || "";

  if (!campusId) {
    throw new Error("Please select a campus.");
  }

  const members = memberList
    ? [...memberList.querySelectorAll(".member-row")]
        .map(collectMemberData)
        .map((member) => ({
          studentId: member.studentId,
          firstName: member.firstName,
          middleName: member.middleName || null,
          lastName: member.lastName,
          position: member.position,

          campaignImageUrl: member.campaign || null,

          backgroundImageUrl: member.background || null,

          photoImageUrl: member.photo || null,
        }))
    : [];

  const posterInput = form.querySelector(".edit-poster-input");

  const logoInput = form.querySelector(".edit-logo-input");

  const payload = {
    name: nameInput?.value.trim() || "",

    description: descriptionInput?.value.trim() || "",

    schoolYear: schoolYearInput?.value.trim() || "",

    campus: {
      id: campusId,
    },

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
      "Updating Partylist",
      "Please wait while the changes are being saved.",
    );

    const response = await fetch(`${PARTYLIST_API}/${partylistId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();

      throw new Error(errorMessageFrom(message, "Failed to update partylist."));
    }

    const updated = await response.json();

    card.classList.remove("editing", "show");

    const icon = card.querySelector(".expand-partylists i");

    if (icon) {
      icon.className = "bi bi-chevron-down";
    }

    hideActionLoading();

    showSuccessToast(
      "Updated",
      `${updated.name || payload.name} was updated successfully.`,
    );

    await loadExistingPartylists();

    return updated;
  } catch (error) {
    console.error("Partylist update failed:", error);

    hideActionLoading();

    showSuccessToast(
      "Save Failed",
      error.message || "Unable to update the partylist.",
    );

    return false;
  }
}

async function saveNewPartylists(form) {
  if (!form) return;

  const name = document.getElementById("partylistsName")?.value.trim() || "";

  const campusId = document.getElementById("partylistsCampus")?.value || "";

  const schoolYear =
    document.getElementById("partylistsSchoolYear")?.value.trim() || "";

  const description =
    document.getElementById("partylistsDescription")?.value.trim() || "";

  if (!campusId) {
    showSuccessToast("Save Failed", "Please select a campus.");
    return;
  }

  const memberList = document.getElementById("createMembersList");

  const members = memberList
    ? [...memberList.querySelectorAll(".member-row")].map(collectMemberData)
    : [];

  const posterInput = document.getElementById("partylistsPoster");

  const logoInput = document.getElementById("partylistsLogo");

  const posterFile =
    posterInput?.files?.[0] || posterInput?._uploadedFile || null;

  const logoFile = logoInput?.files?.[0] || logoInput?._uploadedFile || null;

  try {
    showActionLoading(
      "Saving Partylist",
      "Please wait while the partylist files are being uploaded.",
    );

    // =====================================================
    // UPLOAD PARTYLIST POSTER
    // =====================================================

    let posterImageUrl = null;

    if (posterFile) {
      posterImageUrl = await uploadPartylistFile(posterFile, "poster");
    }

    // =====================================================
    // UPLOAD PARTYLIST LOGO
    // =====================================================

    let posterLogoUrl = null;

    if (logoFile) {
      posterLogoUrl = await uploadPartylistFile(logoFile, "logo");
    }

    // =====================================================
    // MEMBERS
    // =====================================================

    const posterInput = document.getElementById("partylistsPoster");

    const logoInput = document.getElementById("partylistsLogo");

    const payload = {
      name,

      description,

      schoolYear,

      campus: {
        id: campusId,
      },

      status: "ACTIVE",

      // IMPORTANT
      posterImageUrl: posterImageUrl || posterInput?.dataset.url || null,

      posterLogoUrl: posterLogoUrl || logoInput?.dataset.url || null,

      members: members.map((member) => ({
        studentId: member.studentId,
        lastName: member.lastName,
        firstName: member.firstName,
        middleName: member.middleName || null,
        position: member.position,

        campaignImageUrl: member.campaign || null,

        backgroundImageUrl: member.background || null,

        photoImageUrl: member.photo || null,
      })),
    };

    // =====================================================
    // SAVE PARTYLIST
    // =====================================================

    showActionLoading(
      "Saving Partylist",
      "Please wait while the partylist and members are being saved.",
    );

    const response = await fetch(PARTYLIST_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Partylist save failed:", response.status, errorText);

      throw new Error(errorMessageFrom(errorText, "Failed to save partylist."));
    }

    await response.json();

    hideActionLoading();

    resetCreateForm();
    clearAllInlineErrors();

    showSuccessToast("Added", `${name} was added successfully.`);

    await loadExistingPartylists();
  } catch (error) {
    console.error("Partylist creation failed:", error);

    hideActionLoading();

    showSuccessToast(
      "Save Failed",
      error.message || "Unable to save the partylist.",
    );
  }
}

function resetCreateForm() {
  const form = document.getElementById("createPartylistsForm");
  if (!form) return;

  form.reset();

  // form.reset() doesn't clear our custom preview markup - reset it manually
  document
    .querySelectorAll("#createPartylists .partylists-file-upload")
    .forEach((upload) => {
      const preview = upload.querySelector(".partylists-file-preview");
      const button = upload.querySelector(".partylists-file-btn");
      const isLogo = upload.querySelector(".partylists-logo-input") !== null;

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

  const list = document.getElementById("createMembersList");
  if (!list) return;

  list.innerHTML = "";
  DEFAULT_POSITIONS.forEach((position) =>
    addMemberRow(list, { position }, false),
  );
}

// Refresh Existing
function refreshExisting() {
  const filter = document.getElementById("campusFilter");

  if (!filter) return;

  const selectedCampus = filter.value;

  document
    .querySelectorAll("#existingPartylists .partylists-item")
    .forEach((card) => {
      const cardCampusId = card.dataset.campus || "";

      const shouldShow =
        selectedCampus === "all" ||
        selectedCampus === "" ||
        cardCampusId === selectedCampus;

      card.style.display = shouldShow ? "" : "none";
    });
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

// Partylists Tabs
function initializePartylistsTabs() {
  const tabs = document.querySelectorAll(".partylists-tab");
  const sections = document.querySelectorAll(".partylists-section");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const section = tab.dataset.section;

      tabs.forEach((item) => item.classList.remove("active"));
      sections.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      if (section === "create") {
        document.getElementById("createPartylists")?.classList.add("active");
      }

      if (section === "existing") {
        document.getElementById("existingPartylists")?.classList.add("active");
      }
    });
  });
}

function initializeCampusFilter() {
  const filter = document.getElementById("campusFilter");

  if (!filter) return;

  filter.addEventListener("change", () => {
    refreshExisting();
  });

  refreshExisting();
}

async function restorePartylist(id) {
  try {
    showActionLoading(
      "Restoring Partylist",
      "Please wait while the partylist is being restored.",
    );

    const response = await fetch(`${PARTYLIST_API}/${id}/restore`, {
      method: "PUT",
    });

    if (!response.ok) {
      throw new Error("Failed to restore partylist.");
    }

    showSuccessToast("Restored", "Partylist restored successfully.");

    await loadExistingPartylists();
  } catch (error) {
    console.error(error);

    showSuccessToast("Restore Failed", "Unable to restore the partylist.");
  } finally {
    hideActionLoading();
  }
}

async function loadArchivedPartylists(force = false) {
  return SoftCache.load(`${PARTYLIST_API}/archived`, { force });
}

async function loadTrashPartylists(force = false) {
  return SoftCache.load(`${PARTYLIST_API}/trash`, { force });
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

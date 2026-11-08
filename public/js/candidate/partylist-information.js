/* =========================================================
   LCCAST — CANDIDATE PARTYLIST/DEPARTMENT INFORMATION
   (SSC / Department tabbed)
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initCandidateTypeTabs();
  loadGroupInfo("ssc");
  loadGroupInfo("department");
});

const uploadState = {
  ssc: { poster: null, logo: null },
  department: { poster: null, logo: null },
};

const DEFAULT_POSITIONS = [
  "President", "Vice President", "Secretary", "Treasurer",
  "Auditor", "PRO Internal", "PRO External"
];

function sortMembersByPosition(members) {
  return [...members].sort((a, b) => {
    const posA = DEFAULT_POSITIONS.indexOf(a.position);
    const posB = DEFAULT_POSITIONS.indexOf(b.position);
    const rankA = posA === -1 ? DEFAULT_POSITIONS.length : posA;
    const rankB = posB === -1 ? DEFAULT_POSITIONS.length : posB;
    return rankA - rankB;
  });
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initCandidateTypeTabs() {
  document.querySelectorAll(".candidate-type-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const type = tab.getAttribute("data-type");

      document.querySelectorAll(".candidate-type-tab").forEach((t) =>
        t.classList.toggle("active", t === tab)
      );
      document.querySelectorAll(".candidate-type-section").forEach((s) =>
        s.classList.toggle("active", s.getAttribute("data-type-section") === type)
      );
    });
  });
}

function renderSkeleton(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="candidate-group-skeleton">
      <div class="skeleton skeleton-group-poster"></div>
      <div class="skeleton skeleton-group-title"></div>
      <div class="skeleton skeleton-group-line"></div>
      <div class="skeleton skeleton-group-line short"></div>
    </div>
  `;
}

async function loadGroupInfo(type) {
  const container = document.getElementById(
    type === "ssc" ? "sscGroupInfoContainer" : "departmentGroupInfoContainer"
  );
  if (!container) return;

  renderSkeleton(container);

  try {
    const data = await SoftCache.load(`/candidate/api/${type}/group-info`, {
      ttl: 30000,
      swr: false,
    });

    renderGroupInfo(container, type, data);
  } catch (err) {
    console.error(err);
    renderNoGroup(
      container,
      type,
      err.message || `No ${type === "ssc" ? "SSC partylist" : "department"} information found.`
    );
  }
}

function renderNoGroup(container, type, message) {
  container.innerHTML = `
    <div class="election-instructions">
      <h3>No ${type === "ssc" ? "SSC Partylist" : "Department"} Information</h3>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

function renderGroupInfo(container, type, data) {
  const groupLabel = data.groupType === "PARTYLIST" ? "Partylist" : "Department";

  container.innerHTML = `
    <div class="candidate-group-card">
      <div class="candidate-group-header">
        <div class="candidate-group-logo">
          <img src="${data.logoUrl || "/images/default-avatar.png"}" alt="${escapeHTML(data.name)} logo" />
        </div>

        <div>
          <span class="candidate-group-type">${groupLabel}</span>
          <h2>${escapeHTML(data.name)}</h2>
          <p>${escapeHTML(data.schoolYear || "")}</p>
        </div>
      </div>

      <div class="candidate-group-poster">
        <div class="doc-ratio-frame">
          <img data-group-poster src="${data.posterUrl || "/images/campaign-placeholder.png"}" alt="${escapeHTML(data.name)} poster" />
        </div>
      </div>

      <div class="candidate-group-description">
        <h3>Description</h3>
        <p>${escapeHTML(data.description || "No description provided yet.")}</p>
      </div>
    </div>

    ${data.canEdit ? renderEditForm(type, data) : ""}

    <div class="candidate-group-members">
      <h3><i class="bi bi-people"></i> Members</h3>

      <div class="candidate-group-member-grid">
        ${sortMembersByPosition(data.members || [])
          .map(
            (m) => `
          <article class="candidate-group-member-card">
            <img src="${m.photoUrl || "/images/default-avatar.png"}" alt="${escapeHTML(m.fullName)}" />
            <div>
              <strong>${escapeHTML(m.fullName)}</strong>
              <span>${escapeHTML(m.position || "Member")}</span>
            </div>
          </article>
        `
          )
          .join("")}
      </div>
    </div>
  `;

  const posterImg = container.querySelector("[data-group-poster]");
    window.applyDocImageRatio?.(posterImg?.parentElement, posterImg);

  if (data.canEdit) {
    initializeEditForm(type, container);
  }
}

function renderEditForm(type, data) {
  return `
    <div class="candidate-group-edit-card">
      <div class="candidate-group-edit-header">
        <h3><i class="bi bi-pencil-square"></i> Edit Group Information</h3>
        <p>As President, you can update this group's poster, logo, and description.</p>
      </div>

      <form data-edit-form="${type}" novalidate>
        <div class="form-group">
          <label>Description</label>
          <textarea data-description-input>${escapeHTML(data.description || "")}</textarea>
        </div>

        <div class="candidate-group-edit-images">
          <div class="candidate-image-row">
            <div class="candidate-image-preview candidate-image-preview-wide doc-ratio-frame" data-poster-preview-wrapper>
              <img data-poster-preview src="${data.posterUrl || "/images/campaign-placeholder.png"}" alt="Poster preview" />
            </div>
            <div class="candidate-image-actions">
              <input type="file" data-poster-input accept="image/png,image/jpeg,image/webp" hidden />
              <button type="button" class="secondary-btn" data-change-poster-btn>
                <i class="bi bi-upload"></i> Change Poster
              </button>
            </div>
          </div>

          <div class="candidate-image-row">
            <div class="candidate-image-preview candidate-image-preview-round" data-logo-preview-wrapper>
              <img data-logo-preview src="${data.logoUrl || "/images/default-avatar.png"}" alt="Logo preview" />
            </div>
            <div class="candidate-image-actions">
              <input type="file" data-logo-input accept="image/png,image/jpeg,image/webp" hidden />
              <button type="button" class="secondary-btn" data-change-logo-btn>
                <i class="bi bi-upload"></i> Change Logo
              </button>
            </div>
          </div>
        </div>

        <div class="settings-form-actions">
          <button type="submit" class="save-btn">
            <i class="bi bi-check-lg"></i> Save Changes
          </button>
        </div>
      </form>
    </div>
  `;
}

function initializeEditForm(type, container) {
  uploadState[type] = { poster: null, logo: null };

    const posterPreviewImg = container.querySelector("[data-poster-preview]");
    window.applyDocImageRatio?.(posterPreviewImg?.parentElement, posterPreviewImg);

  const posterInput = container.querySelector("[data-poster-input]");
  const logoInput = container.querySelector("[data-logo-input]");

  container.querySelector("[data-change-poster-btn]")?.addEventListener("click", () => posterInput?.click());
  container.querySelector("[data-change-logo-btn]")?.addEventListener("click", () => logoInput?.click());

  posterInput?.addEventListener("change", () => {
    uploadState[type].poster = posterInput.files?.[0] || null;
    if (uploadState[type].poster) {
      const reader = new FileReader();
      reader.onload = (e) => {
        container.querySelector("[data-poster-preview]").src = e.target.result;
      };
      reader.readAsDataURL(uploadState[type].poster);
    }
  });

  logoInput?.addEventListener("change", () => {
    uploadState[type].logo = logoInput.files?.[0] || null;
    if (uploadState[type].logo) {
      const reader = new FileReader();
      reader.onload = (e) => {
        container.querySelector("[data-logo-preview]").src = e.target.result;
      };
      reader.readAsDataURL(uploadState[type].logo);
    }
  });

  container.querySelector(`[data-edit-form="${type}"]`)?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const description = container.querySelector("[data-description-input]").value.trim();

    const formData = new FormData();
    formData.append("description", description);
    if (uploadState[type].poster) formData.append("poster", uploadState[type].poster);
    if (uploadState[type].logo) formData.append("logo", uploadState[type].logo);

    showActionLoading("Saving Changes...", "Please wait while group information is being updated.");

    try {
      const res = await fetch(`/candidate/api/${type}/group-info`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update group information.");

      showSuccessToast("Updated", data.message || "Group information updated successfully.");
      await loadGroupInfo(type);
    } catch (err) {
      showSuccessToast("Update Failed", err.message || "Could not update group information.", true);
    } finally {
      hideActionLoading();
    }
  });
}

/* =========================================================
   LOADING / TOAST HELPERS
========================================================= */

function showActionLoading(title, message) {
  document.getElementById("actionLoadingTitle").textContent = title;
  document.getElementById("actionLoadingMessage").textContent = message;
  document.body.classList.add("modal-loading");
  document.getElementById("actionLoadingModal")?.classList.add("show");
}

function hideActionLoading() {
  document.body.classList.remove("modal-loading");
  document.getElementById("actionLoadingModal")?.classList.remove("show");
}

let toastTimeout = null;

function showSuccessToast(title, message, isError = false) {
  const toast = document.getElementById("successToast");
  if (!toast) return;

  const icon = toast.querySelector(".success-toast-icon i");
  document.getElementById("successToastTitle").textContent = title;
  document.getElementById("successToastMessage").textContent = message;

  if (icon) {
    icon.classList.toggle("bi-check-lg", !isError);
    icon.classList.toggle("bi-x-lg", isError);
  }

  toast.classList.toggle("toast-error", isError);
  toast.classList.add("show");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 4000);
}

document.getElementById("successToastClose")?.addEventListener("click", () => {
  document.getElementById("successToast")?.classList.remove("show");
});
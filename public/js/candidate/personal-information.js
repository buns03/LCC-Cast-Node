/* =========================================================
   LCCAST — CANDIDATE PERSONAL INFORMATION
   (SSC / Department tabbed)
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initCandidateTypeTabs();
  loadCandidacyStatus();
});

const IMAGE_CARDS = [
  {
    type: "photo",
    icon: "bi-person-circle",
    title: "Photo",
    desc: "Used as your avatar and on candidate/member listings.",
    previewClass: "candidate-image-preview-round",
    defaultSrc: "/images/default-avatar.png",
  },
  {
    type: "background",
    icon: "bi-image",
    title: "Background",
    desc: "A wide background image used on your candidate profile.",
    previewClass: "candidate-image-preview-wide",
    defaultSrc: "/images/campaign-placeholder.png",
    docRatio: true,
  },
  {
    type: "campaign",
    icon: "bi-megaphone",
    title: "Campaign Image",
    desc: "Shown to voters when they view your campaign.",
    previewClass: "candidate-image-preview-wide",
    defaultSrc: "/images/campaign-placeholder.png",
    docRatio: true,
  },
];

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

async function loadCandidacyStatus() {
  try {
    const status = await SoftCache.load("/candidate/api/candidacy-status", {
      ttl: 30000,
      swr: false,
    });

    renderPersonalSection("ssc", !!status.ssc);
    renderPersonalSection("department", !!status.department);

    // If the student has no SSC candidacy but does have a department one,
    // default to the Department tab instead of an empty SSC tab.
    if (!status.ssc && status.department) {
      document.querySelector('.candidate-type-tab[data-type="department"]')?.click();
    }
  } catch (err) {
    console.error(err);
  }
}

function renderPersonalSection(type, isCandidate) {
  const container = document.getElementById(
    type === "ssc" ? "sscPersonalContent" : "departmentPersonalContent"
  );
  if (!container) return;

  if (!isCandidate) {
    container.innerHTML = `
      <div class="election-instructions">
        <h3>No ${type === "ssc" ? "SSC" : "Department"} Candidacy</h3>
        <p>You are not currently registered as a ${
          type === "ssc" ? "SSC partylist" : "department"
        } candidate, so there is nothing to manage here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = IMAGE_CARDS.map(
    (card) => `
    <div class="candidate-image-card">
      <div class="candidate-image-card-header">
        <h3><i class="bi ${card.icon}"></i> ${card.title}</h3>
        <p>${card.desc}</p>
      </div>

      <div class="candidate-image-row">
        <div class="candidate-image-preview ${card.previewClass}${card.docRatio ? " doc-ratio-frame" : ""}">
          <img src="${card.defaultSrc}" alt="${card.title}" data-preview="${card.type}" />
        </div>

        <div class="candidate-image-actions">
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-input="${card.type}" />
          <button type="button" class="secondary-btn" data-upload-btn="${card.type}">
            <i class="bi bi-upload"></i> Upload ${card.title}
          </button>
          <small class="field-error" data-error="${card.type}"></small>
        </div>
      </div>
    </div>
  `
  ).join("");

  IMAGE_CARDS.filter((c) => c.docRatio).forEach((c) => {
       const img = container.querySelector(`[data-preview="${c.type}"]`);
       window.applyDocImageRatio?.(img?.parentElement, img);
     });

  loadPersonalInfo(type, container);
  wireImageUploads(type, container);
}

async function loadPersonalInfo(type, container) {
  try {
    const data = await SoftCache.load(`/candidate/api/${type}/personal-info`, {
      ttl: 30000,
      swr: false,
    });

    if (data.photoUrl) {
      const preview = container.querySelector('[data-preview="photo"]');
      if (preview) preview.src = data.photoUrl;

      if (type === "ssc") {
        const topbarAvatar = document.getElementById("topbarAvatarImg");
        if (topbarAvatar) topbarAvatar.src = data.photoUrl;
      }
    }

    if (data.backgroundUrl) {
      const preview = container.querySelector('[data-preview="background"]');
      if (preview) preview.src = data.backgroundUrl;
    }

    if (data.campaignUrl) {
      const preview = container.querySelector('[data-preview="campaign"]');
      if (preview) preview.src = data.campaignUrl;
    }
  } catch (err) {
    console.error(err);
  }
}

function wireImageUploads(type, container) {
  IMAGE_CARDS.forEach((card) => {
    const input = container.querySelector(`[data-input="${card.type}"]`);
    const button = container.querySelector(`[data-upload-btn="${card.type}"]`);
    const preview = container.querySelector(`[data-preview="${card.type}"]`);
    const error = container.querySelector(`[data-error="${card.type}"]`);

    if (!input || !button || !preview) return;

    button.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;

      if (error) error.textContent = "";

      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
      };
      reader.readAsDataURL(file);

      const formData = new FormData();
      formData.append("file", file);

      showActionLoading("Uploading...", "Please wait while your image is being uploaded.");

      try {
        const res = await fetch(`/candidate/api/${type}/personal-info/${card.type}`, {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Upload failed.");

        preview.src = data.url;

        if (card.type === "photo" && type === "ssc") {
          const topbarAvatar = document.getElementById("topbarAvatarImg");
          if (topbarAvatar) topbarAvatar.src = data.url;
        }

        showSuccessToast("Updated", data.message || "Image updated successfully.");
      } catch (err) {
        if (error) error.textContent = err.message;
        showSuccessToast("Upload Failed", err.message || "Could not upload image.", true);
      } finally {
        hideActionLoading();
        input.value = "";
      }
    });
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
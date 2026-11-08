/* =========================================================
   LCCAST - VIEW CANDIDATES MODAL (SHARED: SSC + DEPARTMENT)

   Self-contained on purpose: does not depend on load order
   relative to ssc-election.js / department-election.js /
   department-partylist-election.js.

   Usage:
     openViewCandidatesModal(parties)

   parties: [
     {
       id: string,
       name: string,
       posterImageUrl: string,   // full, already-resolved URL
       logoImageUrl: string,     // full, already-resolved URL
       members: [
         {
           position: string,
           name: string,
           photoImageUrl: string,
           campaignImageUrl: string,
           backgroundImageUrl: string,
         }
       ]
     }
   ]

   If there's only one party, tabs are hidden. If there are
   two or more, numbered tabs (1, 2, 3...) are shown so the
   labels stay compact on mobile.
========================================================= */

let viewCandidatesModalParties = [];

function openViewCandidatesModal(parties) {
  const validParties = (parties || []).filter(
    (party) => party && party.members && party.members.length > 0,
  );

  if (validParties.length === 0) {
    vcmToast("No Candidates", "There are no candidates to display yet.");
    return;
  }

  viewCandidatesModalParties = validParties;

  let modal = document.getElementById("viewCandidatesModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "viewCandidatesModal";
    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div class="candidates-modal" role="dialog" aria-modal="true" aria-labelledby="viewCandidatesModalTitle">

        <div class="campaign-modal-header">
          <div>
            <h2 id="viewCandidatesModalTitle">View Candidates</h2>
          </div>

          <button type="button" class="campaign-modal-close" id="closeViewCandidatesModal" aria-label="Close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div class="candidates-modal-tabs" id="candidatesModalTabs"></div>

        <div class="candidates-modal-body" id="candidatesModalBody"></div>

        <div class="modal-footer">
          <button type="button" class="cancel-btn" id="viewCandidatesCloseButton">Close</button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("closeViewCandidatesModal")
      ?.addEventListener("click", closeViewCandidatesModal);

    document
      .getElementById("viewCandidatesCloseButton")
      ?.addEventListener("click", closeViewCandidatesModal);
  }

  vcmRenderTabs(viewCandidatesModalParties);
  vcmRenderParty(viewCandidatesModalParties[0]);

  vcmShowModal(modal);
}

function closeViewCandidatesModal() {
  vcmHideModal(document.getElementById("viewCandidatesModal"));
}

/* =========================================================
   TABS
========================================================= */

function vcmRenderTabs(parties) {
  const tabsContainer = document.getElementById("candidatesModalTabs");
  if (!tabsContainer) return;

  if (parties.length <= 1) {
    tabsContainer.innerHTML = "";
    tabsContainer.style.display = "none";
    return;
  }

  tabsContainer.style.display = "flex";

  tabsContainer.innerHTML = parties
    .map(
      (party, index) => `
        <button
          type="button"
          class="candidates-tab-btn ${index === 0 ? "active" : ""}"
          data-party-index="${index}"
          aria-label="${vcmEscapeHtml(party.name)}"
          title="${vcmEscapeHtml(party.name)}"
        >
          ${index + 1}
        </button>
      `,
    )
    .join("");

  tabsContainer.querySelectorAll(".candidates-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabsContainer
        .querySelectorAll(".candidates-tab-btn")
        .forEach((b) => b.classList.remove("active"));

      btn.classList.add("active");

      const index = Number(btn.dataset.partyIndex);
      vcmRenderParty(viewCandidatesModalParties[index]);
    });
  });
}

/* =========================================================
   PARTY CONTENT
========================================================= */

function vcmRenderParty(party) {
  const body = document.getElementById("candidatesModalBody");
  if (!body || !party) return;

  const grouped = vcmGroupByPosition(party.members || []);

  body.innerHTML = `
    <div class="candidates-party-header">

      <div class="candidates-party-poster-wrapper image-loading">
        <img
          src="${vcmEscapeHtml(party.posterImageUrl || "/images/campaign-placeholder.png")}"
          alt="${vcmEscapeHtml(party.name)} poster"
          class="candidates-party-poster"
          onload="this.parentElement.classList.remove('image-loading')"
          onerror="this.parentElement.classList.remove('image-loading'); this.src='/images/campaign-placeholder.png'"
        />
      </div>

      <div class="candidates-party-identity">

        <div class="candidates-party-logo-wrapper">
          <img
            src="${vcmEscapeHtml(party.logoImageUrl || "/images/default-avatar.png")}"
            alt="${vcmEscapeHtml(party.name)} logo"
            class="candidates-party-logo"
            onerror="this.src='/images/default-avatar.png'"
          />
        </div>

        <h3 class="candidates-party-name">
          ${vcmEscapeHtml(party.name)}
        </h3>

      </div>

    </div>

    <div class="candidates-party-positions">
      ${grouped
        .map(
          (group) => `
            <section class="candidates-position-group">
              <h4 class="candidates-position-title">
                ${vcmEscapeHtml(group.position)}
              </h4>

              <div class="candidates-member-grid">
                ${group.members.map((member) => vcmCreateMemberCard(member)).join("")}
              </div>
            </section>
          `,
        )
        .join("")}
    </div>
  `;

  const posterImg = body.querySelector(".candidates-party-poster");
    window.applyDocImageRatio?.(posterImg?.parentElement, posterImg);

  body.querySelectorAll(".candidates-view-campaign-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      vcmOpenImagePreview(btn.dataset.name, btn.dataset.image, "Campaign");
    });
  });

  body.querySelectorAll(".candidates-view-background-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      vcmOpenImagePreview(btn.dataset.name, btn.dataset.image, "Background");
    });
  });
}

function vcmGroupByPosition(members) {
  const map = new Map();

  members.forEach((member) => {
    const key = member.position || "Candidate";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(member);
  });

   const groups = Array.from(map.entries()).map(([position, groupMembers]) => ({
      position,
      members: groupMembers,
    }));

    return typeof sortByPositionOrder === "function"
      ? sortByPositionOrder(groups, (group) => group.position)
      : groups;
  }

function vcmCreateMemberCard(member) {
  const photo = member.photoImageUrl || "/images/default-avatar.png";
  const campaign = member.campaignImageUrl || "";
  const background = member.backgroundImageUrl || "";

  return `
    <article class="candidates-member-card">

      <div class="candidates-member-photo-wrapper image-loading">
        <img
          src="${vcmEscapeHtml(photo)}"
          alt="${vcmEscapeHtml(member.name)}"
          class="candidates-member-photo"
          loading="lazy"
          onload="this.parentElement.classList.remove('image-loading')"
          onerror="this.parentElement.classList.remove('image-loading'); this.src='/images/default-avatar.png'"
        />
      </div>

      <h5 class="candidates-member-name">
        ${vcmEscapeHtml(member.name)}
      </h5>

      <div class="candidates-member-actions">

        <button
          type="button"
          class="candidates-view-campaign-btn"
          data-name="${vcmEscapeHtml(member.name)}"
          data-image="${vcmEscapeHtml(campaign)}"
          ${campaign ? "" : "disabled"}
        >
          <i class="bi bi-megaphone"></i>
          View Campaign
        </button>

        <button
          type="button"
          class="candidates-view-background-btn"
          data-name="${vcmEscapeHtml(member.name)}"
          data-image="${vcmEscapeHtml(background)}"
          ${background ? "" : "disabled"}
        >
          <i class="bi bi-image"></i>
          View Background
        </button>

      </div>

    </article>
  `;
}

/* =========================================================
   CAMPAIGN / BACKGROUND IMAGE PREVIEW
========================================================= */

function vcmOpenImagePreview(name, imageUrl, label) {
  if (!imageUrl) return;

  let previewModal = document.getElementById("candidatesImagePreviewModal");

  if (!previewModal) {
    previewModal = document.createElement("div");
    previewModal.id = "candidatesImagePreviewModal";
    previewModal.className = "modal-overlay";

    previewModal.innerHTML = `
      <div class="candidates-image-preview-modal" role="dialog" aria-modal="true">

        <div class="campaign-modal-header">
          <div>
            <h2 id="candidatesImagePreviewTitle"></h2>
          </div>

          <button type="button" class="campaign-modal-close" id="closeCandidatesImagePreview" aria-label="Close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div class="candidates-image-preview-body">
          <div class="candidates-image-preview-wrapper image-loading">
            <img id="candidatesImagePreviewImg" src="" alt="" />
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(previewModal);

    document
      .getElementById("closeCandidatesImagePreview")
      ?.addEventListener("click", () => vcmHideModal(previewModal));

      const previewImg = previewModal.querySelector("#candidatesImagePreviewImg");
          window.applyDocImageRatio?.(previewImg?.parentElement, previewImg);
  }

  const title = document.getElementById("candidatesImagePreviewTitle");
  const img = document.getElementById("candidatesImagePreviewImg");
  const wrapper = previewModal.querySelector(".candidates-image-preview-wrapper");

  if (title) title.textContent = `${name} — ${label}`;

  wrapper?.classList.add("image-loading");

  img.onload = () => wrapper?.classList.remove("image-loading");
  img.onerror = () => wrapper?.classList.remove("image-loading");

  img.src = imageUrl;
  img.alt = `${name} ${label}`;

  vcmShowModal(previewModal);
}

/* =========================================================
   HELPERS (namespaced to avoid clashing with page scripts)
========================================================= */

function vcmShowModal(modal) {
  if (!modal) return;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function vcmHideModal(modal) {
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function vcmEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function vcmToast(title, message) {
  // Best-effort: reuse whichever page-specific toast happens to exist.
  if (typeof showVoteToast === "function") return showVoteToast("warning", title, message);
  if (typeof showDepartmentToast === "function") return showDepartmentToast("warning", title, message);
  if (typeof showDepartmentPartylistVoteToast === "function")
    return showDepartmentPartylistVoteToast("warning", title, message);
  alert(message);
}

/* =========================================================
   GLOBAL MODAL DISMISS (click-outside / escape) — additive,
   safe to coexist with each page's own listeners.
========================================================= */

document.addEventListener("click", (event) => {
  const overlay = event.target.closest(
    "#viewCandidatesModal, #candidatesImagePreviewModal",
  );
  if (!overlay) return;
  if (event.target !== overlay) return;
  vcmHideModal(overlay);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  const preview = document.getElementById("candidatesImagePreviewModal");
  if (preview && preview.classList.contains("show")) {
    vcmHideModal(preview);
    return;
  }

  const main = document.getElementById("viewCandidatesModal");
  if (main && main.classList.contains("show")) {
    vcmHideModal(main);
  }
});
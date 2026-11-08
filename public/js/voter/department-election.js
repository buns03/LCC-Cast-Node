/* =========================================================
   LCCAST - DEPARTMENT ELECTION VOTER VIEW
========================================================= */


document.addEventListener("DOMContentLoaded", () => {
  if (DEPARTMENT_ELECTION_TYPE !== "REPRESENTATIVE") {
    return;
  }
  initializeDepartmentElection();
});

/* =========================================================
   ELECTION DATA (populated from backend)
========================================================= */

let departmentElectionData = null;

async function fetchDepartmentElectionData() {
    try {
      return await SoftCache.load("/voter/api/department-elections/current", {
        ttl: 10000,
        swr: false,
      });
    } catch (error) {
      console.error("Failed to load department election:", error);
      return {};
    }
}

function mapPositionsToObjects(positionNames) {
  return (positionNames || []).map((name) => ({
    id: name,
    name: name,
  }));
}

function formatDateTime(isoString) {
  if (!isoString) return "";

  const date = new Date(isoString);

  if (isNaN(date.getTime())) return isoString;

  const datePart = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${datePart} at ${timePart}`;
}

function formatElectionTimeOnly(isoString) {
  if (!isoString) return "";

  const date = new Date(isoString);

  if (isNaN(date.getTime())) return isoString;

  return date.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapCandidatesToMembers(candidates) {
  return (candidates || []).map((candidate) => ({
    id: candidate.id,
    name: [candidate.firstName, candidate.middleName, candidate.lastName]
      .filter(Boolean)
      .join(" "),
    image:
      resolveElectionFileUrl(candidate.photoImageUrl) ||
      "/images/default-avatar.png",
    campaignImage:
      resolveElectionFileUrl(candidate.campaignImageUrl) ||
      "/images/campaign-placeholder.png",
    // Used by the "View Candidates" modal (View Background button).
    backgroundImage: resolveElectionFileUrl(candidate.backgroundImageUrl) || "",
    // Representative candidates don't always carry a fixed position in
    // this data model (a member can be picked for any open position),
    // but if the backend does send one, keep it for the modal grouping.
    position: candidate.position || "",
  }));


}

/* =========================================================
   STATE
========================================================= */

const departmentElectionState = {
  /*
   * Example:
   *
   * {
   *   "position-1": "member-3",
   *   "position-2": "member-1"
   * }
   */

  selections: {},

  currentMember: null,

  submitting: false,
};

/* =========================================================
   INITIALIZE
========================================================= */

/* =========================================================
   INITIALIZE
========================================================= */

/* =========================================================
   ELECTION SKELETON
========================================================= */

function renderDepartmentElectionSkeleton(container) {
  container.innerHTML = `
    <div class="election-skeleton">

      <div class="skeleton-info-card">
        <div class="skeleton skeleton-info-icon"></div>
        <div class="skeleton-info-content">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-subtitle"></div>
          <div class="skeleton skeleton-badge"></div>
          <div class="skeleton-schedule">
            <div class="skeleton skeleton-schedule-item"></div>
            <div class="skeleton skeleton-schedule-item"></div>
          </div>
        </div>
      </div>

      <div class="skeleton-instructions">
        <div class="skeleton skeleton-instruction-title"></div>
        <div class="skeleton skeleton-instruction-line"></div>
        <div class="skeleton skeleton-instruction-line"></div>
        <div class="skeleton skeleton-instruction-line short"></div>
      </div>

      ${createDepartmentSkeletonPosition()}
      ${createDepartmentSkeletonPosition()}

      <div class="skeleton-action">
        <div class="skeleton skeleton-review-button"></div>
      </div>

    </div>
  `;
}

function createDepartmentSkeletonPosition() {
  return `
    <section class="skeleton-position">
      <div class="skeleton-position-header">
        <div class="skeleton skeleton-position-title"></div>
        <div class="skeleton skeleton-position-rule"></div>
      </div>
      <div class="skeleton-candidate-grid">
        ${createDepartmentSkeletonCandidate()}
        ${createDepartmentSkeletonCandidate()}
        ${createDepartmentSkeletonCandidate()}
        ${createDepartmentSkeletonCandidate()}
      </div>
    </section>
  `;
}

function createDepartmentSkeletonCandidate() {
  return `
    <article class="skeleton-candidate-card">
      <div class="skeleton skeleton-candidate-image"></div>
      <div class="skeleton-candidate-info">
        <div class="skeleton skeleton-candidate-name"></div>
        <div class="skeleton skeleton-candidate-party"></div>
      </div>
      <div class="skeleton-candidate-actions">
        <div class="skeleton skeleton-candidate-button"></div>
        <div class="skeleton skeleton-candidate-button"></div>
      </div>
    </article>
  `;
}

async function initializeDepartmentElection() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  renderDepartmentElectionSkeleton(electionContent);

  const data = await fetchDepartmentElectionData();

  if (!data || !data.status || data.status === "UNAUTHENTICATED" ||
      data.status === "NOT_A_VOTER" || data.status === "NO_DEPARTMENT_MATCH") {
    renderDepartmentEmptyState(
      "Not Available",
      "There is no department election available for your account.",
    );
    return;
  }

  if (data.status === "NO_ELECTION" || data.status === "HIDDEN") {
     renderDepartmentEmptyState(
          "No Department Election Scheduled",
          "There is currently no upcoming or ongoing department election for your department.",
        );
    return;
  }

    departmentElectionData = {
      electionId: data.electionId,
      electionName: data.electionName,
      schoolYear: data.schoolYear,
      department: data.department,
      campus: data.campus,
      scheduledStartAt: data.scheduledStartAt,
      scheduledEndAt: data.scheduledEndAt,
      positions: sortByPositionOrder(mapPositionsToObjects(data.positions)),
      members: mapCandidatesToMembers(data.candidates),
    };

    initializeCampaignModal();
    initializeGlobalModalEvents();

    if (data.hasVoted) {
      renderDepartmentAlreadyVoted();
      return;
    }

  if (data.status === "UPCOMING") {
    renderDepartmentUpcoming();
    return;
  }

  if (data.status === "CONCLUDED") {
    renderDepartmentEmptyState(
      "Voting Closed",
      "This election has already concluded.",
    );
    return;
  }

    renderDepartmentElection();

    initializeMemberSelection();

    initializeReviewVoting();

    initializeLoadingModal();


}

/* =========================================================
   EMPTY STATE
========================================================= */

function renderDepartmentEmptyState(title, message) {
  const electionContent = document.querySelector(".election-content");
  if (!electionContent) return;

  electionContent.innerHTML = `
    <div class="election-instructions">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderDepartmentAlreadyVoted() {
  const electionContent = document.querySelector(".election-content");
  if (!electionContent) return;

  electionContent.innerHTML = `
    <section class="vote-thank-you">
      <div class="vote-thank-you-icon">
        <i class="bi bi-check-circle-fill"></i>
      </div>

      <h2>You've Already Voted</h2>

      <p>
        Your vote for "${escapeHtml(departmentElectionData.electionName)}" has already been recorded.
        You can view your selections in the Vote Summaries tab.
      </p>
    </section>
  `;
}

function resolveElectionFileUrl(storagePath) {
  if (!storagePath) return null;

  // Already a full/absolute URL or a local static asset — use as-is.
  if (
    storagePath.startsWith("http://") ||
    storagePath.startsWith("https://") ||
    storagePath.startsWith("/")
  ) {
    return storagePath;
  }

  return "/voter/api/elections/file?path=" + encodeURIComponent(storagePath);
}

/* =========================================================
   UPCOMING (READ-ONLY) VIEW
========================================================= */

function renderDepartmentUpcoming() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  electionContent.innerHTML = `
    <div class="election-info-card"></div>

    <div class="election-view-candidates-action" id="viewCandidatesButtonWrapper"></div>

    <div class="election-instructions">
      <h3>Upcoming Election</h3>
      <p>
        Voting is not yet open. Here is a preview of the positions
        and members for this election.
      </p>
    </div>

    <div class="election-positions">
      ${departmentElectionData.positions
        .map((position) => createDepartmentPositionReadOnly(position))
        .join("")}
    </div>
  `;

  renderDepartmentElectionInformation();
  renderDepartmentViewCandidatesButton();
}

function createDepartmentPositionReadOnly(position) {
  return `
    <section class="election-position">
      <div class="position-header">
        <div class="position-title">
          <i class="bi bi-person-check"></i>
          <h3>${escapeHtml(position.name)}</h3>
        </div>
      </div>
      <div class="candidate-grid">
        ${departmentElectionData.members
          .map(
            (member) => `
                            <article class="candidate-card">
                              <div class="candidate-image-wrapper image-loading">
                                <img src="${escapeHtml(member.image)}" alt="${escapeHtml(member.name)}" class="candidate-image" loading="lazy" onload="this.parentElement.classList.remove('image-loading')" onerror="this.parentElement.classList.remove('image-loading')" />
                              </div>
                                <div class="candidate-info">
                                  <h4 class="candidate-name">${escapeHtml(member.name)}</h4>
                                  <p class="candidate-partylist">Department Member</p>
                                </div>
                                <div class="candidate-actions">
                                  <button
                                    type="button"
                                    class="candidate-campaign-btn"
                                    data-member-id="${escapeHtml(member.id)}"
                                  >
                                    <i class="bi bi-megaphone"></i>
                                    View Campaign
                                  </button>
                                </div>
                              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

/* =========================================================
   RENDER DEPARTMENT ELECTION
========================================================= */

function renderDepartmentElection() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  electionContent.innerHTML = `
    <div class="election-info-card"></div>

    <div class="election-view-candidates-action" id="viewCandidatesButtonWrapper"></div>

    <div class="election-instructions">
      <h3>
        Before You Vote
      </h3>

      <p>
        Select one member for each position.
        A member can only be selected for one position.
      </p>
    </div>

    <div class="election-positions">
      ${departmentElectionData.positions
        .map((position) => createDepartmentPosition(position))
        .join("")}
    </div>

    <div class="election-action">

    <button type="button" class="secondary-btn" id="clearAllDepartmentVotes">
        <i class="bi bi-arrow-counterclockwise"></i>
        Clear All
      </button>

      <button
        type="button"
        class="primary-btn"
        id="reviewDepartmentVotes"
      >
        <i class="bi bi-clipboard-check"></i>
        Review Vote
      </button>
    </div>
  `;

  renderDepartmentElectionInformation();
  renderDepartmentViewCandidatesButton();
}

/* =========================================================
   ELECTION INFORMATION
========================================================= */

function renderDepartmentElectionInformation() {
  const infoCard = document.querySelector(".election-info-card");

  if (!infoCard) return;

  infoCard.innerHTML = `
    <div class="election-info-icon">
      <i class="bi bi-building"></i>
    </div>

    <div class="election-info-content">

      <h3>
        ${escapeHtml(departmentElectionData.electionName)}
      </h3>

      <p>
        ${escapeHtml(departmentElectionData.department)}
      </p>

      <span>
        ${escapeHtml(departmentElectionData.campus)}
      </span>

      <div class="election-schedule">

        <div class="election-schedule-item">
          <i class="bi bi-calendar-event"></i>

          <span>
            ${escapeHtml(formatDateTime(departmentElectionData.scheduledStartAt))}
          </span>
        </div>

        <div class="election-schedule-item">
          <i class="bi bi-clock"></i>

          <span>
            Until ${escapeHtml(formatDateTime(departmentElectionData.scheduledEndAt))}
          </span>
        </div>

      </div>

    </div>
  `;
}

/* =========================================================
   VIEW CANDIDATES BUTTON (opens the shared modal)

   Representative-type departments don't have partylists, so
   this shows a single group named after the election, with
   all members inside it (no numbered tabs).
========================================================= */

function renderDepartmentViewCandidatesButton() {
  const wrapper = document.getElementById("viewCandidatesButtonWrapper");

  if (!wrapper) return;

  wrapper.innerHTML = `
    <button type="button" class="view-candidates-btn" id="openDeptViewCandidatesBtn">
      <i class="bi bi-people-fill"></i>
      View Candidates
    </button>
  `;

  document
    .getElementById("openDeptViewCandidatesBtn")
    ?.addEventListener("click", () => {
      const party = {
        id: "department",
        name: departmentElectionData.electionName || departmentElectionData.department,
        posterImageUrl: "",
        logoImageUrl: "",
        members: departmentElectionData.members.map((member) => ({
          position: member.position || "Candidate",
          name: member.name,
          photoImageUrl: member.image,
          campaignImageUrl: member.campaignImage,
          backgroundImageUrl: member.backgroundImage,
        })),
      };

      openViewCandidatesModal([party]);
    });
}

/* =========================================================
   CREATE POSITION
========================================================= */

function createDepartmentPosition(position) {
  return `
    <section
      class="election-position"
      data-position-id="${escapeHtml(position.id)}"
    >

      <div class="position-header">

        <div class="position-title">

          <i class="bi bi-person-check"></i>

          <h3>
            ${escapeHtml(position.name)}
          </h3>

        </div>

        <span class="position-rule">
          Select one member
        </span>

      </div>

      <div class="candidate-grid">

        ${departmentElectionData.members
          .map((member) => createDepartmentMemberCard(member, position.id))
          .join("")}

      </div>

    </section>
  `;
}

/* =========================================================
   CREATE MEMBER CARD
========================================================= */

function createDepartmentMemberCard(member, positionId) {
  return `
    <article
      class="candidate-card"
      data-member-id="${escapeHtml(member.id)}"
      data-position-id="${escapeHtml(positionId)}"
    >

            <div class="candidate-image-wrapper image-loading">

              <img
                src="${escapeHtml(member.image)}"
                alt="${escapeHtml(member.name)}"
                class="candidate-image"
                loading="lazy"
                onload="this.parentElement.classList.remove('image-loading')"
                onerror="this.parentElement.classList.remove('image-loading')"
              />

              <div class="candidate-selected-badge">
          <i class="bi bi-check-lg"></i>
          Selected
        </div>

      </div>

      <div class="candidate-info">

        <h4 class="candidate-name">
          ${escapeHtml(member.name)}
        </h4>

        <p class="candidate-partylist">
          Department Member
        </p>

      </div>

      <div class="candidate-actions">

        <button
          type="button"
          class="candidate-campaign-btn"
          data-member-id="${escapeHtml(member.id)}"
        >
          <i class="bi bi-megaphone"></i>
          View Campaign
        </button>

        <button
          type="button"
          class="candidate-select-btn"
          data-member-id="${escapeHtml(member.id)}"
          data-position-id="${escapeHtml(positionId)}"
        >
          <i class="bi bi-check2-circle"></i>

          <span>
            Select
          </span>

        </button>

        <button
          type="button"
          class="candidate-clear-btn"
          data-member-id="${escapeHtml(member.id)}"
          data-position-id="${escapeHtml(positionId)}"
          aria-label="Clear selection"
        >
          <i class="bi bi-x-lg"></i>
        </button>

      </div>

    </article>
  `;
}

/* =========================================================
   MEMBER SELECTION
========================================================= */

function initializeMemberSelection() {
  document.addEventListener("click", (event) => {
    const selectButton = event.target.closest(".candidate-select-btn");

    if (selectButton) {
      const memberId = selectButton.dataset.memberId;
      const positionId = selectButton.dataset.positionId;

      if (memberId && positionId) {
        selectDepartmentMember(positionId, memberId);
      }
      return;
    }

    const clearButton = event.target.closest(".candidate-clear-btn");

    if (clearButton) {
      const positionId = clearButton.dataset.positionId;
      if (positionId) clearDepartmentPositionSelection(positionId);
    }
  });
}

function clearDepartmentPositionSelection(positionId) {
  delete departmentElectionState.selections[positionId];
  updateDepartmentElectionUI();
}

/* =========================================================
   SELECT MEMBER
========================================================= */

function selectDepartmentMember(positionId, memberId) {
  /*
   * If this member is already assigned to another
   * position, do not allow the selection.
   */

  const existingPosition = getMemberSelectedPosition(memberId);

  if (existingPosition && existingPosition !== positionId) {
    showDepartmentToast(
      "error",
      "Member Already Selected",
      "This member has already been selected for another position.",
    );

    return;
  }

  /*
   * Assign member to this position.
   */

  departmentElectionState.selections[positionId] = memberId;

  updateDepartmentElectionUI();
}

/* =========================================================
   UPDATE ELECTION UI
========================================================= */

/* =========================================================
   UPDATE ELECTION UI
========================================================= */

function updateDepartmentElectionUI() {
  document.querySelectorAll(".election-position").forEach((positionSection) => {
    const positionId = positionSection.dataset.positionId;

    const selectedMemberId = departmentElectionState.selections[positionId];

    const cards = positionSection.querySelectorAll(".candidate-card");

    cards.forEach((card) => {
      const memberId = card.dataset.memberId;

      const selectedHere = selectedMemberId === memberId;

      const selectedElsewhere =
        !selectedHere && isMemberSelectedElsewhere(memberId, positionId);

      /*
       * Dim this card if it's not the chosen one for this
       * position — either because another member was picked
       * here, or because this member is locked to a different
       * position entirely.
       */
      const shouldDim =
        !selectedHere && (selectedElsewhere || Boolean(selectedMemberId));

      /* -----------------------------------------
           CARD STATE
        ----------------------------------------- */

      card.classList.toggle("selected", selectedHere);

      card.classList.toggle("dimmed", shouldDim);

      /* -----------------------------------------
           SELECT BUTTON
        ----------------------------------------- */

      const button = card.querySelector(".candidate-select-btn");

      if (!button) return;

      const label = button.querySelector("span");

      const icon = button.querySelector("i");

      if (selectedHere) {
        if (label) label.textContent = "Selected";
        if (icon) icon.className = "bi bi-check-circle-fill";
        button.disabled = false;
      } else if (selectedElsewhere) {
        if (label) label.textContent = "Already Selected";
        if (icon) icon.className = "bi bi-lock-fill";
        button.disabled = true;
      } else {
        if (label) label.textContent = "Select";
        if (icon) icon.className = "bi bi-check2-circle";
        button.disabled = false;
      }
    });
  });
}

/* =========================================================
   CHECK MEMBER SELECTED ELSEWHERE
========================================================= */

function isMemberSelectedElsewhere(memberId, currentPositionId) {
  return Object.entries(departmentElectionState.selections).some(
    ([positionId, selectedMemberId]) =>
      positionId !== currentPositionId && selectedMemberId === memberId,
  );
}

/* =========================================================
   GET MEMBER'S SELECTED POSITION
========================================================= */

function getMemberSelectedPosition(memberId) {
  for (const [positionId, selectedMemberId] of Object.entries(
    departmentElectionState.selections,
  )) {
    if (selectedMemberId === memberId) {
      return positionId;
    }
  }

  return null;
}

/* =========================================================
   GET POSITION NAME
========================================================= */

function getPositionName(positionId) {
  const position = departmentElectionData.positions.find(
    (position) => position.id === positionId,
  );

  return position ? position.name : "Position";
}

/* =========================================================
   CAMPAIGN MODAL
========================================================= */

function initializeCampaignModal() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".candidate-campaign-btn");

    if (!button) return;

    const member = findDepartmentMember(button.dataset.memberId);

    if (!member) return;

    openDepartmentCampaignModal(member);
  });
}

/* =========================================================
   OPEN CAMPAIGN MODAL
========================================================= */

function openDepartmentCampaignModal(member) {
  departmentElectionState.currentMember = member;

  let modal = document.getElementById("departmentCampaignModal");

  if (!modal) {
    modal = document.createElement("div");

    modal.id = "departmentCampaignModal";

    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div
        class="campaign-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="departmentCampaignModalTitle"
      >

        <div class="campaign-modal-header">

          <div>
            <h2 id="departmentCampaignModalTitle">
              Member Campaign
            </h2>
          </div>

          <button
            type="button"
            class="campaign-modal-close"
            id="closeDepartmentCampaignModal"
            aria-label="Close campaign"
          >
            <i class="bi bi-x-lg"></i>
          </button>

        </div>

                <div class="campaign-modal-body">

                  <div class="campaign-loading-content">
                    <div class="skeleton campaign-skeleton-name"></div>
                    <div class="skeleton campaign-skeleton-partylist"></div>
                    <div class="skeleton campaign-skeleton-image"></div>
                  </div>

                  <div class="campaign-loaded-content" style="display:none;">

                    <h3
                      class="campaign-candidate-name"
                      id="departmentCampaignMemberName"
                    ></h3>

                    <p
                      class="campaign-candidate-partylist"
                      id="departmentCampaignMemberInfo"
                    ></p>

                    <div class="campaign-image-wrapper image-loading">
                      <img
                        id="departmentCampaignImage"
                        class="campaign-image"
                        src=""
                        alt="Member campaign"
                      />
                    </div>

                  </div>

                </div>

        <div class="modal-footer">

          <button
            type="button"
            class="cancel-btn"
            id="departmentCampaignCloseButton"
          >
            Close
          </button>

        </div>

      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("closeDepartmentCampaignModal")
      ?.addEventListener("click", closeDepartmentCampaignModal);

    document
      .getElementById("departmentCampaignCloseButton")
      ?.addEventListener("click", closeDepartmentCampaignModal);

       const campaignImg = modal.querySelector("#departmentCampaignImage");
          window.applyDocImageRatio?.(
            campaignImg?.closest(".campaign-image-wrapper"),
            campaignImg,
          );
  }

    const loadingContent = modal.querySelector(".campaign-loading-content");
    const loadedContent = modal.querySelector(".campaign-loaded-content");

    const name = document.getElementById("departmentCampaignMemberName");
    const info = document.getElementById("departmentCampaignMemberInfo");
    const image = document.getElementById("departmentCampaignImage");
    const imageWrapper = modal.querySelector(".campaign-image-wrapper");

    /*
     * Reset modal to skeleton state every time
     * a different member is opened.
     */
    if (loadingContent) {
      loadingContent.style.display = "block";
    }

    if (loadedContent) {
      loadedContent.style.display = "none";
    }

    if (imageWrapper) {
      imageWrapper.classList.add("image-loading");
    }

    if (name) {
      name.textContent = member.name;
    }

    if (info) {
      info.textContent = "Department Member";
    }

    showModal(modal);

    if (!image) return;

    const revealLoadedContent = () => {
      imageWrapper?.classList.remove("image-loading");

      if (loadingContent) {
        loadingContent.style.display = "none";
      }

      if (loadedContent) {
        loadedContent.style.display = "block";
      }
    };

    image.onload = revealLoadedContent;

    image.onerror = () => {
      image.src = "/images/campaign-placeholder.png";
      image.onload = revealLoadedContent;
    };

    image.src = member.campaignImage;
    image.alt = `${member.name} campaign`;
  }

/* =========================================================
   CLOSE CAMPAIGN MODAL
========================================================= */

function closeDepartmentCampaignModal() {
  const modal = document.getElementById("departmentCampaignModal");

  hideModal(modal);
}

/* =========================================================
   REVIEW VOTING
========================================================= */

function initializeReviewVoting() {
  document.addEventListener("click", (event) => {
    const reviewButton = event.target.closest("#reviewDepartmentVotes");

    if (reviewButton) {
      if (!validateDepartmentVotes()) return;
      openDepartmentReviewModal();
      return;
    }

    const clearAllButton = event.target.closest("#clearAllDepartmentVotes");
    if (clearAllButton) clearAllDepartmentSelections();
  });
}

function clearAllDepartmentSelections() {
  if (Object.keys(departmentElectionState.selections).length === 0) return;

  departmentElectionState.selections = {};
  updateDepartmentElectionUI();

  showDepartmentToast(
    "warning",
    "Selections Cleared",
    "All your member selections have been cleared.",
  );
}

/* =========================================================
   VALIDATE VOTES
========================================================= */

function validateDepartmentVotes() {
  const selectedCount = Object.keys(departmentElectionState.selections).length;

  if (selectedCount === 0) {
    showDepartmentToast(
      "warning",
      "Selection Required",
      "Please select at least one member to proceed.",
    );

    return false;
  }

  return true;
}

/* =========================================================
   OPEN REVIEW MODAL
========================================================= */

function openDepartmentReviewModal() {
  let modal = document.getElementById("departmentReviewVoteModal");

  if (!modal) {
    modal = document.createElement("div");

    modal.id = "departmentReviewVoteModal";

    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div
        class="review-vote-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="departmentReviewVoteTitle"
      >

        <div class="modal-header">

          <div>

            <h2 id="departmentReviewVoteTitle">
              Review Your Vote
            </h2>

            <p>
              Review your selections before submitting.
              Skipped positions will remain blank.
            </p>

          </div>

          <button
            type="button"
            class="close-modal"
            id="closeDepartmentReviewVoteModal"
            aria-label="Close review"
          >
            <i class="bi bi-x-lg"></i>
          </button>

        </div>

        <div
          class="review-vote-body"
          id="departmentReviewVoteBody"
        ></div>

        <div class="modal-footer">

          <button
            type="button"
            class="review-cancel-btn"
            id="backToDepartmentVoting"
          >
            <i class="bi bi-arrow-left"></i>
            Reselect
          </button>

          <button
            type="button"
            class="review-submit-btn"
            id="submitDepartmentVote"
          >
            <i class="bi bi-check2-circle"></i>
            Submit Vote
          </button>

        </div>

      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("closeDepartmentReviewVoteModal")
      ?.addEventListener("click", closeDepartmentReviewModal);

    document
      .getElementById("backToDepartmentVoting")
      ?.addEventListener("click", closeDepartmentReviewModal);

    document
      .getElementById("submitDepartmentVote")
      ?.addEventListener("click", confirmDepartmentVote);
  }

  renderDepartmentReviewSelections();

  showModal(modal);
}

/* =========================================================
   RENDER REVIEW
========================================================= */

function renderDepartmentReviewSelections() {
  const container = document.getElementById("departmentReviewVoteBody");

  if (!container) return;

  container.innerHTML = departmentElectionData.positions
    .map((position) => {
      const memberId = departmentElectionState.selections[position.id];

      const member = findDepartmentMember(memberId);

      if (!member) {
        return `
            <section class="review-position">

              <h3>
                ${escapeHtml(position.name)}
              </h3>

              <div class="review-skipped">
                <i class="bi bi-dash-circle"></i>

                <span>
                  Skipped
                </span>
              </div>

            </section>
          `;
      }

      return `
          <section class="review-position">

            <h3>
              ${escapeHtml(position.name)}
            </h3>

            <div class="review-candidate">

              <img
                src="${escapeHtml(member.image)}"
                alt="${escapeHtml(member.name)}"
                class="review-candidate-image"
              />

              <div class="review-candidate-info">

                <strong>
                  ${escapeHtml(member.name)}
                </strong>

                <span>
                  Department Member
                </span>

              </div>

            </div>

          </section>
        `;
    })
    .join("");
}

/* =========================================================
   CLOSE REVIEW
========================================================= */

function closeDepartmentReviewModal() {
  const modal = document.getElementById("departmentReviewVoteModal");

  hideModal(modal);
}

/* =========================================================
   CONFIRM VOTE
========================================================= */

function confirmDepartmentVote() {
  const submitBtn = document.getElementById("submitDepartmentVote");
  if (submitBtn) submitBtn.disabled = true;

  closeDepartmentReviewModal();
  submitDepartmentVotes();
}

/* =========================================================
   SUBMIT VOTES
========================================================= */

async function submitDepartmentVotes() {
  if (departmentElectionState.submitting) {
    return;
  }

  departmentElectionState.submitting = true;

  showDepartmentLoadingModal();

  try {
    /*
     * Every backend-defined position is included.
     *
     * If no member was selected:
     *
     * candidateId = null
     * skipped = true
     */

    const votes = departmentElectionData.positions.map((position) => {
      const memberId = departmentElectionState.selections[position.id] || null;

      return {
        positionId: position.id,

        position: position.name,

        memberId: memberId,

        candidateId: memberId,

        skipped: !memberId,
      };
    });

    const response = await fetch("/voter/api/department-elections/vote", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        electionId: departmentElectionData.electionId || null,

        votes: votes,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Failed to submit your vote.");
    }

    hideDepartmentLoadingModal();

    departmentElectionState.submitting = false;

    showDepartmentToast(
      "success",
      "Vote Submitted",
      "Your vote has been successfully recorded.",
    );
    renderDepartmentAlreadyVoted();

  } catch (error) {
    console.error("Department vote submission failed:", error);

    hideDepartmentLoadingModal();

    departmentElectionState.submitting = false;

    const retryBtn = document.getElementById("submitDepartmentVote");
        if (retryBtn) retryBtn.disabled = false;

    showDepartmentToast(
      "error",
      "Submission Failed",
      error.message || "Unable to submit your vote. Please try again.",
    );
  }
}

/* =========================================================
   LOADING MODAL
========================================================= */

function initializeLoadingModal() {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) return;

  modal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   SHOW LOADING
========================================================= */

function showDepartmentLoadingModal() {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) return;

  const title = document.getElementById("actionLoadingTitle");

  const message = document.getElementById("actionLoadingMessage");

  if (title) {
    title.textContent = "Submitting Vote...";
  }

  if (message) {
    message.textContent = "Please wait while your vote is being submitted.";
  }

  document.body.classList.add("modal-loading");

  showModal(modal);
}

/* =========================================================
   HIDE LOADING
========================================================= */

function hideDepartmentLoadingModal() {
  const modal = document.getElementById("actionLoadingModal");

  hideModal(modal);

  document.body.classList.remove("modal-loading");
}

/* =========================================================
   TOAST
========================================================= */

function showDepartmentToast(type, title, message) {
  let toast = document.getElementById("departmentVoteToast");

  if (!toast) {
    toast = document.createElement("div");

    toast.id = "departmentVoteToast";

    toast.className = "success-toast";

    toast.innerHTML = `
      <div class="success-toast-icon">

        <i id="departmentVoteToastIcon"></i>

      </div>

      <div class="success-toast-content">

        <strong id="departmentVoteToastTitle"></strong>

        <span id="departmentVoteToastMessage"></span>

      </div>

      <button
        type="button"
        class="success-toast-close"
        id="departmentVoteToastClose"
        aria-label="Close notification"
      >
        <i class="bi bi-x-lg"></i>
      </button>
    `;

    document.body.appendChild(toast);

    document
      .getElementById("departmentVoteToastClose")
      ?.addEventListener("click", hideDepartmentToast);
  }

  const icon = document.getElementById("departmentVoteToastIcon");

  const titleElement = document.getElementById("departmentVoteToastTitle");

  const messageElement = document.getElementById("departmentVoteToastMessage");

  toast.classList.remove("success", "error", "warning");

  toast.classList.add(type);

  if (icon) {
    icon.className =
      type === "success"
        ? "bi bi-check-circle-fill"
        : type === "error"
          ? "bi bi-exclamation-circle-fill"
          : "bi bi-info-circle-fill";
  }

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  clearTimeout(toast._timeout);

  toast._timeout = setTimeout(hideDepartmentToast, 4000);
}

/* =========================================================
   HIDE TOAST
========================================================= */

function hideDepartmentToast() {
  const toast = document.getElementById("departmentVoteToast");

  if (!toast) return;

  toast.classList.remove("show");
}

/* =========================================================
   THANK YOU
========================================================= */

function showDepartmentVoteThankYou(result) {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  const referenceNumber =
    result.referenceNumber || result.reference || result.voteReference || "N/A";

  const votedAt =
    result.votedAt || result.voteTime || new Date().toLocaleString();

  const voteDetails = departmentElectionData.positions
    .map((position) => {
      const memberId = departmentElectionState.selections[position.id];

      const member = findDepartmentMember(memberId);

      if (!member) return "";

      return `
          <div class="vote-detail-item">

            <div class="vote-detail-position">
              ${escapeHtml(position.name)}
            </div>

            <div class="vote-detail-candidate">

              <img
                src="${escapeHtml(member.image)}"
                alt="${escapeHtml(member.name)}"
              />

              <div>

                <strong>
                  ${escapeHtml(member.name)}
                </strong>

                <span>
                  Department Member
                </span>

              </div>

            </div>

          </div>
        `;
    })
    .join("");

  electionContent.innerHTML = `
    <section class="vote-thank-you">

      <div class="vote-thank-you-icon">
        <i class="bi bi-check-circle-fill"></i>
      </div>

      <h2>
        Thank You for Voting!
      </h2>

      <p>
        Your department election vote has been successfully recorded.
      </p>

      <div class="vote-reference-card">

        <span>
          Reference Number
        </span>

        <strong>
          ${escapeHtml(referenceNumber)}
        </strong>

      </div>

      <div class="vote-summary-card">

        <div class="vote-summary-header">

          <h3>
            Vote Details
          </h3>

        </div>

        <div class="vote-time">

          <i class="bi bi-clock"></i>

          <div>

            <span>
              Time Voted
            </span>

            <strong>
              ${escapeHtml(votedAt)}
            </strong>

          </div>

        </div>

        <div class="vote-details">
          ${voteDetails}
        </div>

      </div>

    </section>
  `;
}

/* =========================================================
   GLOBAL MODAL EVENTS
========================================================= */

function initializeGlobalModalEvents() {
  document.addEventListener("click", (event) => {
    const overlay = event.target.closest(".modal-overlay");

    if (!overlay) return;

    if (event.target !== overlay) {
      return;
    }

    if (overlay.id === "actionLoadingModal") {
      return;
    }

    hideModal(overlay);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    const visibleModal = document.querySelector(
      ".modal-overlay.show:not(.loading-modal-overlay)",
    );

    if (!visibleModal) return;

    hideModal(visibleModal);
  });
}

/* =========================================================
   FIND MEMBER
========================================================= */

function findDepartmentMember(memberId) {
  if (!memberId) {
    return null;
  }

  return (
    departmentElectionData.members.find((member) => member.id === memberId) ||
    null
  );
}

/* =========================================================
   SHOW MODAL
========================================================= */

function showModal(modal) {
  if (!modal) return;

  modal.classList.add("show");

  modal.setAttribute("aria-hidden", "false");
}

/* =========================================================
   HIDE MODAL
========================================================= */

function hideModal(modal) {
  if (!modal) return;

  modal.classList.remove("show");

  modal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
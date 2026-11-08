/* =========================================================
   LCCAST - DEPARTMENT PARTYLIST TYPE ELECTION VOTER VIEW
========================================================= */

/* =========================================================
   LCCAST - DEPARTMENT PARTYLIST TYPE ELECTION VOTER VIEW
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  if (DEPARTMENT_ELECTION_TYPE !== "PARTYLIST") {
    return;
  }

  initializeDepartmentPartylistElection();
});

/* =========================================================
   ELECTION SKELETON
========================================================= */

function renderDepartmentPartylistElectionSkeleton(container) {
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

      ${createDepartmentPartylistSkeletonPosition()}
      ${createDepartmentPartylistSkeletonPosition()}

      <div class="skeleton-action">
        <div class="skeleton skeleton-review-button"></div>
      </div>

    </div>
  `;
}

function createDepartmentPartylistSkeletonPosition() {
  return `
    <section class="skeleton-position">
      <div class="skeleton-position-header">
        <div class="skeleton skeleton-position-title"></div>
        <div class="skeleton skeleton-position-rule"></div>
      </div>
      <div class="skeleton-candidate-grid">
        ${createDepartmentPartylistSkeletonCandidate()}
        ${createDepartmentPartylistSkeletonCandidate()}
        ${createDepartmentPartylistSkeletonCandidate()}
        ${createDepartmentPartylistSkeletonCandidate()}
      </div>
    </section>
  `;
}

function createDepartmentPartylistSkeletonCandidate() {
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

/* =========================================================
   ELECTION DATA (populated from backend)
========================================================= */

let departmentPartylistElectionData = null;

async function fetchDepartmentPartylistElectionData() {
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

function groupCandidatesByPosition(candidates) {
  const grouped = {};

  (candidates || []).forEach((candidate) => {
    const positionName = candidate.position || "Unassigned";

    if (!grouped[positionName]) {
      grouped[positionName] = [];
    }

    grouped[positionName].push({
      id: candidate.id,
      name: [candidate.firstName, candidate.middleName, candidate.lastName]
        .filter(Boolean)
        .join(" "),
      partylist: candidate.partylistName || "",
      image:
        resolveElectionFileUrl(candidate.photoImageUrl) ||
        "/images/default-avatar.png",
      campaignImage:
        resolveElectionFileUrl(candidate.campaignImageUrl) ||
        "/images/campaign-placeholder.png",
    });
  });

  return Object.keys(grouped).map((positionName) => ({
    name: positionName,
    candidates: grouped[positionName],
  }));
}

/* =========================================================
   STATE
========================================================= */

const departmentPartylistElectionState = {
  selections: {},

  currentCandidate: null,

  submitting: false,
};

/* =========================================================
   INITIALIZE
========================================================= */

/* =========================================================
   INITIALIZE
========================================================= */

async function initializeDepartmentPartylistElection() {
  const electionContent = document.querySelector(".election-content");

  if (electionContent) {
    renderDepartmentPartylistElectionSkeleton(electionContent);
  }

  const data = await fetchDepartmentPartylistElectionData();

  if (!data || !data.status || data.status === "UNAUTHENTICATED" ||
      data.status === "NOT_A_VOTER" || data.status === "NO_DEPARTMENT_MATCH") {
    renderDepartmentPartylistEmptyState(
      "Not Available",
      "There is no department partylist election available for your account.",
    );
    return;
  }

  if (data.status === "NO_ELECTION" || data.status === "HIDDEN") {
        renderDepartmentPartylistEmptyState(
          "No Department Election Scheduled",
          "There is currently no upcoming or ongoing department election for your department.",
        );
    return;
  }

    departmentPartylistElectionData = {
      electionId: data.electionId,
      electionName: data.electionName,
      schoolYear: data.schoolYear,
      department: data.department,
      campus: data.campus,
      scheduledStartAt: data.scheduledStartAt,
      scheduledEndAt: data.scheduledEndAt,
      positions: sortByPositionOrder(groupCandidatesByPosition(data.candidates)),
    };

    initializeDepartmentPartylistCampaignModal();
    initializeDepartmentPartylistGlobalModalEvents();

    if (data.hasVoted) {
      renderDepartmentPartylistAlreadyVoted();
      return;
    }

  if (data.status === "UPCOMING") {
    renderDepartmentPartylistUpcoming();
    return;
  }

  if (data.status === "CONCLUDED") {
    renderDepartmentPartylistEmptyState(
      "Voting Closed",
      "This election has already concluded.",
    );
    return;
  }

    renderDepartmentPartylistElectionContent();

    initializeDepartmentPartylistCandidateSelection();

    initializeDepartmentPartylistReviewVoting();

    initializeDepartmentPartylistLoadingModal();

}

/* =========================================================
   EMPTY STATE
========================================================= */

function renderDepartmentPartylistEmptyState(title, message) {
  const electionContent = document.querySelector(".election-content");
  if (!electionContent) return;

  electionContent.innerHTML = `
    <div class="election-instructions">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderDepartmentPartylistAlreadyVoted() {
  const electionContent = document.querySelector(".election-content");
  if (!electionContent) return;

  electionContent.innerHTML = `
    <section class="vote-thank-you">
      <div class="vote-thank-you-icon">
        <i class="bi bi-check-circle-fill"></i>
      </div>

      <h2>You've Already Voted</h2>

      <p>
        Your vote for "${escapeHtml(departmentPartylistElectionData.electionName)}" has already been recorded.
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

function renderDepartmentPartylistUpcoming() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  electionContent.innerHTML = `
    <div class="election-info-card"></div>

    <div class="election-instructions">
      <h3>Upcoming Election</h3>
      <p>
        Voting is not yet open. Here is a preview of the positions
        and candidates for this election.
      </p>
    </div>

    <div class="election-positions">
      ${departmentPartylistElectionData.positions
        .map((position) => createDepartmentPartylistPositionReadOnly(position))
        .join("")}
    </div>
  `;

  renderDepartmentPartylistElectionInformation();
}

function createDepartmentPartylistPositionReadOnly(position) {
  return `
    <section class="election-position">
      <div class="position-header">
        <div class="position-title">
          <i class="bi bi-person-check"></i>
          <h3>${escapeHtml(position.name)}</h3>
        </div>
      </div>
      <div class="candidate-grid">
        ${position.candidates
          .map(
            (candidate) => `
                            <article class="candidate-card">
                              <div class="candidate-image-wrapper image-loading">
                                <img src="${escapeHtml(candidate.image)}" alt="${escapeHtml(candidate.name)}" class="candidate-image" loading="lazy" onload="this.parentElement.classList.remove('image-loading')" onerror="this.parentElement.classList.remove('image-loading')" />
                              </div>
                                <div class="candidate-info">
                                  <h4 class="candidate-name">${escapeHtml(candidate.name)}</h4>
                                  <p class="candidate-partylist">${escapeHtml(candidate.partylist)}</p>
                                </div>
                                <div class="candidate-actions">
                                  <button
                                    type="button"
                                    class="candidate-campaign-btn"
                                    data-candidate-id="${escapeHtml(candidate.id)}"
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
   RENDER ELECTION CONTENT
========================================================= */

function renderDepartmentPartylistElectionContent() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  electionContent.innerHTML = `
    <div class="election-info-card"></div>

    <div class="election-instructions">
      <h3>
        Before You Vote
      </h3>

      <p>
        Select one candidate for each position.
        You may view each candidate's campaign before
        making your selection. You can still change your
        selected candidate before submitting your vote.
      </p>
    </div>

    <div class="election-positions">
      ${departmentPartylistElectionData.positions
        .map((position) =>
          createDepartmentPartylistPosition(position),
        )
        .join("")}
    </div>

    <div class="election-action">
    <button type="button" class="secondary-btn" id="clearAllDepartmentPartylistVotes">
        <i class="bi bi-arrow-counterclockwise"></i>
        Clear All
      </button>
      <button
        type="button"
        class="primary-btn"
        id="reviewDepartmentPartylistVotes"
      >
        <i class="bi bi-clipboard-check"></i>

        Review Vote
      </button>
    </div>
  `;

  renderDepartmentPartylistElectionInformation();
}

/* =========================================================
   ELECTION INFORMATION
========================================================= */

function renderDepartmentPartylistElectionInformation() {
  const infoCard = document.querySelector(".election-info-card");

  if (!infoCard) return;

  infoCard.innerHTML = `
    <div class="election-info-icon">
      <i class="bi bi-ballot"></i>
    </div>

    <div class="election-info-content">
      <h3>
        ${escapeHtml(
          departmentPartylistElectionData.electionName,
        )}
      </h3>

      <p>
        ${escapeHtml(
          departmentPartylistElectionData.department,
        )}
      </p>

      <span>
        ${escapeHtml(
          departmentPartylistElectionData.campus,
        )}
      </span>

      <div class="election-schedule">
        <div class="election-schedule-item">
          <i class="bi bi-calendar-event"></i>

          <span>
            ${escapeHtml(
              formatDateTime(departmentPartylistElectionData.scheduledStartAt),
            )}
          </span>
        </div>

        <div class="election-schedule-item">
          <i class="bi bi-clock"></i>

          <span>
            Until ${escapeHtml(
              formatDateTime(departmentPartylistElectionData.scheduledEndAt),
            )}
          </span>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   CREATE POSITION
========================================================= */

function createDepartmentPartylistPosition(position) {
  return `
    <section
      class="election-position"
      data-position="${escapeHtml(position.name)}"
    >
      <div class="position-header">
        <div class="position-title">
          <i class="bi bi-person-check"></i>

          <h3>
            ${escapeHtml(position.name)}
          </h3>
        </div>

        <span class="position-rule">
          Select one candidate
        </span>
      </div>

      <div class="candidate-grid">
        ${position.candidates
          .map((candidate) =>
            createDepartmentPartylistCandidateCard(
              candidate,
              position.name,
            ),
          )
          .join("")}
      </div>
    </section>
  `;
}

/* =========================================================
   CREATE CANDIDATE CARD
========================================================= */

function createDepartmentPartylistCandidateCard(
  candidate,
  positionName,
) {
  return `
    <article
      class="candidate-card"
      data-candidate-id="${escapeHtml(candidate.id)}"
      data-position="${escapeHtml(positionName)}"
    >
            <div class="candidate-image-wrapper image-loading">
              <img
                src="${escapeHtml(candidate.image)}"
                alt="${escapeHtml(candidate.name)}"
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
          ${escapeHtml(candidate.name)}
        </h4>

        <p class="candidate-partylist">
          ${escapeHtml(candidate.partylist)}
        </p>
      </div>

      <div class="candidate-actions">
        <button
          type="button"
          class="candidate-campaign-btn"
          data-candidate-id="${escapeHtml(candidate.id)}"
        >
          <i class="bi bi-megaphone"></i>

          View Campaign
        </button>

        <button
          type="button"
          class="candidate-select-btn"
          data-candidate-id="${escapeHtml(candidate.id)}"
          data-position="${escapeHtml(positionName)}"
        >
          <i class="bi bi-check2-circle"></i>

          <span>
            Select
          </span>
        </button>
        <button
          type="button"
          class="candidate-clear-btn"
          data-candidate-id="${escapeHtml(candidate.id)}"
          data-position="${escapeHtml(positionName)}"
          aria-label="Clear selection"
        >
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </article>
  `;
}

/* =========================================================
   INITIALIZE CANDIDATE SELECTION
========================================================= */

function initializeDepartmentPartylistCandidateSelection() {
  document.addEventListener("click", (event) => {
    const selectButton = event.target.closest(".candidate-select-btn");

    if (selectButton) {
      const candidateId = selectButton.dataset.candidateId;
      const position = selectButton.dataset.position;

      if (candidateId && position) {
        selectDepartmentPartylistCandidate(position, candidateId);
      }
      return;
    }

    const clearButton = event.target.closest(".candidate-clear-btn");

    if (clearButton) {
      const position = clearButton.dataset.position;
      if (position) clearDepartmentPartylistPositionSelection(position);
    }
  });
}

function clearDepartmentPartylistPositionSelection(position) {
  delete departmentPartylistElectionState.selections[position];

  const positionSection = [...document.querySelectorAll(".election-position")]
    .find((section) => section.dataset.position === position);

  if (!positionSection) return;

  positionSection.querySelectorAll(".candidate-card").forEach((card) => {
    card.classList.remove("selected", "dimmed");

    const button = card.querySelector(".candidate-select-btn");
    if (!button) return;

    const label = button.querySelector("span");
    const icon = button.querySelector("i");

    if (label) label.textContent = "Select";
    if (icon) icon.className = "bi bi-check2-circle";
  });
}

/* =========================================================
   SELECT ONE CANDIDATE PER POSITION
========================================================= */

function selectDepartmentPartylistCandidate(
  position,
  candidateId,
) {
  departmentPartylistElectionState.selections[position] =
    candidateId;

  const positionSection = [
    ...document.querySelectorAll(".election-position"),
  ].find(
    (section) =>
      section.dataset.position === position,
  );

  if (!positionSection) return;

  const cards =
    positionSection.querySelectorAll(".candidate-card");

  cards.forEach((card) => {
    const isSelected =
      card.dataset.candidateId === candidateId;

    card.classList.toggle("selected", isSelected);

    /*
     * Other candidates are visually greyed out,
     * but they remain selectable.
     */
    card.classList.toggle("dimmed", !isSelected);

    const button = card.querySelector(
      ".candidate-select-btn",
    );

    if (!button) return;

    const label = button.querySelector("span");

    const icon = button.querySelector("i");

    if (label) {
      label.textContent = isSelected
        ? "Selected"
        : "Select";
    }

    if (icon) {
      icon.className = isSelected
        ? "bi bi-check-circle-fill"
        : "bi bi-check2-circle";
    }
  });
}

/* =========================================================
   CAMPAIGN MODAL EVENTS
========================================================= */

function initializeDepartmentPartylistCampaignModal() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(
      ".candidate-campaign-btn",
    );

    if (!button) return;

    const candidate = findDepartmentPartylistCandidate(
      button.dataset.candidateId,
    );

    if (!candidate) return;

    openDepartmentPartylistCampaignModal(candidate);
  });
}

/* =========================================================
   OPEN CAMPAIGN MODAL
========================================================= */

function openDepartmentPartylistCampaignModal(
  candidate,
) {
  departmentPartylistElectionState.currentCandidate =
    candidate;

  let modal = document.getElementById(
    "departmentPartylistCampaignModal",
  );

  if (!modal) {
    modal = document.createElement("div");

    modal.id = "departmentPartylistCampaignModal";

    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div
        class="campaign-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="departmentPartylistCampaignModalTitle"
      >
        <div class="campaign-modal-header">
          <div>
            <h2 id="departmentPartylistCampaignModalTitle">
              Candidate Campaign
            </h2>
          </div>

          <button
            type="button"
            class="campaign-modal-close"
            id="closeDepartmentPartylistCampaignModal"
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
                      id="departmentPartylistCampaignCandidateName"
                    ></h3>

                    <p
                      class="campaign-candidate-partylist"
                      id="departmentPartylistCampaignPartylist"
                    ></p>

                    <div class="campaign-image-wrapper image-loading">
                      <img
                        id="departmentPartylistCampaignImage"
                        class="campaign-image"
                        src=""
                        alt="Candidate campaign"
                      />
                    </div>

                  </div>

                </div>

        <div class="modal-footer">
          <button
            type="button"
            class="cancel-btn"
            id="departmentPartylistCampaignCloseButton"
          >
            Close
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById(
        "closeDepartmentPartylistCampaignModal",
      )
      ?.addEventListener(
        "click",
        closeDepartmentPartylistCampaignModal,
      );

    document
      .getElementById(
        "departmentPartylistCampaignCloseButton",
      )
      ?.addEventListener(
        "click",
        closeDepartmentPartylistCampaignModal,
      );

      const campaignImg = modal.querySelector("#departmentPartylistCampaignImage");
          window.applyDocImageRatio?.(
            campaignImg?.closest(".campaign-image-wrapper"),
            campaignImg,
          );
  }

    const loadingContent = modal.querySelector(".campaign-loading-content");
    const loadedContent = modal.querySelector(".campaign-loaded-content");

    const name = document.getElementById(
      "departmentPartylistCampaignCandidateName",
    );

    const partylist = document.getElementById(
      "departmentPartylistCampaignPartylist",
    );

    const image = document.getElementById(
      "departmentPartylistCampaignImage",
    );

    const imageWrapper = modal.querySelector(".campaign-image-wrapper");

    /*
     * Reset modal to skeleton state every time
     * a different candidate is opened.
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
      name.textContent = candidate.name;
    }

    if (partylist) {
      partylist.textContent = candidate.partylist;
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

    image.src = candidate.campaignImage;
    image.alt = `${candidate.name} campaign`;
  }

/* =========================================================
   CLOSE CAMPAIGN MODAL
========================================================= */

function closeDepartmentPartylistCampaignModal() {
  const modal = document.getElementById(
    "departmentPartylistCampaignModal",
  );

  hideModal(modal);
}

/* =========================================================
   REVIEW VOTE
========================================================= */

function initializeDepartmentPartylistReviewVoting() {
  document.addEventListener("click", (event) => {
    const reviewButton = event.target.closest("#reviewDepartmentPartylistVotes");

    if (reviewButton) {
      if (!validateDepartmentPartylistVoteSelections()) return;
      openDepartmentPartylistReviewVoteModal();
      return;
    }

    const clearAllButton = event.target.closest("#clearAllDepartmentPartylistVotes");
    if (clearAllButton) clearAllDepartmentPartylistSelections();
  });
}

function clearAllDepartmentPartylistSelections() {
  if (Object.keys(departmentPartylistElectionState.selections).length === 0) return;

  departmentPartylistElectionState.selections = {};

  document.querySelectorAll(".candidate-card").forEach((card) => {
    card.classList.remove("selected", "dimmed");

    const button = card.querySelector(".candidate-select-btn");
    if (!button) return;

    const label = button.querySelector("span");
    const icon = button.querySelector("i");

    if (label) label.textContent = "Select";
    if (icon) icon.className = "bi bi-check2-circle";
  });

  showDepartmentPartylistVoteToast(
    "warning",
    "Selections Cleared",
    "All your candidate selections have been cleared.",
  );
}

/* =========================================================
   VALIDATE VOTE
========================================================= */

function validateDepartmentPartylistVoteSelections() {
  const selectedCount = Object.keys(
    departmentPartylistElectionState.selections,
  ).length;

  if (selectedCount > 0) {
    return true;
  }

  showDepartmentPartylistVoteToast(
    "error",
    "No Vote Selected",
    "Please select at least one candidate before reviewing your vote.",
  );

  return false;
}

/* =========================================================
   OPEN REVIEW VOTE MODAL
========================================================= */

function openDepartmentPartylistReviewVoteModal() {
  let modal = document.getElementById(
    "departmentPartylistReviewVoteModal",
  );

  if (!modal) {
    modal = document.createElement("div");

    modal.id = "departmentPartylistReviewVoteModal";

    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div
        class="review-vote-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="departmentPartylistReviewVoteTitle"
      >
        <div class="modal-header">
          <div>
            <h2 id="departmentPartylistReviewVoteTitle">
              Review Your Vote
            </h2>

            <p>
              Review your selected candidates.
              Unselected positions will be skipped.
            </p>
          </div>

          <button
            type="button"
            class="close-modal"
            id="closeDepartmentPartylistReviewVoteModal"
            aria-label="Close review"
          >
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div
          class="review-vote-body"
          id="departmentPartylistReviewVoteBody"
        ></div>

        <div class="modal-footer">
          <button
            type="button"
            class="review-cancel-btn"
            id="backToDepartmentPartylistVoting"
          >
            <i class="bi bi-arrow-left"></i>

            Reselect
          </button>

          <button
            type="button"
            class="review-submit-btn"
            id="submitDepartmentPartylistVote"
          >
            <i class="bi bi-check2-circle"></i>

            Submit Vote
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById(
        "closeDepartmentPartylistReviewVoteModal",
      )
      ?.addEventListener(
        "click",
        closeDepartmentPartylistReviewVoteModal,
      );

    document
      .getElementById(
        "backToDepartmentPartylistVoting",
      )
      ?.addEventListener(
        "click",
        closeDepartmentPartylistReviewVoteModal,
      );

    document
      .getElementById(
        "submitDepartmentPartylistVote",
      )
      ?.addEventListener(
        "click",
        confirmDepartmentPartylistVote,
      );
  }

  renderDepartmentPartylistReviewSelections();

  showModal(modal);
}

/* =========================================================
   RENDER REVIEW SELECTIONS
========================================================= */

function renderDepartmentPartylistReviewSelections() {
  const container = document.getElementById(
    "departmentPartylistReviewVoteBody",
  );

  if (!container) return;

  const positions =
    departmentPartylistElectionData.positions || [];

  container.innerHTML = positions
    .map((position) => {
      const candidateId =
        departmentPartylistElectionState.selections[
          position.name
        ];

      const candidate =
        findDepartmentPartylistCandidate(candidateId);

      /*
       * No candidate selected for this position.
       * Show it as SKIPPED instead of hiding it.
       */
      if (!candidate) {
        return `
          <section class="review-position">
            <h3>
              ${escapeHtml(position.name)}
            </h3>

            <div class="review-skipped">
              <i class="bi bi-dash-circle"></i>
              <span>Skipped</span>
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
              src="${escapeHtml(candidate.image)}"
              alt="${escapeHtml(candidate.name)}"
              class="review-candidate-image"
            />

            <div class="review-candidate-info">
              <strong>
                ${escapeHtml(candidate.name)}
              </strong>

              <span>
                ${escapeHtml(candidate.partylist)}
              </span>
            </div>
          </div>
        </section>
      `;
    })
    .join("");
}

/* =========================================================
   CLOSE REVIEW MODAL
========================================================= */

function closeDepartmentPartylistReviewVoteModal() {
  const modal = document.getElementById(
    "departmentPartylistReviewVoteModal",
  );

  hideModal(modal);
}

/* =========================================================
   CONFIRM REVIEWED VOTE
========================================================= */

function confirmDepartmentPartylistVote() {
  closeDepartmentPartylistReviewVoteModal();

  submitDepartmentPartylistVotes();
}

/* =========================================================
   SUBMIT VOTES
========================================================= */

async function submitDepartmentPartylistVotes() {
  if (
    departmentPartylistElectionState.submitting
  ) {
    return;
  }

  departmentPartylistElectionState.submitting = true;

  showDepartmentPartylistLoadingModal();

  try {
    const votes =
      departmentPartylistElectionData.positions.map(
        (position) => ({
          position: position.name,

          candidateId:
            departmentPartylistElectionState
              .selections[position.name] || null,

          skipped:
            !departmentPartylistElectionState
              .selections[position.name],
        }),
      );

    const response = await fetch("/voter/api/department-elections/vote", { // was department-partylist-elections
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        electionId: departmentPartylistElectionData.electionId || null,
        votes: votes, // { position, candidateId, skipped } — already matches VoteRequest.VoteEntry
      }),
    });

    const result = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.message ||
          "Failed to submit your vote.",
      );
    }

    hideDepartmentPartylistLoadingModal();

    departmentPartylistElectionState.submitting = false;

    showDepartmentPartylistVoteToast(
      "success",
      "Vote Submitted",
      "Your vote has been successfully recorded.",
    );
    renderDepartmentPartylistAlreadyVoted();

  } catch (error) {
    console.error(
      "Department partylist vote submission failed:",
      error,
    );

    hideDepartmentPartylistLoadingModal();

    departmentPartylistElectionState.submitting = false;

    showDepartmentPartylistVoteToast(
      "error",
      "Submission Failed",
      error.message ||
        "Unable to submit your vote. Please try again.",
    );
  }
}

/* =========================================================
   LOADING MODAL
========================================================= */

function initializeDepartmentPartylistLoadingModal() {
  const modal = document.getElementById(
    "actionLoadingModal",
  );

  if (!modal) return;

  modal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   SHOW LOADING
========================================================= */

function showDepartmentPartylistLoadingModal() {
  const modal = document.getElementById(
    "actionLoadingModal",
  );

  if (!modal) return;

  const title = document.getElementById(
    "actionLoadingTitle",
  );

  const message = document.getElementById(
    "actionLoadingMessage",
  );

  if (title) {
    title.textContent = "Submitting Vote...";
  }

  if (message) {
    message.textContent =
      "Please wait while your vote is being submitted.";
  }

  document.body.classList.add("modal-loading");

  showModal(modal);
}

/* =========================================================
   HIDE LOADING
========================================================= */

function hideDepartmentPartylistLoadingModal() {
  const modal = document.getElementById(
    "actionLoadingModal",
  );

  hideModal(modal);

  document.body.classList.remove("modal-loading");
}

/* =========================================================
   VOTE TOAST
========================================================= */

function showDepartmentPartylistVoteToast(
  type,
  title,
  message,
) {
  let toast = document.getElementById(
    "departmentPartylistVoteToast",
  );

  if (!toast) {
    toast = document.createElement("div");

    toast.id = "departmentPartylistVoteToast";

    toast.className = "success-toast";

    toast.innerHTML = `
      <div class="success-toast-icon">
        <i id="departmentPartylistVoteToastIcon"></i>
      </div>

      <div class="success-toast-content">
        <strong id="departmentPartylistVoteToastTitle"></strong>

        <span id="departmentPartylistVoteToastMessage"></span>
      </div>

      <button
        type="button"
        class="success-toast-close"
        id="departmentPartylistVoteToastClose"
        aria-label="Close notification"
      >
        <i class="bi bi-x-lg"></i>
      </button>
    `;

    document.body.appendChild(toast);

    document
      .getElementById(
        "departmentPartylistVoteToastClose",
      )
      ?.addEventListener(
        "click",
        hideDepartmentPartylistVoteToast,
      );
  }

  const icon = document.getElementById(
    "departmentPartylistVoteToastIcon",
  );

  const titleElement = document.getElementById(
    "departmentPartylistVoteToastTitle",
  );

  const messageElement = document.getElementById(
    "departmentPartylistVoteToastMessage",
  );

  toast.classList.remove(
    "success",
    "error",
    "warning",
  );

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

  toast._timeout = setTimeout(
    hideDepartmentPartylistVoteToast,
    4000,
  );
}

function hideDepartmentPartylistVoteToast() {
  const toast = document.getElementById(
    "departmentPartylistVoteToast",
  );

  if (!toast) return;

  toast.classList.remove("show");
}

/* =========================================================
   VOTE THANK YOU
========================================================= */

function showDepartmentPartylistVoteThankYou(
  result,
) {
  const electionContent =
    document.querySelector(".election-content");

  if (!electionContent) return;

  const referenceNumber =
    result.referenceNumber ||
    result.reference ||
    result.voteReference ||
    "N/A";

  const votedAt =
    result.votedAt ||
    result.voteTime ||
    new Date().toLocaleString();

  const voteDetails =
    departmentPartylistElectionData.positions
      .map((position) => {
        const candidateId =
          departmentPartylistElectionState
            .selections[position.name];

        const candidate =
          findDepartmentPartylistCandidate(
            candidateId,
          );

        if (!candidate) return "";

        return `
          <div class="vote-detail-item">
            <div class="vote-detail-position">
              ${escapeHtml(position.name)}
            </div>

            <div class="vote-detail-candidate">
              <img
                src="${escapeHtml(candidate.image)}"
                alt="${escapeHtml(candidate.name)}"
              />

              <div>
                <strong>
                  ${escapeHtml(candidate.name)}
                </strong>

                <span>
                  ${escapeHtml(candidate.partylist)}
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
        Your department partylist election vote
        has been successfully recorded.
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

function initializeDepartmentPartylistGlobalModalEvents() {
  document.addEventListener("click", (event) => {
    const overlay = event.target.closest(
      ".modal-overlay",
    );

    if (!overlay) return;

    /*
     * Only close when the overlay itself is clicked.
     */
    if (event.target !== overlay) {
      return;
    }

    /*
     * Loading modal cannot be closed manually.
     */
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
   FIND CANDIDATE
========================================================= */

function findDepartmentPartylistCandidate(
  candidateId,
) {
  if (!candidateId) {
    return null;
  }

  for (const position of
    departmentPartylistElectionData.positions) {
    const candidate = position.candidates.find(
      (candidate) =>
        candidate.id === candidateId,
    );

    if (candidate) {
      return candidate;
    }
  }

  return null;
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
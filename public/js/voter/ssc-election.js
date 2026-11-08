/* =========================================================
   LCCAST - VOTER VIEW (SSC ELECTION)
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeVoterElection();
});

/* =========================================================
   STATE
========================================================= */

const voterElectionState = {
  data: null,          // response from /voter/api/elections/ssc
  selections: {},
  currentCandidate: null,
  submitting: false,
};

/* =========================================================
   INITIALIZE
========================================================= */

async function initializeVoterElection() {
  initializeCandidateSelection();
  initializeCampaignModal();
  initializeReviewVoting();
  initializeLoadingModal();
  initializeGlobalModalEvents();

  await loadElectionData();
}

/* =========================================================
   LOAD ELECTION DATA FROM BACKEND
========================================================= */

async function loadElectionData() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  // Show skeleton immediately
  renderElectionSkeleton(electionContent);

  try {
    const data = await SoftCache.load("/voter/api/elections/ssc", {
      ttl: 10000,
      swr: false,
    });

    if (Array.isArray(data.positions)) {
      data.positions = sortByPositionOrder(data.positions);
    }

    voterElectionState.data = data;

    renderElectionContent();

    // Start loading candidate images after real content is rendered
//    initializeCandidateImageLoading();

  } catch (error) {
    console.error("Failed to load SSC election:", error);

    electionContent.innerHTML = `
      <div class="election-instructions">
        <h3>Unable to Load Election</h3>
        <p>
          Something went wrong while loading the SSC election.
          Please refresh the page.
        </p>
      </div>
    `;
  }
}

function getProtectedFileUrl(storagePath) {
    if (!storagePath) return "";
    return `/voter/api/elections/file?path=${encodeURIComponent(storagePath)}`;
}

/* =========================================================
   ELECTION SKELETON
========================================================= */

function renderElectionSkeleton(container) {
  container.innerHTML = `
    <div class="election-skeleton">

      <!-- ELECTION INFORMATION -->
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


      <!-- INSTRUCTIONS -->
      <div class="skeleton-instructions">

        <div class="skeleton skeleton-instruction-title"></div>

        <div class="skeleton skeleton-instruction-line"></div>

        <div class="skeleton skeleton-instruction-line"></div>

        <div class="skeleton skeleton-instruction-line short"></div>

      </div>


      <!-- POSITIONS -->
      ${createSkeletonPosition()}
      ${createSkeletonPosition()}


      <!-- REVIEW BUTTON -->
      <div class="skeleton-action">
        <div class="skeleton skeleton-review-button"></div>
      </div>

    </div>
  `;
}


function createSkeletonPosition() {
  return `
    <section class="skeleton-position">

      <div class="skeleton-position-header">
        <div class="skeleton skeleton-position-title"></div>
        <div class="skeleton skeleton-position-rule"></div>
      </div>

      <div class="skeleton-candidate-grid">

        ${createSkeletonCandidate()}
        ${createSkeletonCandidate()}
        ${createSkeletonCandidate()}
        ${createSkeletonCandidate()}

      </div>

    </section>
  `;
}


function createSkeletonCandidate() {
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
   RENDER ELECTION CONTENT (branches by state)
========================================================= */

function renderElectionContent() {
  const electionContent = document.querySelector(".election-content");

  if (!electionContent) return;

  const data = voterElectionState.data;

  if (!data || !data.found) {
    renderNoElectionState(electionContent);
    return;
  }

  if (data.hasVoted) {
    renderAlreadyVotedState(electionContent, data);
    return;
  }

  if (data.phase === "UPCOMING") {
    renderUpcomingState(electionContent, data);
    return;
  }

  if (data.phase === "ONGOING") {
    renderOngoingState(electionContent, data);
    return;
  }

  renderClosedState(electionContent, data);
}

/* =========================================================
   STATE: NO ELECTION FOUND
========================================================= */

function renderNoElectionState(container) {
  container.innerHTML = `
    <div class="election-instructions">
      <h3>No SSC Election Scheduled</h3>
      <p>There is currently no upcoming or ongoing SSC election for your campus.</p>
    </div>
  `;
}

/* =========================================================
   STATE: ALREADY VOTED
========================================================= */

function renderAlreadyVotedState(container, data) {
  container.innerHTML = `
    <section class="vote-thank-you">
      <div class="vote-thank-you-icon">
        <i class="bi bi-check-circle-fill"></i>
      </div>

      <h2>You've Already Voted</h2>

      <p>
        Your vote for "${escapeHtml(data.title)}" has already been recorded.
        You can view your selections in the Vote Summaries tab.
      </p>
    </section>
  `;
}

/* =========================================================
   STATE: UPCOMING (read-only preview, voting disabled)
========================================================= */

function renderUpcomingState(container, data) {
  container.innerHTML = `
    <div class="election-info-card"></div>

    <div class="election-view-candidates-action" id="viewCandidatesButtonWrapper"></div>

    <div class="election-instructions">
      <h3>Voting Has Not Started</h3>
      <p>
        Voting for this election opens on
        <strong>${formatDateTime(data.startAt)}</strong>.
        You can preview the candidates below, but selections are disabled
        until voting begins.
      </p>
    </div>

    <div class="election-positions">
      ${data.positions
        .map((position) => createPosition(position, false))
        .join("")}
    </div>
  `;

  renderElectionInformation(data);
  renderViewCandidatesButton();
}

/* =========================================================
   STATE: ONGOING (interactive voting flow)
========================================================= */

function renderOngoingState(container, data) {
  container.innerHTML = `
    <div class="election-info-card"></div>

    <div class="election-view-candidates-action" id="viewCandidatesButtonWrapper"></div>

    <div class="election-instructions">
      <h3>Before You Vote</h3>
      <p>
        Select one candidate for each position.
        You may view each candidate's campaign before
        making your selection. You can still change your
        selected candidate before submitting your vote.
      </p>
    </div>

    <div class="election-positions">
      ${data.positions
        .map((position) => createPosition(position, true))
        .join("")}
    </div>

    <div class="election-action">
      <button type="button" class="secondary-btn" id="clearAllVotes">
        <i class="bi bi-arrow-counterclockwise"></i>
        Clear All
      </button>

      <button type="button" class="primary-btn" id="reviewVotes">
        <i class="bi bi-clipboard-check"></i>
        Review Vote
      </button>
    </div>
  `;

  renderElectionInformation(data);
  renderViewCandidatesButton();
}

/* =========================================================
   STATE: CLOSED / CONCLUDED
========================================================= */

function renderClosedState(container, data) {
  container.innerHTML = `
    <div class="election-instructions">
      <h3>Voting Has Closed</h3>
      <p>
        Voting for "${escapeHtml(data.title)}" ended on
        <strong>${formatDateTime(data.endAt)}</strong>.
      </p>
    </div>
  `;
}

/* =========================================================
   ELECTION INFORMATION CARD
========================================================= */

function renderElectionInformation(data) {
  const infoCard = document.querySelector(".election-info-card");

  if (!infoCard) return;

  const phaseLabel =
    data.phase === "UPCOMING" ? "Upcoming" : "Ongoing";

  infoCard.innerHTML = `
    <div class="election-info-icon">
      <i class="bi bi-ballot"></i>
    </div>

    <div class="election-info-content">
      <h3>${escapeHtml(data.title)}</h3>

      <p>School Year ${escapeHtml(data.schoolYear)}</p>

      <span class="election-phase-badge">${phaseLabel}</span>

      <div class="election-schedule">
        <div class="election-schedule-item">
          <i class="bi bi-calendar-event"></i>
          <span>${formatDateTime(data.startAt)}</span>
        </div>

        <div class="election-schedule-item">
          <i class="bi bi-clock"></i>
          <span>Until ${formatDateTime(data.endAt)}</span>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   VIEW CANDIDATES BUTTON (opens the shared partylist modal)
========================================================= */

function renderViewCandidatesButton() {
  const wrapper = document.getElementById("viewCandidatesButtonWrapper");

  if (!wrapper) return;

  wrapper.innerHTML = `
    <button type="button" class="view-candidates-btn" id="openViewCandidatesBtn">
      <i class="bi bi-people-fill"></i>
      View Candidates
    </button>
  `;

  document
    .getElementById("openViewCandidatesBtn")
    ?.addEventListener("click", () => {
      const data = voterElectionState.data;
      const parties = mapSscPartylistsForModal(data ? data.partylists : []);
      openViewCandidatesModal(parties);
    });
}

/*
 * Maps the backend's raw `partylists` array (storage paths) into the
 * shape the shared view-candidates-modal.js expects (resolved URLs).
 *
 * Expects each partylist item to look like:
 * {
 *   id, name, posterImageUrl, logoImageUrl,
 *   members: [{ position, name, photoImageUrl, campaignImageUrl, backgroundImageUrl }]
 * }
 */
function mapSscPartylistsForModal(rawPartylists) {
  return (rawPartylists || []).map((party) => ({
    id: party.id,
    name: party.name,
    posterImageUrl: party.posterImageUrl ? getProtectedFileUrl(party.posterImageUrl) : "",
    logoImageUrl: party.logoImageUrl ? getProtectedFileUrl(party.logoImageUrl) : "",
    members: (party.members || []).map((member) => ({
      position: member.position,
      name: member.name,
      photoImageUrl: member.photoImageUrl ? getProtectedFileUrl(member.photoImageUrl) : "",
      campaignImageUrl: member.campaignImageUrl ? getProtectedFileUrl(member.campaignImageUrl) : "",
      backgroundImageUrl: member.backgroundImageUrl ? getProtectedFileUrl(member.backgroundImageUrl) : "",
    })),
  }));
}

/* =========================================================
   CREATE POSITION
========================================================= */

function createPosition(position, votingEnabled) {
  return `
    <section class="election-position" data-position="${escapeHtml(position.name)}">
      <div class="position-header">
        <div class="position-title">
          <i class="bi bi-person-check"></i>
          <h3>${escapeHtml(position.name)}</h3>
        </div>
        <span class="position-rule">Select one candidate</span>
      </div>

      <div class="candidate-grid">
        ${position.candidates
          .map((candidate) =>
            createCandidateCard(candidate, position.name, votingEnabled),
          )
          .join("")}
      </div>
    </section>
  `;
}

/* =========================================================
   CREATE CANDIDATE CARD
========================================================= */

function createCandidateCard(candidate, positionName, votingEnabled) {
  const photo = candidate.photoImageUrl
    ? getProtectedFileUrl(candidate.photoImageUrl)
    : "/images/default-avatar.png";

  return `
    <article
      class="candidate-card"
      data-candidate-id="${escapeHtml(candidate.id)}"
      data-position="${escapeHtml(positionName)}"
    >

      <div class="candidate-image-wrapper image-loading">

        <img
          src="${escapeHtml(photo)}"
          alt="${escapeHtml(candidate.fullName)}"
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
          ${escapeHtml(candidate.fullName)}
        </h4>

        <p class="candidate-partylist">
          ${escapeHtml(candidate.partylistName || "Independent")}
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

        ${
          votingEnabled
            ? `
              <button
                type="button"
                class="candidate-select-btn"
                data-candidate-id="${escapeHtml(candidate.id)}"
                data-position="${escapeHtml(positionName)}"
              >
                <i class="bi bi-check2-circle"></i>
                <span>Select</span>
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
            `
            : ""
        }

      </div>

    </article>
  `;
}

/* =========================================================
   INITIALIZE CANDIDATE SELECTION
========================================================= */

function initializeCandidateSelection() {
  document.addEventListener("click", (event) => {
    const selectButton = event.target.closest(".candidate-select-btn");

    if (selectButton) {
      const candidateId = selectButton.dataset.candidateId;
      const position = selectButton.dataset.position;

      if (candidateId && position) {
        selectCandidate(position, candidateId);
      }
      return;
    }

    const clearButton = event.target.closest(".candidate-clear-btn");

    if (clearButton) {
      const position = clearButton.dataset.position;
      if (position) clearPositionSelection(position);
    }
  });
}

function clearPositionSelection(position) {
  delete voterElectionState.selections[position];

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

function selectCandidate(position, candidateId) {
  voterElectionState.selections[position] = candidateId;

  const positionSection = [...document.querySelectorAll(".election-position")]
    .find((section) => section.dataset.position === position);

  if (!positionSection) return;

  const cards = positionSection.querySelectorAll(".candidate-card");

  cards.forEach((card) => {
    const isSelected = card.dataset.candidateId === candidateId;

    card.classList.toggle("selected", isSelected);
    card.classList.toggle("dimmed", !isSelected);

    const button = card.querySelector(".candidate-select-btn");
    if (!button) return;

    const label = button.querySelector("span");
    const icon = button.querySelector("i");

    if (label) label.textContent = isSelected ? "Selected" : "Select";
    if (icon) icon.className = isSelected ? "bi bi-check-circle-fill" : "bi bi-check2-circle";
  });
}

/* =========================================================
   CAMPAIGN MODAL
========================================================= */

function initializeCampaignModal() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".candidate-campaign-btn");
    if (!button) return;

    const candidate = findCandidate(button.dataset.candidateId);
    if (!candidate) return;

    openCampaignModal(candidate);
  });
}

function openCampaignModal(candidate) {
  voterElectionState.currentCandidate = candidate;

  let modal = document.getElementById("campaignModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "campaignModal";
    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div class="campaign-modal" role="dialog" aria-modal="true" aria-labelledby="campaignModalTitle">

        <div class="campaign-modal-header">
          <div>
            <h2 id="campaignModalTitle">Candidate Campaign</h2>
          </div>

          <button
            type="button"
            class="campaign-modal-close"
            id="closeCampaignModal"
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
              id="campaignCandidateName"
            ></h3>

            <p
              class="campaign-candidate-partylist"
              id="campaignPartylist"
            ></p>

            <div class="campaign-image-wrapper image-loading">
              <img
                id="campaignImage"
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
            id="campaignCloseButton"
          >
            Close
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    document
      .getElementById("closeCampaignModal")
      ?.addEventListener("click", closeCampaignModal);

    document
      .getElementById("campaignCloseButton")
      ?.addEventListener("click", closeCampaignModal);

      const campaignImg = modal.querySelector("#campaignImage");
            window.applyDocImageRatio?.(
              campaignImg?.closest(".campaign-image-wrapper"),
              campaignImg,
            );
  }



  const loadingContent = modal.querySelector(".campaign-loading-content");
  const loadedContent = modal.querySelector(".campaign-loaded-content");

  const name = document.getElementById("campaignCandidateName");
  const partylist = document.getElementById("campaignPartylist");
  const image = document.getElementById("campaignImage");
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

  /*
   * Fill text immediately.
   */
  if (name) {
    name.textContent = candidate.fullName;
  }

  if (partylist) {
    partylist.textContent =
      candidate.partylistName || "Independent";
  }

  /*
   * Show modal immediately.
   */
  showModal(modal);

  /*
   * Campaign image.
   */
  const campaignUrl = candidate.campaignImageUrl
    ? getProtectedFileUrl(candidate.campaignImageUrl)
    : "/images/campaign-placeholder.png";

  if (!image) return;

  image.onload = () => {
    imageWrapper?.classList.remove("image-loading");

    if (loadingContent) {
      loadingContent.style.display = "none";
    }

    if (loadedContent) {
      loadedContent.style.display = "block";
    }
  };

  image.onerror = () => {
    image.src = "/images/campaign-placeholder.png";

    image.onload = () => {
      imageWrapper?.classList.remove("image-loading");

      if (loadingContent) {
        loadingContent.style.display = "none";
      }

      if (loadedContent) {
        loadedContent.style.display = "block";
      }
    };
  };

  image.src = campaignUrl;
  image.alt = `${candidate.fullName} campaign`;
}

function closeCampaignModal() {
  hideModal(document.getElementById("campaignModal"));
}

/* =========================================================
   REVIEW VOTE
========================================================= */

function initializeReviewVoting() {
  document.addEventListener("click", (event) => {
    const reviewButton = event.target.closest("#reviewVotes");

    if (reviewButton) {
      if (!validateVoteSelections()) return;
      openReviewVoteModal();
      return;
    }

    const clearAllButton = event.target.closest("#clearAllVotes");
    if (clearAllButton) clearAllSelections();
  });
}

function clearAllSelections() {
  if (Object.keys(voterElectionState.selections).length === 0) return;

  voterElectionState.selections = {};

  document.querySelectorAll(".candidate-card").forEach((card) => {
    card.classList.remove("selected", "dimmed");

    const button = card.querySelector(".candidate-select-btn");
    if (!button) return;

    const label = button.querySelector("span");
    const icon = button.querySelector("i");

    if (label) label.textContent = "Select";
    if (icon) icon.className = "bi bi-check2-circle";
  });

  showVoteToast(
    "warning",
    "Selections Cleared",
    "All your candidate selections have been cleared.",
  );
}

function validateVoteSelections() {
  const selectedCount = Object.keys(voterElectionState.selections).length;

  if (selectedCount > 0) return true;

  showVoteToast(
    "error",
    "No Vote Selected",
    "Please select at least one candidate before reviewing your vote.",
  );

  return false;
}

function openReviewVoteModal() {
  let modal = document.getElementById("reviewVoteModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "reviewVoteModal";
    modal.className = "modal-overlay";

    modal.innerHTML = `
      <div class="review-vote-modal" role="dialog" aria-modal="true" aria-labelledby="reviewVoteTitle">
        <div class="modal-header">
          <div>
            <h2 id="reviewVoteTitle">Review Your Vote</h2>
            <p>Review your selected candidates. Unselected positions will be skipped.</p>
          </div>
          <button type="button" class="close-modal" id="closeReviewVoteModal" aria-label="Close review">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div class="review-vote-body" id="reviewVoteBody"></div>

        <div class="modal-footer">
          <button type="button" class="review-cancel-btn" id="backToVoting">
            <i class="bi bi-arrow-left"></i>
            Reselect
          </button>
          <button type="button" class="review-submit-btn" id="submitReviewedVote">
            <i class="bi bi-check2-circle"></i>
            Submit Vote
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("closeReviewVoteModal")?.addEventListener("click", closeReviewVoteModal);
    document.getElementById("backToVoting")?.addEventListener("click", closeReviewVoteModal);
    document.getElementById("submitReviewedVote")?.addEventListener("click", confirmReviewedVote);
  }

  renderReviewSelections();
  showModal(modal);
}

function renderReviewSelections() {
  const container = document.getElementById("reviewVoteBody");
  if (!container) return;

  const data = voterElectionState.data;
  if (!data || !data.positions) return;

  container.innerHTML = data.positions
    .map((position) => {
      const candidateId = voterElectionState.selections[position.name];
      const candidate = findCandidate(candidateId);

      if (!candidate) {
        return `
          <section class="review-position">
            <h3>${escapeHtml(position.name)}</h3>
            <div class="review-skipped">
              <i class="bi bi-dash-circle"></i>
              <span>Skipped</span>
            </div>
          </section>
        `;
      }

            const photo = candidate.photoImageUrl
              ? getProtectedFileUrl(candidate.photoImageUrl)
              : "/images/default-avatar.png";

      return `
        <section class="review-position">
          <h3>${escapeHtml(position.name)}</h3>
          <div class="review-candidate">
            <img src="${escapeHtml(photo)}" alt="${escapeHtml(candidate.fullName)}" class="review-candidate-image" />
            <div class="review-candidate-info">
              <strong>${escapeHtml(candidate.fullName)}</strong>
              <span>${escapeHtml(candidate.partylistName || "Independent")}</span>
            </div>
          </div>
        </section>
      `;
    })
    .join("");
}

function closeReviewVoteModal() {
  hideModal(document.getElementById("reviewVoteModal"));
}

function confirmReviewedVote() {
  closeReviewVoteModal();
  submitVotes();
}

/* =========================================================
   SUBMIT VOTES
   NOTE: still points at the placeholder endpoint — wiring the
   real submission API is the next step, not this one.
========================================================= */

async function submitVotes() {
  if (voterElectionState.submitting) return;

  voterElectionState.submitting = true;
  showLoadingModal();

  try {
    const data = voterElectionState.data;

    const votes = data.positions.map((position) => ({
      position: position.name,
      candidateId: voterElectionState.selections[position.name] || null,
      skipped: !voterElectionState.selections[position.name],
    }));

    const response = await fetch("/voter/api/elections/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ electionId: data.electionId, votes }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Failed to submit your vote.");
    }

    hideLoadingModal();
    voterElectionState.submitting = false;

    showVoteToast("success", "Vote Submitted", "Your vote has been successfully recorded.");

    voterElectionState.data.hasVoted = true;
    renderElectionContent();
  } catch (error) {
    console.error("Vote submission failed:", error);

    hideLoadingModal();
    voterElectionState.submitting = false;

    showVoteToast(
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

function showLoadingModal() {
  const modal = document.getElementById("actionLoadingModal");
  if (!modal) return;

  const title = document.getElementById("actionLoadingTitle");
  const message = document.getElementById("actionLoadingMessage");

  if (title) title.textContent = "Submitting Vote...";
  if (message) message.textContent = "Please wait while your vote is being submitted.";

  document.body.classList.add("modal-loading");
  showModal(modal);
}

function hideLoadingModal() {
  hideModal(document.getElementById("actionLoadingModal"));
  document.body.classList.remove("modal-loading");
}

/* =========================================================
   VOTE TOAST
========================================================= */

function showVoteToast(type, title, message) {
  let toast = document.getElementById("voteToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "voteToast";
    toast.className = "success-toast";

    toast.innerHTML = `
      <div class="success-toast-icon"><i id="voteToastIcon"></i></div>
      <div class="success-toast-content">
        <strong id="voteToastTitle"></strong>
        <span id="voteToastMessage"></span>
      </div>
      <button type="button" class="success-toast-close" id="voteToastClose" aria-label="Close notification">
        <i class="bi bi-x-lg"></i>
      </button>
    `;

    document.body.appendChild(toast);

    document.getElementById("voteToastClose")?.addEventListener("click", () => hideVoteToast());
  }

  const icon = document.getElementById("voteToastIcon");
  const titleElement = document.getElementById("voteToastTitle");
  const messageEl = document.getElementById("voteToastMessage");

  toast.classList.remove("success", "error", "warning");
  toast.classList.add(type);

  if (icon) {
    icon.className =
      type === "success" ? "bi bi-check-circle-fill"
      : type === "error" ? "bi bi-exclamation-circle-fill"
      : "bi bi-info-circle-fill";
  }

  if (titleElement) titleElement.textContent = title;
  if (messageEl) messageEl.textContent = message;

  requestAnimationFrame(() => toast.classList.add("show"));

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => hideVoteToast(), 4000);
}

function hideVoteToast() {
  const toast = document.getElementById("voteToast");
  if (!toast) return;
  toast.classList.remove("show");
}

/* =========================================================
   GLOBAL MODAL EVENTS
========================================================= */

function initializeGlobalModalEvents() {
  document.addEventListener("click", (event) => {
    const overlay = event.target.closest(".modal-overlay");
    if (!overlay) return;
    if (event.target !== overlay) return;
    if (overlay.id === "actionLoadingModal") return;
    hideModal(overlay);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const visibleModal = document.querySelector(".modal-overlay.show:not(.loading-modal-overlay)");
    if (!visibleModal) return;
    hideModal(visibleModal);
  });
}

function showModal(modal) {
  if (!modal) return;
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function hideModal(modal) {
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

/* =========================================================
   FIND CANDIDATE (in currently loaded data)
========================================================= */

function findCandidate(candidateId) {
  if (!candidateId || !voterElectionState.data) return null;

  for (const position of voterElectionState.data.positions || []) {
    const candidate = position.candidates.find((c) => c.id === candidateId);
    if (candidate) return candidate;
  }

  return null;
}

/* =========================================================
   FORMAT DATE/TIME
========================================================= */

function formatDateTime(isoString) {
  if (!isoString) return "";

  const date = new Date(isoString);

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
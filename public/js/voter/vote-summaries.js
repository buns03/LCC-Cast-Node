/* ==========================================================
   LCCAST — VOTE SUMMARIES
========================================================== */

let voteSummaries = [];

/* ==========================================================
   INITIALIZE
========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initializeSummaryTabs();
  loadVoteSummaries();
});

/* ==========================================================
   VOTE SUMMARY SKELETON
========================================================== */

function renderVoteSummarySkeleton() {
  const sscContainer = document.getElementById("sscSummary");
  const departmentContainer = document.getElementById("departmentSummary");

  if (sscContainer) {
    sscContainer.innerHTML = createVoteSummarySkeleton();
  }

  if (departmentContainer) {
    departmentContainer.innerHTML = createVoteSummarySkeleton();
  }
}

function createVoteSummarySkeleton() {
  return `
    <div class="vote-summary-skeleton">

      ${createVoteSummarySkeletonCard()}
      ${createVoteSummarySkeletonCard()}

    </div>
  `;
}

function createVoteSummarySkeletonCard() {
  return `
    <article class="vote-summary-skeleton-card">

      <!-- HEADER -->

      <div class="skeleton-summary-header">

        <div class="skeleton-summary-title">

          <div class="skeleton skeleton-summary-title-main"></div>

          <div class="skeleton skeleton-summary-reference"></div>

          <div class="skeleton skeleton-summary-date"></div>

        </div>

        <div class="skeleton-summary-actions">

          <div class="skeleton skeleton-summary-status"></div>

          <div class="skeleton skeleton-summary-button"></div>

        </div>

      </div>


      <!-- DETAILS -->

      <div class="skeleton-summary-details">

        <div>
          <div class="skeleton skeleton-summary-detail-label"></div>
          <div class="skeleton skeleton-summary-detail-value"></div>
        </div>

        <div>
          <div class="skeleton skeleton-summary-detail-label"></div>
          <div class="skeleton skeleton-summary-detail-value"></div>
        </div>

        <div>
          <div class="skeleton skeleton-summary-detail-label"></div>
          <div class="skeleton skeleton-summary-detail-value"></div>
        </div>

        <div>
          <div class="skeleton skeleton-summary-detail-label"></div>
          <div class="skeleton skeleton-summary-detail-value"></div>
        </div>

      </div>


      <!-- CANDIDATES -->

      <div>

        <div class="skeleton skeleton-candidates-title"></div>

        <div class="skeleton skeleton-candidates-description"></div>

        ${createSkeletonCandidateItem()}
        ${createSkeletonCandidateItem()}
        ${createSkeletonCandidateItem()}

      </div>

    </article>
  `;
}

function createSkeletonCandidateItem() {
  return `
    <div class="skeleton-candidate-item">

      <div class="skeleton skeleton-candidate-position"></div>

      <div class="skeleton skeleton-candidate-image"></div>

      <div class="skeleton-candidate-info">

        <div class="skeleton skeleton-candidate-name"></div>

        <div class="skeleton skeleton-candidate-party"></div>

      </div>

    </div>
  `;
}

async function loadVoteSummaries() {
  const sscContainer = document.getElementById("sscSummary");
  const departmentContainer = document.getElementById("departmentSummary");

  renderVoteSummarySkeleton();

  try {
    const data = await SoftCache.load("/voter/vote-summaries/data", {
      onRevalidated: (fresh) => {
        voteSummaries = Array.isArray(fresh) ? fresh.map(normalizeSummary) : [];
        renderVoteSummaries();
      },
    });

    voteSummaries = Array.isArray(data) ? data.map(normalizeSummary) : [];

    renderVoteSummaries();
  } catch (error) {
    console.error("Failed to load vote summaries:", error);

    if (sscContainer) {
      sscContainer.innerHTML = createEmptyState(
        "Unable to load vote summaries. Please try again later.",
      );
    }

    if (departmentContainer) {
      departmentContainer.innerHTML = createEmptyState(
        "Unable to load vote summaries. Please try again later.",
      );
    }
  }
}

/* ==========================================================
   NORMALIZE BACKEND DTO -> RENDER SHAPE
========================================================== */

function normalizeSummary(dto) {
  return {
    id: dto.id,
    type: dto.type,
    votingType: dto.votingType,
    referenceNumber: buildReferenceNumber(dto),
    electionTitle: dto.electionTitle,
    electionLabel: dto.electionLabel,
    campus: dto.campus,
    department: dto.department,
    votedAt: dto.votedAt,
    candidates: Array.isArray(dto.candidates)
      ? sortByPositionOrder(
          dto.candidates.map((c) => ({
            position: c.position,
            candidateName: c.candidateName,
            partylist: c.affiliationName,
            image: c.image,
          })),
          (c) => c.position,
        )
      : [],
  };
}

/* ==========================================================
   BUILD A DISPLAY REFERENCE NUMBER
   (backend doesn't send one — derive something stable from the ballot id)
========================================================== */

function buildReferenceNumber(dto) {
  if (!dto.id) {
    return "N/A";
  }

  const shortId = dto.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const prefix = dto.type === "ssc" ? "SSC" : "DEPT";

  return `VS-${prefix}-${shortId}`;
}

/* ==========================================================
   SUMMARY TABS
========================================================== */

function initializeSummaryTabs() {
  const tabs = document.querySelectorAll(".vote-summary-tab");

  const sections = document.querySelectorAll("[data-summary-section]");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.summary;

      /* REMOVE ACTIVE TAB */

      tabs.forEach((item) => {
        item.classList.remove("active");
      });

      /* ACTIVATE CLICKED TAB */

      tab.classList.add("active");

      /* SWITCH SECTION */

      sections.forEach((section) => {
        section.classList.toggle(
          "active",
          section.dataset.summarySection === target,
        );
      });
    });
  });
}

/* ==========================================================
   RENDER ALL VOTE SUMMARIES
========================================================== */

function renderVoteSummaries() {
  const sscContainer = document.getElementById("sscSummary");

  const departmentContainer = document.getElementById("departmentSummary");

  if (!sscContainer || !departmentContainer) {
    return;
  }

  /*
   * Remove the current hardcoded HTML summary cards.
   * JavaScript will render everything instead.
   */

  sscContainer.innerHTML = "";

  departmentContainer.innerHTML = "";

  /* ========================================================
     FILTER SUMMARIES
  ======================================================== */

  const sscSummaries = voteSummaries.filter(
    (summary) => summary.type === "ssc",
  );

  const departmentSummaries = voteSummaries.filter(
    (summary) => summary.type === "department",
  );

  /* ========================================================
     SSC
  ======================================================== */

  if (sscSummaries.length === 0) {
    sscContainer.innerHTML = createEmptyState("No SSC vote summaries found.");
  } else {
    sscSummaries.forEach((summary) => {
      sscContainer.insertAdjacentHTML("beforeend", createSummaryCard(summary));
    });
  }

  /* ========================================================
     DEPARTMENT
  ======================================================== */

  if (departmentSummaries.length === 0) {
    departmentContainer.innerHTML = createEmptyState(
      "No Department vote summaries found.",
    );
  } else {
    departmentSummaries.forEach((summary) => {
      departmentContainer.insertAdjacentHTML(
        "beforeend",
        createSummaryCard(summary),
      );
    });
  }

  /* BIND EXPORT BUTTONS */

  initializeExportButtons();
}

/* ==========================================================
   CREATE SUMMARY CARD
========================================================== */

function createSummaryCard(summary) {
  const votedDate = formatVoteDate(summary.votedAt);

  const votedTime = formatVoteTime(summary.votedAt);

  return `

    <article
      class="summary-card vote-record-card"
      data-summary-id="${escapeHtml(summary.id)}"
    >

      <!-- ===================================================
           SUMMARY HEADER
      ==================================================== -->

      <div class="summary-card-header">

        <div class="vote-summary-title">

            <h3>
                ${escapeHtml(summary.electionTitle)}
            </h3>

            <span class="vote-summary-reference">
                Ref. No. ${escapeHtml(summary.referenceNumber || "N/A")}
            </span>

            <p>
                Voted ${votedDate} at ${votedTime}
            </p>

            </div>


        <div class="vote-summary-header-actions">

          <span class="summary-status">
            Voted
          </span>

          <button
            type="button"
            class="secondary-btn export-summary-btn"
            data-summary-id="${escapeHtml(summary.id)}"
          >

            <i class="bi bi-download"></i>

            Export

          </button>

        </div>

      </div>


      <!-- ===================================================
           ELECTION INFORMATION
      ==================================================== -->

      <div class="summary-details">

        <div class="summary-detail">

          <span>
            Election
          </span>

          <strong>
            ${escapeHtml(summary.electionLabel)}
          </strong>

        </div>



        <div class="summary-detail">

          <span>
            Campus
          </span>

          <strong>
            ${escapeHtml(summary.campus)}
          </strong>

        </div>


        <div class="summary-detail">

          <span>
            Voting Date
          </span>

          <strong>
            ${votedDate}
          </strong>

        </div>


        <div class="summary-detail">

          <span>
            Time Voted
          </span>

          <strong>
            ${votedTime}
          </strong>

        </div>

      </div>


      <!-- ===================================================
           CANDIDATES VOTED
      ==================================================== -->

      <div class="voted-candidates-section">

        <div class="voted-candidates-header">

          <div>

            <h4>
              Candidates Voted
            </h4>

            <p>
              Candidates selected during this election.
            </p>

          </div>

        </div>


        <div class="voted-candidates-list">

          ${createCandidateList(summary.candidates)}

        </div>

      </div>

    </article>

  `;
}

/* ==========================================================
   CREATE CANDIDATE LIST
========================================================== */

function createCandidateList(candidates = []) {
  if (!candidates.length) {
    return `

      <div class="summary-empty-candidates">

        <i class="bi bi-person-x"></i>

        <p>
          No candidate information available.
        </p>

      </div>

    `;
  }

  return candidates.map((candidate) => createCandidateItem(candidate)).join("");
}

/* ==========================================================
   CREATE CANDIDATE ITEM
========================================================== */

function createCandidateItem(candidate) {
  const image = candidate.image || "/images/default-profile.png";

  const partylist = candidate.partylist || "Independent";

  return `

    <div class="voted-candidate-position">

      <!-- POSITION -->

      <div class="candidate-position-header">

        <span>
          ${escapeHtml(candidate.position)}
        </span>

      </div>


      <!-- CANDIDATE -->

      <div class="voted-candidate-card">

        <div class="voted-candidate-image image-loading">

          <img
            src="${escapeHtml(image)}"
            alt="${escapeHtml(candidate.candidateName)}"
            onload="this.parentElement.classList.remove('image-loading')"
            onerror="
              this.onerror = null;
              this.src = '/images/default-profile.png';
              this.parentElement.classList.remove('image-loading');
            "
          />

        </div>


        <div class="voted-candidate-info">

          <strong class="voted-candidate-name">
            ${escapeHtml(candidate.candidateName)}
          </strong>

          <span class="voted-candidate-partylist">

            <i class="bi bi-people"></i>

            ${escapeHtml(partylist)}

          </span>

        </div>

      </div>

    </div>

  `;
}

/* ==========================================================
   EMPTY STATE
========================================================== */

function createEmptyState(message) {
  return `
    <div class="election-instructions">
      <h3>No Voting Records</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/* ==========================================================
   EXPORT BUTTONS
========================================================== */

function initializeExportButtons() {
  document.querySelectorAll(".export-summary-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const summaryId = button.dataset.summaryId;

      const summary = voteSummaries.find((item) => item.id === summaryId);

      if (!summary) {
        return;
      }

      exportVoteSummary(summary);
    });
  });
}

/* ==========================================================
   EXPORT VOTE SUMMARY AS PDF
========================================================== */

async function exportVoteSummary(summary) {
  if (!summary) {
    return;
  }

  try {
    await loadPdfLibraries();

    if (!window.jspdf || !window.html2canvas) {
      throw new Error("PDF libraries are unavailable.");
    }

    const votedDate = formatVoteDate(summary.votedAt);

    const votedTime = formatVoteTime(summary.votedAt);

    /* ======================================================
       CREATE PDF CONTENT
    ====================================================== */

    const pdfContainer = document.createElement("div");

    pdfContainer.className = "vote-summary-pdf";

    pdfContainer.innerHTML = `

      <div class="pdf-header">

        <div class="pdf-system-brand">

            <img
            src="/images/lcccast_logo.png"
            alt="LCCAST Logo"
            class="pdf-system-logo"
            crossorigin="anonymous"
            />

            <div class="pdf-system-name">

            <h1>LCCAST</h1>

            <span>
                Ref. No. ${escapeHtml(summary.referenceNumber || "N/A")}
            </span>

            <span>
                Student Voting System
            </span>

            </div>

        </div>

        <h2>Vote Summary</h2>

    </div>


      <div class="pdf-election-info">

        <h3>
          ${escapeHtml(summary.electionTitle)}
        </h3>

        <div class="pdf-info-row">
          <strong>Election:</strong>
          <span>
            ${escapeHtml(summary.electionLabel)}
          </span>
        </div>

        <div class="pdf-info-row">
          <strong>Campus:</strong>
          <span>
            ${escapeHtml(summary.campus)}
          </span>
        </div>

        <div class="pdf-info-row">
          <strong>Voting Date:</strong>
          <span>
            ${escapeHtml(votedDate)}
          </span>
        </div>

        <div class="pdf-info-row">
          <strong>Time Voted:</strong>
          <span>
            ${escapeHtml(votedTime)}
          </span>
        </div>

      </div>


      <div class="pdf-candidates">

        <h3>
          Candidates Voted
        </h3>

        ${
          Array.isArray(summary.candidates)
            ? summary.candidates
                .map(
                  (candidate) => `

                <div class="pdf-candidate">

                  <div class="pdf-position">
                    ${escapeHtml(candidate.position)}
                  </div>

                  <div class="pdf-candidate-content">

                    <div class="pdf-candidate-image">

                      <img
                        src="${escapeHtml(
                          candidate.image || "/images/default-profile.png",
                        )}"
                        crossorigin="anonymous"
                      />

                    </div>

                    <div class="pdf-candidate-details">

                      <strong>
                        ${escapeHtml(candidate.candidateName)}
                      </strong>

                      <span>
                        ${escapeHtml(candidate.partylist || "Independent")}
                      </span>

                    </div>

                  </div>

                </div>

              `,
                )
                .join("")
            : ""
        }

      </div>

    `;

    /* ======================================================
       TEMPORARY PDF CONTAINER
    ====================================================== */

    Object.assign(pdfContainer.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "794px",
      background: "#FFFFFF",
      color: "#172033",
      fontFamily: "Arial, Helvetica, sans-serif",
      boxSizing: "border-box",
      zIndex: "-1",
    });

    document.body.appendChild(pdfContainer);

    /* ======================================================
       WAIT FOR IMAGES
    ====================================================== */

    const images = pdfContainer.querySelectorAll("img");

    await Promise.all(
      [...images].map((img) => {
        if (img.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }),
    );

    /* ======================================================
       CREATE CANVAS
    ====================================================== */

    const canvas = await window.html2canvas(pdfContainer, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
    });

    /* ======================================================
       CREATE PDF
    ====================================================== */

    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF("p", "mm", "a4");

    const pageWidth = pdf.internal.pageSize.getWidth();

    const pageHeight = pdf.internal.pageSize.getHeight();

    const margin = 10;

    const availableWidth = pageWidth - margin * 2;

    const imageHeight = (canvas.height * availableWidth) / canvas.width;

    const imgData = canvas.toDataURL("image/png");

    let heightLeft = imageHeight;

    let position = margin;

    /* ======================================================
       FIRST PAGE
    ====================================================== */

    pdf.addImage(imgData, "PNG", margin, position, availableWidth, imageHeight);

    heightLeft -= pageHeight - margin * 2;

    /* ======================================================
       ADDITIONAL PAGES
    ====================================================== */

    while (heightLeft > 0) {
      position = margin - (imageHeight - heightLeft);

      pdf.addPage();

      pdf.addImage(
        imgData,
        "PNG",
        margin,
        position,
        availableWidth,
        imageHeight,
      );

      heightLeft -= pageHeight - margin * 2;
    }

    /* ======================================================
       SAVE
    ====================================================== */

    pdf.save(createPdfFilename(summary));

    pdfContainer.remove();
  } catch (error) {
    console.error("PDF export failed:", error);

    const existing = document.querySelector(".vote-summary-pdf");

    if (existing) {
      existing.remove();
    }

    alert(
      "Unable to export the vote summary as PDF. Check the browser console for details.",
    );
  }
}

/* ==========================================================
   LOAD PDF LIBRARIES
========================================================== */

/* ==========================================================
   LOAD PDF LIBRARIES
========================================================== */

function loadPdfLibraries() {
  return new Promise((resolve, reject) => {
    if (window.jspdf && window.html2canvas) {
      resolve();
      return;
    }

    const existingJsPdf = document.querySelector(
      'script[data-pdf-library="jspdf"]',
    );

    const existingCanvas = document.querySelector(
      'script[data-pdf-library="html2canvas"]',
    );

    function loadCanvas() {
      if (window.html2canvas) {
        resolve();
        return;
      }

      if (existingCanvas) {
        existingCanvas.addEventListener("load", resolve, { once: true });

        existingCanvas.addEventListener("error", reject, { once: true });

        return;
      }

      const script = document.createElement("script");

      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

      script.dataset.pdfLibrary = "html2canvas";

      script.onload = resolve;

      script.onerror = reject;

      document.head.appendChild(script);
    }

    if (window.jspdf) {
      loadCanvas();
      return;
    }

    if (existingJsPdf) {
      existingJsPdf.addEventListener("load", loadCanvas, { once: true });

      existingJsPdf.addEventListener("error", reject, { once: true });

      return;
    }

    const script = document.createElement("script");

    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

    script.dataset.pdfLibrary = "jspdf";

    script.onload = loadCanvas;

    script.onerror = reject;

    document.head.appendChild(script);
  });
}

/* ==========================================================
   PDF FILENAME
========================================================== */

function createPdfFilename(summary) {
  const safeTitle = summary.electionTitle
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `${safeTitle}-vote-summary.pdf`;
}

/* ==========================================================
   CREATE EXPORT FILE NAME
========================================================== */

function createExportFilename(summary) {
  const safeTitle = summary.electionTitle
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `${safeTitle}-vote-summary.txt`;
}

/* ==========================================================
   DATE FORMAT
========================================================== */

function formatVoteDate(dateValue) {
  if (!dateValue) {
    return "N/A";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/* ==========================================================
   TIME FORMAT
========================================================== */

function formatVoteTime(dateValue) {
  if (!dateValue) {
    return "N/A";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/* ==========================================================
   ESCAPE HTML
========================================================== */

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

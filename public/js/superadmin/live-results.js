/* =========================================================
   LCCAST - LIVE RESULTS
   =========================================================

   Handles:

   - SSC / Department tab switching
   - Live SSC campus results
   - Live department results
   - Department filtering
   - Candidate rendering
   - Fullscreen campus/department viewing
   - Live polling
   - Backend-ready data structure

   Replace loadLiveResultsData() with the real backend API later.

========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeLiveResults();
});

/* Clean outline made of 16 hard shadows around the text (no -webkit-text-stroke) */
function buildTextOutline(radius, color) {
  const steps = 16;
  const shadows = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const x = (Math.cos(angle) * radius).toFixed(2);
    const y = (Math.sin(angle) * radius).toFixed(2);
    shadows.push(`${x}px ${y}px 0 ${color}`);
  }
  return shadows.join(", ");
}

async function buildPositionWinnerExportCard(
  positionName,
  candidates,
  options = {},
) {
  const {
    programCourse = null,
    campusName = "",
    electionType = "",
    rightLogo = "/images/lcccast_logo.png",
    electionStatus = "concluded",
    isDraw = false,
  } = options;

  const orderedCandidates = [...candidates].sort(
    (a, b) => Number(b.votes || 0) - Number(a.votes || 0),
  );
  const totalVotes = orderedCandidates.reduce(
    (total, c) => total + Number(c.votes || 0),
    0,
  );
  const topVotes = Number(orderedCandidates[0]?.votes || 0);

  const bgDataUrl = await cropBackgroundToDataURL(
    "/images/lcc_bg.png",
    1200,
    900,
  );
  const exportCard = buildExportCardBase(bgDataUrl);

  exportCard.appendChild(
    buildExportHeader({ programCourse, campusName, electionType, rightLogo }),
  );

  /* CONTENT — position title + candidate list, same shell as the winner card */
  const content = document.createElement("div");
  content.style.flex = "1";
  content.style.minHeight = "0";
  content.style.padding = "22px 55px 0";
  content.style.display = "flex";
  content.style.flexDirection = "column";

  const titleWrap = document.createElement("div");
  titleWrap.style.alignSelf = "center";
  titleWrap.style.marginBottom = "20px";
  titleWrap.style.textAlign = "center";
  titleWrap.innerHTML = `
        <h1 style="
            margin: 0;
            color: #FFFFFF;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 46px;
            font-weight: 900;
            letter-spacing: 1px;
            -webkit-text-stroke: 0;
            text-shadow:
                ${buildTextOutline(2.5, "#1E3A8A")},
                0 0 18px rgba(59, 91, 235, .65),
                0 0 34px rgba(59, 91, 235, .45);
        ">${escapeHTML(positionName)}</h1>
    `;
  content.appendChild(titleWrap);

  const list = document.createElement("div");
  list.className = "position-export-candidates";
  list.style.flex = "1";
  list.style.minHeight = "0";
  list.style.overflow = "hidden";

  list.innerHTML = orderedCandidates
    .map((candidate, index) => {
      const votes = Number(candidate.votes || 0);
      const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
      const isTop = votes === topVotes && topVotes > 0;
      const showLabel = isDraw ? isTop : index === 0;
      const labelText = isDraw
        ? "DRAW — NO OFFICIAL WINNER"
        : electionStatus === "concluded"
          ? "OFFICIAL WINNER"
          : "LEADING CANDIDATE";

      return `
            <div class="position-export-candidate ${!isDraw && index === 0 ? "is-leading" : ""}">
                ${
                  showLabel
                    ? `
                    <div class="position-export-leading-label">
                        <i class="bi bi-trophy-fill"></i>
                        ${labelText}
                    </div>`
                    : ""
                }
                <div class="position-export-candidate-photo">
                    <img src="${resolveCandidateImage(candidate.photo)}" alt="${escapeHTML(candidate.name || "Candidate")}">
                </div>
                <div class="position-export-candidate-info">
                    <h2>${escapeHTML(candidate.name || "Unknown Candidate")}</h2>
                    <p>${escapeHTML(candidate.partylist || "Independent")}</p>
                    <div class="position-export-candidate-stats">
                        <div>
                            <strong>${votes.toLocaleString()}</strong>
                            <span>VOTES</span>
                        </div>
                        <div>
                            <strong>${percentage.toFixed(1)}%</strong>
                            <span>VOTE SHARE</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    })
    .join("");

  list.querySelectorAll("img").forEach((image) => {
    image.onerror = () => {
      image.src = DEFAULT_CANDIDATE_IMAGE;
    };
  });

  content.appendChild(list);
  exportCard.appendChild(content);
  exportCard.appendChild(buildExportFooter());

  return exportCard;
}

function findCandidateInPositions(positions, positionLabel, name) {
  if (!positions) return null;
  const searchName = String(name).trim().toLowerCase();

  for (const [key, candidates] of Object.entries(positions)) {
    const standard = findStandardPosition(key);
    const label = standard ? standard.label : key;
    if (label !== positionLabel) continue;

    const candidate = (candidates || []).find(
      (item) => String(item.name).trim().toLowerCase() === searchName,
    );
    if (candidate) return candidate;
  }

  return null;
}

/* =========================================================
   GLOBAL STATE
========================================================= */

let liveResultsData = null;

const DEPARTMENT_LOGOS = {
  BSIS: "/images/IS_logo.png",
  BSBA: "/images/BA_logo.png",
  // add the rest of your programs here, e.g.:
  // "BSED": "/images/ED_logo.png",
  // "BSCRIM": "/images/CRIM_logo.png",
  // "BSHM": "/images/HM_logo.png",
};

const DEFAULT_DEPARTMENT_LOGO = "/images/dept_logo.png"; // fallback if code not in the map

function resolveDepartmentLogo(programCourse) {
  if (!programCourse) return DEFAULT_DEPARTMENT_LOGO;
  const code = String(programCourse).trim().toUpperCase();
  return DEPARTMENT_LOGOS[code] || DEFAULT_DEPARTMENT_LOGO;
}

/* =========================================================
   CREATE ANONYMOUS CANDIDATE DATA
========================================================= */

const DEFAULT_CANDIDATE_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="160"
            height="160"
            viewBox="0 0 160 160"
        >
            <rect
                width="160"
                height="160"
                rx="24"
                fill="#EEF0F5"
            />
            <circle
                cx="80"
                cy="57"
                r="27"
                fill="#9CA3AF"
            />
            <path
                d="M35 135c4-29 21-45 45-45s41 16 45 45"
                fill="#9CA3AF"
            />
        </svg>
    `);

function resolveCandidateImage(photoPath) {
  if (!photoPath) return DEFAULT_CANDIDATE_IMAGE;
  if (
    photoPath.startsWith("http://") ||
    photoPath.startsWith("https://") ||
    photoPath.startsWith("data:") ||
    photoPath.startsWith("/files/")
  ) {
    return photoPath;
  }
  return `/files/${photoPath}`;
}

/* =========================================================
   BACKGROUND CROP (exact 4:3, done in canvas — not CSS cover)
========================================================= */

function loadImageForExport(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function cropBackgroundToDataURL(src, targetWidth, targetHeight) {
  try {
    const img = await loadImageForExport(src);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");

    const targetRatio = targetWidth / targetHeight;
    const imgRatio = img.width / img.height;

    let sx, sy, sWidth, sHeight;

    if (imgRatio > targetRatio) {
      sHeight = img.height;
      sWidth = sHeight * targetRatio;
      sx = (img.width - sWidth) / 2;
      sy = 0;
    } else {
      sWidth = img.width;
      sHeight = sWidth / targetRatio;
      sx = 0;
      sy = (img.height - sHeight) / 2;
    }

    ctx.drawImage(
      img,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );
    return canvas.toDataURL("image/png");
  } catch (error) {
    console.error("Background crop failed, falling back to CSS cover:", error);
    return null;
  }
}

function buildExportHeader(options) {
  const {
    programCourse = null,
    campusName = "",
    electionType = "",
    rightLogo = "/images/lcccast_logo.png",
  } = options;

  const header = document.createElement("div");
  header.style.width = "100%";
  header.style.boxSizing = "border-box";
  header.style.flexShrink = "0";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "20px";
  header.style.padding = "20px 40px";
  header.style.background = "rgba(255,255,255,.97)";
  header.style.boxShadow = "0 4px 18px rgba(15,23,42,.18)";

  const leftLogo = document.createElement("img");
  leftLogo.src = "/images/lcccast_logo.png";
  leftLogo.style.width = "52px";
  leftLogo.style.height = "52px";
  leftLogo.style.objectFit = "contain";
  leftLogo.style.flexShrink = "0";
  leftLogo.onerror = () => {
    leftLogo.style.visibility = "hidden";
  };

  const titleBlock = document.createElement("div");
  titleBlock.style.flex = "1";
  titleBlock.style.textAlign = "center";

  const mainTitle = document.createElement("div");
  mainTitle.textContent = programCourse
    ? `${programCourse} ELECTION RESULTS`.toUpperCase()
    : "OFFICIAL ELECTION RESULTS";
  mainTitle.style.fontSize = "24px";
  mainTitle.style.fontWeight = "800";
  mainTitle.style.lineHeight = "1.15";
  mainTitle.style.letterSpacing = ".5px";

  const subtitleElement = document.createElement("div");
  subtitleElement.textContent = programCourse
    ? `${programCourse} - ${campusName} - ${electionType}`
    : `${campusName} - ${electionType}`;
  subtitleElement.style.marginTop = "5px";
  subtitleElement.style.fontSize = "12px";
  subtitleElement.style.color = "#6B7280";

  titleBlock.appendChild(mainTitle);
  titleBlock.appendChild(subtitleElement);

  const rightLogoImg = document.createElement("img");
  rightLogoImg.src = rightLogo;
  rightLogoImg.style.width = "52px";
  rightLogoImg.style.height = "52px";
  rightLogoImg.style.objectFit = "contain";
  rightLogoImg.style.flexShrink = "0";
  rightLogoImg.onerror = () => {
    rightLogoImg.style.visibility = "hidden";
  };

  header.appendChild(leftLogo);
  header.appendChild(titleBlock);
  header.appendChild(rightLogoImg);

  return header;
}

function buildExportCardBase(bgDataUrl) {
  const exportCard = document.createElement("div");
  exportCard.style.position = "fixed";
  exportCard.style.left = "-10000px";
  exportCard.style.top = "0";
  exportCard.style.width = "1200px";
  exportCard.style.height = "900px";
  exportCard.style.boxSizing = "border-box";
  exportCard.style.backgroundColor = "#FFFFFF";
  exportCard.style.backgroundImage = bgDataUrl
    ? `url("${bgDataUrl}")`
    : 'url("/images/lcc_bg.png")';
  exportCard.style.backgroundSize = "cover";
  exportCard.style.backgroundPosition = "center";
  exportCard.style.backgroundRepeat = "no-repeat";
  exportCard.style.fontFamily = "Arial, Helvetica, sans-serif";
  exportCard.style.color = "#202334";
  exportCard.style.overflow = "hidden";
  exportCard.style.display = "flex";
  exportCard.style.flexDirection = "column";
  return exportCard;
}

function buildExportFooter() {
  const footer = document.createElement("div");
  footer.textContent = "LCC Cast - Official Election Results";
  footer.style.flexShrink = "0";
  footer.style.textAlign = "center";
  footer.style.padding = "14px 0 20px";
  footer.style.fontSize = "11px";
  footer.style.fontWeight = "600";
  footer.style.color = "#FFFFFF";
  footer.style.textShadow = "0 1px 4px rgba(0,0,0,.45)";
  return footer;
}

let currentLiveSection = "ssc";

let previousVotes = {};

/* =========================================================
   CURRENT FILTER STATE
========================================================= */

let selectedSSCCampus = "ALL";

let selectedDepartmentCampus = "ALL";

let selectedDepartment = "ALL";

/* =========================================================
   ANONYMOUS CANDIDATE ORDER
========================================================= */

const anonymousCandidateOrder = new Map();

/* =========================================================
   POSITIONS
========================================================= */

const POSITIONS = [
  {
    key: "President",
    label: "President",
    aliases: ["president", "pres"],
  },

  {
    key: "VP",
    label: "Vice President",
    aliases: ["vp", "vicepresident", "vicepres"],
  },

  {
    key: "Secretary",
    label: "Secretary",
    aliases: ["secretary", "sec"],
  },

  {
    key: "Treasurer",
    label: "Treasurer",
    aliases: ["treasurer", "treas"],
  },

  {
    key: "Auditor",
    label: "Auditor",
    aliases: ["auditor", "audit"],
  },

  {
    key: "PRO Internal",
    label: "PRO Internal",
    aliases: ["prointernal", "internalpro", "proint", "prointl"],
  },

  {
    key: "PRO External",
    label: "PRO External",
    aliases: ["proexternal", "externalpro", "proext", "proextl"],
  },
];

function normalizePositionKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findStandardPosition(key) {
  const normalized = normalizePositionKey(key);

  return (
    POSITIONS.find(
      (position) =>
        normalizePositionKey(position.key) === normalized ||
        (position.aliases || []).includes(normalized),
    ) || null
  );
}

function getOrderedPositionKeys(positions) {
  const rank = (key) => {
    const standard = findStandardPosition(key);
    return standard ? POSITIONS.indexOf(standard) : POSITIONS.length;
  };

  return Object.keys(positions || {})
    .map((key, originalIndex) => ({ key, originalIndex }))
    .sort(
      (a, b) => rank(a.key) - rank(b.key) || a.originalIndex - b.originalIndex,
    )
    .map((item) => item.key);
}

function getPositionList(positions) {
  return getOrderedPositionKeys(positions).map((key) => {
    const standard = findStandardPosition(key);

    // keep the REAL key from the data so positions[key] still works
    return {
      key,
      label: standard ? standard.label : key,
    };
  });
}

//
///* =========================================================
//   CAMPUSES
//========================================================= */
//
//const CAMPUSES = {
//
//    college: {
//        key: "college",
//        name: "College"
//    },
//
//    muzon: {
//        key: "muzon",
//        name: "Muzon"
//    },
//
//};

/* =========================================================
   ELECTION STATUS
========================================================= */

function getElectionStatus(entity) {
  return String(entity?.phase || "UPCOMING").toLowerCase();
}

const STATUS_LABELS = {
  ongoing: "ONGOING",
  upcoming: "UPCOMING",
  concluded: "CONCLUDED",
  unscheduled: "SCHEDULE PENDING",
};

function getDrawPositions(entity) {
  return getElectionStatus(entity) === "concluded"
    ? entity?.drawPositions || []
    : [];
}
function drawBadgeHTML(entity) {
  return entity?.drawElection
    ? `<span class="draw-election-badge"><i class="bi bi-shuffle"></i> DRAW ELECTION</span>`
    : "";
}
function statusMessage(entity, status) {
  if (status === "unscheduled")
    return "Waiting for the voting schedule to be set.";
  if (status === "ongoing") return "Voting is currently in progress.";
  if (status === "concluded") {
    const draws = getDrawPositions(entity);
    return draws.length
      ? `${escapeHTML(entity.drawMessage || "Draw — no official winner yet.")} Tie-break needed for: ${draws.map((d) => escapeHTML(d)).join(", ")}.`
      : "Election officially concluded.";
  }
  return "Voting has not started yet.";
}

/* =========================================================
   SKELETON LOADING
========================================================= */

function buildSkeletonPositionColumn() {
  return `
        <div class="live-skeleton-column">
            <div class="skeleton live-skeleton-heading"></div>
            ${[0, 1]
              .map(
                () => `
                <div class="live-skeleton-candidate">
                    <div class="skeleton live-skeleton-avatar"></div>
                    <div class="live-skeleton-candidate-info">
                        <div class="skeleton live-skeleton-line" style="width:70%"></div>
                        <div class="skeleton live-skeleton-line" style="width:45%"></div>
                        <div class="skeleton live-skeleton-bar"></div>
                    </div>
                </div>
            `,
              )
              .join("")}
        </div>
    `;
}

function buildSkeletonEntityCard() {
  return `
        <article class="result-entity-container live-skeleton-card">
            <div class="result-entity-header">
                <div class="result-entity-identity">
                    <div class="skeleton live-skeleton-line" style="width:80px;height:10px;"></div>
                    <div class="skeleton live-skeleton-line" style="width:220px;height:24px;margin-top:8px;"></div>
                    <div class="skeleton live-skeleton-line" style="width:160px;height:14px;margin-top:8px;"></div>
                </div>
                <div class="result-entity-actions">
                    <div class="skeleton live-skeleton-line" style="width:70px;height:34px;"></div>
                </div>
            </div>
            <div class="result-entity-section voting-results-section">
                <div class="positions-grid">
                    ${[0, 1, 2, 3].map(buildSkeletonPositionColumn).join("")}
                </div>
            </div>
        </article>
    `;
}

function showLiveResultsSkeleton() {
  const sscContainer = document.getElementById("sscCampusResultsContainer");
  const deptContainer = document.getElementById("departmentLiveContainer");

  const skeletonHTML = [0, 1].map(buildSkeletonEntityCard).join("");

  if (sscContainer) sscContainer.innerHTML = skeletonHTML;
  if (deptContainer) deptContainer.innerHTML = skeletonHTML;
}

/* =========================================================
   INITIALIZE
========================================================= */

async function initializeLiveResults() {
  showLiveResultsSkeleton();

  liveResultsData = await loadLiveResultsData();

  populateLiveFilters();
  initializeTabs();

  initializeCampusFilters();

  initializeDepartmentFilter();

  initializeFullscreenButtons();

  renderLiveResults();

  connectLiveResultsSocket();
}

async function loadLiveResultsData() {
  return SoftCache.load("/superadmin/live-results/data", {
    ttl: 10000,
    onRevalidated: (fresh) => {
      liveResultsData = fresh;
      updateLiveVotesInPlace(fresh);
    },
  });
}

let stompClient = null;

function connectLiveResultsSocket() {
  const socket = new SockJS("/ws-analytics");
  stompClient = Stomp.over(socket);
  stompClient.debug = () => {};
  stompClient.connect({}, () => {
    stompClient.subscribe("/topic/live-results", (message) => {
      liveResultsData = JSON.parse(message.body);
      updateLiveVotesInPlace(liveResultsData);
      updateLastUpdated();
    });
  });
}

/* =========================================================
   UPDATE LIVE VOTES IN PLACE (no re-render, no scroll jump)
========================================================= */

function hasStaleCards(entities, prefix, containerId) {
  const liveIds = new Set(entities.map((e) => `${prefix}-${e.id}`));

  return [
    ...document.querySelectorAll(
      `#${containerId} > .result-entity-container[id]`,
    ),
  ].some((card) => !liveIds.has(card.id));
}

function updateLiveVotesInPlace(newData) {
  const ssc = newData?.ssc || [];
  const departments = newData?.departments || [];

  // An election was archived/deleted: its card is no longer in the payload
  const stale =
    hasStaleCards(ssc, "campus", "sscCampusResultsContainer") ||
    hasStaleCards(departments, "department", "departmentLiveContainer");

  if (stale) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    renderLiveResults();
    return;
  }

  updateEntityGroupInPlace(ssc, "campus");
  updateEntityGroupInPlace(departments, "department");
}

function updateEntityGroupInPlace(entities, prefix) {
  entities.forEach((entity) => {
    const cardId = `${prefix}-${entity.id}`;
    const card = document.getElementById(cardId);

    if (!card) {
      if (document.fullscreenElement) return;
      renderLiveResults();
      return;
    }

    if (!entityChanged(cardId, entity)) return;

    const newCard =
      prefix === "department"
        ? createDepartmentCard(entity.name || entity.id, entity)
        : createCampusResultCard(entity.id, entity); // not used in admin-dept, only "department" runs there

    swapCardContents(card, newCard);
  });
}

/* =========================================================
   TABS
========================================================= */

function initializeTabs() {
  const tabs = document.querySelectorAll(".live-results-tab");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const section = tab.dataset.section;

      currentLiveSection = section;

      tabs.forEach((item) => {
        item.classList.remove("active");
      });

      tab.classList.add("active");

      document
        .getElementById("sscLiveSection")
        ?.classList.toggle("active", section === "ssc");

      document
        .getElementById("departmentLiveSection")
        ?.classList.toggle("active", section === "department");
    });
  });
}

/* =========================================================
   CAMPUS FILTERS
========================================================= */

/* =========================================================
   CAMPUS FILTERS
========================================================= */

function initializeCampusFilters() {
  const sscFilter = document.getElementById("sscCampusFilter");

  const departmentCampusFilter = document.getElementById(
    "departmentCampusFilter",
  );

  if (sscFilter) {
    selectedSSCCampus = sscFilter.value || "ALL";

    sscFilter.addEventListener("change", (event) => {
      selectedSSCCampus = event.target.value;

      renderSSC(selectedSSCCampus);
    });
  }

  if (departmentCampusFilter) {
    selectedDepartmentCampus = departmentCampusFilter.value || "ALL";

    departmentCampusFilter.addEventListener("change", (event) => {
      selectedDepartmentCampus = event.target.value;

      renderDepartments(selectedDepartment, selectedDepartmentCampus);
    });
  }
}

function populateLiveFilters() {
  const sscFilter = document.getElementById("sscCampusFilter");
  const deptCampusFilter = document.getElementById("departmentCampusFilter");
  const deptFilter = document.getElementById("liveDepartmentFilter");

  if (sscFilter) {
    sscFilter.innerHTML = `<option value="ALL">All Campuses</option>`;
    (liveResultsData?.ssc || []).forEach((c) => {
      sscFilter.innerHTML += `<option value="${c.campusId}">${escapeHTML(c.campusName)}</option>`;
    });
  }

  if (deptCampusFilter) {
    deptCampusFilter.innerHTML = `<option value="ALL">All Campuses</option>`;
    const seen = new Set();
    (liveResultsData?.departments || []).forEach((d) => {
      if (!seen.has(d.campusId)) {
        seen.add(d.campusId);
        deptCampusFilter.innerHTML += `<option value="${d.campusId}">${escapeHTML(d.campusName)}</option>`;
      }
    });
  }

  if (deptFilter) {
    deptFilter.innerHTML = `<option value="ALL">All Departments</option>`;
    const seenKeys = new Set();
    (liveResultsData?.departments || []).forEach((d) => {
      if (seenKeys.has(d.key)) return;
      seenKeys.add(d.key);
      deptFilter.innerHTML += `<option value="${d.key}">${escapeHTML(d.name)}</option>`;
    });
  }
}

/* =========================================================
   DEPARTMENT FILTER
========================================================= */

function initializeDepartmentFilter() {
  const filter = document.getElementById("liveDepartmentFilter");

  if (!filter) return;

  selectedDepartment = filter.value || "ALL";

  filter.addEventListener("change", (event) => {
    selectedDepartment = event.target.value;

    renderDepartments(selectedDepartment, selectedDepartmentCampus);
  });
}

/* =========================================================
   ROW REORDER ANIMATION (FLIP)
   Remembers where every candidate row was, rebuilds the card,
   then slides each row from its old spot to its new one.
========================================================= */

const lastCardSignature = new Map();

/* false when the data for this card did not change at all */
function entityChanged(cardId, entity) {
  const signature = JSON.stringify(entity);
  if (lastCardSignature.get(cardId) === signature) return false;
  lastCardSignature.set(cardId, signature);
  return true;
}

function captureRowPositions(root) {
  const map = new Map();
  root.querySelectorAll(".live-candidate[data-candidate-id]").forEach((row) => {
    map.set(
      `${row.dataset.positionId}|${row.dataset.candidateId}`,
      row.getBoundingClientRect().top,
    );
  });
  return map;
}

function playRowAnimation(root, before) {
  root.querySelectorAll(".live-candidate[data-candidate-id]").forEach((row) => {
    const key = `${row.dataset.positionId}|${row.dataset.candidateId}`;
    const previousTop = before.get(key);

    // new row in this position: fade it in
    if (previousTop === undefined) {
      if (before.size) row.classList.add("row-enter");
      return;
    }

    const distance = previousTop - row.getBoundingClientRect().top;
    if (Math.abs(distance) < 1) return;

    row.classList.add("is-moving");
    row.style.transition = "none";
    row.style.transform = `translateY(${distance}px)`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        row.style.transition = "transform .6s cubic-bezier(.22, 1, .36, 1)";
        row.style.transform = "";
      });
    });

    row.addEventListener(
      "transitionend",
      () => {
        row.style.transition = "";
        row.classList.remove("is-moving");
      },
      { once: true },
    );
  });
}

/* replaces the children of `card` with those of `newCard`, animated.
   Moving the nodes (not innerHTML) keeps the click listeners. */
function swapCardContents(card, newCard) {
  const before = captureRowPositions(card);

  while (card.firstChild) card.removeChild(card.firstChild);
  while (newCard.firstChild) card.appendChild(newCard.firstChild);

  playRowAnimation(card, before);
}

/* =========================================================
   FULLSCREEN BUTTONS
========================================================= */

function initializeFullscreenButtons() {
  /*
       Event delegation.

       This works even for fullscreen
       buttons created dynamically after
       the page has loaded.
    */

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-fullscreen]");

    if (!button) return;

    const targetId = button.dataset.fullscreen;

    const target = document.getElementById(targetId);

    if (!target) {
      console.error("Fullscreen target not found:", targetId);

      return;
    }

    await enterFullscreen(target);
  });

  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButtons();
  });
}

/* =========================================================
   ENTER FULLSCREEN
========================================================= */

async function enterFullscreen(element) {
  try {
    if (document.fullscreenElement === element) {
      await document.exitFullscreen();

      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }

    await element.requestFullscreen();
  } catch (error) {
    console.error("Fullscreen error:", error);
  }
}

/* =========================================================
   UPDATE FULLSCREEN BUTTON TEXT
========================================================= */

function updateFullscreenButtons() {
  const fullscreenElement = document.fullscreenElement;

  document.querySelectorAll("[data-fullscreen]").forEach((button) => {
    const target = document.getElementById(button.dataset.fullscreen);

    const icon = button.querySelector("i");

    const text = button.querySelector("span");

    if (fullscreenElement === target) {
      if (icon) {
        icon.className = "bi bi-fullscreen-exit";
      }

      if (text) {
        text.textContent = "Exit Fullscreen";
      }
    } else {
      if (icon) {
        icon.className = "bi bi-fullscreen";
      }

      if (text) {
        text.textContent = "Fullscreen";
      }
    }
  });
}

/* =========================================================
   RENDER EVERYTHING
========================================================= */

function renderLiveResults(options = {}) {
  const sscSection = document.getElementById("sscLiveSection");

  const departmentSection = document.getElementById("departmentLiveSection");

  sscSection.style.display = "";

  departmentSection.style.display = "";

  renderSSC(document.getElementById("sscCampusFilter")?.value || "ALL");

  renderDepartments(
    document.getElementById("liveDepartmentFilter")?.value || "ALL",

    document.getElementById("departmentCampusFilter")?.value || "ALL",
  );

  updateLastUpdated();
}

/* =========================================================
   SSC
========================================================= */

function renderSSC(selectedCampus = "ALL") {
  const elections = liveResultsData?.ssc || [];

  const container = document.getElementById("sscCampusResultsContainer");

  if (!container) return;

  container.innerHTML = "";

  const visibleElections = elections.filter(
    (election) =>
      selectedCampus === "ALL" || selectedCampus === election.campusId,
  );

  visibleElections.forEach((election) => {
    container.appendChild(
      createCampusResultCard(election.id, {
        ...election,
        id: election.id,
        campusName: election.campusName,
        totalVotes: election.votesCast,
      }),
    );
  });

  if (visibleElections.length === 0) {
    container.innerHTML = `

            <div class="department-filter-empty">

                <div class="live-empty-icon">
                    <i class="bi bi-search"></i>
                </div>

                <h3>
                    No SSC Election
                </h3>

                <p>
                    There is no visible SSC election
                    for this campus right now.
                </p>

            </div>

        `;
  }

  updateElement(
    "sscLiveVotes",
    elections.reduce(
      (total, election) => total + Number(election.votesCast || 0),
      0,
    ),
  );
}

/* =========================================================
   CALCULATE CAMPUS VOTES
========================================================= */

function calculateCampusVotes(campuses) {
  return (campuses || []).reduce(
    (total, campus) => total + Number(campus.votesCast || 0),
    0,
  );
}

/* =========================================================
   CREATE CAMPUS RESULT CARD
========================================================= */

function createCampusResultCard(campusKey, campus) {
  const card = document.createElement("article");

  const cardId = `campus-${campusKey}`;

  card.id = cardId;
  card.className = "result-entity-container";

  const electionStatus = getElectionStatus(campus);

  const statusLabel = STATUS_LABELS[electionStatus] || "UPCOMING";

  const campusName = campus.campusName || "Campus";
  const electionTitle = campus.name || "SSC Election";
  const votesCast = Number(campus.votesCast ?? campus.totalVotes ?? 0);
  const drawPositions = getDrawPositions(campus);

  card.innerHTML = `

        <div class="result-entity-header">

            <div class="result-entity-identity">

                <span class="result-entity-label">
                    CAMPUS
                </span>

                                <div class="result-entity-title-row">
                                    <h2>${escapeHTML(campusName)}</h2>
                                    <span class="election-status status-${electionStatus}">${statusLabel}</span>
                                    ${drawBadgeHTML(campus)}
                                </div>

                <p>
                    <strong>${escapeHTML(electionTitle)}</strong><br>

                    ${statusMessage(campus, electionStatus)}
                </p>

            </div>

            <div class="result-entity-actions">

                <div class="campus-votes">

                    <span>Votes Cast</span>

                    <strong id="${cardId}-votes-cast">
                        ${votesCast}
                    </strong>

                </div>

                ${
                  electionStatus === "ongoing"
                    ? `
                <button
                    type="button"
                    class="fullscreen-btn"
                    data-fullscreen="${cardId}"
                    title="Fullscreen ${escapeHTML(campusName)}"
                >
                    <i class="bi bi-fullscreen"></i>
                    <span>Fullscreen</span>
                </button>`
                    : ""
                }

            </div>

        </div>


        <div
            class="result-entity-section winner-section"
            id="${cardId}-winner-section"
        ></div>


        <div
            class="result-entity-section position-winner-section"
            id="${cardId}-position-section"
        ></div>


        <div class="result-entity-section voting-results-section">

            <div class="result-entity-section-heading">

                <div>

                    <span>
                        <i class="bi bi-bar-chart-fill"></i>
                        VOTING RESULTS
                    </span>

                    <p>
                        Live results for every position
                    </p>

                </div>

            </div>

            <div
                class="positions-grid"
                id="${cardId}-results"
            ></div>

        </div>

    `;

  /* =========================================================
       WINNER CONTENT
    ========================================================= */

  if (electionStatus === "concluded") {
    const winnerContainer = card.querySelector(`#${cardId}-winner-section`);

    const winnerSection = document.createElement("section");

    winnerSection.className = "winner-card";

    winnerSection.innerHTML = `

            <div class="winner-card-header">

                <div>

                    <span class="result-section-label">

                        <i class="bi bi-trophy-fill"></i>

                        WINNER CARD

                    </span>

                    <h3>
                        ${escapeHTML(campusName)}
                    </h3>

                    <p>
                        Official winners for this election
                    </p>

                </div>

                <button
                    type="button"
                    class="download-winner-btn"
                    data-download-winners="${cardId}-winner"
                >

                    <i class="bi bi-download"></i>

                    Download PNG

                </button>

            </div>


            <div
                class="winner-card-content"
                id="${cardId}-winner"
            >

                <div class="winner-card-title">

                    <span>
                        Campus
                    </span>

                    <strong>
                        ${escapeHTML(campusName)} Winners!
                    </strong>

                </div>

                <div class="winner-list"></div>

            </div>

        `;

    winnerContainer.appendChild(winnerSection);

    renderWinnerList(
      winnerSection.querySelector(".winner-list"),
      campus.positions,
      drawPositions,
    );

    /* =====================================================
           POSITION WINNER CARDS
        ====================================================== */

    const positionContainer = card.querySelector(`#${cardId}-position-section`);

    const positionSection = document.createElement("section");

    positionSection.className = "position-winners-section";

    positionSection.innerHTML = `

            <div class="position-winners-header">

                <div>

                    <span>
                        WINNER POSITION CARDS
                    </span>

                    <h3>
                        Position Results
                    </h3>

                    <p>
                        Downloadable result cards for each position
                    </p>

                </div>

            </div>

            <div class="position-winners-grid"></div>

        `;

    positionContainer.appendChild(positionSection);

    renderPositionWinnerCards(
      positionSection.querySelector(".position-winners-grid"),
      campus.positions,
      `ssc-${campusKey}`,
      {
        campusName: campusName,
        electionType: "Supreme Student Council",
        rightLogo: "/images/ssc_logo.png",
        positions: campus.positions,
        drawPositions: drawPositions,
      },
    );

    /* =====================================================
           DOWNLOAD WINNER CARD
        ====================================================== */

    const downloadButton = winnerSection.querySelector(
      "[data-download-winners]",
    );

    downloadButton?.addEventListener("click", () => {
      downloadWinnerCard(winnerSection.querySelector(".winner-card-content"), {
        campusName: campusName,
        electionType: "Supreme Student Council",
        rightLogo: "/images/ssc_logo.png",
        positions: campus.positions,
      });
    });
  } else {
    card.querySelector(`#${cardId}-winner-section`)?.remove();

    card.querySelector(`#${cardId}-position-section`)?.remove();
  }

  /* =========================================================
       LIVE VOTING RESULTS
    ========================================================= */

  renderPositionsGrid(
    card.querySelector(".positions-grid"),
    campus.positions,
    campusKey,
    false,
    drawPositions,
  );

  return card;
}

/* =========================================================
   RENDER WINNERS
========================================================= */

function renderWinnerList(container, positions, drawPositions = []) {
  if (!container) return;
  container.innerHTML = "";

  getPositionList(positions).forEach((position) => {
    const candidates = positions?.[position.key] || [];
    if (!candidates.length) return;

    const sorted = [...candidates].sort(
      (a, b) => Number(b.votes || 0) - Number(a.votes || 0),
    );

    if (drawPositions.includes(position.key)) {
      const top = Number(sorted[0].votes || 0);
      const tied = sorted.filter((c) => Number(c.votes || 0) === top);
      const draw = document.createElement("div");
      draw.className = "draw-item"; // not "winner-item", so the PNG export skips it
      draw.innerHTML = `
                <div class="winner-item-info">
                    <span>${escapeHTML(position.label)}</span>
                    <strong>DRAW — no official winner yet</strong>
                    <small>${tied.map((c) => escapeHTML(c.name)).join(" vs ")} · ${top} vote${top === 1 ? "" : "s"} each</small>
                </div>`;
      container.appendChild(draw);
      return;
    }

    const winner = sorted[0];
    const item = document.createElement("div");
    item.className = "winner-item";
    item.innerHTML = `
            <img src="${resolveCandidateImage(winner.photo)}" alt="${escapeHTML(winner.name)}">
            <div class="winner-item-info">
                <span>${escapeHTML(position.label)}</span>
                <strong>${escapeHTML(winner.name)}</strong>
            </div>
            <div class="winner-item-votes">
                <strong>${Number(winner.votes || 0)}</strong>
                <span>Votes</span>
            </div>`;
    const image = item.querySelector("img");
    image.onerror = () => {
      image.src = DEFAULT_CANDIDATE_IMAGE;
    };
    container.appendChild(item);
  });
}

function renderPositionWinnerCards(
  container,
  positions,
  exportPrefix,
  cardOptions = {},
) {
  if (!container) return;

  container.innerHTML = "";

  getPositionList(positions).forEach((position) => {
    const candidates = positions?.[position.key] || [];

    if (!candidates.length) {
      return;
    }

    const isDraw = (cardOptions.drawPositions || []).includes(position.key);

    /*
           Highest voter is always first.
        */
    const orderedCandidates = [...candidates].sort(
      (a, b) => Number(b.votes || 0) - Number(a.votes || 0),
    );

    const totalVotes = orderedCandidates.reduce(
      (total, candidate) => total + Number(candidate.votes || 0),
      0,
    );

    const positionCard = document.createElement("article");

    positionCard.className = "position-winner-card";

    positionCard.innerHTML = `

            <div class="position-winner-card-header">

                <div>
                    <span>
                        Position
                    </span>

                       <h3>${escapeHTML(position.label)} ${isDraw ? '<span class="draw-chip">DRAW</span>' : ""}</h3>
                </div>

                <button
                    type="button"
                    class="download-position-btn"
                    title="Download ${escapeHTML(position.label)} PNG"
                >
                    <i class="bi bi-download"></i>
                    PNG
                </button>

            </div>

            <div class="position-winner-card-content">

                <div class="position-winner-list"></div>

            </div>

        `;

    const list = positionCard.querySelector(".position-winner-list");

    orderedCandidates.forEach((candidate) => {
      const votes = Number(candidate.votes || 0);

      const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;

      const item = document.createElement("div");

      item.className = "position-winner-candidate";

      item.innerHTML = `

                    <img
                        src="${resolveCandidateImage(candidate.photo)}"
                        alt="${escapeHTML(candidate.name)}"
                    >

                    <div class="position-winner-info">

                        <strong>
                            ${escapeHTML(candidate.name || "Unknown Candidate")}
                        </strong>

                        <span>
                            ${escapeHTML(candidate.partylist || "Independent")}
                        </span>

                        <div class="position-winner-progress">

                            <div
                                class="position-winner-progress-track"
                            >
                                <div
                                    class="position-winner-progress-bar"
                                    style="width:${percentage}%"
                                ></div>
                            </div>

                            <strong>
                                ${percentage.toFixed(1)}%
                            </strong>

                        </div>

                        <small>
                            ${votes}
                            vote${votes === 1 ? "" : "s"}
                        </small>

                    </div>

                `;

      const image = item.querySelector("img");

      image.onerror = () => {
        image.src = DEFAULT_CANDIDATE_IMAGE;
      };

      list.appendChild(item);
    });

    const downloadButton = positionCard.querySelector(".download-position-btn");

    downloadButton?.addEventListener("click", () => {
      downloadPositionWinnerCard(
        position.label,
        exportPrefix,
        orderedCandidates,
        { ...cardOptions, isDraw },
      );
    });

    container.appendChild(positionCard);
  });
}
/* =========================================================
   RENDER POSITIONS GRID
========================================================= */

function renderPositionsGrid(
  container,
  positions,
  campusKey,
  isAnonymous = false,
  drawPositions = [],
  limit = null,
) {
  if (!container) return;
  container.innerHTML = "";

  getPositionList(positions).forEach((position) => {
    const ordered = getDisplayCandidates(
      positions?.[position.key] || [],
      isAnonymous,
      `${campusKey}-${position.key}`,
    );
    const display = isAnonymous
      ? ordered.map((c, i) => createAnonymousCandidate(c, i))
      : ordered;

    container.appendChild(
      createPositionColumn(
        position,
        display,
        `${campusKey}-${position.key}`,
        isAnonymous,
        drawPositions.includes(position.key),
        limit,
      ),
    );
  });
}

/* =========================================================
   DEPARTMENT
========================================================= */

function renderDepartments(
  departmentFilter = selectedDepartment,
  campusFilter = selectedDepartmentCampus,
) {
  const container = document.getElementById("departmentLiveContainer");

  if (!container) return;

  const departments = liveResultsData?.departments || [];

  selectedDepartment = departmentFilter || "ALL";

  selectedDepartmentCampus = campusFilter || "ALL";

  const filteredDepartments = departments.filter((department) => {
    if (selectedDepartment !== "ALL" && department.key !== selectedDepartment) {
      return false;
    }

    if (
      selectedDepartmentCampus !== "ALL" &&
      department.campusId !== selectedDepartmentCampus
    ) {
      return false;
    }

    return true;
  });

  container.innerHTML = "";

  filteredDepartments.forEach((department) => {
    container.appendChild(
      createDepartmentCard(department.name || department.id, department),
    );
  });

  if (filteredDepartments.length === 0) {
    container.innerHTML = `

            <div class="department-filter-empty">

                <div class="live-empty-icon">

                    <i class="bi bi-search"></i>

                </div>

                <h3>
                    No Department Results
                </h3>

                <p>
                    No department election matches the
                    selected campus and department.
                </p>

            </div>

        `;
  }

  const totalVotes = filteredDepartments.reduce(
    (total, department) => total + Number(department.votesCast || 0),
    0,
  );

  updateElement("departmentLiveVotes", totalVotes);
}

/* =========================================================
   CREATE DEPARTMENT CARD
========================================================= */

function createDepartmentCard(departmentCode, department) {
  const card = document.createElement("article");

  const cardId = `department-${department.id}`;

  card.id = cardId;

  card.className = "result-entity-container department-entity-container";

  const departmentName = department.name || departmentCode;
  const departmentTitle = department.title || "";
  const campusName = department.campusName || "Campus Not Assigned";

  const electionStatus = getElectionStatus(department);

  const statusLabel = STATUS_LABELS[electionStatus] || "UPCOMING";
  const drawPositions = getDrawPositions(department);

  card.innerHTML = `

        <!-- =====================================================
             IDENTITY
        ====================================================== -->

        <div class="result-entity-header">

            <div class="result-entity-identity">

                <span class="result-entity-label">
                    DEPARTMENT
                </span>


                                <div class="result-entity-title-row">
                                    <h2>${escapeHTML(departmentName)}</h2>
                                    <span class="election-status status-${electionStatus}">${statusLabel}</span>
                                    ${drawBadgeHTML(department)}
                                </div>


                <h3 class="result-entity-subtitle">

                     ${escapeHTML(departmentTitle)}

                </h3>


                <p>

                    <i class="bi bi-building"></i>

                    ${escapeHTML(campusName)}

                    Campus

                </p>

                ${
                  electionStatus === "unscheduled" ||
                  getDrawPositions(department).length
                    ? `<p>${statusMessage(department, electionStatus)}</p>`
                    : ""
                }

            </div>


            <div class="result-entity-actions">

                <div class="campus-votes">

                    <span>
                        Votes Cast
                    </span>

                    <strong id="${cardId}-votes-cast">${Number(department.votesCast || 0)}</strong>

                </div>


                ${
                  electionStatus === "ongoing"
                    ? `
                <button
                    type="button"
                    class="fullscreen-btn"
                    data-fullscreen="${cardId}"
                >
                    <i class="bi bi-fullscreen"></i>
                    <span>Fullscreen</span>
                </button>`
                    : ""
                }

            </div>

        </div>


        <!-- =====================================================
             WINNER CARD
        ====================================================== -->

        <div
            class="result-entity-section winner-section"
            id="${cardId}-winner-section"
        ></div>


        <!-- =====================================================
             POSITION WINNER CARDS
        ====================================================== -->

        <div
            class="result-entity-section position-winner-section"
            id="${cardId}-position-section"
        ></div>


        <!-- =====================================================
             VOTING RESULTS
        ====================================================== -->

        <div class="result-entity-section voting-results-section">

            <div class="result-entity-section-heading">

                <div>

                    <span>

                        <i class="bi bi-bar-chart-fill"></i>

                        VOTING RESULTS

                    </span>


                    <p>
                        Results for every department position
                    </p>

                </div>

            </div>


            <div
                class="positions-grid"
                id="${cardId}-results"
            ></div>

        </div>

    `;

  /* =========================================================
       WINNER CONTENT
    ========================================================= */

  if (electionStatus === "concluded") {
    const winnerContainer = card.querySelector(`#${cardId}-winner-section`);

    const winnerSection = document.createElement("section");

    winnerSection.className = "winner-card department-winner-card";

    winnerSection.innerHTML = `

            <div class="winner-card-header">

                <div>

                    <span class="result-section-label">

                        <i class="bi bi-trophy-fill"></i>

                        WINNER CARD

                    </span>


                    <h3>
                        ${escapeHTML(departmentCode)}
                    </h3>


                    <p>

                        ${escapeHTML(departmentName)}

                    </p>

                </div>


                <button
                    type="button"
                    class="download-winner-btn"
                    data-download-winners="${cardId}-winner"
                >

                    <i class="bi bi-download"></i>

                    Download PNG

                </button>

            </div>


            <div
                class="winner-card-content"
                id="${cardId}-winner"
            >

                <div class="winner-card-title">

                    <span>
                        Department
                    </span>


                    <strong>

                        ${escapeHTML(departmentCode)}

                        Winners!

                    </strong>

                </div>


                <div class="winner-list"></div>

            </div>

        `;

    winnerContainer.appendChild(winnerSection);

    renderWinnerList(
      winnerSection.querySelector(".winner-list"),
      department.positions,
      drawPositions,
    );

    /* =====================================================
           POSITION WINNER CARDS
        ====================================================== */

    const positionContainer = card.querySelector(`#${cardId}-position-section`);

    const positionSection = document.createElement("section");

    positionSection.className = "position-winners-section";

    positionSection.innerHTML = `

            <div class="position-winners-header">

                <div>

                    <span>
                        WINNER POSITION CARDS
                    </span>


                    <h3>
                        ${escapeHTML(departmentCode)}
                        Position Results
                    </h3>


                    <p>
                        Downloadable result cards for each position
                    </p>

                </div>

            </div>


            <div
                class="position-winners-grid"
            ></div>

        `;

    positionContainer.appendChild(positionSection);

    renderPositionWinnerCards(
      positionSection.querySelector(".position-winners-grid"),
      department.positions,
      `department-${departmentCode}`,
      {
        programCourse: departmentName,
        campusName: campusName,
        electionType: "Departmental Election",
        rightLogo: resolveDepartmentLogo(departmentName),
        positions: department.positions,
        isRepresentative: department.votingType === "REPRESENTATIVE",
        drawPositions: drawPositions,
      },
    );

    const downloadButton = winnerSection.querySelector(
      "[data-download-winners]",
    );

    downloadButton?.addEventListener("click", () => {
      downloadWinnerCard(winnerSection.querySelector(".winner-card-content"), {
        programCourse: departmentName,
        campusName: campusName,
        electionType: "Departmental Election",
        rightLogo: resolveDepartmentLogo(departmentName),
        positions: department.positions, // ADD
        isRepresentative: department.votingType === "REPRESENTATIVE", // ADD
      });
    });
  } else {
    card.querySelector(`#${cardId}-winner-section`)?.remove();

    card.querySelector(`#${cardId}-position-section`)?.remove();
  }

  /* =========================================================
       VOTING RESULTS
    ========================================================= */

  renderPositionsGrid(
    card.querySelector(".positions-grid"),
    department.positions,
    departmentCode,
    false,
    drawPositions,
    department.votingType === "REPRESENTATIVE" ? 3 : null,
  );

  return card;
}

/* =========================================================
   GET DISPLAY CANDIDATES
========================================================= */

function getDisplayCandidates(candidates, isAnonymous, anonymousKey) {
  if (!candidates || candidates.length === 0) {
    return [];
  }

  /*
       ELECTION ENDED
       -----------------------------------------
       Always show highest voter first.
    */
  if (!isAnonymous) {
    return [...candidates].sort(
      (a, b) => Number(b.votes || 0) - Number(a.votes || 0),
    );
  }

  /*
       ELECTION RUNNING
       -----------------------------------------
       The candidate with the highest votes
       ALWAYS stays at the top.

       The remaining candidates are randomized.
       This prevents the live polling refresh
       from constantly changing their positions.
    */

  if (anonymousCandidateOrder.has(anonymousKey)) {
    const savedOrder = anonymousCandidateOrder.get(anonymousKey);

    /*
           Find the current leader.
        */

    let currentLeaderIndex = 0;

    for (let i = 1; i < candidates.length; i++) {
      if (
        Number(candidates[i].votes || 0) >
        Number(candidates[currentLeaderIndex].votes || 0)
      ) {
        currentLeaderIndex = i;
      }
    }

    /*
           Keep the current leader first.
    
           The remaining candidates keep
           their previous randomized order.
        */

    const remainingOrder = savedOrder.filter(
      (index) => index !== currentLeaderIndex,
    );

    const finalOrder = [currentLeaderIndex, ...remainingOrder];

    anonymousCandidateOrder.set(anonymousKey, finalOrder);

    return finalOrder.map((index) => candidates[index]).filter(Boolean);
  }

  const indexes = candidates.map((_, index) => index);

  /*
       Find current top voter.
    */
  let topIndex = 0;

  for (let i = 1; i < candidates.length; i++) {
    if (
      Number(candidates[i].votes || 0) > Number(candidates[topIndex].votes || 0)
    ) {
      topIndex = i;
    }
  }

  /*
       Remove top voter from shuffle pool.
    */
  const remainingIndexes = indexes.filter((index) => index !== topIndex);

  /*
       Shuffle everyone except the leader.
    */
  for (let i = remainingIndexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [remainingIndexes[i], remainingIndexes[j]] = [
      remainingIndexes[j],
      remainingIndexes[i],
    ];
  }

  /*
       Leader is ALWAYS first.
    */
  const finalOrder = [topIndex, ...remainingIndexes];

  anonymousCandidateOrder.set(anonymousKey, finalOrder);

  return finalOrder.map((index) => candidates[index]).filter(Boolean);
}

function createAnonymousCandidate(candidate, anonymousIndex) {
  return {
    id: candidate.id,
    name: `Candidate ${anonymousIndex + 1}`,
    photo: DEFAULT_CANDIDATE_IMAGE,
    partylist: "Anonymous Partylist",
    votes: Number(candidate.votes || 0),
  };
}

/* =========================================================
   CREATE POSITION COLUMN
========================================================= */

function createPositionColumn(
  position,
  candidates,
  positionId,
  isAnonymous = false,
  isDraw = false,
  limit = null,
) {
  const column = document.createElement("div");
  column.className = "position-column";
  column.classList.add(
    `position-${position.key.toLowerCase().replace(/\s+/g, "-")}`,
  );
  column.dataset.position = position.key;

  const heading = document.createElement("div");
  heading.className = "position-heading";
  heading.textContent = position.label;
  column.appendChild(heading);

  // percentages are always based on ALL votes of the position
  const totalPositionVotes = (candidates || []).reduce(
    (t, c) => t + Number(c.votes || 0),
    0,
  );

  // `limit` (Representative departments): only candidates with votes,
  // highest first, top N (candidates tied with the last place stay)
  let shown = candidates || [];
  if (limit) {
    const ranked = shown.filter((c) => Number(c.votes || 0) > 0);
    if (ranked.length > limit) {
      const cutoff = Number(ranked[limit - 1].votes || 0);
      shown = ranked.filter((c) => Number(c.votes || 0) >= cutoff);
    } else {
      shown = ranked;
    }
  }

  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "live-no-candidate";
    empty.textContent = limit ? "No votes yet" : "No candidates";
    column.appendChild(empty);
    return column;
  }

  if (isDraw) {
    const note = document.createElement("div");
    note.className = "position-draw-note";
    note.textContent = "DRAW — no official winner yet";
    column.appendChild(note);
  }

  const top = Number(shown[0]?.votes || 0);

  shown.forEach((candidate, index) => {
    const row = createCandidateRow(candidate, positionId, totalPositionVotes);
    if (isDraw && Number(candidate.votes || 0) === top)
      row.classList.add("is-draw");
    else if (!isDraw && index === 0) row.classList.add("is-leading");
    column.appendChild(row);
  });

  return column;
}

/* =========================================================
   CREATE CANDIDATE ROW
========================================================= */

function createCandidateRow(candidate, positionId, totalPositionVotes) {
  const row = document.createElement("div");

  row.className = "live-candidate";

  row.dataset.candidateId = candidate.id;
  row.dataset.positionId = positionId;

  /* =====================================================
       IMAGE
    ===================================================== */

  const image = document.createElement("img");

  image.className = "live-candidate-image";

  image.src = resolveCandidateImage(candidate.photo);

  image.alt = candidate.name || "Candidate";

  image.onerror = () => {
    image.src = DEFAULT_CANDIDATE_IMAGE;
  };

  /* =====================================================
       INFORMATION CONTAINER
    ===================================================== */

  const info = document.createElement("div");

  info.className = "live-candidate-info";

  /* =====================================================
       CANDIDATE NAME
    ===================================================== */

  const name = document.createElement("span");

  name.className = "live-candidate-name";

  name.textContent = candidate.name || "Unknown Candidate";

  /* =====================================================
       PARTYLIST
    ===================================================== */

  const partylist = document.createElement("span");

  partylist.className = "live-candidate-partylist";

  partylist.textContent = candidate.partylist || "Independent";

  info.appendChild(name);

  info.appendChild(partylist);

  /* =====================================================
       VOTE CALCULATION
    ===================================================== */

  const votes = Number(candidate.votes || 0);

  const percentage =
    totalPositionVotes > 0 ? (votes / totalPositionVotes) * 100 : 0;

  const roundedPercentage = percentage.toFixed(1);

  /* =====================================================
       PROGRESS CONTAINER
    ===================================================== */

  const progress = document.createElement("div");

  progress.className = "live-candidate-progress";

  /* =====================================================
       PROGRESS TRACK
    ===================================================== */

  const progressTrack = document.createElement("div");

  progressTrack.className = "live-candidate-progress-track";

  /* =====================================================
       PROGRESS BAR
    ===================================================== */

  const progressBar = document.createElement("div");

  progressBar.className = "live-candidate-progress-bar";

  progressBar.style.width = `${percentage}%`;

  /* =====================================================
       PERCENTAGE
    ===================================================== */

  const percent = document.createElement("strong");

  percent.className = "live-candidate-percent";

  percent.textContent = `${roundedPercentage}%`;

  progressTrack.appendChild(progressBar);

  progress.appendChild(progressTrack);

  progress.appendChild(percent);

  /* =====================================================
       VOTE COUNT
    ===================================================== */

  const voteCount = document.createElement("span");

  voteCount.className = "live-candidate-vote-count";

  voteCount.dataset.role = "vote-count";

  progressBar.className = "live-candidate-progress-bar";

  progressBar.dataset.role = "progress-bar";

  percent.className = "live-candidate-percent";

  percent.dataset.role = "percent";

  voteCount.textContent = `${votes} vote${votes === 1 ? "" : "s"}`;

  /* =====================================================
       VOTE UPDATE TRACKING
    ===================================================== */

  const voteKey = `${positionId}-${candidate.name}`;

  if (
    previousVotes[voteKey] !== undefined &&
    previousVotes[voteKey] !== votes
  ) {
    voteCount.classList.add("vote-updated");
  }

  previousVotes[voteKey] = votes;

  /* =====================================================
       BUILD ROW
    ===================================================== */

  row.appendChild(image);

  row.appendChild(info);

  row.appendChild(progress);

  row.appendChild(voteCount);

  return row;
}

/* =========================================================
   LAST UPDATED
========================================================= */

function updateLastUpdated() {
  const now = new Date();

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  updateElement("lastUpdatedSSC", `Updated ${time}`);

  updateElement("lastUpdatedDepartment", `Updated ${time}`);
}

/* =========================================================
   UPDATE ELEMENT
========================================================= */

function updateElement(id, value, directElement = null) {
  const element = directElement || document.getElementById(id);

  if (!element) return;

  element.textContent = value;
}

/* =========================================================
   DOWNLOAD WINNER CARD AS 4:3 PNG
========================================================= */

/* =========================================================
   DOWNLOAD WINNER CARD AS DESIGNED 4:3 PNG
========================================================= */
function createExportWinnerBox(
  item,
  sizes,
  positions = null,
  isRepresentative = false,
) {
  const image = item.querySelector("img");
  const positionSpan = item.querySelector(".winner-item-info span");
  const name = item.querySelector(".winner-item-info strong");

  const nameText = (name?.textContent || "").trim();
  const positionLabel = (positionSpan?.textContent || "").trim();

  let partylist = "Independent";
  if (!isRepresentative) {
    const originalCandidate = findCandidateInPositions(
      positions,
      positionLabel,
      nameText,
    );
    partylist = originalCandidate?.partylist || "Independent";
  } else {
    partylist = ""; // representative-type departments have no partylist concept
  }

  const box = document.createElement("div");

  Object.assign(box.style, {
    boxSizing: "border-box",
    padding: "16px 18px",
    border: "1px solid #E5E7EB",
    borderRadius: "22px",
    background: "#FFFFFF",
    boxShadow: "0 8px 24px rgba(15, 23, 42, .18)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    overflow: "hidden",
  });

  const candidateImage = document.createElement("img");
  candidateImage.src = image?.src || DEFAULT_CANDIDATE_IMAGE;

  Object.assign(candidateImage.style, {
    width: `${sizes.image}px`,
    height: `${sizes.image}px`,
    borderRadius: `${Math.round(sizes.image * 0.16)}px`,
    objectFit: "cover",
    border: "3px solid #E1E4EC",
    background: "#F0F2F7",
    marginBottom: `${Math.round(sizes.image * 0.1)}px`,
  });

  candidateImage.onerror = () => {
    candidateImage.src = DEFAULT_CANDIDATE_IMAGE;
  };

  const candidateName = document.createElement("div");
  candidateName.textContent = nameText || "Unknown Candidate";

  Object.assign(candidateName.style, {
    fontSize: `${sizes.name}px`,
    fontWeight: "800",
    lineHeight: "1.15",
    maxWidth: "100%",
    color: "#202334",
    marginBottom: "6px",
  });

  const candidatePosition = document.createElement("div");
  candidatePosition.textContent = positionLabel;

  Object.assign(candidatePosition.style, {
    fontSize: `${sizes.position}px`,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    color: "#5B5CEB",
    marginBottom: "5px",
  });

  const candidatePartylist = document.createElement("div");
  candidatePartylist.textContent = partylist;

  Object.assign(candidatePartylist.style, {
    fontSize: `${sizes.party}px`,
    color: "#6B7280",
    lineHeight: "1.3",
    maxWidth: "100%",
  });

  box.appendChild(candidateImage);
  box.appendChild(candidateName);
  box.appendChild(candidatePosition);
  if (partylist) box.appendChild(candidatePartylist);

  return box;
}

async function downloadWinnerCard(element, options) {
  const {
    programCourse = null,
    campusName = "",
    electionType = "",
    rightLogo = "/images/lcccast_logo.png",
    positions = null, // ADD
    isRepresentative = false, // ADD
  } = options || {};

  if (!element || typeof html2canvas === "undefined") return;

  try {
    const winnerItems = element.querySelectorAll(".winner-item");
    if (!winnerItems.length) return;

    const bgDataUrl = await cropBackgroundToDataURL(
      "/images/lcc_bg.png",
      1200,
      900,
    );
    const exportCard = buildExportCardBase(bgDataUrl);

    exportCard.appendChild(
      buildExportHeader({ programCourse, campusName, electionType, rightLogo }),
    );

    /* CONTENT — winner grid, padded below the full-width ribbon */
    const content = document.createElement("div");
    content.style.flex = "1";
    content.style.minHeight = "0";
    content.style.padding = "26px 55px 0";
    content.style.display = "flex";
    content.style.flexDirection = "column";

    const items = [...winnerItems];
    const isPresident = (item) =>
      item
        .querySelector(".winner-item-info span")
        ?.textContent.trim()
        .toLowerCase() === "president";

    const presidentItem = items.find(isPresident) || null;
    const otherItems = items.filter((item) => item !== presidentItem);

    const rows = [];
    if (presidentItem) rows.push([presidentItem]);
    for (let i = 0; i < otherItems.length; i += 3) {
      rows.push(otherItems.slice(i, i + 3));
    }

    const ROW_GAP = 16;
    // 900 canvas - header(92) - footer(47) - top padding(26) - safety(12)
    const AVAILABLE_HEIGHT = 900 - 92 - 47 - 26 - 12;
    const rowHeight =
      (AVAILABLE_HEIGHT - ROW_GAP * (rows.length - 1)) / rows.length;

    const imageSize = Math.max(56, Math.min(190, Math.round(rowHeight * 0.5)));
    const nameSize = Math.max(
      15,
      Math.min(28, Math.round(imageSize * 0.15) + 3),
    );
    const sizes = {
      image: imageSize,
      name: nameSize,
      position: Math.max(11, Math.round(nameSize * 0.6)),
      party: Math.max(12, Math.round(nameSize * 0.6)),
    };

    const layout = document.createElement("div");
    layout.style.display = "flex";
    layout.style.flexDirection = "column";
    layout.style.gap = "16px";
    layout.style.flex = "1";
    layout.style.minHeight = "0";

    rows.forEach((rowItems) => {
      const row = document.createElement("div");
      row.style.flex = "1";
      row.style.minHeight = "0";
      row.style.gap = "16px";

      const isPartialRow = rowItems.length < 3;
      if (isPartialRow) {
        row.style.display = "flex";
        row.style.justifyContent = "center";
      } else {
        row.style.display = "grid";
        row.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      }

      rowItems.forEach((item) => {
        const box = createExportWinnerBox(
          item,
          sizes,
          positions,
          isRepresentative,
        );
        if (isPartialRow) box.style.width = "calc((100% - 32px) / 3)";
        row.appendChild(box);
      });

      layout.appendChild(row);
    });

    content.appendChild(layout);
    exportCard.appendChild(content);
    exportCard.appendChild(buildExportFooter());

    document.body.appendChild(exportCard);

    const canvas = await html2canvas(exportCard, {
      backgroundColor: "#FFFFFF",
      scale: 2,
      useCORS: true,
      width: 1200,
      height: 900,
    });

    document.body.removeChild(exportCard);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = 1200;
    outputCanvas.height = 900;
    outputCanvas.getContext("2d").drawImage(canvas, 0, 0, 1200, 900);

    const link = document.createElement("a");
    link.download = `${campusName}-winners.png`
      .replace(/\s+/g, "-")
      .toLowerCase();
    link.href = outputCanvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    console.error("Winner card download failed:", error);
  }
}

/* =========================================================
   BUILD DESIGNED POSITION EXPORT
========================================================= */

function createExportPositionCandidateRow(candidate, index, totalVotes) {
  const votes = Number(candidate.votes || 0);
  const percentage = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;

  const row = document.createElement("div");
  row.style.position = "relative";
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "20px";
  row.style.padding = "16px 22px";
  row.style.borderRadius = "18px";
  row.style.border = index === 0 ? "2px solid #5B5CEB" : "1px solid #E5E7EF";
  row.style.background = index === 0 ? "#FAFAFF" : "#FFFFFF";

  if (index === 0) {
    const badge = document.createElement("div");
    badge.textContent = "★ OFFICIAL WINNER";
    badge.style.position = "absolute";
    badge.style.top = "-11px";
    badge.style.right = "18px";
    badge.style.background = "#5B5CEB";
    badge.style.color = "#FFFFFF";
    badge.style.fontSize = "10px";
    badge.style.fontWeight = "800";
    badge.style.letterSpacing = ".6px";
    badge.style.padding = "4px 10px";
    badge.style.borderRadius = "999px";
    row.appendChild(badge);
  }

  const img = document.createElement("img");
  img.src = resolveCandidateImage(candidate.photo);
  img.onerror = () => {
    img.src = DEFAULT_CANDIDATE_IMAGE;
  };
  img.style.width = "82px";
  img.style.height = "82px";
  img.style.borderRadius = "14px";
  img.style.objectFit = "cover";
  img.style.border = "2px solid #E1E4EC";
  img.style.flexShrink = "0";

  const info = document.createElement("div");
  info.style.flex = "1";
  info.style.minWidth = "0";

  const name = document.createElement("div");
  name.textContent = candidate.name || "Unknown Candidate";
  name.style.fontSize = "19px";
  name.style.fontWeight = "800";
  name.style.color = "#202334";
  name.style.whiteSpace = "nowrap";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";

  const group = document.createElement("div");
  group.textContent = candidate.partylist || "Independent";
  group.style.marginTop = "3px";
  group.style.fontSize = "13px";
  group.style.color = "#6B7280";

  const stats = document.createElement("div");
  stats.style.marginTop = "9px";
  stats.style.display = "flex";
  stats.style.gap = "26px";
  stats.innerHTML = `
        <div><strong style="font-size:16px;color:#202334;">${votes.toLocaleString()}</strong>
             <span style="display:block;font-size:9px;color:#9AA0AE;font-weight:700;letter-spacing:.5px;">VOTES</span></div>
        <div><strong style="font-size:16px;color:#202334;">${percentage.toFixed(1)}%</strong>
             <span style="display:block;font-size:9px;color:#9AA0AE;font-weight:700;letter-spacing:.5px;">VOTE SHARE</span></div>
    `;

  info.appendChild(name);
  info.appendChild(group);
  info.appendChild(stats);
  row.appendChild(img);
  row.appendChild(info);

  return row;
}

async function downloadPositionWinnerCard(
  positionName,
  prefix,
  candidates,
  options = {},
) {
  if (typeof html2canvas === "undefined") return;
  if (!candidates || !candidates.length) return;

  try {
    const exportCard = await buildPositionWinnerExportCard(
      positionName,
      candidates,
      options,
    );
    exportCard.style.position = "fixed";
    exportCard.style.left = "-100000px";
    exportCard.style.top = "0";

    document.body.appendChild(exportCard);

    const canvas = await html2canvas(exportCard, {
      backgroundColor: "#FFFFFF",
      scale: 2,
      useCORS: true,
      width: 1200,
      height: 900,
    });

    document.body.removeChild(exportCard);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = 1200;
    outputCanvas.height = 900;
    outputCanvas.getContext("2d").drawImage(canvas, 0, 0, 1200, 900);

    const link = document.createElement("a");
    link.download = `${prefix}-${positionName}-result.png`
      .replace(/\s+/g, "-")
      .toLowerCase();
    link.href = outputCanvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    console.error("Position winner export failed:", error);
  }
}

/* =========================================================
   DOWNLOAD DESIGNED POSITION WINNER PNG
========================================================= */

/* =========================================================
   FIND CANDIDATE BY NAME
========================================================= */

function findCandidateByName(name) {
  const searchName = String(name).trim().toLowerCase();

  /*
       Search SSC campuses.
    */

  const campuses = liveResultsData?.ssc || [];

  for (const campus of campuses) {
    for (const candidates of Object.values(campus.positions || {})) {
      const candidate = candidates.find(
        (item) => String(item.name).trim().toLowerCase() === searchName,
      );

      if (candidate) {
        return candidate;
      }
    }
  }

  /*
       Search departments.
    */

  const departments = liveResultsData?.departments || [];

  for (const department of departments) {
    for (const candidates of Object.values(department.positions || {})) {
      const candidate = candidates.find(
        (item) => String(item.name).trim().toLowerCase() === searchName,
      );

      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
   LCCAST - ANALYTICS PAGE
   Handles SSC/Department tabs, Chart.js rendering, candidate
   photos, PDF export (single graph / campus / full section).

   NOTE: MOCK_DATA is temporary — replace loadAnalyticsData()
   with a real backend call later.
========================================================= */

document.addEventListener("DOMContentLoaded", initializeAnalytics);

// State
let analyticsData = null;
const charts = {};
let currentDepartment = "BSA";

let stompClient = null;

const expandedElectionIds = new Set();

const selectedSscElection = {}; // campusKey -> electionId

function getSscElections(campusKey) {
  return Object.values(analyticsData.ssc?.elections || {})
    .map((byCampus) => byCampus[campusKey])
    .filter(Boolean);
}

function getSscData(campusKey) {
  const elections = getSscElections(campusKey);
  return (
    elections.find((e) => e.electionId === selectedSscElection[campusKey]) ||
    elections[0] ||
    analyticsData.ssc?.campuses?.[campusKey]
  );
}

/* =========================================================
   ANALYTICS — CONTENT SKELETON
========================================================= */

function showAnalyticsContentSkeleton(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="analytics-content-skeleton">

      <div class="analytics-skeleton-summary">
        <div class="skeleton analytics-skeleton-summary-card"></div>
        <div class="skeleton analytics-skeleton-summary-card"></div>
        <div class="skeleton analytics-skeleton-summary-card"></div>
        <div class="skeleton analytics-skeleton-summary-card"></div>
      </div>

      <div class="analytics-skeleton-card">
        <div class="skeleton analytics-skeleton-title"></div>
        <div class="skeleton analytics-skeleton-subtitle"></div>
        <div class="skeleton analytics-skeleton-chart"></div>
      </div>

      <div class="analytics-skeleton-card">
        <div class="skeleton analytics-skeleton-title"></div>
        <div class="skeleton analytics-skeleton-subtitle"></div>
        <div class="skeleton analytics-skeleton-chart"></div>
      </div>

      <div class="analytics-skeleton-summary">
        <div class="skeleton analytics-skeleton-summary-card"></div>
        <div class="skeleton analytics-skeleton-summary-card"></div>
        <div class="skeleton analytics-skeleton-summary-card"></div>
        <div class="skeleton analytics-skeleton-summary-card"></div>
      </div>

      <div class="analytics-skeleton-card">
        <div class="skeleton analytics-skeleton-title"></div>
        <div class="skeleton analytics-skeleton-subtitle"></div>
        <div class="skeleton analytics-skeleton-chart"></div>
      </div>

    </div>
  `;
}

function connectAnalyticsSocket() {
  stompClient = new StompJs.Client({
    webSocketFactory: () => new SockJS("/ws-analytics"),
    reconnectDelay: 3000,
  });

  stompClient.onConnect = () => {
    stompClient.subscribe("/topic/analytics", refreshAnalyticsFromServer);
  };

  stompClient.activate();
}

async function refreshAnalyticsFromServer() {
  try {
    const res = await fetch("/api/superadmin/analytics", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return;
    analyticsData = await res.json();
    refreshCurrentView();
  } catch (error) {
    console.error("Failed to refresh analytics:", error);
  }
}

function refreshCurrentView() {
  const scrollY = window.scrollY;
  const activeTab = document.querySelector(".analytics-tab.active")?.dataset
    .section;

  if (activeTab === "department") {
    const campus =
      document.getElementById("departmentCampusSelector")?.value || "all";
    renderDepartment(currentDepartment, campus);
  } else {
    const campus = document.getElementById("sscCampusSelector")?.value || "all";
    renderSSC(campus);
  }

  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

let successToast, successToastTitle, successToastMessage, successToastClose;
let successToastTimer = null;
let actionLoadingModal;
let actionLoadingTitle;
let actionLoadingMessage;

// Campuses
let CAMPUSES = {}; // campus key (lowercase name) -> display name, filled from the database

// Departments
let DEPARTMENTS = {};

async function attachDepartmentIds() {
  const dbDepartments = await SoftCache.load(
    "/api/superadmin/analytics/departments",
    {
      ttl: 60000,
    },
  );

  DEPARTMENTS = {};
  dbDepartments.forEach((d) => {
    DEPARTMENTS[d.id] = {
      id: d.id,
      name: d.name,
      title: d.title,
      votingType: d.votingType,
      departmentName: d.departmentName,
    };
  });
}

/* =========================================================
   SSC PROGRAMS
========================================================= */

const SSC_PROGRAM_COLORS = {
  BSIS: "#5B5CEB",
  BSHM: "#22C55E",
  BSCRIM: "#EF4444",
  BSPSYCH: "#8E45F5",
  BSPSY: "#8E45F5", // your dropdown/DB use BSPSY; the old map only had BSPSYCH
  EDUC: "#F59E0B",
  BSBA: "#06B6D4",
  BAEL: "#EC4899",
  BSCE: "#14B8A6",
  BSA: "#748FEA",
  BSAIS: "#F97316",
};

const FALLBACK_PROGRAM_COLORS = ["#64748B", "#A855F7", "#0EA5E9", "#84CC16", "#E11D48", "#0D9488", "#CA8A04", "#7C3AED"];

const SSC_CHART_TYPES = [
  "sscPartylistChart",
  "sscCandidateChart",
  "sscTurnoutChart",
  "sscYearChart",
  "sscProgramChart",
  "sscProgramNotVotedChart",
  "sscActivityChart",
];

let DEPARTMENT_GROUPS = [];


function buildDepartmentGroups() {
  DEPARTMENT_GROUPS = SystemConfig.programs().map((p) => ({
    code: p.acronym,
    label: `${p.acronym} — ${p.fullName}`,
    aliases: [p.acronym, ...(p.aliases || [])].map((a) => a.toUpperCase()),
  }));
}

function fillAnalyticsCampusSelectors() {
  ["sscCampusSelector", "departmentCampusSelector"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML =
      `<option value="all">All Campuses</option>` +
      Object.entries(CAMPUSES)
        .map(
          ([key, name]) =>
            `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`,
        )
        .join("");
  });
}

function stripCampusSuffix(chartId) {
  const keys = Object.keys(CAMPUSES).map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  if (!keys.length) return chartId;
  return chartId.replace(new RegExp(`-(${keys.join("|")})$`), "");
}

// Which department does this election belong to? (matches the start of its title)
// Which department group does this election belong to?
// Uses the department's name (e.g. "BSIS - Test 1"), not the election title.
function getDepartmentGroupCode(election) {
  const name = String(election.departmentName || "")
    .trim()
    .toUpperCase();
  if (!name) return null;

  for (const group of DEPARTMENT_GROUPS) {
    for (const alias of group.aliases) {
      // alias must be followed by a non-letter/digit, so "BSA" doesn't match "BSAIS"
      const safe = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${safe}(?![A-Z0-9])`);
      if (re.test(name)) return group.code;
    }
  }
  return null;
}

function getGroupElections(groupCode) {
  return Object.values(DEPARTMENTS)
    .filter((d) => getDepartmentGroupCode(d) === groupCode)
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

const DEPARTMENT_CHART_TYPES = [
  "departmentCandidateChart",
  "departmentTurnoutChart",
  "departmentYearChart",
  "departmentActivityChart",
  "departmentStatusChart",
];

function getProgramRank(program) {
  const i = SystemConfig.programs().findIndex(
    (p) => p.acronym.toUpperCase() === program,
  );
  return i === -1 ? 999 : i;
}

/* Builds one shared program list so both pies have identical labels,
   order and colors (a program with 0 votes still appears in the legend). */
function getProgramSeries(data) {
  const voted = new Map();
  const notVoted = new Map();

  (data.programVotes || []).forEach((p) =>
    voted.set(String(p.program).trim().toUpperCase(), p.votes),
  );
  (data.programNotVoted || []).forEach((p) =>
    notVoted.set(String(p.program).trim().toUpperCase(), p.votes),
  );

  const programs = [...new Set([...voted.keys(), ...notVoted.keys()])].sort(
    (a, b) => getProgramRank(a) - getProgramRank(b),
  );

  return {
    programs,
    voted: programs.map((p) => voted.get(p) ?? 0),
    notVoted: programs.map((p) => notVoted.get(p) ?? 0),
    colors: programs.map(
      (p, i) =>
        SSC_PROGRAM_COLORS[p] ||
        FALLBACK_PROGRAM_COLORS[i % FALLBACK_PROGRAM_COLORS.length],
    ),
  };
}

const NO_CAMPUS_ELECTION_MESSAGE = "No active election for this campus yet.";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emptyCardMarkup(title, subtitle, message) {
  return `
    <div class="campus-election-section">
        <div class="campus-election-header">
            <div class="campus-election-title">
                <i class="bi bi-geo-alt"></i>
                <div>
                    <h2>${escapeHtml(title)}</h2>
                    <p>${escapeHtml(subtitle)}</p>
                </div>
            </div>
        </div>
        <div class="campus-election-list">
            <p class="no-election-message">${escapeHtml(message)}</p>
        </div>
    </div>
  `;
}

// Init
async function initializeAnalytics() {
  try {
    initializeSuccessToast();
    initializeActionLoadingModal();

    await attachDepartmentIds();

    await SystemConfig.load();
    CAMPUSES = {};
    SystemConfig.campuses().forEach((c) => {
            CAMPUSES[SystemConfig.campusKey(c.name)] = c.name;
    });
    buildDepartmentGroups();
    fillAnalyticsCampusSelectors();

    // Show skeleton ONLY inside analytics result containers
    showAnalyticsContentSkeleton(document.getElementById("sscCampusAnalytics"));

    showAnalyticsContentSkeleton(
      document.getElementById("departmentCampusAnalytics"),
    );

    analyticsData = await loadAnalyticsData();

    initializeTabs();
    initializeDepartmentSelector();
    initializeCampusSelectors();
    initializeExportButtons();

    renderSSC();

    if (currentDepartment) {
      try {
        renderDepartment(currentDepartment);
      } catch (error) {
        console.error("Failed to render department analytics:", error);
        showDepartmentMessage(
          "Unable to load department analytics. Please refresh the page.",
        );
      }
    } else {
      showDepartmentMessage("There are no active department elections yet.");
    }

    connectAnalyticsSocket();
  } catch (error) {
    console.error("Failed to initialize analytics:", error);

    // Remove skeletons if initialization fails
    const sscContainer = document.getElementById("sscCampusAnalytics");
    const departmentContainer = document.getElementById(
      "departmentCampusAnalytics",
    );

    const errorMessage =
      "Unable to load analytics right now. Please refresh the page.";
    if (sscContainer) {
      sscContainer.innerHTML = emptyCardMarkup(
        "Supreme Student Council",
        "Supreme Student Council Elections",
        errorMessage,
      );
    }
    if (departmentContainer) {
      departmentContainer.innerHTML = emptyCardMarkup(
        "Department Elections",
        "Department analytics",
        errorMessage,
      );
    }
  }
}

async function loadAnalyticsData() {
  return SoftCache.load("/api/superadmin/analytics", {
    ttl: 15000,
    onRevalidated: (fresh) => {
      analyticsData = fresh;
      refreshCurrentView();
    },
  });
}

// Tabs
function initializeTabs() {
  const tabs = document.querySelectorAll(".analytics-tab");
  const sections = document.querySelectorAll(".analytics-section");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const section = tab.dataset.section;

      tabs.forEach((item) => item.classList.remove("active"));
      sections.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      if (section === "ssc") {
        document.getElementById("sscAnalytics")?.classList.add("active");
      }
      if (section === "department") {
        document.getElementById("departmentAnalytics")?.classList.add("active");
      }

      // Charts drawn while a tab was hidden need a resize once it's visible
      requestAnimationFrame(() =>
        Object.values(charts).forEach((chart) => chart.resize()),
      );
    });
  });
}

function initializeDepartmentSelector() {
  const groupSelect = document.getElementById("departmentSelector");
  if (!groupSelect) return;

  groupSelect.innerHTML = DEPARTMENT_GROUPS.map(
    (g) => `<option value="${g.code}">${escapeHtml(g.label)}</option>`,
  ).join("");

  // start on the first department that actually has an election
  const first = DEPARTMENT_GROUPS.find((g) => getGroupElections(g.code).length);
  groupSelect.value = (first || DEPARTMENT_GROUPS[0]).code;
  selectDepartmentElection(groupSelect.value);

  groupSelect.addEventListener("change", () => {
    selectDepartmentElection(groupSelect.value);
    renderDepartment(currentDepartment, getDepartmentCampus());
  });
}

// currentDepartment holds the election id for the chosen department
function selectDepartmentElection(groupCode) {
  const elections = getGroupElections(groupCode);
  currentDepartment = elections.length ? elections[0].id : null;
}

function getDepartmentCampus() {
  return document.getElementById("departmentCampusSelector")?.value || "all";
}

// Campus selectors
function initializeCampusSelectors() {
  const sscSelector = document.getElementById("sscCampusSelector");
  if (sscSelector) {
    sscSelector.addEventListener("change", (event) =>
      renderSSC(event.target.value),
    );
  }

  const departmentCampusSelector = document.getElementById(
    "departmentCampusSelector",
  );
  if (departmentCampusSelector) {
    departmentCampusSelector.addEventListener("change", (event) => {
      renderDepartment(currentDepartment, event.target.value);
    });
  }
}

// SSC
function renderSSC(campusFilter = "all") {
  const container = document.getElementById("sscCampusAnalytics");
  if (!container) return;

  destroyChartsWithPrefix("ssc");
  container.innerHTML = "";

  const campusKeys =
    campusFilter === "all" ? Object.keys(CAMPUSES) : [campusFilter];

  campusKeys.forEach((campusKey) => {
    const data = getSscData(campusKey);

    if (!data || !data.electionId) {
      container.insertAdjacentHTML(
        "beforeend",
        emptyCardMarkup(
          CAMPUSES[campusKey],
          "Supreme Student Council Elections",
          NO_CAMPUS_ELECTION_MESSAGE,
        ),
      );
      return;
    }

    const section = createCampusElectionSection(campusKey, data, "ssc");
    container.appendChild(section);

    renderSSCCharts(campusKey, data);
  });
}

function createCampusElectionSection(
  campusKey,
  data,
  type,
  departmentCode = null,
) {
  const section = document.createElement("div");
  section.className = "campus-election-section";

  const campusName = CAMPUSES[campusKey];
  const elections = data.electionId
    ? [{ id: data.electionId, title: data.electionTitle }]
    : [];

  const sscElections = type === "ssc" ? getSscElections(campusKey) : [];

  const yearSelector =
    sscElections.length > 1
      ? `
        <div class="election-year-select-wrapper">
          <i class="bi bi-calendar-event"></i>
          <select class="election-year-select" data-campus="${campusKey}">
            ${sscElections
              .map(
                (e) => `
              <option value="${e.electionId}" ${e.electionId === data.electionId ? "selected" : ""}>
                ${escapeHtml(e.schoolYear || "—")} — ${escapeHtml(e.electionTitle)}${e.phase === "CONCLUDED" ? " (Concluded)" : ""}
              </option>`,
              )
              .join("")}
          </select>
          <i class="bi bi-chevron-down select-caret"></i>
        </div>`
      : "";

  section.innerHTML = `
        <div class="campus-election-header">
            <div class="campus-election-title">
                <i class="bi bi-geo-alt"></i>
                <div>
                    <h2>${campusName}</h2>
                       <p>${type === "ssc" ? "Supreme Student Council Elections" : escapeHtml(DEPARTMENTS[departmentCode]?.title || "Department Elections")}</p>
                </div>
            </div>
            ${yearSelector}
        </div>

                <div class="campus-election-list">
                    ${
                      elections.length === 0
                        ? `<p class="no-election-message">No active election for this campus yet.</p>`
                        : elections
                            .map((election) => {
                              const isExpanded = expandedElectionIds.has(
                                election.id,
                              );
                              return `
                          <div class="election-item${isExpanded ? " expanded" : ""}" data-election-id="${election.id}">
                              <div class="election-item-header">
                                  <div class="election-title">
                                      <i class="bi bi-calendar-event"></i>
                                      <span>${election.title}</span>
                                  </div>
                                  <div class="election-actions">
                                      <button type="button" class="election-action-btn expand-election" title="Expand Election">
                                          <i class="bi ${isExpanded ? "bi-chevron-up" : "bi-chevron-down"}"></i>
                                      </button>
                                  </div>
                              </div>
                              <div class="election-content" style="display:${isExpanded ? "block" : "none"}">
                                  <div class="election-export-row">
                                      <button
                                          type="button"
                                          class="election-export-btn"
                                          data-campus="${campusKey}"
                                          data-election="${election.id}"
                                          data-type="${type}"
                                          ${departmentCode ? `data-department="${departmentCode}"` : ""}
                                      >
                                          <i class="bi bi-download"></i>
                                          Export Graphs
                                      </button>
                                  </div>
                                  ${createElectionGraphsMarkup(campusKey, data, type, departmentCode)}
                              </div>
                          </div>
                        `;
                            })
                            .join("")
                    }
                      </div>
    `;

  section
    .querySelector(".election-year-select")
    ?.addEventListener("change", (event) => {
      selectedSscElection[event.target.dataset.campus] = event.target.value;
      expandedElectionIds.add(event.target.value);
      renderSSC(document.getElementById("sscCampusSelector")?.value || "all");
    });

  initializeElectionActions(section);
  return section;
}

// Election graph markup
function createElectionGraphsMarkup(
  campusKey,
  data,
  type,
  departmentCode = null,
) {
  if (type === "ssc") {
    return `
            <div class="analytics-summary-grid">
                <div class="analytics-summary-card">
                    <div class="summary-icon"><i class="bi bi-people"></i></div>
                    <div><span>Total Voters</span><strong>${data.totalVoters}</strong></div>
                </div>
                <div class="analytics-summary-card">
                    <div class="summary-icon"><i class="bi bi-check2-circle"></i></div>
                    <div><span>Votes Cast</span><strong>${data.votesCast}</strong></div>
                </div>
                <div class="analytics-summary-card">
                    <div class="summary-icon"><i class="bi bi-percent"></i></div>
                    <div><span>Turnout</span><strong>${calculatePercentage(data.votesCast, data.totalVoters)}</strong></div>
                </div>
                <div class="analytics-summary-card">
                    <div class="summary-icon"><i class="bi bi-person-badge"></i></div>
                    <div><span>Candidates</span><strong>${data.candidates.length}</strong></div>
                </div>
            </div>

            <div class="analytics-card">
                <div class="analytics-card-header">
                    <div>
                        <h3>Partylist Vote Distribution</h3>
                        <p>Distribution of votes received by each SSC partylist.</p>
                    </div>
                    <button class="graph-export-btn" data-export="sscPartylistChart-${campusKey}"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container chart-container-donut">
                    <canvas id="sscPartylistChart-${campusKey}"></canvas>
                </div>
            </div>

            <div class="analytics-card">
                <div class="analytics-card-header">
                    <div>
                        <h3>Candidate Votes</h3>
                        <p>Votes received by individual SSC candidates.</p>
                    </div>
                    <button class="graph-export-btn" data-export="sscCandidateChart-${campusKey}"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container">
                    <canvas id="sscCandidateChart-${campusKey}"></canvas>
                </div>
                <div class="candidate-photo-list" id="sscCandidatePhotos-${campusKey}"></div>
            </div>

            <div class="analytics-two-column">
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <h3>Voter Turnout</h3>
                        <button class="graph-export-btn" data-export="sscTurnoutChart-${campusKey}"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container small-chart">
                        <canvas id="sscTurnoutChart-${campusKey}"></canvas>
                    </div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <h3>Votes by Year Level</h3>
                        <button class="graph-export-btn" data-export="sscYearChart-${campusKey}"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container small-chart">
                        <canvas id="sscYearChart-${campusKey}"></canvas>
                    </div>
                </div>
            </div>

            <div class="analytics-two-column">
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <div>
                            <h3>Votes per Program</h3>
                            <p>Share of SSC votes cast by each program.</p>
                        </div>
                        <button class="graph-export-btn" data-export="sscProgramChart-${campusKey}" title="Export Votes per Program"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container chart-container-donut">
                        <canvas id="sscProgramChart-${campusKey}"></canvas>
                    </div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <div>
                            <h3>Not Yet Voted per Program</h3>
                            <p>Registered voters who have not voted, by program.</p>
                        </div>
                        <button class="graph-export-btn" data-export="sscProgramNotVotedChart-${campusKey}" title="Export Not Yet Voted per Program"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container chart-container-donut">
                        <canvas id="sscProgramNotVotedChart-${campusKey}"></canvas>
                    </div>
                </div>
            </div>

            <div class="analytics-card">
                <div class="analytics-card-header">
                    <h3>Voting Activity</h3>
                    <button class="graph-export-btn" data-export="sscActivityChart-${campusKey}"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container">
                    <canvas id="sscActivityChart-${campusKey}"></canvas>
                </div>
            </div>
        `;
  }

  return createDepartmentGraphsMarkup(campusKey, data, departmentCode);
}

// Department graph markup
function createDepartmentGraphsMarkup(campusKey, data, departmentCode) {
  return `
        <div class="analytics-summary-grid">
            <div class="analytics-summary-card">
                <div class="summary-icon"><i class="bi bi-people"></i></div>
                <div><span>Department Voters</span><strong>${data.totalVoters}</strong></div>
            </div>
            <div class="analytics-summary-card">
                <div class="summary-icon"><i class="bi bi-check2-circle"></i></div>
                <div><span>Votes Cast</span><strong>${data.votesCast}</strong></div>
            </div>
            <div class="analytics-summary-card">
                <div class="summary-icon"><i class="bi bi-percent"></i></div>
                <div><span>Turnout</span><strong>${calculatePercentage(data.votesCast, data.totalVoters)}</strong></div>
            </div>
            <div class="analytics-summary-card">
                <div class="summary-icon"><i class="bi bi-person-badge"></i></div>
                <div><span>Officer Candidates</span><strong>${data.candidates.length}</strong></div>
            </div>
        </div>

        <div class="analytics-card">
            <div class="analytics-card-header">
                <div>
                    <h3>Department Officer Votes</h3>
                    <p>Votes received by department officer candidates.</p>
                </div>
                <button class="graph-export-btn" data-export="departmentCandidateChart-${campusKey}"><i class="bi bi-download"></i></button>
            </div>
            <div class="chart-container">
                <canvas id="departmentCandidateChart-${campusKey}"></canvas>
            </div>
            <div class="candidate-photo-list" id="departmentCandidatePhotos-${campusKey}"></div>
        </div>

        <div class="analytics-two-column">
            <div class="analytics-card">
                <div class="analytics-card-header">
                    <h3>Department Voter Turnout</h3>
                    <button class="graph-export-btn" data-export="departmentTurnoutChart-${campusKey}"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container small-chart">
                    <canvas id="departmentTurnoutChart-${campusKey}"></canvas>
                </div>
            </div>
            <div class="analytics-card">
                <div class="analytics-card-header">
                    <h3>Participation by Year Level</h3>
                    <button class="graph-export-btn" data-export="departmentYearChart-${campusKey}"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container small-chart">
                    <canvas id="departmentYearChart-${campusKey}"></canvas>
                </div>
            </div>
        </div>

        <div class="analytics-card">
            <div class="analytics-card-header">
                <h3>Department Voting Activity</h3>
                <button class="graph-export-btn" data-export="departmentActivityChart-${campusKey}"><i class="bi bi-download"></i></button>
            </div>
            <div class="chart-container">
                <canvas id="departmentActivityChart-${campusKey}"></canvas>
            </div>
        </div>

        <div class="analytics-card">
            <div class="analytics-card-header">
                <h3>Voting Status</h3>
                <button class="graph-export-btn" data-export="departmentStatusChart-${campusKey}"><i class="bi bi-download"></i></button>
            </div>
            <div class="chart-container">
                <canvas id="departmentStatusChart-${campusKey}"></canvas>
            </div>
        </div>
    `;
}

// Election item actions (expand/delete/archive/export)
function initializeElectionActions(section) {
  section.querySelectorAll(".expand-election").forEach((button) => {
    button.addEventListener("click", () => {
      const election = button.closest(".election-item");
      if (!election) return;

      const electionId = election.dataset.electionId;
      if (electionId) expandedElectionIds.delete(electionId);
      const content = election.querySelector(".election-content");
      const isExpanded = election.classList.toggle("expanded");

      if (isExpanded) {
        content.style.display = "block";
        button.innerHTML = `<i class="bi bi-chevron-up"></i>`;
        expandedElectionIds.add(electionId);
      } else {
        content.style.display = "none";
        button.innerHTML = `<i class="bi bi-chevron-down"></i>`;
        expandedElectionIds.delete(electionId);
      }
    });
  });

  section.querySelectorAll(".election-export-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();

      const type = button.dataset.type;
      const campus = button.dataset.campus;

      if (type === "ssc") {
        await exportCampusSSCPDF(campus);
      } else {
        await exportCampusDepartmentPDF(button.dataset.department, campus);
      }
    });
  });
}

function renderSSCCharts(campusKey, data) {
  renderSSCPartylistChart(data, `sscPartylistChart-${campusKey}`);
  renderSSCCandidateChart(data, `sscCandidateChart-${campusKey}`);
  renderSSCTurnoutChart(data, `sscTurnoutChart-${campusKey}`);
  renderSSCYearChart(data, `sscYearChart-${campusKey}`);
  renderSSCActivityChart(data, `sscActivityChart-${campusKey}`);
  renderSSCProgramChart(data, `sscProgramChart-${campusKey}`);
  renderSSCProgramNotVotedChart(data, `sscProgramNotVotedChart-${campusKey}`);
  renderCandidatePhotos(`sscCandidatePhotos-${campusKey}`, data.candidates);
}

// SSC charts
function renderSSCPartylistChart(data, chartId) {
  createOrUpdateChart(
    chartId,
    "doughnut",
    data.partyLists.map((item) => item.name),
    data.partyLists.map((item) => item.votes),
    {
      title: "SSC Partylist Vote Distribution",
      description: "Distribution of votes received by each SSC partylist.",
    },
  );
}

function renderSSCCandidateChart(data, chartId) {
  createOrUpdateChart(
    chartId,
    "bar",
    data.candidates.map((c) => c.name),
    data.candidates.map((c) => c.votes),
    {
      title: "SSC Candidate Votes",
      description: "Votes received by individual SSC candidates.",
      horizontal: true,
    },
  );
}

function renderSSCTurnoutChart(data, chartId) {
  const voted = data.votesCast;
  const notVoted = Math.max(data.totalVoters - voted, 0);

  createOrUpdateChart(
    chartId,
    "doughnut",
    ["Voted", "Not Yet Voted"],
    [voted, notVoted],
    {
      title: "SSC Voter Turnout",
      description:
        "Comparison between registered SSC voters who voted and those who have not yet voted.",
    },
  );
}

function renderSSCYearChart(data, chartId) {
  createOrUpdateChart(
    chartId,
    "bar",
    data.yearLevel.labels,
    data.yearLevel.values,
    {
      title: "SSC Votes by Year Level",
      description:
        "Number of SSC voters who participated from each year level.",
    },
  );
}

function renderSSCProgramChart(data, chartId) {
  const series = getProgramSeries(data);

  createOrUpdateChart(chartId, "pie", series.programs, series.voted, {
    title: "SSC Votes per Program",
    description: "Share of SSC votes cast by each program.",
    backgroundColor: series.colors,
    legendPosition: "bottom",
    unit: "votes",
  });
}

function renderSSCProgramNotVotedChart(data, chartId) {
  const series = getProgramSeries(data);

  createOrUpdateChart(chartId, "pie", series.programs, series.notVoted, {
    title: "SSC Not Yet Voted per Program",
    description: "Registered SSC voters who have not voted, by program.",
    backgroundColor: series.colors,
    legendPosition: "bottom",
    unit: "not voted",
  });
}

function renderSSCActivityChart(data, chartId) {
  createOrUpdateChart(
    chartId,
    "line",
    data.activity.labels,
    data.activity.values,
    {
      title: "SSC Voting Activity",
      description:
        "Cumulative SSC voting activity throughout the election period.",
    },
  );
}

// Department
function renderDepartment(departmentCode, campusFilter = "all") {
  const container = document.getElementById("departmentCampusAnalytics");
  if (!container) return;

  destroyChartsWithPrefix("department");
  container.innerHTML = "";

  const department = DEPARTMENTS[departmentCode];
  if (!department || !department.id) {
    showDepartmentMessage("No department election is available yet.");
    return;
  }

  const deptTitle = department.title || departmentCode;
  const campusKeys =
    campusFilter === "all" ? Object.keys(CAMPUSES) : [campusFilter];

  campusKeys.forEach((campusKey) => {
    const data =
      analyticsData.departments?.departments?.[department.id]?.[campusKey];

    if (!data || !data.electionId) {
      container.insertAdjacentHTML(
        "beforeend",
        emptyCardMarkup(
          CAMPUSES[campusKey],
          `${deptTitle} Department Elections`,
          NO_CAMPUS_ELECTION_MESSAGE,
        ),
      );
      return;
    }

    const section = createCampusElectionSection(
      campusKey,
      data,
      "department",
      departmentCode,
    );
    container.appendChild(section);

    renderDepartmentCharts(departmentCode, campusKey, data);
  });
}

function showDepartmentMessage(message) {
  const container = document.getElementById("departmentCampusAnalytics");
  if (container) {
    container.innerHTML = emptyCardMarkup(
      "Department Elections",
      "Department analytics",
      message,
    );
  }
}

function renderDepartmentCharts(departmentCode, campusKey, data) {
  renderDepartmentCandidateChart(
    data,
    departmentCode,
    `departmentCandidateChart-${campusKey}`,
  );
  renderDepartmentTurnoutChart(
    data,
    departmentCode,
    `departmentTurnoutChart-${campusKey}`,
  );
  renderDepartmentYearChart(
    data,
    departmentCode,
    `departmentYearChart-${campusKey}`,
  );
  renderDepartmentActivityChart(
    data,
    departmentCode,
    `departmentActivityChart-${campusKey}`,
  );
  renderDepartmentStatusChart(
    data,
    departmentCode,
    `departmentStatusChart-${campusKey}`,
  );
  renderCandidatePhotos(
    `departmentCandidatePhotos-${campusKey}`,
    data.candidates,
  );
}

// Department charts
function renderDepartmentCandidateChart(data, departmentCode, chartId) {
  const deptTitle = DEPARTMENTS[departmentCode]?.title || departmentCode;
  createOrUpdateChart(
    chartId,
    "bar",
    data.candidates.map((c) => c.name),
    data.candidates.map((c) => c.votes),
    {
      title: `${deptTitle} Department Officer Votes`,
      description: `Votes received by candidates running for ${deptTitle} department officer positions.`,
      horizontal: true,
    },
  );
}

function renderDepartmentTurnoutChart(data, departmentCode, chartId) {
  const voted = data.votesCast;
  const notVoted = Math.max(data.totalVoters - voted, 0);

  createOrUpdateChart(
    chartId,
    "doughnut",
    ["Voted", "Not Yet Voted"],
    [voted, notVoted],
    {
      title: `${departmentCode} Department Voter Turnout`,
      description: `Turnout among voters belonging to ${departmentCode}.`,
    },
  );
}

function renderDepartmentYearChart(data, departmentCode, chartId) {
  createOrUpdateChart(
    chartId,
    "bar",
    data.yearLevel.labels,
    data.yearLevel.values,
    {
      title: `${departmentCode} Participation by Year Level`,
      description: `Voting participation among ${departmentCode} students by year level.`,
    },
  );
}

function renderDepartmentActivityChart(data, departmentCode, chartId) {
  createOrUpdateChart(
    chartId,
    "line",
    data.activity.labels,
    data.activity.values,
    {
      title: `${departmentCode} Department Voting Activity`,
      description: `Voting activity among ${departmentCode} students throughout the election period.`,
    },
  );
}

function renderDepartmentStatusChart(data, departmentCode, chartId) {
  const voted = data.votesCast ?? 0;
  const notVoted = Math.max((data.totalVoters ?? 0) - voted, 0);

  createOrUpdateChart(
    chartId,
    "bar",
    ["Voted", "Not Yet Voted"],
    [voted, notVoted],
    {
      title: `${departmentCode} Voting Status`,
      description: `Registered ${departmentCode} voters who have voted and those who have not yet voted.`,
      backgroundColor: ["#22C55E", "#EF4444"],
      legend: "labels",
      showPercent: true,
      unit: "voters",
    },
  );
}

// Force a chart to finish rendering before it's captured for export
async function prepareChartForExport(chart) {
  if (!chart) return;

  chart.stop();
  chart.options.animation = false;
  chart.resize();
  chart.update("none");

  // Let the browser actually paint the finished canvas
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

function destroyChartsWithPrefix(prefix) {
  Object.keys(charts).forEach((key) => {
    if (key.startsWith(prefix)) {
      charts[key].destroy();
      delete charts[key];
    }
  });
}

function createOrUpdateChart(canvasId, type, labels, values, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (!labels || labels.length === 0) {
    if (charts[canvasId]) {
      charts[canvasId].destroy();
      delete charts[canvasId];
    }
    return;
  }

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  const ctx = canvas.getContext("2d");
  const isHorizontal = options.horizontal === true;
  const isCircular = type === "doughnut" || type === "pie";
  const showPercent = options.showPercent ?? isCircular;
  const unit = options.unit || "votes";
  const useLabelLegend = options.legend === "labels" && !isCircular;

  const chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [
        {
          label: options.title || "",
          data: values,
          backgroundColor:
            options.backgroundColor ||
            (isCircular
              ? [
                  "#748FEA",
                  "#8E45F5",
                  "#5B5CEB",
                  "#22C55E",
                  "#F59E0B",
                  "#EF4444",
                  "#06B6D4",
                  "#EC4899",
                ]
              : "#748FEA"),
          borderColor:
            type === "line" ? "#5B5CEB" : isCircular ? "#FFFFFF" : undefined,
          borderWidth: type === "line" ? 2 : isCircular ? 2 : 1,
          borderRadius: type === "bar" ? 6 : 0,
          fill: type === "line" ? false : undefined,
          tension: type === "line" ? 0.35 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: isHorizontal ? "y" : "x",
      plugins: {
        legend: {
          display: isCircular || useLabelLegend,
          position: options.legendPosition || (isCircular ? "right" : "bottom"),
          ...(useLabelLegend ? { onClick: () => {} } : {}),
          labels: {
            font: { family: "Poppins", size: 12 },
            padding: 14,
            ...(useLabelLegend
              ? {
                  generateLabels: (c) => {
                    const colors = c.data.datasets[0].backgroundColor;
                    return c.data.labels.map((label, i) => ({
                      text: label,
                      fillStyle: colors[i],
                      strokeStyle: colors[i],
                      lineWidth: 0,
                      hidden: false,
                      index: i,
                      datasetIndex: 0,
                    }));
                  },
                }
              : {}),
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = Number(context.raw) || 0;

              if (!showPercent) return ` ${value} ${unit}`;

              const total = context.dataset.data.reduce(
                (sum, v) => sum + (Number(v) || 0),
                0,
              );
              const pct = total ? ((value / total) * 100).toFixed(1) : "0.0";
              const prefix = isCircular ? `${context.label}: ` : "";

              return ` ${prefix}${value} ${unit} (${pct}%)`;
            },
            footer: (items) => {
              if (!showPercent || !items.length) return "";
              const total = items[0].dataset.data.reduce(
                (sum, v) => sum + (Number(v) || 0),
                0,
              );
              return `Total: ${total}`;
            },
          },
        },
      },
      scales: isCircular
        ? {}
        : {
            x: {
              beginAtZero: true,
              ticks: { precision: 0, font: { family: "Poppins", size: 11 } },
            },
            y: {
              beginAtZero: true,
              ticks: { precision: 0, font: { family: "Poppins", size: 11 } },
            },
          },
    },
  });

  chart.$showPercent = showPercent; // used by the PDF export
  charts[canvasId] = chart;
}

// Candidate photos (alt text carries the candidate's name)
function renderCandidatePhotos(containerId, candidates) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  candidates.forEach((candidate) => {
    const wrapper = document.createElement("div");
    wrapper.className = "candidate-photo";

    const image = document.createElement("img");
    image.src = candidate.photo
      ? `/api/storage/file?path=${encodeURIComponent(candidate.photo)}`
      : "";
    image.alt = candidate.name;
    image.title = candidate.name;

    const label = document.createElement("span");
    label.textContent = candidate.name;

    wrapper.appendChild(image);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  });
}

// Export buttons
function initializeExportButtons() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".graph-export-btn");
    if (!button) return;

    const chartId = button.dataset.export;
    if (!chartId) return;

    await exportChartPDF(chartId);
  });

  document
    .getElementById("exportSSC")
    ?.addEventListener("click", exportAllSSCPDF);
  document
    .getElementById("exportDepartment")
    ?.addEventListener("click", exportAllDepartmentPDF);
}

// Load jsPDF on demand
let jsPDFPromise = null;

function loadJsPDF() {
  if (window.jspdf) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (jsPDFPromise) {
    return jsPDFPromise;
  }

  jsPDFPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

    script.onload = () => {
      if (window.jspdf?.jsPDF) {
        resolve(window.jspdf.jsPDF);
      } else {
        reject(new Error("jsPDF failed to load."));
      }
    };
    script.onerror = () => reject(new Error("Unable to load jsPDF."));

    document.head.appendChild(script);
  });

  return jsPDFPromise;
}

async function exportChartPDF(
  chartId,
  customTitle = null,
  customDescription = null,
  departmentCode = null,
) {
  const jsPDF = await loadJsPDF();
  const chart = charts[chartId];

  if (!chart) {
    showErrorToast("Nothing to Download", "This graph is not available yet.");
    return;
  }

  const canvas = document.getElementById(chartId);
  if (!canvas) {
    showErrorToast("Nothing to Download", "This graph could not be found.");
    return;
  }

  // Ensure Chart.js has fully rendered the selected campus chart
  await prepareChartForExport(chart);

  const title = customTitle || getChartTitle(chartId);
  const description = customDescription || getChartDescription(chartId);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  addPDFHeader(pdf, title, description);

  // Use the Chart.js image rather than reading the canvas directly
  const image = chart.toBase64Image("image/png", 1.0);
  const imageWidth = 180;
  const imageHeight = calculateImageHeight(canvas, imageWidth);

  pdf.addImage(image, "PNG", 15, 48, imageWidth, imageHeight);

  addChartValuesToPDF(pdf, chart, 48 + imageHeight + 12);
  addPDFFooter(pdf, departmentCode);

  pdf.save(`${sanitizeFilename(title)}.pdf`);
}

// Export a single SSC campus
async function exportCampusSSCPDF(campusKey) {
  await prepareChartsForExport("ssc", null, [campusKey]);
  await exportChartsForCampuses("ssc", null, [campusKey]);
}

// Export a single department campus
async function exportCampusDepartmentPDF(departmentCode, campusKey) {
  await prepareChartsForExport("department", departmentCode, [campusKey]);
  await exportChartsForCampuses("department", departmentCode, [campusKey]);
}

// Expand every election in the given campuses and re-render their charts
// so Chart.js has real dimensions to draw into before export.
async function prepareChartsForExport(type, departmentCode, campusKeys) {
  const containerId =
    type === "ssc" ? "sscCampusAnalytics" : "departmentCampusAnalytics";
  const container = document.getElementById(containerId);
  if (!container) return;

  campusKeys.forEach((campusKey) => {
    const electionSection = [
      ...container.querySelectorAll(".campus-election-section"),
    ].find((section) => {
      const heading = section.querySelector(".campus-election-title h2");
      return heading && heading.textContent.trim() === CAMPUSES[campusKey];
    });
    if (!electionSection) return;

    electionSection.querySelectorAll(".election-item").forEach((election) => {
      election.classList.add("expanded");

      const content = election.querySelector(".election-content");
      if (content) content.style.display = "block";

      const expandButton = election.querySelector(".expand-election");
      if (expandButton)
        expandButton.innerHTML = `<i class="bi bi-chevron-up"></i>`;
    });
  });

  // Let display:block apply before Chart.js recalculates canvas sizes
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

  for (const campusKey of campusKeys) {
    const data =
      type === "ssc"
        ? getSscData(campusKey)
        : analyticsData.departments?.departments?.[departmentCode]?.[campusKey];
    if (!data) continue;

    if (!data.candidates || data.candidates.length === 0) continue;

    if (type === "ssc") {
      renderSSCCharts(campusKey, data);
    } else {
      renderDepartmentCharts(departmentCode, campusKey, data);
    }
  }

  // Charts were just recreated (and may be animating) — force them
  // to finish rendering before the PDF is generated.
  const chartTypes = type === "ssc" ? SSC_CHART_TYPES : DEPARTMENT_CHART_TYPES;

  for (const campusKey of campusKeys) {
    for (const chartType of chartTypes) {
      const chart = charts[`${chartType}-${campusKey}`];
      if (chart) await prepareChartForExport(chart);
    }
  }
}

// Export the selected campus(es)/election as one PDF
async function exportChartsForCampuses(type, departmentCode, campusKeys) {
  const jsPDF = await loadJsPDF();

  const chartTypes = type === "ssc" ? SSC_CHART_TYPES : DEPARTMENT_CHART_TYPES;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let firstPage = true;

  for (const campusKey of campusKeys) {
    for (const chartType of chartTypes) {
      const chartId = `${chartType}-${campusKey}`;
      const chart = charts[chartId];
      const canvas = document.getElementById(chartId);

      if (!chart || !canvas) continue;
      if (canvas.width <= 0 || canvas.height <= 0) {
        console.warn(`Skipping invalid chart: ${chartId}`);
        continue;
      }

      await prepareChartForExport(chart);

      if (!firstPage) pdf.addPage();
      firstPage = false;

      const campusName = CAMPUSES[campusKey];

      const title =
        type === "ssc"
          ? `${campusName} — ${getChartTitle(chartId)}`
          : `${campusName} — ${getDepartmentChartTitle(chartId, departmentCode)}`;

      const description =
        type === "ssc"
          ? getChartDescription(chartId)
          : getDepartmentChartDescription(chartId, departmentCode);

      addPDFHeader(
        pdf,
        title,
        description,
        type === "ssc"
          ? `${campusName} — SSC`
          : `${departmentCode} — ${campusName}`,
      );

      const image = chart.toBase64Image("image/png", 1.0);
      const imageWidth = 180;
      const imageHeight = calculateImageHeight(canvas, imageWidth);

      pdf.addImage(image, "PNG", 15, 48, imageWidth, imageHeight);
      addChartValuesToPDF(pdf, chart, 48 + imageHeight + 12);

      addPDFFooter(
        pdf,
        type === "ssc"
          ? `${campusName} - SSC`
          : `${departmentCode} - ${campusName}`,
      );
    }
  }

  if (firstPage) {
    showErrorToast(
      "Nothing to Download",
      "There are no graphs available for this election.",
    );
    return;
  }

  const filename =
    type === "ssc"
      ? `SSC-Graphs-${CAMPUSES[campusKeys[0]]}`
      : `${departmentCode}-Graphs-${CAMPUSES[campusKeys[0]]}`;

  pdf.save(`${sanitizeFilename(filename)}.pdf`);
}

// Export all SSC graphs for the selected campus (or every campus)
async function exportAllSSCPDF() {
  if (!hasCharts("ssc")) {
    showErrorToast(
      "Nothing to Download",
      "There are no SSC graphs to download.",
    );
    return;
  }
  const campusFilter =
    document.getElementById("sscCampusSelector")?.value || "all";
  const campusKeys =
    campusFilter === "all" ? Object.keys(CAMPUSES) : [campusFilter];

  await prepareChartsForExport("ssc", null, campusKeys);
  await exportChartsForCampuses("ssc", null, campusKeys);
}

// Export all graphs for the selected department + campus (or every campus)
async function exportAllDepartmentPDF() {
  const department = DEPARTMENTS[currentDepartment];
  if (!department || !hasCharts("department")) {
    showErrorToast(
      "Nothing to Download",
      "There are no department graphs to download.",
    );
    return;
  }

  const campusFilter =
    document.getElementById("departmentCampusSelector")?.value || "all";
  const campusKeys =
    campusFilter === "all" ? Object.keys(CAMPUSES) : [campusFilter];

  await prepareChartsForExport("department", currentDepartment, campusKeys);
  await exportChartsForCampuses("department", currentDepartment, campusKeys);
}

// PDF header
function addPDFHeader(pdf, title, description, sectionLabel = null) {
  PdfBrand.drawHeader(pdf, {
    title,
    description,
    sectionLabel,
    report: "Analytics Report",
  });
}

// PDF footer
function addPDFFooter(pdf, label = "") {
  PdfBrand.drawFooter(pdf, {
    label,
    report: "Election Analytics Report",
  });
}

// Add labels/values table to PDF
function addChartValuesToPDF(pdf, chart, startY) {
  let y = startY;

  const labels = chart.data.labels || [];
  const values = chart.data.datasets?.[0]?.data || [];

  if (!labels.length) return y;

  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);
  const showPercent = chart.$showPercent === true;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Labels and Values", 15, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  labels.forEach((label, index) => {
    const value = values[index] ?? 0;
    const pct = total ? ((value / total) * 100).toFixed(1) : "0.0";

    if (y > 270) {
      pdf.addPage();
      y = 20;
    }

    pdf.text(
      showPercent ? `${label}: ${value} (${pct}%)` : `${label}: ${value}`,
      20,
      y,
    );
    y += 5;
  });

  if (showPercent) {
    if (y > 270) {
      pdf.addPage();
      y = 20;
    }
    pdf.setFont("helvetica", "bold");
    pdf.text(`Total: ${total}`, 20, y);
    y += 5;
  }

  return y;
}

// Chart title/description lookups
function getChartTitle(chartId) {
 const baseChartId = stripCampusSuffix(chartId);
  const titles = {
    sscPartylistChart: "SSC Partylist Vote Distribution",
    sscCandidateChart: "SSC Candidate Votes",
    sscTurnoutChart: "SSC Voter Turnout",
    sscYearChart: "SSC Votes by Year Level",
    sscActivityChart: "SSC Voting Activity",
    sscProgramChart: "SSC Votes per Program",
    sscProgramNotVotedChart: "SSC Not Yet Voted per Program",
    departmentCandidateChart: "Department Officer Votes",
    departmentTurnoutChart: "Department Voter Turnout",
    departmentYearChart: "Participation by Year Level",
    departmentActivityChart: "Department Voting Activity",
    departmentStatusChart: "Voting Status",
  };

  return titles[baseChartId] || "LCCast Analytics";
}

function getChartDescription(chartId) {
  const baseChartId = stripCampusSuffix(chartId);

  const descriptions = {
    sscPartylistChart: "Distribution of votes received by each SSC partylist.",
    sscCandidateChart: "Votes received by individual SSC candidates.",
    sscTurnoutChart:
      "Comparison between registered SSC voters who voted and those who have not yet voted.",
    sscYearChart: "Number of SSC voters who participated from each year level.",
    sscProgramNotVotedChart:
      "Registered SSC voters who have not yet voted, by program.",
    sscProgramChart:
      "Number of SSC votes cast by students from each academic program.",
    sscActivityChart:
      "Cumulative SSC voting activity throughout the election period.",
    departmentCandidateChart:
      "Votes received by candidates running for department officer positions.",
    departmentTurnoutChart:
      "Turnout among voters belonging to the selected department.",
    departmentYearChart:
      "Voting participation among students of the selected department by year level.",
    departmentActivityChart:
      "Voting activity among students of the selected department throughout the election period.",
    departmentStatusChart:
      "Registered department voters who have voted and those who have not yet voted.",
  };

  return descriptions[baseChartId] || "";
}

function getDepartmentChartTitle(chartId, departmentCode) {
  const titles = {
    departmentCandidateChart: `${departmentCode} Department Officer Votes`,
    departmentTurnoutChart: `${departmentCode} Department Voter Turnout`,
    departmentYearChart: `${departmentCode} Participation by Year Level`,
    departmentActivityChart: `${departmentCode} Department Voting Activity`,
    departmentStatusChart: `${departmentCode} Voting Status`,
  };

  return titles[chartId] || `${departmentCode} Department Analytics`;
}

function getDepartmentChartDescription(chartId, departmentCode) {
  const descriptions = {
    departmentCandidateChart: `Votes received by candidates running for ${departmentCode} department officer positions.`,
    departmentTurnoutChart: `Turnout only among voters belonging to ${departmentCode}.`,
    departmentYearChart: `Voting participation among ${departmentCode} students by year level.`,
    departmentActivityChart: `Voting activity among ${departmentCode} students throughout the election period.`,
    departmentStatusChart: `Registered ${departmentCode} voters who have voted and those who have not yet voted.`,
  };

  return descriptions[chartId] || "";
}

// Helpers
function calculateImageHeight(canvas, width) {
  if (!canvas.width) return 80;
  return (canvas.height / canvas.width) * width;
}

function updateElement(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function calculatePercentage(value, total) {
  if (!total) return "0%";
  return ((value / total) * 100).toFixed(1) + "%";
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-z0-9\s-_]/gi, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Success toast
function initializeSuccessToast() {
  successToast = document.getElementById("successToast");
  successToastTitle = document.getElementById("successToastTitle");
  successToastMessage = document.getElementById("successToastMessage");
  successToastClose = document.getElementById("successToastClose");

  successToastClose?.addEventListener("click", hideSuccessToast);
}

function initializeActionLoadingModal() {
  actionLoadingModal = document.getElementById("actionLoadingModal");
  actionLoadingTitle = document.getElementById("actionLoadingTitle");
  actionLoadingMessage = document.getElementById("actionLoadingMessage");

  if (!actionLoadingModal) {
    console.error("actionLoadingModal was not found.");
  }
}

function showActionLoading(
  title = "Processing...",
  message = "Please wait while we process your request.",
) {
  if (!actionLoadingModal) return;

  if (actionLoadingTitle) {
    actionLoadingTitle.textContent = title;
  }

  if (actionLoadingMessage) {
    actionLoadingMessage.textContent = message;
  }

  actionLoadingModal.classList.add("show");
  document.body.classList.add("modal-loading");
}

function hideActionLoading() {
  if (!actionLoadingModal) return;

  actionLoadingModal.classList.remove("show");
  document.body.classList.remove("modal-loading");
}

function showSuccessToast(
  title = "Success",
  message = "Action completed successfully.",
  type = "success",
) {
  if (!successToast) return;

  if (successToastTimer) clearTimeout(successToastTimer);

  if (successToastTitle) successToastTitle.textContent = title;
  if (successToastMessage) successToastMessage.textContent = message;

  successToast.classList.toggle("error", type === "error");
  const icon = successToast.querySelector(".success-toast-icon i");
  if (icon) icon.className = type === "error" ? "bi bi-x-lg" : "bi bi-check-lg";

  successToast.classList.add("show");
  successToastTimer = setTimeout(hideSuccessToast, 3500);
}

function showErrorToast(title, message) {
  showSuccessToast(title, message, "error");
}

function hasCharts(prefix) {
  return Object.keys(charts).some((key) => key.startsWith(prefix));
}

function hideSuccessToast() {
  if (!successToast) return;

  successToast.classList.remove("show");

  if (successToastTimer) {
    clearTimeout(successToastTimer);
    successToastTimer = null;
  }
}

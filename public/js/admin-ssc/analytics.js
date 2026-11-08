/* =========================================================
   LCCAST — ADMIN-SSC ANALYTICS PAGE
   Scoped to the admin's own campus. SSC only.
========================================================= */

document.addEventListener("DOMContentLoaded", initializeAnalytics);

let analyticsData = null;
let analyticsHistory = [];
let selectedElectionId = null;
const charts = {};
let stompClient = null;
const expandedElectionIds = new Set();

const ADMIN_CAMPUS_ID = document.body.dataset.adminCampusId || "";
const ADMIN_CAMPUS_NAME = document.body.dataset.adminCampusName || "";

const SSC_PROGRAM_COLORS = {
  BSIS: "#5B5CEB",
  BSHM: "#22C55E",
  BSCRIM: "#EF4444",
  BSPSYCH: "#8E45F5",
  BSPSY: "#8E45F5",
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

function getProgramRank(program) {
  const list = SystemConfig.programsForCampus(ADMIN_CAMPUS_ID);
  const i = list.findIndex((p) => p.acronym.toUpperCase() === program);
  return i === -1 ? 999 : i;
}

/* One shared program list so both pies have identical labels, order and colors. */
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

let successToast, successToastTitle, successToastMessage, successToastClose;
let successToastTimer = null;

async function initializeAnalytics() {
  try {
    initializeSuccessToast();

    try {
      await SystemConfig.load();
    } catch (error) {
      console.error(error);
    }

    showAnalyticsContentSkeleton(document.getElementById("sscCampusAnalytics"));

    analyticsData = await loadAnalyticsData();

    initializeExportButtons();
    renderSSC();
    connectAnalyticsSocket();
  } catch (error) {
    console.error("Failed to initialize analytics:", error);
    const container = document.getElementById("sscCampusAnalytics");
    if (container) container.innerHTML = "";
  }
}

let analyticsRevalidateTimer = null;

function scheduleAnalyticsRefresh() {
  clearTimeout(analyticsRevalidateTimer);
  analyticsRevalidateTimer = setTimeout(async () => {
    try {
      const scrollY = window.scrollY;
      analyticsData = await loadAnalyticsData();
      renderSSC();
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    } catch (error) {
      console.error("Failed to refresh analytics:", error);
    }
  }, 50);
}

async function loadAnalyticsData(force = false) {
  const options = { force, onRevalidated: scheduleAnalyticsRefresh };

  const [latest, history] = await Promise.all([
    SoftCache.load("/admin-ssc/api/analytics", options),
    SoftCache.load("/admin-ssc/api/analytics/history", options),
  ]);

  analyticsHistory = history;
  return (
    analyticsHistory.find((e) => e.electionId === selectedElectionId) || latest
  );
}

function connectAnalyticsSocket() {
  const socket = new SockJS("/ws-analytics");
  stompClient = new StompJs.Client({
    webSocketFactory: () => socket,
    reconnectDelay: 3000,
  });

  stompClient.onConnect = () => {
    // Broadcast carries every campus's data; admin-ssc only needs its own,
    // so just re-fetch the scoped endpoint whenever anything changes.
    stompClient.subscribe("/topic/analytics", async () => {
      try {
        const scrollY = window.scrollY;
        analyticsData = await loadAnalyticsData(true);
        renderSSC();
        requestAnimationFrame(() => window.scrollTo(0, scrollY));
      } catch (error) {
        console.error("Failed to refresh analytics:", error);
      }
    });
  };

  stompClient.activate();
}

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
    </div>
  `;
}

/* =========================================================
   RENDER — single campus, no selector needed
========================================================= */

function renderSSC() {
  const container = document.getElementById("sscCampusAnalytics");
  if (!container) return;

  destroyChartsWithPrefix("ssc");
  container.innerHTML = "";

  const data = analyticsData;
  if (!data || !data.electionId) {
    container.innerHTML = emptyCardMarkup(
      ADMIN_CAMPUS_NAME,
      "Supreme Student Council Elections",
      NO_CAMPUS_ELECTION_MESSAGE,
    );
    return;
  }

  const section = createCampusElectionSection(data);
  container.appendChild(section);
  renderSSCCharts(data);
}

function createCampusElectionSection(data) {
  const section = document.createElement("div");
  section.className = "campus-election-section";

  const elections = data.electionId
    ? [{ id: data.electionId, title: data.electionTitle }]
    : [];

  //    const yearSelector = sscElections.length > 1 ? `
  //      <div class="election-year-select-wrapper">
  //        <i class="bi bi-calendar-event"></i>
  //        <select class="election-year-select" data-campus="${campusKey}">
  //          ${sscElections.map((e) => `
  //            <option value="${e.electionId}" ${e.electionId === data.electionId ? "selected" : ""}>
  //              ${escapeHtml(e.schoolYear || "—")} — ${escapeHtml(e.electionTitle)}${e.phase === "CONCLUDED" ? " (Concluded)" : ""}
  //            </option>`).join("")}
  //        </select>
  //        <i class="bi bi-chevron-down select-caret"></i>
  //      </div>` : "";

  const yearSelector =
    analyticsHistory.length > 1
      ? `
        <div class="election-year-select-wrapper">
          <i class="bi bi-calendar-event"></i>
          <select class="election-year-select" id="sscElectionYearSelect">
            ${analyticsHistory
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
                <h2>${escapeHtml(ADMIN_CAMPUS_NAME)}</h2>
                <p>Supreme Student Council Elections</p>
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
                  const isExpanded = expandedElectionIds.has(election.id);
                  return `
              <div class="election-item${isExpanded ? " expanded" : ""}" data-election-id="${election.id}">
                  <div class="election-item-header">
                      <div class="election-title">
                          <i class="bi bi-calendar-event"></i>
                          <span>${escapeHtml(election.title)}</span>
                      </div>
                      <div class="election-actions">
                          <button type="button" class="election-action-btn expand-election" title="Expand Election">
                              <i class="bi ${isExpanded ? "bi-chevron-up" : "bi-chevron-down"}"></i>
                          </button>
                      </div>
                  </div>
                  <div class="election-content" style="display:${isExpanded ? "block" : "none"}">
                      <div class="election-export-row">
                          <button type="button" class="election-export-btn" data-election="${election.id}">
                              <i class="bi bi-download"></i>
                              Export Graphs
                          </button>
                      </div>
                      ${createElectionGraphsMarkup()}
                  </div>
              </div>
            `;
                })
                .join("")
        }
    </div>
  `;

  section
    .querySelector("#sscElectionYearSelect")
    ?.addEventListener("change", (event) => {
      selectedElectionId = event.target.value;
      analyticsData =
        analyticsHistory.find((e) => e.electionId === selectedElectionId) ||
        analyticsData;
      expandedElectionIds.add(selectedElectionId);
      renderSSC();
    });

  initializeElectionActions(section);
  return section;
}

function createElectionGraphsMarkup() {
  const data = analyticsData;
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
            <button class="graph-export-btn" data-export="sscPartylistChart"><i class="bi bi-download"></i></button>
        </div>
        <div class="chart-container chart-container-donut">
            <canvas id="sscPartylistChart"></canvas>
        </div>
    </div>

    <div class="analytics-card">
        <div class="analytics-card-header">
            <div>
                <h3>Candidate Votes</h3>
                <p>Votes received by individual SSC candidates.</p>
            </div>
            <button class="graph-export-btn" data-export="sscCandidateChart"><i class="bi bi-download"></i></button>
        </div>
        <div class="chart-container">
            <canvas id="sscCandidateChart"></canvas>
        </div>
        <div class="candidate-photo-list" id="sscCandidatePhotos"></div>
    </div>

    <div class="analytics-two-column">
        <div class="analytics-card">
            <div class="analytics-card-header">
                <h3>Voter Turnout</h3>
                <button class="graph-export-btn" data-export="sscTurnoutChart"><i class="bi bi-download"></i></button>
            </div>
            <div class="chart-container small-chart">
                <canvas id="sscTurnoutChart"></canvas>
            </div>
        </div>
        <div class="analytics-card">
            <div class="analytics-card-header">
                <h3>Votes by Year Level</h3>
                <button class="graph-export-btn" data-export="sscYearChart"><i class="bi bi-download"></i></button>
            </div>
            <div class="chart-container small-chart">
                <canvas id="sscYearChart"></canvas>
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
                    <button class="graph-export-btn" data-export="sscProgramChart" title="Export Votes per Program"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container chart-container-donut">
                    <canvas id="sscProgramChart"></canvas>
                </div>
            </div>
            <div class="analytics-card">
                <div class="analytics-card-header">
                    <div>
                        <h3>Not Yet Voted per Program</h3>
                        <p>Registered voters who have not voted, by program.</p>
                    </div>
                    <button class="graph-export-btn" data-export="sscProgramNotVotedChart" title="Export Not Yet Voted per Program"><i class="bi bi-download"></i></button>
                </div>
                <div class="chart-container chart-container-donut">
                    <canvas id="sscProgramNotVotedChart"></canvas>
                </div>
            </div>
        </div>

    <div class="analytics-card">
        <div class="analytics-card-header">
            <h3>Voting Activity</h3>
            <button class="graph-export-btn" data-export="sscActivityChart"><i class="bi bi-download"></i></button>
        </div>
        <div class="chart-container">
            <canvas id="sscActivityChart"></canvas>
        </div>
    </div>
  `;
}

function initializeElectionActions(section) {
  section.querySelectorAll(".expand-election").forEach((button) => {
    button.addEventListener("click", () => {
      const election = button.closest(".election-item");
      if (!election) return;

      const electionId = election.dataset.electionId;
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
      await exportAllSSCPDF();
    });
  });
}

function renderSSCCharts(data) {
  renderSSCPartylistChart(data);
  renderSSCCandidateChart(data);
  renderSSCTurnoutChart(data);
  renderSSCYearChart(data);
  renderSSCActivityChart(data);
  renderSSCProgramChart(data);
  renderSSCProgramNotVotedChart(data);
  renderCandidatePhotos("sscCandidatePhotos", data.candidates);
}

function renderSSCPartylistChart(data) {
  createOrUpdateChart(
    "sscPartylistChart",
    "doughnut",
    data.partyLists.map((i) => i.name),
    data.partyLists.map((i) => i.votes),
    {
      title: "SSC Partylist Vote Distribution",
      description: "Distribution of votes received by each SSC partylist.",
    },
  );
}

function renderSSCCandidateChart(data) {
  createOrUpdateChart(
    "sscCandidateChart",
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

function renderSSCTurnoutChart(data) {
  const voted = data.votesCast;
  const notVoted = Math.max(data.totalVoters - voted, 0);
  createOrUpdateChart(
    "sscTurnoutChart",
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

function renderSSCYearChart(data) {
  createOrUpdateChart(
    "sscYearChart",
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

function renderSSCProgramChart(data) {
  const series = getProgramSeries(data);

  createOrUpdateChart("sscProgramChart", "pie", series.programs, series.voted, {
    title: "SSC Votes per Program",
    description: "Share of SSC votes cast by each program.",
    backgroundColor: series.colors,
    legendPosition: "bottom",
    unit: "votes",
  });
}

function renderSSCProgramNotVotedChart(data) {
  const series = getProgramSeries(data);

  createOrUpdateChart(
    "sscProgramNotVotedChart",
    "pie",
    series.programs,
    series.notVoted,
    {
      title: "SSC Not Yet Voted per Program",
      description: "Registered SSC voters who have not voted, by program.",
      backgroundColor: series.colors,
      legendPosition: "bottom",
      unit: "not voted",
    },
  );
}

function renderSSCActivityChart(data) {
  createOrUpdateChart(
    "sscActivityChart",
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

/* =========================================================
   CHART LIFECYCLE (unchanged logic, reused as-is)
========================================================= */

async function prepareChartForExport(chart) {
  if (!chart) return;
  chart.stop();
  chart.options.animation = false;
  chart.resize();
  chart.update("none");
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

/* =========================================================
   EXPORT (PDF) — same as before, but single-campus
========================================================= */

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
}

let jsPDFPromise = null;

function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (jsPDFPromise) return jsPDFPromise;

  jsPDFPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () =>
      window.jspdf?.jsPDF
        ? resolve(window.jspdf.jsPDF)
        : reject(new Error("jsPDF failed to load."));
    script.onerror = () => reject(new Error("Unable to load jsPDF."));
    document.head.appendChild(script);
  });

  return jsPDFPromise;
}

async function exportChartPDF(chartId) {
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

  await prepareChartForExport(chart);

  const title = getChartTitle(chartId);
  const description = getChartDescription(chartId);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  addPDFHeader(pdf, title, description, ADMIN_CAMPUS_NAME);

  const image = chart.toBase64Image("image/png", 1.0);
  const imageWidth = 180;
  const imageHeight = calculateImageHeight(canvas, imageWidth);

  pdf.addImage(image, "PNG", 15, 48, imageWidth, imageHeight);
  addChartValuesToPDF(pdf, chart, 48 + imageHeight + 12);
  addPDFFooter(pdf, ADMIN_CAMPUS_NAME);

  pdf.save(`${sanitizeFilename(title)}.pdf`);
}

async function exportAllSSCPDF() {
  if (!hasCharts("ssc")) {
    showErrorToast(
      "Nothing to Download",
      "There are no SSC graphs to download.",
    );
    return;
  }
  const container = document.getElementById("sscCampusAnalytics");
  container?.querySelectorAll(".election-item").forEach((election) => {
    election.classList.add("expanded");
    const content = election.querySelector(".election-content");
    if (content) content.style.display = "block";
    const btn = election.querySelector(".expand-election");
    if (btn) btn.innerHTML = `<i class="bi bi-chevron-up"></i>`;
  });

  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

  if (analyticsData?.candidates?.length) renderSSCCharts(analyticsData);

  const chartTypes = SSC_CHART_TYPES;

  for (const chartType of chartTypes) {
    const chart = charts[chartType];
    if (chart) await prepareChartForExport(chart);
  }

  const jsPDF = await loadJsPDF();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let firstPage = true;

  for (const chartType of chartTypes) {
    const chart = charts[chartType];
    const canvas = document.getElementById(chartType);
    if (!chart || !canvas || canvas.width <= 0 || canvas.height <= 0) continue;

    await prepareChartForExport(chart);

    if (!firstPage) pdf.addPage();
    firstPage = false;

    const title = `${ADMIN_CAMPUS_NAME} — ${getChartTitle(chartType)}`;
    const description = getChartDescription(chartType);

    addPDFHeader(pdf, title, description, `${ADMIN_CAMPUS_NAME} — SSC`);

    const image = chart.toBase64Image("image/png", 1.0);
    const imageWidth = 180;
    const imageHeight = calculateImageHeight(canvas, imageWidth);

    pdf.addImage(image, "PNG", 15, 48, imageWidth, imageHeight);
    addChartValuesToPDF(pdf, chart, 48 + imageHeight + 12);
    addPDFFooter(pdf, `${ADMIN_CAMPUS_NAME} - SSC`);
  }

  if (firstPage) {
    showErrorToast(
      "Nothing to Download",
      "There are no graphs available for this election.",
    );
    return;
  }

  pdf.save(`${sanitizeFilename(`SSC-Graphs-${ADMIN_CAMPUS_NAME}`)}.pdf`);
}

function addPDFHeader(pdf, title, description, sectionLabel = null) {
  PdfBrand.drawHeader(pdf, {
    title,
    description,
    sectionLabel,
    report: "Analytics Report",
  });
}

function addPDFFooter(pdf, label = "") {
  PdfBrand.drawFooter(pdf, {
    label,
    report: "Election Analytics Report",
  });
}

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

function getChartTitle(chartId) {
  const titles = {
    sscPartylistChart: "SSC Partylist Vote Distribution",
    sscCandidateChart: "SSC Candidate Votes",
    sscTurnoutChart: "SSC Voter Turnout",
    sscYearChart: "SSC Votes by Year Level",
    sscActivityChart: "SSC Voting Activity",
    sscProgramChart: "SSC Votes per Program",
    sscProgramNotVotedChart: "SSC Not Yet Voted per Program",
  };
  return titles[chartId] || "LCCast Analytics";
}

function getChartDescription(chartId) {
  const descriptions = {
    sscPartylistChart: "Distribution of votes received by each SSC partylist.",
    sscCandidateChart: "Votes received by individual SSC candidates.",
    sscTurnoutChart:
      "Comparison between registered SSC voters who voted and those who have not yet voted.",
    sscYearChart: "Number of SSC voters who participated from each year level.",
    sscProgramChart:
      "Number of SSC votes cast by students from each academic program.",
    sscActivityChart:
      "Cumulative SSC voting activity throughout the election period.",
    sscProgramNotVotedChart:
      "Registered SSC voters who have not yet voted, by program.",
  };
  return descriptions[chartId] || "";
}

function calculateImageHeight(canvas, width) {
  if (!canvas.width) return 80;
  return (canvas.height / canvas.width) * width;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initializeSuccessToast() {
  successToast = document.getElementById("successToast");
  successToastTitle = document.getElementById("successToastTitle");
  successToastMessage = document.getElementById("successToastMessage");
  successToastClose = document.getElementById("successToastClose");
  successToastClose?.addEventListener("click", hideSuccessToast);
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

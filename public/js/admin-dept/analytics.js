let successToast, successToastTitle, successToastMessage, successToastClose;
let successToastTimer = null;
let actionLoadingModal;
let actionLoadingTitle;
let actionLoadingMessage;

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
                  "#748FEA", "#8E45F5", "#5B5CEB", "#22C55E",
                  "#F59E0B", "#EF4444", "#06B6D4", "#EC4899",
                ]
              : "#748FEA"),
          borderColor: type === "line" ? "#5B5CEB" : isCircular ? "#FFFFFF" : undefined,
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

function destroyChartsWithPrefix(prefix) {
  Object.keys(charts).forEach((key) => {
    if (key.startsWith(prefix)) {
      charts[key].destroy();
      delete charts[key];
    }
  });
}

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

document.addEventListener("DOMContentLoaded", initializeAnalytics);

const charts = {};
let stompClient = null;
let currentData = null;
let selectedElectionId = null;

async function initializeAnalytics() {
  try {
    initializeSuccessToast();
    initializeActionLoadingModal();
    initializeExportButton();

    showAnalyticsContentSkeleton(document.getElementById("departmentCampusAnalytics"));

    await loadAndRenderAnalytics();
    connectAnalyticsSocket();
  } catch (error) {
    console.error("Failed to initialize analytics:", error);
    const container = document.getElementById("departmentCampusAnalytics");
    if (container) {
          container.innerHTML = renderDepartmentEmptyCard(
            "Department",
            "Department Elections",
            "Unable to load analytics right now. Please refresh the page.",
          );
        }
  }
}

async function loadAndRenderAnalytics(force = false) {
  currentData = await SoftCache.load("/api/admin-dept/analytics", {
    force,
    onRevalidated: (fresh) => {
      const scrollY = window.scrollY;
      currentData = fresh;
      renderDepartmentAnalytics(currentData);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    },
  });
  renderDepartmentAnalytics(currentData);
}

function connectAnalyticsSocket() {
  const socket = new SockJS("/ws-analytics");
  stompClient = new StompJs.Client({
    webSocketFactory: () => socket,
    reconnectDelay: 3000,
  });

  stompClient.onConnect = () => {
    // Payload is the superadmin-wide shape; we just use the message as a refresh signal.
    stompClient.subscribe("/topic/analytics", async () => {
      const scrollY = window.scrollY;
      await loadAndRenderAnalytics(true);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    });
  };

  stompClient.activate();
}

function renderDepartmentEmptyCard(titleName, subtitle, message) {
  return `
    <div class="campus-election-section">
        <div class="campus-election-header">
            <div class="campus-election-title">
                <i class="bi bi-geo-alt"></i>
                <div>
                    <h2>${escapeHtml(titleName)}</h2>
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function renderDepartmentSetupRequiredCard(message) {
  return `
    <div class="campus-election-section">
        <div class="campus-election-header">
            <div class="campus-election-title">
                <i class="bi bi-exclamation-circle"></i>
                <div>
                    <h2>Setup Required</h2>
                </div>
            </div>
        </div>

        <div class="campus-election-list">
            <p class="no-election-message">${escapeHtml(message)}</p>
        </div>
    </div>
  `;
}

function renderDepartmentAnalytics(data) {
  destroyChartsWithPrefix("department");

  const container = document.getElementById("departmentCampusAnalytics");
  if (!container) return;
  container.innerHTML = "";

    if (!data || !data.departmentId || !data.hasActiveElection || !data.analytics) {
      container.innerHTML = renderDepartmentEmptyCard(
        data?.departmentTitle || data?.departmentName || "Department",
        "Department Elections",
        "No active election for your department yet.",
      );
      return;
    }

  const history = data.history?.length ? data.history : [data.analytics];
  const ca = history.find((e) => e.electionId === selectedElectionId) || history[0];
  selectedElectionId = ca.electionId;

    const yearSelector = history.length > 1 ? `
      <div class="election-year-select-wrapper">
        <i class="bi bi-calendar-event"></i>
        <select class="election-year-select" id="departmentElectionYearSelect">
          ${history.map((e) => `
            <option value="${e.electionId}" ${e.electionId === ca.electionId ? "selected" : ""}>
              ${escapeHtml(e.schoolYear || "—")} — ${escapeHtml(e.electionTitle)}${e.phase === "CONCLUDED" ? " (Concluded)" : ""}
            </option>`).join("")}
        </select>
        <i class="bi bi-chevron-down select-caret"></i>
      </div>` : "";

  container.innerHTML = `
    <div class="campus-election-section">
        <div class="campus-election-header">
            <div class="campus-election-title">
                <i class="bi bi-geo-alt"></i>
                <div>
                    <h2>${ca.campus}</h2>
                    <p>${data.departmentTitle || data.departmentName} Department Elections</p>
                </div>
            </div>
            ${yearSelector}
        </div>

        <div class="election-item expanded">
            <div class="election-item-header">
                <div class="election-title">
                    <i class="bi bi-calendar-event"></i>
                    <span>${ca.electionTitle}</span>
                </div>
            </div>
            <div class="election-content" style="display:block">

                <div class="analytics-summary-grid">
                    <div class="analytics-summary-card">
                        <div class="summary-icon"><i class="bi bi-people"></i></div>
                        <div><span>Department Voters</span><strong>${ca.totalVoters}</strong></div>
                    </div>
                    <div class="analytics-summary-card">
                        <div class="summary-icon"><i class="bi bi-check2-circle"></i></div>
                        <div><span>Votes Cast</span><strong>${ca.votesCast}</strong></div>
                    </div>
                    <div class="analytics-summary-card">
                        <div class="summary-icon"><i class="bi bi-percent"></i></div>
                        <div><span>Turnout</span><strong>${calculatePercentage(ca.votesCast, ca.totalVoters)}</strong></div>
                    </div>
                    <div class="analytics-summary-card">
                        <div class="summary-icon"><i class="bi bi-person-badge"></i></div>
                        <div><span>Officer Candidates</span><strong>${ca.candidates.length}</strong></div>
                    </div>
                </div>

                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <div>
                            <h3>Department Officer Votes</h3>
                            <p>Votes received by department officer candidates.</p>
                        </div>
                        <button class="graph-export-btn" data-export="departmentCandidateChart"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container">
                        <canvas id="departmentCandidateChart"></canvas>
                    </div>
                    <div class="candidate-photo-list" id="departmentCandidatePhotos"></div>
                </div>

                <div class="analytics-two-column">
                    <div class="analytics-card">
                        <div class="analytics-card-header">
                            <h3>Voter Turnout</h3>
                            <button class="graph-export-btn" data-export="departmentTurnoutChart"><i class="bi bi-download"></i></button>
                        </div>
                        <div class="chart-container small-chart">
                            <canvas id="departmentTurnoutChart"></canvas>
                        </div>
                    </div>
                    <div class="analytics-card">
                        <div class="analytics-card-header">
                            <h3>Participation by Year Level</h3>
                            <button class="graph-export-btn" data-export="departmentYearChart"><i class="bi bi-download"></i></button>
                        </div>
                        <div class="chart-container small-chart">
                            <canvas id="departmentYearChart"></canvas>
                        </div>
                    </div>
                </div>

                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <h3>Voting Activity</h3>
                        <button class="graph-export-btn" data-export="departmentActivityChart"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container">
                        <canvas id="departmentActivityChart"></canvas>
                    </div>
                </div>

                <div class="analytics-card">
                    <div class="analytics-card-header">
                        <h3>Voting Status</h3>
                        <button class="graph-export-btn" data-export="departmentStatusChart"><i class="bi bi-download"></i></button>
                    </div>
                    <div class="chart-container">
                        <canvas id="departmentStatusChart"></canvas>
                    </div>
                </div>

            </div>
        </div>
    </div>
  `;

  container.querySelector("#departmentElectionYearSelect")?.addEventListener("change", (event) => {
      selectedElectionId = event.target.value;
      renderDepartmentAnalytics(currentData);
    });

  createOrUpdateChart("departmentCandidateChart", "bar",
    ca.candidates.map(c => c.name), ca.candidates.map(c => c.votes),
    { title: "Department Officer Votes", horizontal: true });

    const notVoted = Math.max(ca.totalVoters - ca.votesCast, 0);
    createOrUpdateChart("departmentTurnoutChart", "doughnut",
      ["Voted", "Not Yet Voted"], [ca.votesCast, notVoted],
      { title: "Voter Turnout", unit: "voters" });

  createOrUpdateChart("departmentYearChart", "bar",
    ca.yearLevel.labels, ca.yearLevel.values,
    { title: "Participation by Year Level" });

  createOrUpdateChart("departmentActivityChart", "line",
    ca.activity.labels, ca.activity.values,
    { title: "Voting Activity" });

    createOrUpdateChart("departmentStatusChart", "bar",
      ["Voted", "Not Yet Voted"], [ca.votesCast ?? 0, notVoted],
      {
        title: "Voting Status",
        backgroundColor: ["#22C55E", "#EF4444"],
        legend: "labels",
        showPercent: true,
        unit: "voters",
      });

  renderCandidatePhotos("departmentCandidatePhotos", ca.candidates);
}

function getChartTitle(chartId) {
  const titles = {
    departmentCandidateChart: "Department Officer Votes",
    departmentTurnoutChart: "Voter Turnout",
    departmentYearChart: "Participation by Year Level",
    departmentActivityChart: "Voting Activity",
    departmentStatusChart: "Voting Status",
  };
  return titles[chartId] || "LCCast Analytics";
}

function initializeExportButton() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".graph-export-btn");
    if (!button) return;
    await exportChartPDF(button.dataset.export);
  });

  document.getElementById("exportDepartment")?.addEventListener("click", exportAllDepartmentPDF);
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
  const label = currentData?.departmentTitle || currentData?.departmentName || "";

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  addPDFHeader(pdf, title, "", label);

  const image = chart.toBase64Image("image/png", 1.0);
  const imageWidth = 180;
  const imageHeight = calculateImageHeight(canvas, imageWidth);
  pdf.addImage(image, "PNG", 15, 48, imageWidth, imageHeight);

  addChartValuesToPDF(pdf, chart, 48 + imageHeight + 12);
  addPDFFooter(pdf, label);

  pdf.save(`${sanitizeFilename(title)}.pdf`);
}

async function exportAllDepartmentPDF() {
  if (!hasCharts("department")) {
      showErrorToast("Nothing to Download", "There are no department graphs to download.");
      return;
    }
  const jsPDF = await loadJsPDF();
  const chartIds = [
    "departmentCandidateChart",
    "departmentTurnoutChart",
    "departmentYearChart",
    "departmentActivityChart",
    "departmentStatusChart",
  ];

  const label = currentData?.departmentTitle || currentData?.departmentName || "";
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let firstPage = true;

  for (const chartId of chartIds) {
    const chart = charts[chartId];
    const canvas = document.getElementById(chartId);
    if (!chart || !canvas) continue;

    await prepareChartForExport(chart);

    if (!firstPage) pdf.addPage();
    firstPage = false;

    addPDFHeader(pdf, getChartTitle(chartId), "", label);

    const image = chart.toBase64Image("image/png", 1.0);
    const imageWidth = 180;
    const imageHeight = calculateImageHeight(canvas, imageWidth);
    pdf.addImage(image, "PNG", 15, 48, imageWidth, imageHeight);
    addChartValuesToPDF(pdf, chart, 48 + imageHeight + 12);
    addPDFFooter(pdf, label);
  }

    if (firstPage) {
      showErrorToast("Nothing to Download", "There are no graphs available for this election.");
      return;
    }

  pdf.save(`${sanitizeFilename((currentData?.departmentName || "Department") + "-Graphs")}.pdf`);
}
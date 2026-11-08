/* ==========================================================
   LCCAST — DASHBOARD (ADMIN-SSC)

   Campus is fixed to the one registered on the account; the
   server resolves it from the session, so nothing here sends
   or switches a campus. No department data on this page.
========================================================== */

const DASHBOARD_API = "/admin-ssc/api/dashboard";

document.addEventListener("DOMContentLoaded", () => {
  setGreeting();
  setCurrentDate();
  setActiveSidebar();
  loadDashboardStatistics();
  connectDashboardSocket();
});

/* ==========================================================
   GREETING
========================================================== */

function setGreeting() {
  const greetingElement = document.getElementById("greetingText");
  if (!greetingElement) return;

  const hour = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    hour12: false,
  });

  greetingElement.textContent =
    Number(hour) < 12 ? "Good Morning," : "Good Afternoon,";
}

/* ==========================================================
   CURRENT DATE
========================================================== */

function setCurrentDate() {
  const dateElement = document.getElementById("todayDate");
  if (!dateElement) return;

  dateElement.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/* ==========================================================
   ACTIVE SIDEBAR
========================================================== */

function setActiveSidebar() {
  const currentPath = window.location.pathname;

  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === currentPath) {
      link.classList.add("active");
    }
  });
}

/* ==========================================================
   DASHBOARD DATA
========================================================== */

async function loadDashboardStatistics(force = false) {
  try {
    const data = await SoftCache.load(DASHBOARD_API, {
      force,
      onRevalidated: applyDashboardData,
    });
    applyDashboardData(data);
  } catch (error) {
    console.error("Failed to load dashboard statistics:", error);
  }
}

function applyDashboardData(data) {
  const statistics = data.statistics ?? {};

  const totalVoters = statistics.totalVoters ?? 0;
  const totalVoted = statistics.totalVoted ?? 0;
  const activeElection =
    statistics.activeElections ?? statistics.activeElection ?? 0;
  const totalCandidates = statistics.totalCandidates ?? 0;

  const turnout =
    totalVoters > 0 ? Math.round((totalVoted / totalVoters) * 100) : 0;

  animateNumber("totalVoters", totalVoters);
  animateNumber("totalVoted", totalVoted);
  animateNumber("activeElection", activeElection);
  animateNumber("totalCandidates", totalCandidates);
  animateNumber("turnout", turnout, "%");

  initializeSSCChart(data.sscVotes ?? []);
}

/* ==========================================================
   COUNT ANIMATION
========================================================== */

function animateNumber(id, end, suffix = "", duration = 1000) {
  const element = document.getElementById(id);
  if (!element) return;

  let start = null;

  function step(timestamp) {
    if (!start) start = timestamp;

    const progress = Math.min((timestamp - start) / duration, 1);
    element.textContent = Math.floor(progress * end) + suffix;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

/* ==========================================================
   SSC GRAPH
========================================================== */

let sscChart;

function initializeSSCChart(sscVotes = []) {
  const canvas = document.getElementById("sscGraph");
  if (!canvas) return;

  if (sscChart) {
    sscChart.destroy();
  }

  const labels = sscVotes.map((item) => item.program);
  const votes = sscVotes.map((item) => item.votes);

  sscChart = new Chart(canvas, {
    type: "bar",

    data: {
      labels: labels,

      datasets: [
        {
          label: "Voters",
          data: votes,
          backgroundColor: "#5B5CEB",
          hoverBackgroundColor: "#494ADB",
          borderRadius: 10,
          borderSkipped: false,
          maxBarThickness: 60,
        },
      ],
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      animation: {
        duration: 700,
        easing: "easeOutQuart",
      },

      plugins: {
        legend: { display: false },

        tooltip: {
          displayColors: false,
          padding: 12,
          cornerRadius: 10,
          callbacks: {
            label: (context) => `Votes: ${context.parsed.y}`,
          },
        },
      },

      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#64748B",
            font: { family: "Poppins", size: 13 },
          },
        },

        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            color: "#64748B",
            font: { family: "Poppins", size: 12 },
          },
          grid: {
            color: "#E8EAF2",
            drawBorder: false,
          },
        },
      },
    },
  });
}

/* ==========================================================
   REAL-TIME UPDATES
========================================================== */

function connectDashboardSocket() {
  if (typeof StompJs === "undefined" || typeof SockJS === "undefined") {
    console.error("StompJs/SockJS not loaded — real-time dashboard updates disabled.");
    return;
  }

  const campusId = document.body.dataset.adminCampusId || "";
  if (!campusId) {
    console.error("Missing adminCampusId on <body> — cannot scope dashboard socket.");
    return;
  }

  const client = new StompJs.Client({
    webSocketFactory: () => new SockJS("/ws-analytics"),
    reconnectDelay: 4000,
    onConnect: () => {
       client.subscribe(`/topic/dashboard/${campusId}`, () => loadDashboardStatistics(true));
    },
  });

  client.activate();
}
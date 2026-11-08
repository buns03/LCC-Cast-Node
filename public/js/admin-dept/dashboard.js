/* ==========================================================
   LCCast Admin-Dept Dashboard
========================================================== */

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

    const greetingElement =
        document.getElementById("greetingText");

    if (!greetingElement) return;

    const hour =
        new Date().toLocaleString("en-US", {
            timeZone: "Asia/Manila",
            hour: "numeric",
            hour12: false
        });

    greetingElement.textContent =
        Number(hour) < 12
            ? "Good Morning,"
            : "Good Afternoon,";

}

/* ==========================================================
   CURRENT DATE
========================================================== */

function setCurrentDate() {

    const dateElement = document.getElementById("todayDate");

    if (!dateElement) return;

    const today = new Date();

    dateElement.textContent = today.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    });

}

/* ==========================================================
   ACTIVE SIDEBAR
========================================================== */

function setActiveSidebar() {

    const currentPath = window.location.pathname;

    document.querySelectorAll(".sidebar nav a").forEach(link => {

        link.classList.remove("active");

        if (link.getAttribute("href") === currentPath) {
            link.classList.add("active");
        }

    });

}

/* ==========================================================
   DASHBOARD DATA
   No campus/department params — scope comes entirely from
   the server-side session, never from the client.
========================================================== */

async function loadDashboardStatistics(force = false) {
    try {
        const data = await SoftCache.load("/admin-dept/api/dashboard", {
            force,
            onRevalidated: applyDashboardData
        });
        applyDashboardData(data);
    } catch (error) {
        console.error("Failed to load dashboard statistics:", error);
    }
}

function applyDashboardData(data) {
    const statistics = data.statistics;

    initializeDepartmentChart(data.departmentVotes ?? []);

    const totalVoters = statistics.totalVoters ?? 0;
    const totalVoted = statistics.totalVoted ?? 0;
    const activeElection =
        statistics.activeElections ?? statistics.activeElection ?? 0;
    const totalCandidates = statistics.totalCandidates ?? 0;

    const turnout =
        totalVoters > 0
            ? Math.round((totalVoted / totalVoters) * 100)
            : 0;

    animateNumber("totalVoters", totalVoters);
    animateNumber("totalVoted", totalVoted);
    animateNumber("activeElection", activeElection);
    animateNumber("totalCandidates", totalCandidates);
    animateNumber("turnout", turnout, "%");
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

/* =========================================================
   DEPARTMENT GRAPH
   Votes per position, for this admin's own department only.
========================================================= */

let departmentChart;

function initializeDepartmentChart(departmentVotes = []) {

    const canvas = document.getElementById("departmentGraph");

    if (!canvas) return;

    if (departmentChart) {
        departmentChart.destroy();
    }

    const labels = departmentVotes.map(item => item.position);
    const votes = departmentVotes.map(item => item.votes);

    departmentChart = new Chart(canvas, {

        type: "bar",

        data: {
            labels: labels,
            datasets: [{
                label: "Votes",
                data: votes,
                backgroundColor: "#5B5CEB",
                hoverBackgroundColor: "#494ADB",
                borderRadius: 10,
                borderSkipped: false,
                maxBarThickness: 60
            }]
        },

        options: {

            responsive: true,
            maintainAspectRatio: false,

            animation: {
                duration: 700,
                easing: "easeOutQuart"
            },

            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    padding: 12,
                    cornerRadius: 10,
                    callbacks: {
                        label: context => "Votes: " + context.parsed.y
                    }
                }
            },

            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#64748B",
                        font: { family: "Poppins", size: 13 }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        color: "#64748B",
                        font: { family: "Poppins", size: 12 }
                    },
                    grid: {
                        color: "#E8EAF2",
                        drawBorder: false
                    }
                }
            }

        }

    });

}

/* ==========================================================
   REAL-TIME UPDATES
========================================================== */

function connectDashboardSocket() {
    if (typeof SockJS === "undefined") {
        console.error("SockJS not loaded — real-time dashboard updates disabled.");
        return;
    }

    const campusId = document.body.dataset.adminCampusId || "";
    const departmentCode = document.body.dataset.adminDepartmentCode || "";

    if (!campusId || !departmentCode) {
        console.error("Missing adminCampusId/adminDepartmentCode on <body> — cannot scope dashboard socket.");
        return;
    }

    const topic = `/topic/dashboard/${campusId}/${departmentCode}`;

    if (typeof StompJs !== "undefined") {
        const client = new StompJs.Client({
            webSocketFactory: () => new SockJS("/ws-analytics"),
            reconnectDelay: 4000,
        });
        client.onConnect = () => client.subscribe(topic, () => loadDashboardStatistics(true));
        client.activate();
    } else if (typeof Stomp !== "undefined") {
        const socket = new SockJS("/ws-analytics");
        const client = Stomp.over(socket);
        client.debug = () => {};
        client.connect({}, () => client.subscribe(topic, () => loadDashboardStatistics(true)));
    } else {
        console.error("No STOMP client library found — real-time dashboard updates disabled.");
    }
}


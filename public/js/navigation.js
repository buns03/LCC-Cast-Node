document.addEventListener("DOMContentLoaded", function () {
    buildMobileTabbar();
    initializeMobileNavToggle();
});

/* =========================================================
   MOBILE NAV TOGGLE (hamburger button + overlay)
========================================================= */

function initializeMobileNavToggle() {
    const toggleBtn = document.getElementById("mobileNavToggle");
    const overlay = document.getElementById("mobileNavOverlay");
    const sidebar = document.getElementById("sidebar");

    if (!toggleBtn || !overlay || !sidebar) {
        return;
    }

    function openNav() {
        sidebar.classList.add("open");
        overlay.classList.add("show");
        toggleBtn.setAttribute("aria-expanded", "true");
    }

    function closeNav() {
        sidebar.classList.remove("open");
        overlay.classList.remove("show");
        toggleBtn.setAttribute("aria-expanded", "false");
    }

    toggleBtn.addEventListener("click", () => {
        const isOpen = sidebar.classList.contains("open");
        isOpen ? closeNav() : openNav();
    });

    overlay.addEventListener("click", closeNav);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && sidebar.classList.contains("open")) {
            closeNav();
        }
    });
}

/* =========================================================
   BUILD MOBILE TAB BAR (replaces burger nav)
========================================================= */

function buildMobileTabbar() {

    const mainContent = document.querySelector(".main-content");
    const sidebar = document.getElementById("sidebar");

    if (!mainContent || !sidebar) {
        return;
    }

    const tabbar = document.createElement("nav");
    tabbar.className = "mobile-tabbar";
    tabbar.id = "mobileTabbar";
    tabbar.setAttribute("aria-label", "Mobile navigation");

    function makeItem(link) {

        const icon = link.querySelector("i");
        const spanLabel = link.querySelector("span");

        let labelText = "";

        if (spanLabel) {
            // Pages that already wrap the label in <span>
            labelText = spanLabel.textContent.trim();
        } else {
            // Pages with bare text nodes (e.g. dashboard.html)
            labelText = Array.from(link.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent.trim())
                .join(" ")
                .trim();
        }

        const item = document.createElement("a");
        item.className =
            "tabbar-item" + (link.classList.contains("active") ? " active" : "");

        item.href = link.getAttribute("href") || "#";

        if (labelText) {
            item.setAttribute("aria-label", labelText);
            item.setAttribute("title", labelText);
        }

        item.innerHTML = `
            ${icon ? `<i class="${icon.className}"></i>` : ""}
            <span class="tabbar-label">${labelText}</span>
        `;

        if (link.classList.contains("logout-trigger")) {
            item.classList.add("logout-trigger");
            item.href = "#";
        }

        return item;
    }

    sidebar.querySelectorAll(".sidebar-top nav a").forEach((a) => {
        tabbar.appendChild(makeItem(a));
    });

    const bottomLinks = sidebar.querySelectorAll(".sidebar-bottom a");

    if (bottomLinks.length) {
        const divider = document.createElement("span");
        divider.className = "tabbar-divider";
        tabbar.appendChild(divider);

        bottomLinks.forEach((a) => {
            tabbar.appendChild(makeItem(a));
        });
    }

    document.body.appendChild(tabbar);
}

(function () {
  if (document.querySelector("script[data-job-progress]")) return;
  const s = document.createElement("script");
  s.src = "/js/job-progress.js";
  s.dataset.jobProgress = "true";
  document.head.appendChild(s);
})();
// HTML Escape
function esc(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getFileName(url) {
    try {
        return decodeURIComponent(url.split("/").pop());
    } catch {
        return "Uploaded file";
    }
}

// Generic Modal
function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("show");
    document.body.classList.add("modal-open");
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("show");

    if (!document.querySelector(".modal-overlay.show")) {
        document.body.classList.remove("modal-open");
    }
}

function refreshAccordion(accordion) {
    if (!accordion) return;

    const content = accordion.querySelector(":scope > .accordion-content");
    if (!content) return;

    if (!accordion.classList.contains("active")) {
        content.style.maxHeight = "0px";
        return;
    }

    requestAnimationFrame(() => content.style.maxHeight = content.scrollHeight + "px");
}

function getProtectedFileUrl(storagePath) {
    if (!storagePath) return "";

    return `${DEPARTMENT_API}/file?path=${encodeURIComponent(storagePath)}`;
}

// Departments Initials
function getDepartmentsInitials(name) {
    if (!name) return "";
    const words = name.trim().split(/\s+/);
    return words.length === 1
        ? words[0].substring(0, 2).toUpperCase()
        : words.map(word => word[0]).join("").toUpperCase();
}

function createFileDisplay(url, type = "image", alt = "") {

    if (!url) {
        return `
            <div class="file-preview-empty">
                No file uploaded.
            </div>
        `;
    }

    const fileName = getFileName(url);

    const isPDF =
        type === "pdf" ||
        fileName.toLowerCase().endsWith(".pdf");

    if (isPDF) {

        return `
            <div class="file-display-pdf">

                <iframe
                    src="${esc(getProtectedFileUrl(url))}"
                    title="${esc(alt || "PDF Preview")}"
                    loading="lazy">
                </iframe>

            </div>
        `;

    }

    return `
        <img
            src="${esc(getProtectedFileUrl(url))}"
            alt="${esc(alt)}"
            loading="lazy"
        >
    `;
}

function allDepartmentsCards() {
    return document.querySelectorAll("#existingDepartments .departments-item");
}
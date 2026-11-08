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
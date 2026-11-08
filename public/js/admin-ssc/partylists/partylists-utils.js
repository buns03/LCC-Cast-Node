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

// Sizes the member file preview card. The CSS already gives photos (240px)
// and PDFs (300px) their own heights, so this only widens the card for
// documents. Replace it with your superadmin version if you find one.
function applyDocumentPreviewRatio(preview, type) {
    if (!preview) return;

    const isDocument = !!preview.querySelector(".background-preview-body");

    preview.style.width = isDocument
        ? "min(460px, calc(100vw - 30px))"
        : "";
}
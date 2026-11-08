// Position Member File Preview
function positionMemberFilePreview(row, preview, type = "photo") {
    if (!row || !preview) return;

    // const button = row.querySelector(
    //     ".campaign-btn, .background-btn, .photo-btn, .resume-btn"
    // );

    const button = row.querySelector(`.${type}-btn`);
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const previewWidth = preview.offsetWidth || 340;
    const previewHeight = preview.offsetHeight || 300;
    const gap = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Prefer above the row if there isn't enough room below
    let top = buttonRect.bottom + gap;
    if (top + previewHeight > viewportHeight - 15) {
        top = buttonRect.top - previewHeight - gap;
    }
    if (top < 15) top = 15;

    // Prefer aligning the right side with the button
    let left = buttonRect.right - previewWidth;
    if (left < 15) left = 15;
    if (left + previewWidth > viewportWidth - 15) {
        left = viewportWidth - previewWidth - 15;
    }

    preview.style.top = `${top}px`;
    preview.style.left = `${left}px`;
}

function deleteMemberFile(row, type) {

    if (type === "campaign") {

        const input = row.querySelector(".campaign-input");
        if (input) input.value = "";

        row._campaignFile = null;
        row.removeAttribute("data-campaign");

        const button = row.querySelector(".campaign-btn");

        if (button) {
            button.classList.remove("has-campaign");
            button.innerHTML = `
                <i class="bi bi-megaphone"></i>
                <span>Campaign</span>
            `;
        }

    } else if (type === "background") {

        const input = row.querySelector(".background-input");
        if (input) input.value = "";

        row._backgroundFile = null;
        row.removeAttribute("data-background");

        const button = row.querySelector(".background-btn");

        if (button) {
            button.classList.remove("has-background");
            button.innerHTML = `
                <i class="bi bi-image"></i>
                <span>Background</span>
            `;
        }

    } else if (type === "photo") {

        const input = row.querySelector(".photo-input");
        if (input) input.value = "";

        row._photoFile = null;
        row.removeAttribute("data-photo");

        const button = row.querySelector(".photo-btn");

        if (button) {
            button.classList.remove("has-photo");
            button.innerHTML = `
                <i class="bi bi-person-bounding-box"></i>
                <span>Photo</span>
            `;
        }

    }

    closeMemberFilePreview(row);
}

function closeMemberFilePreview(row) {
    const preview = row.querySelector(".member-file-preview");
    if (!preview) return;
    preview.classList.remove("show");
    preview.innerHTML = "";
}

// Position Options
function positionOptions(selected) {
    const isCustom = selected && !DEFAULT_POSITIONS.includes(selected) && selected !== "Member";
    const positions = [...DEFAULT_POSITIONS, "Member", "Others"];

    return positions.map(position => `
        <option value="${esc(position)}" ${(position === selected || (position === "Others" && isCustom)) ? "selected" : ""}>
            ${esc(position)}
        </option>
    `).join("");
}

// Remove Buttons
function updateRemoveButtons(list) {
    list.querySelectorAll(".member-row").forEach(row => {
        const button = row.querySelector(".remove-member");
        if (button) button.style.display = "flex";
    });
}

// Resume / COC Reader
async function processBackground(file, row) {
    const backgroundButton = row.querySelector(".background-btn");
    if (!backgroundButton) return;

    const originalHTML = backgroundButton.innerHTML;
    backgroundButton.disabled = true;
    backgroundButton.classList.add("scanning");
    backgroundButton.innerHTML = `<i class="bi bi-hourglass-split"></i><span>Reading...</span>`;

    try {
        let text = "";

        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
            text = await extractPDFText(file);
        } else if (file.type.startsWith("image/")) {
            if (typeof Tesseract === "undefined") throw new Error("Tesseract is unavailable.");
            const result = await Tesseract.recognize(file, "eng");
            text = result?.data?.text || "";
        }

        if (!text.trim()) {
            alert("No readable text was detected in this resume / COC.");
            return;
        }

        console.log("Background", text);

        const data = parseBackgroundText(text);
        fillMemberFromBackground(row, data);

        backgroundButton.classList.add("has-background");
        backgroundButton.innerHTML = `<i class="bi bi-check-lg"></i><span>Background</span>`;
    } catch (error) {
        console.error("Resume reading error:", error);
        alert("The resume / COC could not be read. You can still enter the information manually.");
    } finally {
        backgroundButton.disabled = false;
        backgroundButton.classList.remove("scanning");

        if (!backgroundButton.classList.contains("has-background")) {
            backgroundButton.innerHTML = originalHTML;
        }
    }
}

// PDF Text Extraction
async function extractPDFText(file) {
    if (!file) throw new Error("No PDF file selected.");
    if (typeof pdfjsLib === "undefined") throw new Error("PDF.js is not loaded.");

    console.log("Opening PDF:", file.name);

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

    console.log("PDF loaded successfully. Pages:", pdf.numPages);

    let fullText = "";

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        console.log(`Reading PDF page ${pageNumber}/${pdf.numPages}`);

        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str || "").join(" ").trim();

        console.log(`Page ${pageNumber} text length:`, pageText.length);

        if (pageText) fullText += pageText + "\n";
    }

    return fullText.trim();
}

// OCR Scanned PDF
async function ocrPDF(file, row) {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF.js is not loaded.");
    if (typeof Tesseract === "undefined") throw new Error("Tesseract.js is not loaded.");

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

    let fullText = "";

    console.log("Starting OCR for", pdf.numPages, "PDF page(s)");

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        console.log(`OCR page ${pageNumber}/${pdf.numPages}`);

        const page = await pdf.getPage(pageNumber);

        // Render PDF page to canvas
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;

        // Send rendered page to Tesseract
        const result = await Tesseract.recognize(canvas, "eng", {
            logger: message => {
                if (message.status === "recognizing text") {
                    console.log(`OCR page ${pageNumber}:`, Math.round(message.progress * 100) + "%");
                }
            }
        });

        const pageText = result?.data?.text || "";
        console.log(`OCR page ${pageNumber} result:`, pageText);
        fullText += pageText + "\n";
    }

    return fullText.trim();
}

// Load PDF.js
async function loadPDFJS() {
    if (window.pdfjsLib) {
        if (window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }
        return;
    }

    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";

        script.onload = () => {
            if (!window.pdfjsLib) {
                reject(new Error("PDF.js loaded but pdfjsLib is unavailable."));
                return;
            }
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            resolve();
        };

        script.onerror = () => reject(new Error("Unable to load PDF.js."));

        document.head.appendChild(script);
    });
}

// Parse Resume
function parseBackgroundText(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    const result = { studentId: "", firstName: "", middleName: "", lastName: "", position: "" };

    // Student ID / School ID
    const studentIdPatterns = [
        /(?:student\s*(?:id|no|number)|school\s*(?:id|no|number)|id\s*(?:no|number)?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]*)/i,
        /\b(20\d{2}[-\s]?\d{4,7})\b/i
    ];

    for (const pattern of studentIdPatterns) {
        const match = text.match(pattern);

        if (match?.[1]) {
            result.studentId = match[1].trim();
            break;
        }
    }

    // Name
    const namePatterns = [
        /(?:full\s*name|student\s*name|name)\s*[:\-]\s*(.+)/i,
        /^([A-Z][A-Z\s.'-]{3,})$/m
    ];

    for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            const name = match[1].trim();
            const parts = name.split(/\s+/);

            if (parts.length >= 2) {
                result.firstName = parts[0];
                result.lastName = parts[parts.length - 1];
                if (parts.length > 2) result.middleName = parts.slice(1, -1).join(" ");
                break;
            }
        }
    }

    // Position
    const positionMatch = text.match(/(?:position|office|running\s+for|candidate\s+for)\s*[:\-]\s*(.+)/i);
    if (positionMatch?.[1]) result.position = positionMatch[1].split("\n")[0].trim();

    return result;
}

// Fill Member From Resume
function fillMemberFromBackground(row, data) {
    if (data.studentId) {
        const studentId = row.querySelector(".member-student-id");

        if (studentId) {
            studentId.value = data.studentId;
            studentId.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }
    if (data.firstName) row.querySelector(".member-first-name").value = data.firstName;
    if (data.middleName) row.querySelector(".member-middle-name").value = data.middleName;
    if (data.lastName) row.querySelector(".member-last-name").value = data.lastName;

    if (data.position) {
        const select = row.querySelector(".member-position");
        const other = row.querySelector(".other-position-input");

        if (DEFAULT_POSITIONS.includes(data.position) || data.position === "Member") {
            select.value = data.position;
            other.hidden = true;
        } else {
            select.value = "Others";
            other.hidden = false;
            other.value = data.position;
        }
    }
}

// Edit Members
function initializeEditMembers(card) {
    const list = card.querySelector(".edit-members-list");

    if (!list) return;

    list.innerHTML = "";

    const existingMembers = [
        ...card.querySelectorAll(".existing-member")
    ];

    existingMembers.forEach(memberElement => {

        addMemberRow(
            list,
            {
                studentId: memberElement.dataset.studentId || "",
                firstName: memberElement.dataset.firstName || "",
                middleName: memberElement.dataset.middleName || "",
                lastName: memberElement.dataset.lastName || "",
                position: memberElement.dataset.position || "Member",
                campaign: memberElement.dataset.campaign || "",
                background: memberElement.dataset.background || "",
                photo: memberElement.dataset.photo || ""
            },
            true
        );
    });

    list.dataset.initialized = "true";

    updateRemoveButtons(list);
    refreshExisting();
}

function collectMemberData(row) {
    const positionSelect = row.querySelector(".member-position");
    const otherPosition = row.querySelector(".other-position-input");

    const position =
        positionSelect?.value === "Others"
            ? (otherPosition?.value.trim() || "Member")
            : (positionSelect?.value || "Member");

    return {
        studentId:
            row.querySelector(".member-student-id")?.value.trim() || "",

        firstName:
            row.querySelector(".member-first-name")?.value.trim() || "",

        middleName:
            row.querySelector(".member-middle-name")?.value.trim() || "",

        lastName:
            row.querySelector(".member-last-name")?.value.trim() || "",

        position,

        campaign: row.dataset.campaignDirty === "true" ? (row.dataset.campaign || "") : "",
            background: row.dataset.backgroundDirty === "true" ? (row.dataset.background || "") : "",
            photo: row.dataset.photoDirty === "true" ? (row.dataset.photo || "") : ""
    };
}

function clearMemberFieldsFromLookup(row) {
    if (!row) return;

    const firstName = row.querySelector(".member-first-name");
    const middleName = row.querySelector(".member-middle-name");
    const lastName = row.querySelector(".member-last-name");

    if (firstName) firstName.value = "";
    if (middleName) middleName.value = "";
    if (lastName) lastName.value = "";
}
// No File Uploaded Modal
function showNoFileUploadedModal(fileType) {
    let modal = document.getElementById("noFileUploadedModal");

    if (!modal) {
        modal = document.createElement("div");
        modal.id = "noFileUploadedModal";
        modal.className = "modal-overlay";
        modal.innerHTML = `
            <div class="delete-modal no-file-modal">
                <div class="delete-modal-content">
                    <div class="delete-modal-icon"><i class="bi bi-file-earmark-x"></i></div>
                    <h2>No File Uploaded</h2>
                    <p>No ${fileType.toLowerCase()} has been uploaded for this member yet.</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="delete-cancel-btn no-file-close">
                        <i class="bi bi-check-lg"></i>Okay
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector(".no-file-close")?.addEventListener("click", () => {
            modal.classList.remove("show");
        });

        modal.addEventListener("click", e => {
            if (e.target === modal) modal.classList.remove("show");
        });
    }

    modal.classList.add("show");
    document.body.classList.add("modal-open");
}

// Keep preview inside viewport
function repositionOpenPreviews() {
    document.querySelectorAll(".member-file-preview.show").forEach(preview => {
        const row = preview.closest(".member-row");
        if (!row) return;

        const button =
            row.querySelector(".campaign-btn.has-campaign") ||
            row.querySelector(".background-btn.has-background") ||
            row.querySelector(".photo-btn.has-photo");

        if (!button) return;

        const type =
            button.classList.contains("campaign-btn") ? "campaign" :
                button.classList.contains("background-btn") ? "background" :
                    "photo";

        positionMemberFilePreview(row, preview, type);
    });
}

window.addEventListener("resize", repositionOpenPreviews);
window.addEventListener("scroll", repositionOpenPreviews, true);
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
function positionOptions(selected, positions = DEFAULT_POSITIONS) {
    const isCustom = selected && !positions.includes(selected) && selected !== "Member";
    const options = [...positions, "Member", "Others"];

    return options.map(position => `
        <option value="${esc(position)}" ${(position === selected || (position === "Others" && isCustom)) ? "selected" : ""}>
            ${esc(position)}
        </option>
    `).join("");
}

function syncMemberPositionOptions(positionsList) {
    const container = positionsList.closest("#createDepartmentsForm") ||
        positionsList.closest(".edit-departments-form");

    if (!container) return;

    const memberList = container.querySelector(".members-list");
    if (!memberList) return;

//    const positions = getPositions(positionsList);
//
//    memberList.querySelectorAll(".member-row").forEach(row => {
//        const select = row.querySelector(".member-position");
//        const current = select.value === "Others"
//            ? (row.querySelector(".other-position-input")?.value.trim() || "")
//            : select.value;
//
//        select.innerHTML = positionOptions(current, positions);
//    });
}

// Remove Buttons
function updateRemoveButtons(list) {
    if (!list) return;

    const rows = list.querySelectorAll(".member-row");

    const container =
        list.closest("#createDepartmentsForm") ||
        list.closest(".edit-departments-form");

    const votingTypeSelect =
        container?.querySelector("#departmentsVotingType, .edit-departments-voting-type");

    const positionsList =
        container?.querySelector("#createPositionsList, .edit-positions-list");

    const minimumMembers =
        votingTypeSelect?.value === "REPRESENTATIVE" && positionsList
            ? getPositions(positionsList).length
            : 0;

    rows.forEach((row, index) => {
        const removeBtn = row.querySelector(".remove-member");

        if (!removeBtn) return;

        removeBtn.style.display =
            rows.length > minimumMembers ? "" : "none";
    });
}

function updateMemberPositionVisibility(list) {
    if (!list) return;

    const container =
        list.closest("#createDepartmentsForm") ||
        list.closest(".edit-departments-form");

    const votingTypeSelect =
        container?.querySelector("#departmentsVotingType, .edit-departments-voting-type");

    const isPartylist = votingTypeSelect?.value === "PARTYLIST";

    list.querySelectorAll(".member-row").forEach(row => {
        const positionGroup = row.querySelector(".member-position-group");
        if (positionGroup) positionGroup.hidden = !isPartylist;
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
                    position: memberElement.dataset.position || "",
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

    const position = positionSelect
        ? (positionSelect.value === "Others"
            ? (otherPosition?.value.trim() || "Member")
            : (positionSelect.value || "Member"))
        : "";

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

        campaign:
            row.dataset.campaign || "",

        background:
            row.dataset.background || "",

        photo:
            row.dataset.photo || ""
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

// Existing Member Files
function initializeExistingMemberFiles() {
    document.querySelectorAll(".existing-member").forEach(member => {
        const photoButton = member.querySelector(".view-member-photo");
        const resumeButton = member.querySelector(".view-member-background");

        photoButton?.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            showExistingMemberFile(member, "photo");
        });

        resumeButton?.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            showExistingMemberFile(member, "background");
        });
    });
}

function showExistingMemberFile(member, type) {

    let url = "";

    if (type === "photo") {
        url = member.dataset.photo || "";
    } else if (type === "background") {
        url = member.dataset.background || "";
    }

    if (!url) {
        showNoFileUploadedModal(
            type === "photo" ? "Photo" : "Background"
        );
        return;
    }

    let preview = member.querySelector(".existing-member-preview");

    if (!preview) {
        preview = document.createElement("div");
        preview.className = "existing-member-preview";
        member.appendChild(preview);
    }

    const cleanUrl = url.split("?")[0];
    const isPDF = cleanUrl.toLowerCase().endsWith(".pdf");

    const title =
        type === "photo"
            ? "Member Photo"
            : "Background";

    preview.innerHTML = `
        <div class="file-preview-header">

            <strong>${title}</strong>

            <button
                type="button"
                class="existing-preview-close"
                title="Close Preview"
                aria-label="Close Preview">

                <i class="bi bi-x-lg"></i>

            </button>

        </div>

        <div class="file-preview-body">

            ${type === "photo"
            ? `
                        <img
                            src="${esc(url)}"
                            alt="Member Photo">
                      `
            : isPDF
                ? `
                            <iframe
                                src="${esc(url)}"
                                title="Background Preview">
                            </iframe>
                          `
                : `
                            <img
                                src="${esc(url)}"
                                alt="Background Preview">
                          `
        }

        </div>
    `;

    preview.classList.add("show");

    preview
        .querySelector(".existing-preview-close")
        ?.addEventListener("click", e => {

            e.preventDefault();
            e.stopPropagation();

            preview.classList.remove("show");
        });
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

function initializeCreatePositions() {
    const list = document.getElementById("createPositionsList");
    const input = document.getElementById("newPositionInput");
    const addBtn = document.getElementById("addPositionBtn");
    const votingType = document.getElementById("departmentsVotingType");

    if (!list || !votingType) return;

    const updatePositions = () => {
        if (votingType.value !== "REPRESENTATIVE") {
            list.innerHTML = "";
            return;
        }

        if (list.children.length === 0) {
            renderPositionsList(list, [...DEFAULT_POSITIONS]);
        }

        if (!list.dataset.positionsBound) {
            bindPositionsControls(
                document.getElementById("createDepartmentsForm"),
                list,
                input,
                addBtn
            );

            list.dataset.positionsBound = "true";
        }
    };

    votingType.addEventListener("change", updatePositions);

    updatePositions();
}

function initializeEditPositions(card, department) {
    const list = card.querySelector(".edit-positions-list");
    const input = card.querySelector(".new-position-input");
    const addBtn = card.querySelector(".add-position-btn");
    const form = card.querySelector(".edit-departments-form");

    if (!list || list.dataset.positionsBound === "true") return;
    list.dataset.positionsBound = "true";

    const positions = Array.isArray(department?.positions) && department.positions.length
        ? department.positions
        : [...DEFAULT_POSITIONS];

    renderPositionsList(list, positions);
    bindPositionsControls(form, list, input, addBtn);
}

function initializeCreateMembers() {
    const list = document.getElementById("createMembersList");
    const add = document.getElementById("addMemberBtn");
    const positionsList = document.getElementById("createPositionsList");
    const votingType = document.getElementById("departmentsVotingType");

    if (!list || !add || !votingType) return;

    const updateMembers = () => {
        if (votingType.value === "PARTYLIST") {
            list.innerHTML = "";
            DEFAULT_POSITIONS.forEach(position => addMemberRow(list, { position }, false));
            updateRemoveButtons(list);
            return;
        }

        if (votingType.value !== "REPRESENTATIVE") {
            list.innerHTML = "";
            return;
        }

        const positions = getPositions(positionsList);

        if (list.children.length === 0) {
            positions.forEach(() => {
                addMemberRow(list, {}, false);
            });
        }

        updateRemoveButtons(list);
    };

    votingType.addEventListener("change", updateMembers);

    add.addEventListener("click", () => {
        if (votingType.value !== "REPRESENTATIVE" && votingType.value !== "PARTYLIST") return;

        addMemberRow(list, { position: "Member" }, true);
        updateRemoveButtons(list);
    });

    updateMembers();
}

// Add Member Row
function addMemberRow(list, member = {}, removable = true) {
    const row = document.createElement("div");
    row.className = removable ? "member-row can-remove" : "member-row";

    const existingCampaign = member.campaign || "";
    const existingBackground = member.background || "";
    const existingPhoto = member.photo || "";

    row.innerHTML = `
        <div class="member-field-group">
            <input type="text" class="member-student-id" placeholder="Student No. / ID"
                value="${esc(member.studentId || "")}" autocomplete="off" inputmode="text">
            <small class="inline-error member-student-id-error"></small>
        </div>

        <div class="member-field-group">
            <input type="text" class="member-last-name" placeholder="Last Name" value="${esc(member.lastName || "")}">
            <small class="inline-error member-last-name-error"></small>
        </div>

        <div class="member-field-group">
            <input type="text" class="member-first-name" placeholder="First Name" value="${esc(member.firstName || "")}">
            <small class="inline-error member-first-name-error"></small>
        </div>

        <div class="member-field-group">
            <input type="text" class="member-middle-name" placeholder="Middle Name" value="${esc(member.middleName || "")}">
        </div>

        <div class="member-field-group member-position-group" hidden>
                    <div class="position-wrapper">
                        <select class="member-position"></select>
                        <input type="text" class="other-position-input" placeholder="Enter position" hidden>
                        <small class="inline-error member-position-error"></small>
                    </div>
        </div>

        <input type="file" class="campaign-input" accept="image/*" hidden>

        <button type="button" class="campaign-btn" title="Upload Campaign / Platform">
            <span>Campaign</span>
        </button>

        <input type="file" class="background-input"
       accept="application/pdf,image/*" hidden>

        <button type="button" class="background-btn" title="Upload Background">
            <span>Background</span>
        </button>

        <input type="file" class="photo-input" accept="image/*" hidden>

        <button type="button" class="photo-btn" title="Upload member photo">
            <i class="bi bi-person-bounding-box"></i>
            <span>Photo</span>
        </button>


        <button type="button" class="remove-member" title="Remove member">
            <i class="bi bi-x-lg"></i>
        </button>

        <div class="member-file-preview"></div>
    `;

    // Student ID / key
    // =========================================================
    // STUDENT ID AUTOFILL
    // =========================================================

        const positionGroup = row.querySelector(".member-position-group");
        const positionSelect = row.querySelector(".member-position");
        const otherPositionInput = row.querySelector(".other-position-input");

        if (positionSelect) {
            positionSelect.innerHTML = [...DEFAULT_POSITIONS, "Member", "Others"]
                .map(pos => `<option value="${esc(pos)}" ${pos === (member.position || "Member") ? "selected" : ""}>${esc(pos)}</option>`)
                .join("");

            if (member.position && !DEFAULT_POSITIONS.includes(member.position) && member.position !== "Member" && member.position !== "Others") {
                positionSelect.value = "Others";
                if (otherPositionInput) {
                    otherPositionInput.hidden = false;
                    otherPositionInput.value = member.position;
                }
            }

                    positionSelect.addEventListener("change", () => {
                        if (positionSelect.value === "Others") {
                            otherPositionInput.hidden = false;
                            otherPositionInput.focus();
                        } else {
                            otherPositionInput.hidden = true;
                            otherPositionInput.value = "";
                        }
                    });
                }

                                const votingTypeContainer =
                                    list.closest("#createDepartmentsForm") ||
                                    list.closest(".edit-departments-form");

                                const votingTypeSelect =
                                    votingTypeContainer?.querySelector("#departmentsVotingType, .edit-departments-voting-type");

                                if (positionGroup) {
                                    positionGroup.hidden = votingTypeSelect?.value !== "PARTYLIST";
                                }

                const studentIdInput = row.querySelector(".member-student-id");

        let studentLookupTimer = null;

    studentIdInput?.addEventListener("input", () => {

        const studentId = studentIdInput.value.trim();

        const lastNameInput =
            row.querySelector(".member-last-name");

        const firstNameInput =
            row.querySelector(".member-first-name");

        const middleNameInput =
            row.querySelector(".member-middle-name");

        // Clear previous timer
        clearTimeout(studentLookupTimer);

        // If Student ID was cleared, clear autofilled names too
        if (!studentId) {
            lastNameInput.value = "";
            firstNameInput.value = "";
            middleNameInput.value = "";

            clearInlineError(studentIdInput);
            return;
        }

        // Clear error while typing
        clearInlineError(studentIdInput);

        // Wait until user stops typing
        studentLookupTimer = setTimeout(async () => {

            try {

            const isCreateMember =
                !!row.closest("#createMembersList");

            if (isCreateMember) {

                const campusSelect =
                    document.getElementById("departmentsCampus");

                if (!campusSelect?.value) {

                    showInlineError(
                        studentIdInput,
                        "Please select a campus first."
                    );

                    return;
                }
            }

                showActionLoading(
                    "Finding Student",
                    "Please wait while we retrieve the student information."
                );

                const createCampusId =
                    isCreateMember
                        ? document.getElementById("departmentsCampus")?.value || ""
                        : row
                            .closest(".departments-item")
                            ?.querySelector(".edit-departments-campus")
                            ?.value || "";

                const departmentSelect =
                    document.getElementById("departmentsName");

                const createDepartmentId =
                    departmentSelect?.value || "";

                const editDepartmentId =
                    row.closest(".departments-item")?.dataset.id || null;

                const selectedDepartmentId =
                    isCreateMember
                        ? createDepartmentId
                        : editDepartmentId;

                const departmentName =
                    isCreateMember
                        ? document.getElementById("departmentsName")?.value || ""
                        : row
                            .closest(".departments-item")
                            ?.querySelector(".edit-departments-name-input")
                            ?.value || "";

                const schoolYear =
                    isCreateMember
                        ? document.getElementById("departmentsSchoolYear")?.value || ""
                        : row
                            .closest(".departments-item")
                            ?.querySelector(".edit-departments-schoolyear-input")
                            ?.value || "";

                const student =
                    await lookupStudentById(
                        studentId,
                        schoolYear,
                        isCreateMember ? null : editDepartmentId
                    );

                if (!student) {

                    showInlineError(
                        studentIdInput,
                        "Student ID was not found."
                    );

                    return;
                }

                // =================================================
                // AUTOFILL
                // =================================================

                lastNameInput.value =
                    student.lastName || "";

                firstNameInput.value =
                    student.firstName || "";

                middleNameInput.value =
                    student.middleName || "";

                clearInlineError(studentIdInput);
                clearInlineError(lastNameInput);
                clearInlineError(firstNameInput);

            } catch (error) {

                console.error(
                    "Student lookup failed:",
                    error
                );

                showInlineError(
                    studentIdInput,
                    error.message ||
                    "Student does not belong to the selected campus."
                );

            } finally {

                hideActionLoading();
            }

        }, 500);
    });

    // Campaign / Platform Image
    const campaignFile = row.querySelector(".campaign-input");
    const campaignButton = row.querySelector(".campaign-btn");

    campaignButton?.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();

        if (row._campaignFile || row.dataset.campaign) {
            toggleMemberFilePreview(row, "campaign");
            return;
        }

        campaignFile?.click();
    });

    campaignFile?.addEventListener("change", async () => {
        const file = campaignFile.files?.[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Please select an image file.");
            campaignFile.value = "";
            return;
        }

        try {
            showActionLoading(
                "Uploading Campaign",
                "Please wait while the campaign image is being uploaded."
            );

            const url = await uploadDepartmentFile(file, "campaign");

            row._campaignFile = file;
            row.dataset.campaign = url;

            campaignButton.classList.add("has-campaign");
            campaignButton.innerHTML = `
                <i class="bi bi-check-lg"></i>
                <span>Campaign</span>
            `;

            showMemberFilePreview(row, "campaign");
            refreshExisting();

        } catch (error) {
            console.error("Campaign upload failed:", error);

            alert(
                error.message ||
                "Failed to upload campaign image."
            );

            campaignFile.value = "";

        } finally {
            hideActionLoading();
        }
    });

    // Background Image
    const backgroundFile = row.querySelector(".background-input");
    const backgroundButton = row.querySelector(".background-btn");

    backgroundButton?.addEventListener("click", e => {

        e.preventDefault();
        e.stopPropagation();

        const hasBackground =
            !!row._backgroundFile ||
            !!row.dataset.background;

        if (hasBackground) {
            toggleMemberFilePreview(
                row,
                "background"
            );
            return;
        }

        backgroundFile?.click();
    });

    backgroundFile?.addEventListener("change", async () => {
        const file = backgroundFile.files?.[0];

        if (!file) return;

        if (
            !file.type.startsWith("image/") &&
            file.type !== "application/pdf"
        ) {
            alert("Please select an image or PDF file.");
            backgroundFile.value = "";
            return;
        }

        try {
            showActionLoading(
                "Uploading Background",
                "Please wait while the background file is being uploaded."
            );

            const url = await uploadDepartmentFile(
                file,
                "background"
            );

            row._backgroundFile = file;
            row.dataset.background = url;

            backgroundButton.classList.add("has-background");
            backgroundButton.innerHTML = `
                <i class="bi bi-check-lg"></i>
                <span>Background</span>
            `;

            showMemberFilePreview(row, "background");
            refreshExisting();

        } catch (error) {
            console.error("Background upload failed:", error);

            alert(
                error.message ||
                "Failed to upload background file."
            );

            backgroundFile.value = "";

        } finally {
            hideActionLoading();
        }
    });

    // Photo
    const photoFile = row.querySelector(".photo-input");
    const photoButton = row.querySelector(".photo-btn");

    photoButton.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();

        if (row._photoFile || row.dataset.photo) {
            toggleMemberFilePreview(row, "photo");
            return;
        }

        photoFile.click();
    });

    photoFile.addEventListener("change", async () => {
        const file = photoFile.files?.[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Please select an image file.");
            photoFile.value = "";
            return;
        }

        try {
            showActionLoading(
                "Uploading Photo",
                "Please wait while the member photo is being uploaded."
            );

            const url = await uploadDepartmentFile(
                file,
                "photo"
            );

            row._photoFile = file;
            row.dataset.photo = url;

            photoButton.classList.add("has-photo");
            photoButton.innerHTML = `
                <i class="bi bi-check-lg"></i>
                <span>Photo</span>
            `;

            showMemberFilePreview(row, "photo");
            refreshExisting();

        } catch (error) {
            console.error("Photo upload failed:", error);

            alert(
                error.message ||
                "Failed to upload member photo."
            );

            photoFile.value = "";

        } finally {
            hideActionLoading();
        }
    });

    // Remove
    row.querySelector(".remove-member").addEventListener("click", () => {
        row.remove();
        updateRemoveButtons(list);
        refreshAccordion(list.closest(".accordion"));
    });

    list.appendChild(row);



    if (existingCampaign) {
        row.dataset.campaign = existingCampaign;
        row._campaignFile = null;

        campaignButton?.classList.add("has-campaign");

        if (campaignButton) {
            campaignButton.innerHTML = `
            <i class="bi bi-check-lg"></i>
            <span>Campaign</span>
        `;
        }
    }

    if (existingBackground) {
        row.dataset.background = existingBackground;
        row._backgroundFile = null;

        backgroundButton?.classList.add("has-background");

        if (backgroundButton) {
            backgroundButton.innerHTML = `
            <i class="bi bi-check-lg"></i>
            <span>Background</span>
        `;
        }
    }

    if (existingPhoto) {
        row.dataset.photo = existingPhoto;
        row._photoFile = null;

        photoButton?.classList.add("has-photo");

        if (photoButton) {
            photoButton.innerHTML =
                `<i class="bi bi-check-lg"></i><span>Photo</span>`;
        }
    }
}


// Student Lookup
async function lookupStudentById(
    studentId,
    schoolYear = null,
    currentDepartmentId = null
) {
    if (!studentId) return null;

    const url = `${DEPARTMENT_API}/members/student/${encodeURIComponent(studentId)}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        if (!response.ok) {
            let message =
                "Student does not belong to the selected campus and department.";

            try {
                const data = await response.json();

                message =
                    data?.message ||
                    data?.error ||
                    message;
            } catch (e) {}

            throw new Error(message);
        }

        const voter = await response.json();

        // Check existing department membership immediately
        if (schoolYear) {
            const membersResponse = await fetch(
                `${DEPARTMENT_API}/members/student/${encodeURIComponent(studentId)}/school-year/${encodeURIComponent(schoolYear)}` +
                    (currentDepartmentId
                        ? `?excludeDepartmentId=${encodeURIComponent(currentDepartmentId)}`
                        : ""),
                    {
                    method: "GET",
                    headers: {
                        "Accept": "application/json"
                    }
                }
            );

            if (!membersResponse.ok) {
                throw new Error(
                    "Unable to verify the student's department membership."
                );
            }

            const existingMembers = await membersResponse.json();

            if (
                Array.isArray(existingMembers) &&
                existingMembers.length > 0
            ) {
                throw new Error(
                    "This student is already a department member for the selected school year."
                );
            }
        }

        return voter;

    } catch (error) {
        console.error("Student lookup failed:", error);
        throw error;
    }
}

function renderPositionsList(list, positions) {
    if (!list) return;

    list.innerHTML = positions.map(position => `
        <div class="position-chip" data-position="${esc(position)}">
            <span>${esc(position)}</span>
            <button type="button" class="remove-position" title="Remove position">
                <i class="bi bi-x"></i>
            </button>
        </div>
    `).join("");

    list.dataset.positions = JSON.stringify(positions);
}

function getPositions(list) {
    if (!list?.dataset.positions) return [];
    try {
        return JSON.parse(list.dataset.positions);
    } catch {
        return [];
    }
}

function addPosition(list, position) {
    position = position.trim();
    if (!position) return false;

    const positions = getPositions(list);

    if (positions.some(p => p.toLowerCase() === position.toLowerCase())) {
        return false;
    }

    positions.push(position);
    renderPositionsList(list, positions);
    return true;
}

function removePosition(list, position) {
    const positions = getPositions(list).filter(p => p !== position);
    renderPositionsList(list, positions);
}

function syncMemberRowsToPositions(positionsList) {
    const container =
        positionsList.closest("#createDepartmentsForm") ||
        positionsList.closest(".edit-departments-form");

    if (!container) return;

    const memberList =
        container.querySelector(".members-list");

    if (!memberList) return;

    const positions = getPositions(positionsList);
    let memberCount = memberList.querySelectorAll(".member-row").length;

    while (memberCount < positions.length) {
        addMemberRow(memberList, {}, false);
        memberCount++;
    }

    updateRemoveButtons(memberList);
}

function bindPositionsControls(container, list, input, addBtn) {
    list.addEventListener("click", e => {
        const btn = e.target.closest(".remove-position");
        if (!btn) return;

        const chip = btn.closest(".position-chip");
        removePosition(list, chip.dataset.position);
        syncMemberRowsToPositions(list);
    });

    addBtn?.addEventListener("click", () => {
        if (addPosition(list, input.value)) {
            input.value = "";
            syncMemberRowsToPositions(list);
        }
    });

    input?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();

            if (addPosition(list, input.value)) {
                input.value = "";
                syncMemberRowsToPositions(list);
            }
        }
    });
}

window.addEventListener("resize", repositionOpenPreviews);
window.addEventListener("scroll", repositionOpenPreviews, true);
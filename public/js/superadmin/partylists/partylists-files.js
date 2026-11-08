
function initializePartylistsFileUploads(root = document) {

    root.querySelectorAll(".partylists-file-upload").forEach(upload => {

        if (upload.dataset.bound === "true") return;

        const input =
            upload.querySelector('input[type="file"]');

        const button =
            upload.querySelector(".partylists-file-btn");

        const preview =
            upload.querySelector(".partylists-file-preview");

        if (!input || !button || !preview) return;

        upload.dataset.bound = "true";

        const isLogo =
            input.classList.contains("partylists-logo-input");

        const defaultButton = () => {
            button.classList.remove("has-file");

            button.innerHTML = isLogo
                ? `
                    <i class="bi bi-image"></i>
                    <span>${input.classList.contains("edit-logo-input")
                        ? "Change Logo"
                        : "Upload Logo"}</span>
                  `
                : `
                    <i class="bi bi-file-earmark-image"></i>
                    <span>${input.classList.contains("edit-poster-input")
                        ? "Change Poster"
                        : "Upload Poster"}</span>
                  `;
        };

        // =====================================================
        // BUTTON
        // =====================================================

        button.addEventListener("click", e => {

            e.preventDefault();
            e.stopPropagation();

            const file =
                input.files?.[0] ||
                input._uploadedFile ||
                null;

            const url =
                input.dataset.url ||
                upload.dataset.url ||
                "";

            if (file || url) {

                showPartylistsFilePreview(
                    upload,
                    file || url,
                    isLogo
                );

                return;
            }

            input.click();
        });

        // =====================================================
        // FILE SELECTED
        // =====================================================

        input.addEventListener("change", async () => {

            const file = input.files?.[0];

            if (!file) return;

            const isImage =
                file.type.startsWith("image/");

            const isPDF =
                file.type === "application/pdf";

            if (isLogo && !isImage) {

                alert("Please select an image file.");

                input.value = "";
                return;
            }

            if (!isLogo && !isImage && !isPDF) {

                alert(
                    "Please select an image or PDF file."
                );

                input.value = "";
                return;
            }

            try {

                showActionLoading(
                    isLogo
                        ? "Uploading Logo"
                        : "Uploading Poster",
                    "Please wait while the file is being uploaded."
                );

                const type =
                    isLogo
                        ? "logo"
                        : "poster";

                const url =
                    await uploadPartylistFile(
                        file,
                        type
                    );

                // Store uploaded URL
                input.dataset.url = url;
                upload.dataset.url = url;

                // Keep local file reference
                input._uploadedFile = file;

                button.classList.add("has-file");

                button.innerHTML = isLogo
                    ? `
                        <i class="bi bi-check-lg"></i>
                        <span>Logo Uploaded</span>
                      `
                    : `
                        <i class="bi bi-check-lg"></i>
                        <span>Poster Uploaded</span>
                      `;

                showPartylistsFilePreview(
                    upload,
                    file,
                    isLogo
                );

                clearInlineError(input);

            } catch (error) {

                console.error(
                    "Partylist file upload failed:",
                    error
                );

                alert(
                    error.message ||
                    "File upload failed."
                );

                input.value = "";
                input._uploadedFile = null;
                input.dataset.url = "";
                upload.dataset.url = "";

                defaultButton();

            } finally {

                hideActionLoading();
            }
        });

        // =====================================================
        // EXISTING SERVER FILE
        // =====================================================

        const existingUrl =
            input.dataset.url ||
            upload.dataset.url ||
            "";

        if (existingUrl) {

            button.classList.add("has-file");

            button.innerHTML = isLogo
                ? `
                    <i class="bi bi-check-lg"></i>
                    <span>Logo Uploaded</span>
                  `
                : `
                    <i class="bi bi-check-lg"></i>
                    <span>Poster Uploaded</span>
                  `;
        }
    });
}


// =========================================================
// PARTYLIST FILE PREVIEW
// =========================================================

function showPartylistsFilePreview(
    upload,
    fileOrUrl,
    isLogo = false
) {

    const preview =
        upload.querySelector(".partylists-file-preview");

    const button =
        upload.querySelector(".partylists-file-btn");

    const input =
        upload.querySelector('input[type="file"]');

    if (!preview || !button || !input) return;

    let fileUrl = "";
    let fileName = "";
    let isFile = false;

    if (fileOrUrl instanceof File) {

        isFile = true;

        fileUrl =
            URL.createObjectURL(fileOrUrl);

        fileName =
            fileOrUrl.name;

    } else {

        fileUrl =
            String(fileOrUrl || "");

        fileName =
            getFileName(fileUrl);
    }

    if (!fileUrl) return;

    const cleanUrl =
        fileUrl.split("?")[0].toLowerCase();

    const isPDF =
        isFile
            ? fileOrUrl.type === "application/pdf"
            : cleanUrl.endsWith(".pdf");

    const title =
        isLogo
            ? "Logo Preview"
            : "Poster Preview";

    const icon =
        isPDF
            ? "bi-file-earmark-pdf"
            : isLogo
                ? "bi-image"
                : "bi-file-earmark-image";

    preview.innerHTML = `

        <div class="partylists-file-preview-header">

            <strong>
                ${title}
            </strong>

            <button
                type="button"
                class="partylists-file-preview-close"
                title="Close Preview"
                aria-label="Close Preview">

                <i class="bi bi-x-lg"></i>

            </button>

        </div>

        <div class="partylists-file-preview-filename">

            <i class="bi ${icon}"></i>

            <span>
                ${esc(fileName || "Uploaded file")}
            </span>

        </div>

        <div class="partylists-file-preview-body">

            ${
                isPDF
                    ? `
                        <iframe
                            src="${esc(fileUrl)}"
                            title="${esc(title)}">
                        </iframe>
                      `
                    : `
                        <img
                            src="${esc(fileUrl)}"
                            alt="${esc(
                                isLogo
                                    ? "Partylist Logo"
                                    : "Partylist Poster"
                            )}">
                      `
            }

        </div>

        <div class="partylists-file-preview-actions">

            <button
                type="button"
                class="partylists-file-change-btn">

                <i class="bi bi-arrow-repeat"></i>
                Change

            </button>

            <button
                type="button"
                class="partylists-file-delete-btn">

                <i class="bi bi-trash"></i>
                Delete

            </button>

        </div>
    `;

    preview.classList.add("show");

    // =====================================================
    // CLOSE
    // =====================================================

    preview
        .querySelector(".partylists-file-preview-close")
        ?.addEventListener("click", e => {

            e.preventDefault();
            e.stopPropagation();

            preview.classList.remove("show");
        });

    // =====================================================
    // CHANGE
    // =====================================================

    preview
        .querySelector(".partylists-file-change-btn")
        ?.addEventListener("click", e => {

            e.preventDefault();
            e.stopPropagation();

            input.click();
        });

    // =====================================================
    // DELETE
    // =====================================================

    preview
        .querySelector(".partylists-file-delete-btn")
        ?.addEventListener("click", async e => {

            e.preventDefault();
            e.stopPropagation();

            const oldUrl =
                input.dataset.url ||
                upload.dataset.url ||
                "";

            input.value = "";
            input._uploadedFile = null;

            input.dataset.url = "";
            upload.dataset.url = "";

            preview.innerHTML = "";
            preview.classList.remove("show");

            button.classList.remove("has-file");

            button.innerHTML = isLogo
                ? `
                    <i class="bi bi-image"></i>
                    <span>${input.classList.contains("edit-logo-input")
                        ? "Change Logo"
                        : "Upload Logo"}</span>
                  `
                : `
                    <i class="bi bi-file-earmark-image"></i>
                    <span>${input.classList.contains("edit-poster-input")
                        ? "Change Poster"
                        : "Upload Poster"}</span>
                  `;

            /*
             * If this is an already-saved server file,
             * remember that the user removed it.
             */
            if (oldUrl) {
                input.dataset.deleted = "true";
            }
        });

    requestAnimationFrame(() => {

        if (
            typeof positionPartylistsFilePreview ===
            "function"
        ) {
            positionPartylistsFilePreview(
                upload,
                preview
            );
        }
    });
}


// =========================================================
// DISPLAY EXISTING SERVER FILE
// =========================================================

function showExistingPartylistsFile(
    preview,
    url,
    isLogo = false
) {

    if (!preview || !url) return;

    const cleanUrl =
        url.split("?")[0].toLowerCase();

    const isPDF =
        cleanUrl.endsWith(".pdf");

    const title =
        isLogo
            ? "Logo"
            : "Poster";

    preview.innerHTML = `

        <div class="partylists-file-preview-header">

            <strong>
                ${title}
            </strong>

        </div>

        <div class="partylists-file-preview-body">

            ${
                isPDF
                    ? `
                        <iframe
                            src="${esc(url)}"
                            title="${esc(title)}">
                        </iframe>
                      `
                    : `
                        <img
                            src="${esc(url)}"
                            alt="${esc(
                                isLogo
                                    ? "Partylist Logo"
                                    : "Partylist Poster"
                            )}">
                      `
            }

        </div>
    `;

    preview.classList.add("show");
}

// =========================================================
// UPLOAD FILE TO BACKEND
// =========================================================

async function uploadPartylistFile(file, type) {

    if (!file) {
        throw new Error("No file selected.");
    }

    const formData =
        new FormData();

    formData.append(
        "file",
        file
    );

    formData.append(
        "type",
        type
    );

    const response =
        await fetch(
            `${PARTYLIST_API}/upload`,
            {
                method: "POST",
                body: formData
            }
        );

    let result;

    try {

        result =
            await response.json();

    } catch {

        throw new Error(
            "Server returned an invalid upload response."
        );
    }

    if (
        !response.ok ||
        !result ||
        !result.path
    ) {

        throw new Error(
            result?.error ||
            `File upload failed (${response.status}).`
        );
    }

    return result.path;
}


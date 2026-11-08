// Delete / Discard / Archive / Save Modals
function initializeDeleteDiscardModals() {
    const deleteConfirm = document.getElementById("confirmDeleteBtn");
    const archiveConfirm = document.getElementById("confirmArchiveBtn");
    const saveConfirm = document.getElementById("confirmSavePartylistsBtn");
    const discardConfirm = document.getElementById("confirmDiscardBtn");

    deleteConfirm?.addEventListener("click", async () => {
        if (!pendingDeleteCard) return;

        const card = pendingDeleteCard;
        const partylistId = card.dataset.id;
        const deletedName =
            card.querySelector(".partylists-item-title h3")?.textContent.trim() ||
            "Partylists";

        if (!partylistId) {
            hideActionLoading();
            showSuccessToast("Error", "Partylist ID is missing.");
            return;
        }

        closeModal("deletePartylistsModal");

        showActionLoading(
            "Deleting...",
            "Please wait while the partylist is being deleted."
        );

        try {
            const response = await fetch(`/superadmin/api/partylists/${partylistId}`, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            card.remove();
            pendingDeleteCard = null;

            showSuccessToast(
                "Deleted",
                `${deletedName} was deleted successfully.`
            );

            refreshExisting();

        } catch (error) {
            console.error("Delete partylist failed:", error);
            showSuccessToast(
                "Error",
                "Failed to delete the partylist."
            );
        } finally {
            hideActionLoading();
        }
    });

    // ARCHIVE
    archiveConfirm?.addEventListener("click", async () => {
        if (!pendingArchiveCard) return;

        const card = pendingArchiveCard;
        const partylistId = card.dataset.id;
        const archiveName =
            card.querySelector(".partylists-item-title h3")?.textContent.trim() ||
            "Partylists";

        if (!partylistId) {
            hideActionLoading();
            showSuccessToast("Error", "Partylist ID is missing.");
            return;
        }

        closeModal("archivePartylistsModal");

        showActionLoading(
            "Archiving...",
            "Please wait while the partylist is being archived."
        );

        try {
            const response = await fetch(
                `/superadmin/api/partylists/${partylistId}/archive`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );

            if (!response.ok) {
                throw new Error(await response.text());
            }

            card.remove();
            pendingArchiveCard = null;

            showSuccessToast(
                "Archived",
                `${archiveName} has been archived.`
            );

            refreshExisting();

        } catch (error) {
            console.error("Archive partylist failed:", error);
            showSuccessToast(
                "Error",
                "Failed to archive the partylist."
            );
        } finally {
            hideActionLoading();
        }
    });


    // SAVE / UPDATE
   saveConfirm?.addEventListener("click", async () => {
       if (!pendingSaveAction) return;

       const action = pendingSaveAction;
       pendingSaveAction = null;

       closeModal("savePartylistsModal");

       showActionLoading(
           action.type === "create" ? "Saving..." : "Updating...",
           action.type === "create"
               ? "Please wait while the partylist is being saved."
               : "Please wait while the partylist is being updated."
       );

       try {
           if (action.type === "create") {
               await saveNewPartylists(action.form);
           } else if (action.type === "edit") {
               await saveEditedPartylists(action.card);
           }
       } catch (error) {
           console.error("Save partylist failed:", error);

           showSuccessToast(
               "Error",
               error.message || "Failed to save the partylist."
           );
       } finally {
           hideActionLoading();
       }
   });

    // DISCARD
    discardConfirm?.addEventListener("click", () => {
        closeModal("discardPartylistsModal");

        showActionLoading(
            "Discarding...",
            "Please wait while your changes are being discarded."
        );

        setTimeout(() => {
            resetCreateForm();
            clearAllInlineErrors();

            hideActionLoading();

            showDiscardToast(
                "Discarded",
                "Your changes have been discarded."
            );
        }, 600);
    });

    document.querySelectorAll("[data-modal-close]").forEach(button => {
        button.addEventListener("click", () =>
            closeModal(button.dataset.modalClose)
        );
    });

    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", e => {
            if (e.target === overlay) {
                overlay.classList.remove("show");
            }
        });
    });
}

function openDeleteModal(card) {
    pendingDeleteCard = card;

    const title = card.querySelector(".partylists-item-title h3")?.textContent.trim();
    const name = document.getElementById("deletePartylistsName");
    if (name) name.textContent = title || "this partylists";

    openModal("deletePartylistsModal");
}

function openDiscardModal() {
    openModal("discardPartylistsModal");
}

function openArchiveModal(card) {
    pendingArchiveCard = card;

    const title = card.querySelector(".partylists-item-title h3")?.textContent.trim();
    const name = document.getElementById("archivePartylistsName");
    if (name) name.textContent = title || "this partylists";

    openModal("archivePartylistsModal");
}

// Selection Modal Buttons
function initializeSelectionModalButtons() {
    document.querySelectorAll(".modal-footer .cancel-btn").forEach(button => {
        button.addEventListener("click", e => {
            e.preventDefault();
            button.closest(".modal-overlay")?.classList.remove("show");
        });
    });
}

// Success Toast
function initializeSuccessToast() {
    const toast = document.getElementById("successToast");
    const closeBtn = document.getElementById("successToastClose");
    if (!toast) return;

    closeBtn?.addEventListener("click", () => hideSuccessToast());
}

function showSuccessToast(title, message) {
    const toast = document.getElementById("successToast");
    const titleEl = document.getElementById("successToastTitle");
    const messageEl = document.getElementById("successToastMessage");
    if (!toast) return;

    if (titleEl) titleEl.textContent = title || "Success";
    if (messageEl) messageEl.textContent = message || "";

    toast.classList.remove("show");
    void toast.offsetWidth; // restart CSS transition even if already visible
    toast.classList.add("show");

    clearTimeout(successToastTimeout);
    successToastTimeout = setTimeout(() => hideSuccessToast(), 4000);
}

function hideSuccessToast() {
    const toast = document.getElementById("successToast");
    if (!toast) return;
    toast.classList.remove("show");
    clearTimeout(successToastTimeout);
}

// Discard Toast
function showDiscardToast(title, message) {
    const toast = document.getElementById("successToast");
    const titleEl = document.getElementById("successToastTitle");
    const messageEl = document.getElementById("successToastMessage");

    if (!toast) return;

    if (titleEl) titleEl.textContent = title || "Discarded";
    if (messageEl) messageEl.textContent = message || "";

    toast.classList.remove("show");
    void toast.offsetWidth; // restart CSS transition
    toast.classList.add("show");

    clearTimeout(discardToastTimeout);
    discardToastTimeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 4000);
}
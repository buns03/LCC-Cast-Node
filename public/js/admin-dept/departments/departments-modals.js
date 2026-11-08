// Delete / Discard / Archive / Save Modals
function initializeDeleteDiscardModals() {
    const deleteConfirm = document.getElementById("confirmDeleteBtn");
    const archiveConfirm = document.getElementById("confirmArchiveBtn");
    const saveConfirm = document.getElementById("confirmSaveDepartmentsBtn");
    const discardConfirm = document.getElementById("confirmDiscardBtn");

    deleteConfirm?.addEventListener("click", async () => {
        if (!pendingDeleteCard) return;

        const card = pendingDeleteCard;
        const departmentId = card.dataset.id;
        const deletedName =
            card.querySelector(".departments-item-title h3")?.textContent.trim() ||
            "Departments";

        if (!departmentId) {
            hideActionLoading();
            showSuccessToast("Error", "Department ID is missing.");
            return;
        }

        closeModal("deleteDepartmentsModal");

        showActionLoading(
            "Deleting...",
            "Please wait while the department is being deleted."
        );

        try {
            const response = await fetch(`${DEPARTMENT_API}/${departmentId}`, {
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
                        console.error("Delete department failed:", error);
                        showSuccessToast(
                            "Error",
                            error.message || "Failed to delete the department."
                        );
                    } finally {
                        hideActionLoading();
                    }
    });

    // ARCHIVE
    archiveConfirm?.addEventListener("click", async () => {
        if (!pendingArchiveCard) return;

        const card = pendingArchiveCard;
        const departmentId = card.dataset.id;
        const archiveName =
            card.querySelector(".departments-item-title h3")?.textContent.trim() ||
            "Departments";

        if (!departmentId) {
            hideActionLoading();
            showSuccessToast("Error", "Department ID is missing.");
            return;
        }

        closeModal("archiveDepartmentsModal");

        showActionLoading(
            "Archiving...",
            "Please wait while the department is being archived."
        );

        try {
                    const response = await fetch(`${DEPARTMENT_API}/${departmentId}/archive`,
                        {
                            method: "PUT",
                            headers: {
                                "Accept": "application/json"
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
                    console.error("Archive department failed:", error);
                    showSuccessToast(
                        "Error",
                        error.message || "Failed to archive the department."
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

       closeModal("saveDepartmentsModal");

       showActionLoading(
           action.type === "create" ? "Saving..." : "Updating...",
           action.type === "create"
               ? "Please wait while the department is being saved."
               : "Please wait while the department is being updated."
       );

       try {
           if (action.type === "create") {
               await saveNewDepartments(action.form);
           } else if (action.type === "edit") {
               await saveEditedDepartments(action.card);
           }
       } catch (error) {
           console.error("Save department failed:", error);

           showSuccessToast(
               "Error",
               error.message || "Failed to save the department."
           );
       } finally {
           hideActionLoading();
       }
   });

    // DISCARD
    discardConfirm?.addEventListener("click", () => {
        closeModal("discardDepartmentsModal");

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

    const title = card.querySelector(".departments-item-title h3")?.textContent.trim();
    const name = document.getElementById("deleteDepartmentsName");
    if (name) name.textContent = title || "this departments";

    openModal("deleteDepartmentsModal");
}

function openDiscardModal() {
    openModal("discardDepartmentsModal");
}

function openArchiveModal(card) {
    pendingArchiveCard = card;

    const title = card.querySelector(".departments-item-title h3")?.textContent.trim();
    const name = document.getElementById("archiveDepartmentsName");
    if (name) name.textContent = title || "this departments";

    openModal("archiveDepartmentsModal");
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

function showActionLoading(title, message) {
  const modal = document.getElementById("actionLoadingModal");
  const titleElement = document.getElementById("actionLoadingTitle");
  const messageElement = document.getElementById("actionLoadingMessage");

  if (!modal) {
    console.error("actionLoadingModal not found.");
    return;
  }

  if (titleElement) {
    titleElement.textContent = title;
  }

  if (messageElement) {
    messageElement.textContent = message;
  }

  modal.classList.add("show");
  document.body.classList.add("modal-loading");
}

function hideActionLoading() {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) {
    return;
  }

  modal.classList.remove("show");
  document.body.classList.remove("modal-loading");
}
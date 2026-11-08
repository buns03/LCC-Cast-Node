

// Refresh Existing
function refreshExisting() {
    // No campus filter for admin-dept — every card already belongs
    // to this admin's own campus and department.
}

async function restoreDepartment(id) {
    try {
        showActionLoading(
            "Restoring Department",
            "Please wait while the department is being restored."
        );

        const response = await fetch(
            `${DEPARTMENT_API}/${id}/restore`,
            {
                method: "PUT"
            }
        );

        if (!response.ok) {
            throw new Error("Failed to restore department.");
        }

        showSuccessToast(
            "Restored",
            "Department restored successfully."
        );

        await loadDepartments();

    } catch (error) {
        console.error(error);

        showSuccessToast(
            "Restore Failed",
            "Unable to restore the department."
        );

    } finally {
        hideActionLoading();
    }
}

async function loadArchivedDepartments(force = false) {
    return SoftCache.load(`${DEPARTMENT_API}/archived`, { force });
}

async function loadTrashDepartments(force = false) {
    return SoftCache.load(`${DEPARTMENT_API}/trash`, { force });
}
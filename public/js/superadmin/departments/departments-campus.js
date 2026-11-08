async function loadEditCampusOptions(select) {
    if (!select) return;

    try {
        const campuses = await SoftCache.load("/superadmin/api/departments/campuses", { ttl: 300000 });
        const currentCampusId = select.dataset.campusId || "";

        select.innerHTML = `
            <option value="">Select Campus</option>

            ${campuses.map(campus => `
                <option
                    value="${esc(campus.id)}"
                    ${String(campus.id) === String(currentCampusId) ? "selected" : ""}
                >
                    ${esc(campus.name)}
                </option>
            `).join("")}
        `;

    } catch (error) {
        console.error("Failed to load edit campuses:", error);
        select.innerHTML = `<option value="">Unable to load campuses</option>`;
    }
}

async function loadCampuses() {

    const campusSelect = document.getElementById("departmentsCampus");

    if (!campusSelect) return;

    try {

        const campuses = await SoftCache.load(`${DEPARTMENT_API}/campuses`, { ttl: 300000 });

        campusSelect.innerHTML = `
            <option value="">Select Campus</option>
        `;

        campuses.forEach(campus => {

            if (!campus.id) return;

            const option = document.createElement("option");

            option.value = campus.id;
            option.textContent = campus.name || "";

            campusSelect.appendChild(option);
        });

    } catch (error) {

        console.error("Failed to load campuses:", error);

        campusSelect.innerHTML = `
            <option value="">Unable to load campuses</option>
        `;
    }
}

function initializeCampusFilter() {
    const filter = document.getElementById("campusFilter");

    if (!filter) return;

    filter.addEventListener("change", () => {
        refreshExisting();
    });

    refreshExisting();
}

// Refresh Existing
function refreshExisting() {
    const filter = document.getElementById("campusFilter");

    if (!filter) return;

    const selectedCampus = filter.value;

    document
        .querySelectorAll("#existingDepartments .departments-item")
        .forEach(card => {
            const cardCampusId = card.dataset.campus || "";

            const shouldShow =
                selectedCampus === "all" ||
                selectedCampus === "" ||
                cardCampusId === selectedCampus;

            card.style.display = shouldShow ? "" : "none";
        });
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

async function loadArchivedDepartments() {
    const response = await fetch(`${DEPARTMENT_API}/archived`);

    if (!response.ok) {
        throw new Error("Failed to load archived departments.");
    }

    return await response.json();
}

async function loadTrashDepartments() {
    const response = await fetch(`${DEPARTMENT_API}/trash`);

    if (!response.ok) {
        throw new Error("Failed to load deleted departments.");
    }

    return await response.json();
}
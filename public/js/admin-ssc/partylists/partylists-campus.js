async function loadEditCampusOptions(select) {
    if (!select) return;

    try {
        const response = await fetch("/superadmin/api/partylists/campuses");

        if (!response.ok) {
            throw new Error("Failed to load campuses.");
        }

        const campuses = await response.json();
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
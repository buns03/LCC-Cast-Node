function clearAllInlineErrors() {
    document.querySelectorAll(".inline-error.show").forEach(error => {
        error.textContent = "";
        error.classList.remove("show");
    });

    document.querySelectorAll(".form-group.has-error, .departments-file-upload.has-error, .member-row.has-error")
        .forEach(group => group.classList.remove("has-error"));
}

function showInlineError(control, message) {
    if (!control) return;

    const wrapper = control.closest(".form-group") ||
        control.closest(".departments-file-upload") ||
        control.closest(".member-field-group") ||
        control.closest(".member-row");
    const error = wrapper?.querySelector(".inline-error") || document.getElementById(control.dataset.errorTarget || "");

    if (wrapper) wrapper.classList.add("has-error");
    if (error) {
        error.textContent = message;
        error.classList.add("show");
    }
}

function clearInlineError(control) {
    if (!control) return;

    const wrapper = control.closest(".form-group") ||
        control.closest(".departments-file-upload") ||
        control.closest(".member-field-group") ||
        control.closest(".member-row");
    const error = wrapper?.querySelector(".inline-error") || document.getElementById(control.dataset.errorTarget || "");

    if (error) {
        error.textContent = "";
        error.classList.remove("show");
    }
    if (wrapper) wrapper.classList.remove("has-error");
}

function validateRequiredField(control, message) {
    if (!control) return false;

    const value = ["SELECT", "INPUT", "TEXTAREA"].includes(control.tagName) ? control.value.trim() : "";

    if (!value) {
        showInlineError(control, message);
        control.focus();
        return false;
    }

    clearInlineError(control);
    return true;
}

function validateRequiredFile(control, message) {
    if (!control) return false;

    const file = control.files && control.files.length > 0;
    const wrapper = control.closest(".departments-file-upload") || control.closest(".form-group");

    if (!file) {
        if (wrapper) wrapper.classList.add("has-error");
        const target = wrapper?.querySelector(".inline-error") || document.getElementById(control.dataset.errorTarget || "");
        if (target) {
            target.textContent = message;
            target.classList.add("show");
        }
        control.focus();
        return false;
    }

    if (wrapper) wrapper.classList.remove("has-error");
    const target = wrapper?.querySelector(".inline-error") || document.getElementById(control.dataset.errorTarget || "");
    if (target) {
        target.textContent = "";
        target.classList.remove("show");
    }

    return true;
}

function initializeValidationBindings() {

    document.addEventListener("input", e => {
        const target = e.target;

        // Text fields
        if (
            target.matches("#departmentsName") ||
            target.matches("#departmentsTitle") ||
            target.matches("#departmentsSchoolYear") ||
            target.matches(".edit-departments-name-input") ||
            target.matches(".edit-departments-title-input") ||
            target.matches(".edit-departments-schoolyear-input") ||
            target.matches(".member-student-id") ||
            target.matches(".member-last-name") ||
            target.matches(".member-first-name") ||
            target.matches(".other-position-input")
        ) {
            if (target.value.trim()) {
                clearInlineError(target);
            }
        }
    });

    document.addEventListener("change", e => {
        const target = e.target;

        // Select fields
        if (
            target.matches("#departmentsCampus") ||
            target.matches(".edit-departments-campus") ||
            target.matches(".member-position")
        ) {
            if (target.value) {
                clearInlineError(target);
            }
        }

        // File fields
        if (
            target.matches("#departmentsPoster") ||
            target.matches(".departments-poster-input") ||
            target.matches(".departments-logo-input")
        ) {
            if (target.files && target.files.length > 0) {
                clearInlineError(target);
            }
        }
    });

    document.addEventListener("blur", async e => {
        const target = e.target;

        if (!target.matches(".member-student-id")) return;

        const studentId = target.value.trim();

        if (!studentId) return;

        const row = target.closest(".member-row");
        if (!row) return;

        try {
            target.classList.add("loading");

            const response = await fetch(
                `/superadmin/api/departments/members/student/${encodeURIComponent(studentId)}`
            );

            if (!response.ok) {
                clearMemberFieldsFromLookup(row);
                return;
            }

            const student = await response.json();

            const firstName = row.querySelector(".member-first-name");
            const middleName = row.querySelector(".member-middle-name");
            const lastName = row.querySelector(".member-last-name");

            if (firstName) {
                firstName.value = student.firstName || "";
                firstName.dispatchEvent(
                    new Event("input", { bubbles: true })
                );
            }

            if (middleName) {
                middleName.value = student.middleName || "";
                middleName.dispatchEvent(
                    new Event("input", { bubbles: true })
                );
            }

            if (lastName) {
                lastName.value = student.lastName || "";
                lastName.dispatchEvent(
                    new Event("input", { bubbles: true })
                );
            }

            clearInlineError(target);

        } catch (error) {
            console.error("Student lookup failed:", error);
        } finally {
            target.classList.remove("loading");
        }
    });

}

function validateMembers(memberList) {
    let isValid = true;
    const rows = memberList.querySelectorAll(".member-row");

    const container =
        memberList.closest("#createDepartmentsForm") ||
        memberList.closest(".edit-departments-form");

    const votingTypeSelect =
        container?.querySelector("#departmentsVotingType, .edit-departments-voting-type");

    const isPartylist = votingTypeSelect?.value === "PARTYLIST";

    rows.forEach(row => {
        const studentId = row.querySelector(".member-student-id");
        const lastName = row.querySelector(".member-last-name");
        const firstName = row.querySelector(".member-first-name");
        const position = row.querySelector(".member-position");
        const otherPosition = row.querySelector(".other-position-input");

        if (studentId && !validateRequiredField(studentId, "Student ID is required.")) isValid = false;
        if (lastName && !validateRequiredField(lastName, "Last name is required.")) isValid = false;
        if (firstName && !validateRequiredField(firstName, "First name is required.")) isValid = false;

        if (isPartylist) {
            if (position && !validateRequiredField(position, "Please select a position.")) isValid = false;

            if (position && position.value === "Others" && otherPosition &&
                !validateRequiredField(otherPosition, "Please enter a position.")) {
                isValid = false;
            }
        }
    });

    return isValid;
}

function validateNoDuplicatePositionMembers(memberList) {
    let isValid = true;
    const rows = [...memberList.querySelectorAll(".member-row")];
    const seen = new Map();

    rows.forEach(row => {
        const input = row.querySelector(".member-student-id");
        const studentId = input?.value.trim().toLowerCase() || "";

        if (!studentId) return;

        if (seen.has(studentId)) {
            showInlineError(input, "This student cannot hold multiple positions in the same partylist.");
            showInlineError(seen.get(studentId), "This student cannot hold multiple positions in the same partylist.");
            isValid = false;
            return;
        }

        seen.set(studentId, input);
    });

    return isValid;
}

function validateMemberCountAgainstPositions(memberList, positionsList) {
    const positions = getPositions(positionsList);
    const rows = memberList.querySelectorAll(".member-row").length;

    if (positions.length === 0) {
        showInlineError(positionsList, "Please add at least one position.");
        return false;
    }

    if (rows < positions.length) {
        const error = positionsList.parentElement?.querySelector(".inline-error") ||
            document.getElementById("positionsError");

        if (error) {
            error.textContent = `Add at least ${positions.length} member(s) to match the selected positions.`;
            error.classList.add("show");
        }
        return false;
    }

    const errorEl = document.getElementById("positionsError") ||
        positionsList.parentElement?.querySelector(".inline-error");

    if (errorEl) {
        errorEl.textContent = "";
        errorEl.classList.remove("show");
    }

    return true;
}

// Edit Forms
function initializeEditForms() {
    document
        .querySelectorAll("#existingDepartments .departments-item")
        .forEach(card => bindEditForm(card));

    // Create form
    const form = document.getElementById("createDepartmentsForm");

    form?.addEventListener("submit", e => {
        e.preventDefault();
        clearAllInlineErrors();

        showActionLoading(
                "Validating Department",
                "Please wait..."
            );

        const nameInput =
            document.getElementById("departmentsName");

        const titleInput =
            document.getElementById("departmentsTitle");

        const schoolYearInput =
            document.getElementById("departmentsSchoolYear");

        const campusSelect =
            document.getElementById("departmentsCampus");

        const votingTypeInput = document.getElementById("departmentsVotingType");

        const memberList =
            document.getElementById("createMembersList");

        let isValid = true;

        if (
            !nameInput ||
            !validateRequiredField(
                nameInput,
                "Departments name is required."
            )
        ) {
            isValid = false;
        }

        if (
            !titleInput ||
            !validateRequiredField(
                titleInput,
                "Department title is required."
            )
        ) {
            isValid = false;
        }

        if (
            !schoolYearInput ||
            !validateRequiredField(
                schoolYearInput,
                "Departments school year is required."
            )
        ) {
            isValid = false;
        }

        if (!votingTypeInput || !validateRequiredField(votingTypeInput, "Please select a voting type.")) isValid = false;

        if (
            !campusSelect ||
            !validateRequiredField(
                campusSelect,
                "Please select a campus."
            )
        ) {
            isValid = false;
        }

                if (votingTypeInput?.value === "REPRESENTATIVE") {

                    if (memberList && !validateMembers(memberList)) {
                        isValid = false;
                    }

                    const createPositionsList = document.getElementById("createPositionsList");

                    if (createPositionsList &&
                        !validateMemberCountAgainstPositions(memberList, createPositionsList)) {
                        isValid = false;
                    }
                }

                if (votingTypeInput?.value === "PARTYLIST") {

                    if (memberList && !validateMembers(memberList)) {
                        isValid = false;
                    }

                    if (memberList && !validateNoDuplicatePositionMembers(memberList)) {
                        isValid = false;
                    }
                }

        if (!isValid) return;

        pendingSaveAction = {
            type: "create",
            form
        };

        hideActionLoading();
        openModal("saveDepartmentsModal");
    });

    // Discard
    document
        .getElementById("discardDepartments")
        ?.addEventListener("click", e => {
            e.preventDefault();
            openDiscardModal();
        });

    // Revalidate edit members when department/campus changes
    document
        .querySelectorAll("#existingDepartments .departments-item")
        .forEach(card => {
            const editForm =
                card.querySelector(".edit-departments-form");

            const departmentSelect =
                editForm?.querySelector(
                    ".edit-departments-name-input"
                );

            const campusSelect =
                editForm?.querySelector(
                    ".edit-departments-campus"
                );

            const revalidateEditMembers = async () => {
                const campusId =
                    campusSelect?.value || "";

                const departmentName =
                    departmentSelect?.value || "";

//                const departmentId =
//                    card.dataset.id || null;

                if (!campusId || !departmentName) {
                    return;
                }

                const memberRows =
                    editForm.querySelectorAll(".member-row");

                for (const row of memberRows) {
                    const studentIdInput =
                        row.querySelector(
                            ".member-student-id"
                        );

                    if (
                        !studentIdInput ||
                        !studentIdInput.value.trim()
                    ) {
                        continue;
                    }

                    try {
                        const schoolYear =
                            editForm
                                .querySelector(".edit-departments-schoolyear-input")
                                ?.value.trim() || "";

                        await lookupStudentById(
                            studentIdInput.value.trim(),
                            campusId,
                            null,
                            departmentName,
                            schoolYear,
                            card.dataset.id || null
                        );

                        clearInlineError(
                            studentIdInput
                        );
                    } catch (error) {
                        showInlineError(
                            studentIdInput,
                            error.message ||
                            "Student does not belong to the selected campus and department."
                        );
                    }
                }
            };

            departmentSelect?.addEventListener(
                "change",
                revalidateEditMembers
            );

            campusSelect?.addEventListener(
                "change",
                revalidateEditMembers
            );
        });
}
function bindEditForm(card) {
    if (!card || card.dataset.editBound === "true") return;
    card.dataset.editBound = "true";

    const form = card.querySelector(".edit-departments-form");
    const list = card.querySelector(".edit-members-list");
    const add = card.querySelector(".edit-add-member");
    const cancel = card.querySelector(".cancel-departments-edit");

    if (!form) return;

    const campusSelect = form.querySelector(".edit-departments-campus");

    const departmentSelect =
        form.querySelector(".edit-departments-name-input");

    if (departmentSelect) {
        const currentName =
            departmentSelect.dataset.currentName || "";

        if (currentName) {
            departmentSelect.value = currentName;
        }
    }

    loadEditCampusOptions(campusSelect);
    initializeExistingDepartmentFiles(card);

        initializeEditPositions(card, card._departmentData || null);

    // Add member
    add?.addEventListener("click", e => {
        e.preventDefault();

        addMemberRow(
            list,
            { position: "Member" },
            true
        );

        updateRemoveButtons(list);
        refreshExisting();
    });

    // Cancel
    cancel?.addEventListener("click", e => {
        e.preventDefault();

        clearAllInlineErrors();

        card.classList.remove("editing", "show");

        const icon = card.querySelector(".expand-departments i");

        if (icon) {
            icon.className = "bi bi-chevron-down";
        }

        refreshExisting();
    });

    // Save
    form.addEventListener("submit", async e => {
        e.preventDefault();

        clearAllInlineErrors();

        showActionLoading(
                "Validating Department",
                "Please wait..."
            );

        const nameInput =
            form.querySelector(".edit-departments-name-input");

        const titleInput =
            form.querySelector(".edit-departments-title-input");

        const descriptionInput =
            form.querySelector(".edit-departments-description-input");

        const schoolYearInput =
            form.querySelector(".edit-departments-schoolyear-input");

        const campusSelect =
            form.querySelector(".edit-departments-campus");

        const votingTypeInput = form.querySelector(".edit-departments-voting-type");

        const editList =
            form.querySelector(".edit-members-list");

        let isValid = true;

        if (
            !nameInput ||
            !validateRequiredField(
                nameInput,
                "Departments name is required."
            )
        ) {
            isValid = false;
        }

        if (
            !titleInput ||
            !validateRequiredField(
                titleInput,
                "Department title is required."
            )
        ) {
            isValid = false;
        }

        if (
            !schoolYearInput ||
            !validateRequiredField(
                schoolYearInput,
                "Departments school year is required."
            )
        ) {
            isValid = false;
        }

        if (!votingTypeInput || !validateRequiredField(votingTypeInput, "Please select a voting type.")) isValid = false;

        if (
            !campusSelect ||
            !validateRequiredField(
                campusSelect,
                "Please select a campus."
            )
        ) {
            isValid = false;
        }

        if (votingTypeInput?.value === "REPRESENTATIVE") {

            if (editList && !validateMembers(editList)) {
                isValid = false;
            }

            const editPositionsList = form.querySelector(".edit-positions-list");

            if (editPositionsList &&
                !validateMemberCountAgainstPositions(editList, editPositionsList)) {
                isValid = false;
            }
        }

        if (!isValid) return;

        const campusId = campusSelect.value;
        const departmentName = nameInput.value.trim();

        const memberRows =
            editList?.querySelectorAll(".member-row") || [];

        for (const row of memberRows) {
            const studentIdInput =
                row.querySelector(".member-student-id");

            if (!studentIdInput?.value.trim()) continue;

            try {
                await lookupStudentById(
                    studentIdInput.value.trim(),
                    campusId,
                    null,
                    departmentName,
                    schoolYearInput.value.trim(),
                    card.dataset.id || null
                );

                clearInlineError(studentIdInput);

            } catch (error) {
                showInlineError(
                    studentIdInput,
                    error.message ||
                    "Student does not belong to the selected campus and department."
                );

                isValid = false;
            }
        }

        if (!isValid) return;

        pendingSaveAction = {
            type: "edit",
            card: card
        };

        hideActionLoading();

        openModal("saveDepartmentsModal");
    });
}
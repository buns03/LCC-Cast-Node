function clearAllInlineErrors() {
    document.querySelectorAll(".inline-error.show").forEach(error => {
        error.textContent = "";
        error.classList.remove("show");
    });

    document.querySelectorAll(".form-group.has-error, .partylists-file-upload.has-error, .member-row.has-error")
        .forEach(group => group.classList.remove("has-error"));
}

function showInlineError(control, message) {
    if (!control) return;

    const wrapper = control.closest(".form-group") ||
        control.closest(".partylists-file-upload") ||
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
        control.closest(".partylists-file-upload") ||
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
    const wrapper = control.closest(".partylists-file-upload") || control.closest(".form-group");

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
            target.matches("#partylistsName") ||
            target.matches("#partylistsSchoolYear") ||
            target.matches(".edit-partylists-name-input") ||
            target.matches(".edit-partylists-schoolyear-input") ||
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
            target.matches("#partylistsCampus") ||
            target.matches(".edit-partylists-campus") ||
            target.matches(".member-position")
        ) {
            if (target.value) {
                clearInlineError(target);
            }
        }

        // File fields
        if (
            target.matches("#partylistsPoster") ||
            target.matches(".partylists-poster-input") ||
            target.matches(".partylists-logo-input")
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
                `/superadmin/api/partylists/members/student/${encodeURIComponent(studentId)}`
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

    rows.forEach(row => {
        const studentId = row.querySelector(".member-student-id");
        const lastName = row.querySelector(".member-last-name");
        const firstName = row.querySelector(".member-first-name");
        const position = row.querySelector(".member-position");
        const otherPosition = row.querySelector(".other-position-input");

        if (studentId && !validateRequiredField(studentId, "Student ID is required.")) isValid = false;
        if (lastName && !validateRequiredField(lastName, "Last name is required.")) isValid = false;
        if (firstName && !validateRequiredField(firstName, "First name is required.")) isValid = false;
        if (position && !validateRequiredField(position, "Please select a position.")) isValid = false;

        if (position && position.value === "Others" && otherPosition &&
            !validateRequiredField(otherPosition, "Please enter a position.")) {
            isValid = false;
        }
    });

    return isValid;
}
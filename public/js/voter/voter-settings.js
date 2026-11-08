document.addEventListener("DOMContentLoaded", function () {

  // =====================================================
  // TOGGLE: "Change" buttons (email + password sections)
  // =====================================================
  const toggleButtons = document.querySelectorAll(".change-toggle-btn");

  toggleButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const targetId = btn.getAttribute("data-target");
      const targetEl = document.getElementById(targetId);

      if (!targetEl) return;

      const isHidden = targetEl.hasAttribute("hidden");

      if (isHidden) {
        targetEl.removeAttribute("hidden");
        btn.textContent = "Cancel";
      } else {
        targetEl.setAttribute("hidden", "");
        btn.textContent = targetId === "emailChangeFields"
          ? "Change"
          : "Change";

        targetEl.querySelectorAll("input").forEach(function (input) {
          input.value = "";
          input.closest(".form-group")?.classList.remove(
            "has-error",
            "password-mismatch",
            "password-same"
          );
        });
      }
    });
  });

  wirePasswordStrengthFeedback({
      passwordInputId: "newPassword",
      feedbackId: "newPasswordStrength",
      getButtons: () => [document.getElementById("saveVoterSettings")]
    });

  // =====================================================
  // PASSWORD VISIBILITY TOGGLE (eye icons)
  // =====================================================
  const passwordToggles = document.querySelectorAll(".password-toggle");

  passwordToggles.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      const icon = btn.querySelector("i");

      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";

      if (icon) {
        icon.classList.toggle("bi-eye", !isPassword);
        icon.classList.toggle("bi-eye-slash", isPassword);
      }
    });
  });

  // =====================================================
  // VALIDATION HELPERS
  // =====================================================

  function isEmailValid(value) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(value.trim());
  }

  function setFieldError(inputEl, hasError) {
    const group = inputEl.closest(".form-group");
    if (!group) return;
    group.classList.toggle("has-error", hasError);
  }

  function isSectionOpen(sectionId) {
    const el = document.getElementById(sectionId);
    return el && !el.hasAttribute("hidden");
  }

  function validateEmailSection() {
    const emailInput = document.getElementById("voterEmail");

    if (!isSectionOpen("emailChangeFields")) {
      return true;
    }

    const value = emailInput.value.trim();

    if (value === "") {
      setFieldError(emailInput, false);
      return true;
    }

    const valid = isEmailValid(value);
    setFieldError(emailInput, !valid);
    return valid;
  }

  function validatePasswordSection() {
    if (!isSectionOpen("passwordChangeFields")) {
      return true;
    }

    const currentInput = document.getElementById("currentPassword");
    const newInput = document.getElementById("newPassword");
    const confirmInput = document.getElementById("confirmPassword");

    const current = currentInput.value;
    const newPass = newInput.value;
    const confirm = confirmInput.value;

    let valid = true;

    if (current === "") {
      setFieldError(currentInput, true);
      valid = false;
    } else {
      setFieldError(currentInput, false);
    }

        if (newPass === "") {
          setFieldError(newInput, true);
          valid = false;
        } else {
          const feedback = getPasswordFeedback(newPass);
          setFieldError(newInput, !feedback.valid);
          if (!feedback.valid) valid = false;
        }

    const confirmGroup = confirmInput.closest(".form-group");

    if (confirm === "") {
      setFieldError(confirmInput, true);
      confirmGroup?.classList.remove("password-mismatch", "password-same");
      valid = false;
    } else if (newPass !== "" && confirm !== newPass) {
      setFieldError(confirmInput, true);
      confirmGroup?.classList.add("password-mismatch");
      confirmGroup?.classList.remove("password-same");
      valid = false;
    } else {
      setFieldError(confirmInput, false);
      confirmGroup?.classList.remove("password-mismatch");
      confirmGroup?.classList.add("password-same");
    }

    return valid;
  }

  function validateVoterSettingsForm() {
    const emailValid = validateEmailSection();
    const passwordValid = validatePasswordSection();
    return emailValid && passwordValid;
  }

  // =====================================================
  // MODAL HELPERS
  // =====================================================
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("show");
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("show");
  }

  // =====================================================
  // SAVE BUTTON -> VALIDATE -> OPEN SAVE MODAL
  // =====================================================
  const voterProfileForm = document.getElementById("voterProfileForm");

    voterProfileForm.addEventListener("submit", function (event) {
      event.preventDefault();

      const isValid = validateVoterSettingsForm();

      if (!isValid) {
        return;
      }

      const saveBtn = document.getElementById("saveVoterSettings");
      if (saveBtn && saveBtn.disabled) return;

      openModal("saveVoterSettingsModal");
    });

  const cancelSaveBtn = document.getElementById("cancelSaveVoterSettings");

  if (cancelSaveBtn) {
    cancelSaveBtn.addEventListener("click", function () {
      closeModal("saveVoterSettingsModal");
    });
  }

  const confirmSaveBtn = document.getElementById("confirmSaveVoterSettings");

  if (confirmSaveBtn) {
    confirmSaveBtn.addEventListener("click", function () {
      closeModal("saveVoterSettingsModal");
      submitVoterSettings();
    });
  }

  // =====================================================
  // BUILD PAYLOAD + SUBMIT TO BACKEND
  // =====================================================
  function submitVoterSettings() {

    const payload = {
      newEmail: null,
      currentPassword: null,
      newPassword: null,
      confirmPassword: null
    };

    if (isSectionOpen("emailChangeFields")) {
      const emailValue = document.getElementById("voterEmail").value.trim();
      if (emailValue !== "") {
        payload.newEmail = emailValue;
      }
    }

    if (isSectionOpen("passwordChangeFields")) {
      payload.currentPassword = document.getElementById("currentPassword").value;
      payload.newPassword = document.getElementById("newPassword").value;
      payload.confirmPassword = document.getElementById("confirmPassword").value;
    }

    if (!payload.newEmail && !payload.currentPassword) {
      return;
    }

    showActionLoading(
      "Saving Changes...",
      "Please wait while we update your settings."
    );

    fetch("/voter/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        hideActionLoading();

        if (result.ok) {
          showSuccessToast(
            "Success",
            result.data.message || "Your settings were updated successfully."
          );
          resetChangeSections();
        } else {
          showSuccessToast(
            "Update Failed",
            result.data.message || "Something went wrong. Please try again.",
            true
          );
        }
      })
      .catch(function () {
        hideActionLoading();
        showSuccessToast(
          "Update Failed",
          "Network error. Please try again.",
          true
        );
      });
  }

  // =====================================================
  // LOADING MODAL HELPERS
  // =====================================================
  function showActionLoading(title, message) {
    document.getElementById("actionLoadingTitle").textContent = title;
    document.getElementById("actionLoadingMessage").textContent = message;
    document.body.classList.add("modal-loading");
    openModal("actionLoadingModal");
  }

  function hideActionLoading() {
    document.body.classList.remove("modal-loading");
    closeModal("actionLoadingModal");
  }

  // =====================================================
  // SUCCESS / ERROR TOAST
  // =====================================================
  let toastTimeout = null;

  function showSuccessToast(title, message, isError) {
    const toast = document.getElementById("successToast");
    const icon = toast.querySelector(".success-toast-icon i");

    document.getElementById("successToastTitle").textContent = title;
    document.getElementById("successToastMessage").textContent = message;

    if (icon) {
      icon.classList.toggle("bi-check-lg", !isError);
      icon.classList.toggle("bi-x-lg", !!isError);
    }
    toast.classList.toggle("toast-error", !!isError);

    toast.classList.add("show");

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      toast.classList.remove("show");
    }, 4000);
  }

  // =====================================================
  // RESET FORM SECTIONS AFTER SUCCESSFUL SAVE
  // =====================================================
  function resetChangeSections() {
    ["emailChangeFields", "passwordChangeFields"].forEach(function (id) {
      const section = document.getElementById(id);
      if (!section) return;

      section.setAttribute("hidden", "");
      section.querySelectorAll("input").forEach(function (input) {
        input.value = "";
      });
    });

    document.getElementById("changeEmailBtn").textContent = "Change";
    document.getElementById("changePasswordBtn").textContent = "Change";
  }

  // =====================================================
  // TOAST CLOSE BUTTON
  // =====================================================
  const toastCloseBtn = document.getElementById("successToastClose");
  if (toastCloseBtn) {
    toastCloseBtn.addEventListener("click", function () {
      document.getElementById("successToast").classList.remove("show");
    });
  }

});
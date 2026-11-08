document.addEventListener("DOMContentLoaded", function () {

  // ===== TOGGLE "Change" BUTTONS =====
  document.querySelectorAll(".change-toggle-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const targetEl = document.getElementById(btn.getAttribute("data-target"));
      if (!targetEl) return;

      const isHidden = targetEl.hasAttribute("hidden");
      if (isHidden) {
        targetEl.removeAttribute("hidden");
        btn.textContent = "Cancel";
      } else {
        targetEl.setAttribute("hidden", "");
        btn.textContent = "Change";
        targetEl.querySelectorAll("input").forEach((input) => (input.value = ""));
      }
    });
  });

  wirePasswordStrengthFeedback({
      passwordInputId: "newPassword",
      feedbackId: "newPasswordStrength",
      getButtons: () => [document.getElementById("saveVoterSettings")]
    });

  // ===== PASSWORD VISIBILITY =====
  document.querySelectorAll(".password-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const input = document.getElementById(btn.getAttribute("data-target"));
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

  function isSectionOpen(id) {
    const el = document.getElementById(id);
    return el && !el.hasAttribute("hidden");
  }

  function isEmailValid(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function setFieldError(input, hasError) {
    input.closest(".form-group")?.classList.toggle("has-error", hasError);
  }

  function validateForm() {
    let valid = true;

    if (isSectionOpen("emailChangeFields")) {
      const emailInput = document.getElementById("voterEmail");
      const value = emailInput.value.trim();
      if (value !== "" && !isEmailValid(value)) {
        setFieldError(emailInput, true);
        valid = false;
      } else {
        setFieldError(emailInput, false);
      }
    }

    if (isSectionOpen("passwordChangeFields")) {
      const current = document.getElementById("currentPassword");
      const newPass = document.getElementById("newPassword");
      const confirm = document.getElementById("confirmPassword");

            if (current.value === "") { setFieldError(current, true); valid = false; } else setFieldError(current, false);
            if (newPass.value === "") {
              setFieldError(newPass, true);
              valid = false;
            } else {
              const feedback = getPasswordFeedback(newPass.value);
              setFieldError(newPass, !feedback.valid);
              if (!feedback.valid) valid = false;
            }
            if (confirm.value === "" || confirm.value !== newPass.value) { setFieldError(confirm, true); valid = false; } else setFieldError(confirm, false);
    }

    return valid;
  }

  function openModal(id) { document.getElementById(id)?.classList.add("show"); }
  function closeModal(id) { document.getElementById(id)?.classList.remove("show"); }

  // ===== PROFILE PICTURE — SELECT ONLY, NO UPLOAD YET =====
  const pictureInput = document.getElementById("profilePictureInput");
  const pictureBtn = document.getElementById("changeProfilePicture");
  const picturePreview = document.getElementById("profilePicturePreview");

  const originalPictureSrc = picturePreview ? picturePreview.src : null;
  let selectedProfileFile = null; // holds the chosen File until Save is clicked

  pictureBtn?.addEventListener("click", () => pictureInput?.click());

  pictureInput?.addEventListener("change", function () {
    const file = pictureInput.files[0];
    if (!file) return;

    selectedProfileFile = file;

    // Local preview only — nothing is sent to the server yet.
    const reader = new FileReader();
    reader.onload = function (e) {
      picturePreview.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  function clearSelectedPicture() {
    selectedProfileFile = null;
    if (pictureInput) pictureInput.value = "";
  }

  // ===== DISCARD BUTTON — REVERT EVERYTHING UNSAVED =====
  document.getElementById("discardVoterSettings")?.addEventListener("click", function () {
    resetChangeSections();
    if (picturePreview && originalPictureSrc) {
      picturePreview.src = originalPictureSrc;
    }
    clearSelectedPicture();
  });

  // ===== SAVE BUTTON -> CONFIRM MODAL =====
  const form = document.getElementById("voterProfileForm");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validateForm()) return;

      const saveBtn = document.getElementById("saveVoterSettings");
      if (saveBtn && saveBtn.disabled) return;

      const emailTouched = isSectionOpen("emailChangeFields") &&
        document.getElementById("voterEmail").value.trim() !== "";
    const passwordTouched = isSectionOpen("passwordChangeFields") &&
        document.getElementById("currentPassword").value !== "";
    const pictureTouched = !!selectedProfileFile;

    if (!emailTouched && !passwordTouched && !pictureTouched) {
      return; // nothing to save
    }

    openModal("saveVoterSettingsModal");
  });

  document.getElementById("cancelSaveVoterSettings")?.addEventListener("click", () => closeModal("saveVoterSettingsModal"));

  document.getElementById("confirmSaveVoterSettings")?.addEventListener("click", function () {
    closeModal("saveVoterSettingsModal");
    submitSettings();
  });

  // ===== SUBMIT — ONLY WHAT WAS ACTUALLY CHANGED =====
  function submitSettings() {
    const emailTouched = isSectionOpen("emailChangeFields") &&
        document.getElementById("voterEmail").value.trim() !== "";
    const passwordTouched = isSectionOpen("passwordChangeFields") &&
        document.getElementById("currentPassword").value !== "";
    const pictureTouched = !!selectedProfileFile;

    if (!emailTouched && !passwordTouched && !pictureTouched) return;

    showLoading("Saving Changes...", "Please wait while we update your settings.");

    const tasks = [];

    // Email/password go together only if either was touched —
    // untouched fields inside the payload stay null and are ignored server-side.
    if (emailTouched || passwordTouched) {
      const payload = { newEmail: null, currentPassword: null, newPassword: null, confirmPassword: null };

      if (emailTouched) {
        payload.newEmail = document.getElementById("voterEmail").value.trim();
      }
      if (passwordTouched) {
        payload.currentPassword = document.getElementById("currentPassword").value;
        payload.newPassword = document.getElementById("newPassword").value;
        payload.confirmPassword = document.getElementById("confirmPassword").value;
      }

      tasks.push(
        fetch("/admin-ssc/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data, kind: "profile" })))
          .catch(() => ({ ok: false, data: { message: "Network error." }, kind: "profile" }))
      );
    }

    // Picture upload only if a new file was actually selected.
    if (pictureTouched) {
      const formData = new FormData();
      formData.append("file", selectedProfileFile);

      tasks.push(
        fetch("/admin-ssc/settings/profile-picture", {
          method: "POST",
          body: formData,
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data, kind: "picture" })))
          .catch(() => ({ ok: false, data: { message: "Network error." }, kind: "picture" }))
      );
    }

    Promise.all(tasks).then(function (results) {
      hideLoading();

      const failures = results.filter((r) => !r.ok);

      if (failures.length === 0) {
        showToast("Success", "Your settings were updated successfully.", false);

        if (emailTouched || passwordTouched) resetChangeSections();

        if (pictureTouched) {
          const pictureResult = results.find((r) => r.kind === "picture");
          if (pictureResult && pictureResult.data.profilePictureUrl) {
            picturePreview.src = pictureResult.data.profilePictureUrl;
          }
          clearSelectedPicture();
        }
      } else {
        const message = failures.map((f) => f.data.message).filter(Boolean).join(" ");
        showToast("Update Failed", message || "Something went wrong. Please try again.", true);
      }
    });
  }

  function resetChangeSections() {
    ["emailChangeFields", "passwordChangeFields"].forEach((id) => {
      const section = document.getElementById(id);
      if (!section) return;
      section.setAttribute("hidden", "");
      section.querySelectorAll("input").forEach((input) => (input.value = ""));
    });
    document.getElementById("changeEmailBtn").textContent = "Change";
    document.getElementById("changePasswordBtn").textContent = "Change";
  }

  // ===== LOADING / TOAST HELPERS =====
  function showLoading(title, message) {
    document.getElementById("actionLoadingTitle").textContent = title;
    document.getElementById("actionLoadingMessage").textContent = message;
    document.body.classList.add("modal-loading");
    openModal("actionLoadingModal");
  }

  function hideLoading() {
    document.body.classList.remove("modal-loading");
    closeModal("actionLoadingModal");
  }

  let toastTimeout = null;
  function showToast(title, message, isError) {
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
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  document.getElementById("successToastClose")?.addEventListener("click", () => {
    document.getElementById("successToast").classList.remove("show");
  });
});
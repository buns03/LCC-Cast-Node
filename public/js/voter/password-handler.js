document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("changePasswordForm");
  const passwordInput = document.getElementById("password");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const passwordError = document.getElementById("passwordError");
  const confirmPasswordError = document.getElementById("confirmPasswordError");
  const loadingModal = document.getElementById("actionLoadingModal");

  if (!form) return;

  // ===== EYE ICON TOGGLES =====
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
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

  // ===== SHARED PASSWORD STRENGTH (live feedback + button gate) =====
  wirePasswordStrengthFeedback({
    passwordInputId: "password",
    feedbackId: "newPasswordStrength",
    getButtons: () => [document.getElementById("savePasswordBtn")]
  });

  const username =
    document.querySelector(".change-password-header span")?.textContent.trim() || "";

  function clearErrors() {
    passwordError.textContent = "";
    confirmPasswordError.textContent = "";
    passwordInput.classList.remove("input-error");
    confirmPasswordInput.classList.remove("input-error");
  }

  function showPasswordError(message) {
    passwordError.textContent = message;
    passwordInput.classList.add("input-error");
  }

  function showConfirmPasswordError(message) {
    confirmPasswordError.textContent = message;
    confirmPasswordInput.classList.add("input-error");
  }

  function showLoadingModal() {
    if (!loadingModal) return;
    loadingModal.classList.add("show");
    loadingModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-loading");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const password = passwordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();

    clearErrors();
    let valid = true;

    // ===== THE ACTUAL FIX: enforce the shared rule, not just "non-empty" =====
    if (!password) {
      showPasswordError("Please enter a new password.");
      valid = false;
    } else {
      const feedback = getPasswordFeedback(password);
      if (!feedback.valid) {
        showPasswordError(feedback.message);
        valid = false;
      }
    }

    if (!confirmPassword) {
      showConfirmPasswordError("Please confirm your new password.");
      valid = false;
    }

    if (password && username && password.toLowerCase() === username.toLowerCase()) {
      showPasswordError("Password cannot be the same as your username.");
      valid = false;
    }

    if (password && confirmPassword && password !== confirmPassword) {
      showConfirmPasswordError("Passwords do not match.");
      valid = false;
    }

    if (!valid) return;

    // second line of defense — never submit while the button is disabled
    const saveBtn = document.getElementById("savePasswordBtn");
    if (saveBtn && saveBtn.disabled) return;

    showLoadingModal();
    form.submit();
  });

  passwordInput.addEventListener("input", () => {
    passwordError.textContent = "";
    passwordInput.classList.remove("input-error");
    if (confirmPasswordInput.value) {
      if (passwordInput.value !== confirmPasswordInput.value) {
        showConfirmPasswordError("Passwords do not match.");
      } else {
        confirmPasswordError.textContent = "";
        confirmPasswordInput.classList.remove("input-error");
      }
    }
  });

  confirmPasswordInput.addEventListener("input", () => {
    confirmPasswordError.textContent = "";
    confirmPasswordInput.classList.remove("input-error");
    if (confirmPasswordInput.value && passwordInput.value !== confirmPasswordInput.value) {
      showConfirmPasswordError("Passwords do not match.");
    }
  });
});
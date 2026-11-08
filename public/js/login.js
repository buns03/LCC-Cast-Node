/* =========================================================
   LCCAST
   LOGIN PAGE
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeActionLoadingModal();

  initializeLogin();

  initializeForgotPassword();

  initializeMfa();

  initializePasswordToggles();
});

function initializePasswordToggles() {
  const toggles = document.querySelectorAll(".password-toggle");

  toggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      const icon = btn.querySelector("i");

      if (!input) return;

      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";

      if (icon) {
        icon.classList.toggle("bi-eye", !isHidden);
        icon.classList.toggle("bi-eye-slash", isHidden);
      }

      btn.setAttribute(
        "aria-label",
        isHidden ? "Hide password" : "Show password",
      );
    });
  });
}

/* =========================================================
   ACTION LOADING MODAL
========================================================= */

function initializeActionLoadingModal() {
  const modal = document.getElementById("actionLoadingModal");

  if (!modal) {
    return;
  }

  window.showActionLoading = (
    title = "Please Wait",
    message = "Processing your request...",
  ) => {
    const titleElement = document.getElementById("actionLoadingTitle");

    const messageElement = document.getElementById("actionLoadingMessage");

    if (titleElement) {
      titleElement.textContent = title;
    }

    if (messageElement) {
      messageElement.textContent = message;
    }

    modal.classList.add("show");

    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-loading");
  };

  window.hideActionLoading = () => {
    modal.classList.remove("show");

    modal.setAttribute("aria-hidden", "true");

    document.body.classList.remove("modal-loading");
  };
}

/* =========================================================
   LOGIN
========================================================= */

function initializeLogin() {
  const loginForm = document.getElementById("loginForm");
  const schoolIdInput = document.getElementById("schoolId");
  const passwordInput = document.getElementById("password");
  const schoolIdError = document.getElementById("schoolIdError");
  const passwordError = document.getElementById("passwordError");

  if (!loginForm) return;

  // true while the red "invalid credentials" state is showing
  let credentialError = false;

  function clearCredentialError() {
    if (!credentialError) return;
    clearFieldError(schoolIdInput, schoolIdError);
    clearFieldError(passwordInput, passwordError);
    credentialError = false;
  }

  schoolIdInput.addEventListener("input", () => {
    clearFieldError(schoolIdInput, schoolIdError);
    clearCredentialError();
    hideServerError();
  });

  passwordInput.addEventListener("input", () => {
    clearFieldError(passwordInput, passwordError);
    clearCredentialError();
    hideServerError();
  });

  loginForm.addEventListener("submit", async (event) => {
    // We send the login with fetch now (no Thymeleaf to re-render the page).
    event.preventDefault();

    const schoolId = schoolIdInput.value.trim();
    const password = passwordInput.value;
    let isValid = true;

    credentialError = false;
    clearFieldError(schoolIdInput, schoolIdError);
    clearFieldError(passwordInput, passwordError);
    hideServerError();

    if (!schoolId) {
      showFieldError(schoolIdInput, schoolIdError, "School ID is required.");
      isValid = false;
    }
    if (!password) {
      showFieldError(passwordInput, passwordError, "Password is required.");
      isValid = false;
    }
    if (!isValid) return;

    showActionLoading("Logging In", "Verifying your School ID and password...");

    try {
      const response = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, password }),
      });
      const result = await parseJsonResponse(response);

      if (response.ok && result.success) {
        // keep the loading modal visible while the browser navigates
        window.location.href = result.redirectUrl || "/login";
        return;
      }

      hideActionLoading();

      if (result.code === "MFA_REQUIRED") {
        openMfaModal(result.maskedEmail);
        return;
      }

      if (result.code === "CONCURRENT_LOGIN") {
        showConcurrentWarning(result.message);
      } else if (
        result.code === "INVALID_CREDENTIALS" ||
        response.status === 401
      ) {
        // inline field errors: red border on both inputs, message under the password field
        credentialError = true;
        showFieldError(schoolIdInput, null, "");
        showFieldError(
          passwordInput,
          passwordError,
          result.message || "Invalid School ID or password.",
        );
      } else {
        showServerError(
          result.message || "Something went wrong. Please try again.",
        );
      }
    } catch (error) {
      hideActionLoading();
      showServerError("Unable to log in right now. Please try again.");
    }
  });
}

/* =========================================================
   MFA (admins / superadmin on a new or long-idle device)
========================================================= */

let mfaResendTimer = null;

function initializeMfa() {
  const modal = document.getElementById("mfaModal");
  if (!modal) return;

  const otp = document.getElementById("mfaOtp");

  document
    .getElementById("closeMfaModal")
    .addEventListener("click", closeMfaModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeMfaModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("show")) closeMfaModal();
  });

  otp.addEventListener("input", () => {
    otp.value = otp.value.replace(/\D/g, "");
    clearFieldError(otp, document.getElementById("mfaOtpError"));
  });
  otp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") verifyMfa();
  });

  document.getElementById("mfaVerifyBtn").addEventListener("click", verifyMfa);
  document.getElementById("mfaResendBtn").addEventListener("click", resendMfa);
}

function openMfaModal(maskedEmail) {
  const modal = document.getElementById("mfaModal");
  const sentTo = document.getElementById("mfaSentTo");
  if (sentTo) {
    sentTo.textContent = maskedEmail
      ? `A verification code was sent to ${maskedEmail}.`
      : "A verification code was sent to your registered email.";
  }
  document.getElementById("mfaOtp").value = "";
  clearFieldError(
    document.getElementById("mfaOtp"),
    document.getElementById("mfaOtpError"),
  );
  document.getElementById("mfaTrustDevice").checked = true;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  startMfaResendCooldown(60);
  setTimeout(() => document.getElementById("mfaOtp").focus(), 100);
}

function closeMfaModal() {
  const modal = document.getElementById("mfaModal");
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  clearInterval(mfaResendTimer);
  document.getElementById("password").value = "";
  document.getElementById("password").focus();
}

function startMfaResendCooldown(seconds) {
  const btn = document.getElementById("mfaResendBtn");
  clearInterval(mfaResendTimer);
  let left = seconds;
  btn.disabled = true;
  btn.textContent = `Resend code (${left}s)`;
  mfaResendTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(mfaResendTimer);
      btn.disabled = false;
      btn.textContent = "Resend code";
    } else {
      btn.textContent = `Resend code (${left}s)`;
    }
  }, 1000);
}

async function verifyMfa() {
  const otpInput = document.getElementById("mfaOtp");
  const errorEl = document.getElementById("mfaOtpError");
  const otp = otpInput.value.trim();

  clearFieldError(otpInput, errorEl);

  if (!otp) return showFieldError(otpInput, errorEl, "OTP is required.");
  if (!/^\d{6}$/.test(otp))
    return showFieldError(
      otpInput,
      errorEl,
      "OTP must contain exactly 6 digits.",
    );

  showActionLoading("Verifying OTP", "Checking your verification code...");

  try {
    const response = await fetch("/login/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        otp,
        rememberDevice: document.getElementById("mfaTrustDevice").checked,
      }),
    });
    const result = await parseJsonResponse(response);

    if (response.ok && result.success) {
      window.location.href = result.redirectUrl || "/login"; // keep the loading modal up
      return;
    }

    hideActionLoading();

    if (result.code === "MFA_EXPIRED") {
      closeMfaModal();
      showServerError(
        result.message || "Verification expired. Please log in again.",
      );
      return;
    }
    showFieldError(
      otpInput,
      errorEl,
      result.message || "Invalid verification code.",
    );
  } catch (e) {
    hideActionLoading();
    showFieldError(otpInput, errorEl, "Unable to verify the code right now.");
  }
}

async function resendMfa() {
  const errorEl = document.getElementById("mfaOtpError");
  clearFieldError(document.getElementById("mfaOtp"), errorEl);

  try {
    const response = await fetch("/login/mfa/resend", { method: "POST" });
    const result = await parseJsonResponse(response);

    if (response.ok && result.success) {
      startMfaResendCooldown(60);
      return;
    }
    if (result.code === "MFA_COOLDOWN") {
      startMfaResendCooldown(result.retryAfter || 60);
      return;
    }
    if (result.code === "MFA_EXPIRED") {
      closeMfaModal();
      showServerError(result.message);
      return;
    }
    errorEl.textContent = result.message || "Could not resend the code.";
  } catch (e) {
    errorEl.textContent = "Could not resend the code.";
  }
}

/* =========================================================
   FORGOT PASSWORD
========================================================= */

function initializeForgotPassword() {
  const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

  const modal = document.getElementById("forgotPasswordModal");

  const closeForgotModal = document.getElementById("closeForgotModal");

  const verifyEmailBtn = document.getElementById("verifyEmailBtn");

  const verifyOtpBtn = document.getElementById("verifyOtpBtn");

  const resetPasswordBtn = document.getElementById("resetPasswordBtn");

  const returnToLoginBtn = document.getElementById("returnToLoginBtn");

  if (!modal) {
    return;
  }

  /* -----------------------------------------
       OPEN MODAL
    ----------------------------------------- */

  forgotPasswordBtn.addEventListener("click", () => {
    openForgotPasswordModal();
  });

  /* -----------------------------------------
       CLOSE / CANCEL PROCESS
    ----------------------------------------- */

  closeForgotModal.addEventListener("click", () => {
    closeForgotPasswordModal();
  });

  /*
   * Clicking the dark overlay also cancels
   * the entire forgot-password process.
   */

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeForgotPasswordModal();
    }
  });

  /*
   * Escape key also cancels the process.
   */

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) {
      closeForgotPasswordModal();
    }
  });

  /* -----------------------------------------
       EMAIL
    ----------------------------------------- */

  verifyEmailBtn.addEventListener("click", verifyEmail);

  /* -----------------------------------------
       OTP
    ----------------------------------------- */

  verifyOtpBtn.addEventListener("click", verifyOtp);

  /* -----------------------------------------
       PASSWORD RESET
    ----------------------------------------- */

  resetPasswordBtn.addEventListener("click", resetPassword);

  /* -----------------------------------------
       RETURN TO LOGIN
    ----------------------------------------- */

  returnToLoginBtn.addEventListener("click", () => {
    closeForgotPasswordModal();
  });

  initializeForgotPasswordInputs();
}

/* =========================================================
   FORGOT PASSWORD INPUT EVENTS
========================================================= */

function initializeForgotPasswordInputs() {
  const registeredEmail = document.getElementById("registeredEmail");

  const otp = document.getElementById("otp");

  const newPassword = document.getElementById("newPassword");

  const confirmPassword = document.getElementById("confirmPassword");

  registeredEmail.addEventListener("input", () => {
    clearFieldError(
      registeredEmail,
      document.getElementById("registeredEmailError"),
    );
  });

  otp.addEventListener("input", () => {
    /*
     * Allow only numeric characters.
     *
     * This is input formatting, not
     * OTP verification.
     */

    otp.value = otp.value.replace(/\D/g, "");

    clearFieldError(otp, document.getElementById("otpError"));
  });

  newPassword.addEventListener("input", () => {
    clearFieldError(newPassword, document.getElementById("newPasswordError"));
  });

  confirmPassword.addEventListener("input", () => {
    clearFieldError(
      confirmPassword,
      document.getElementById("confirmPasswordError"),
    );
  });
}

/* =========================================================
   VERIFY EMAIL
========================================================= */

async function verifyEmail() {
  const registeredEmail = document.getElementById("registeredEmail");
  const errorElement = document.getElementById("registeredEmailError");
  const identifier = registeredEmail.value.trim();

  clearFieldError(registeredEmail, errorElement);

  if (!identifier) {
    showFieldError(
      registeredEmail,
      errorElement,
      "School ID or email is required.",
    );
    return;
  }

  showActionLoading(
    "Finding Account",
    "Checking your account and sending the OTP...",
  );

  try {
    const response = await fetch("/forgot-password/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // key stays "email" so the other steps and the route don't change;
      // the server accepts a School ID or an email in this field
      body: JSON.stringify({ email: identifier }),
    });

    const result = await parseJsonResponse(response);

    if (!response.ok || !result.success) {
      showFieldError(
        registeredEmail,
        errorElement,
        result.message || "The account could not be verified.",
      );
      return;
    }

    const otpSentTo = document.getElementById("otpSentTo");
    if (otpSentTo) {
      otpSentTo.textContent =
        result.via === "SCHOOL_ID" && result.maskedEmail
          ? `An OTP was sent to the email ${result.maskedEmail}.`
          : `An OTP was sent to the email you entered: ${identifier}.`;
    }

    showResetStep("otpStep");
  } catch (error) {
    showFieldError(
      registeredEmail,
      errorElement,
      "Unable to verify the account right now.",
    );
  } finally {
    hideActionLoading();
  }
}
/* =========================================================
   VERIFY OTP
========================================================= */

async function verifyOtp() {
  const otpInput = document.getElementById("otp");

  const errorElement = document.getElementById("otpError");

  const registeredEmail = document.getElementById("registeredEmail");

  const otp = otpInput.value.trim();

  const email = registeredEmail.value.trim();

  clearFieldError(otpInput, errorElement);

  /* -----------------------------------------
       EMPTY
    ----------------------------------------- */

  if (!otp) {
    showFieldError(otpInput, errorElement, "OTP is required.");

    return;
  }

  /* -----------------------------------------
       OTP FORMAT
    ----------------------------------------- */

  if (!/^\d{6}$/.test(otp)) {
    showFieldError(
      otpInput,
      errorElement,
      "OTP must contain exactly 6 digits.",
    );

    return;
  }

  showActionLoading("Verifying OTP", "Checking your verification code...");

  try {
    const response = await fetch("/forgot-password/verify-otp", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        email: email,
        otp: otp,
      }),
    });

    const result = await parseJsonResponse(response);

    if (!response.ok || !result.success) {
      showFieldError(
        otpInput,
        errorElement,
        result.message || "Invalid or expired OTP.",
      );

      return;
    }

    /*
     * Backend confirmed the OTP.
     */

    showResetStep("newPasswordStep");
  } catch (error) {
    showFieldError(
      otpInput,
      errorElement,
      "Unable to verify the OTP right now.",
    );
  } finally {
    hideActionLoading();
  }
}

/* =========================================================
   RESET PASSWORD
========================================================= */

async function resetPassword() {
  const newPassword = document.getElementById("newPassword");

  const confirmPassword = document.getElementById("confirmPassword");

  const newPasswordError = document.getElementById("newPasswordError");

  const confirmPasswordError = document.getElementById("confirmPasswordError");

  const email = document.getElementById("registeredEmail").value.trim();

  const otp = document.getElementById("otp").value.trim();

  clearFieldError(newPassword, newPasswordError);

  clearFieldError(confirmPassword, confirmPasswordError);

  let isValid = true;

  /* -----------------------------------------
       NEW PASSWORD
    ----------------------------------------- */

  if (!newPassword.value) {
    showFieldError(newPassword, newPasswordError, "New password is required.");

    isValid = false;
  } else if (!isValidPassword(newPassword.value)) {
    showFieldError(
      newPassword,
      newPasswordError,
      "Password must be at least 8 characters.",
    );

    isValid = false;
  }

  /* -----------------------------------------
       CONFIRM PASSWORD
    ----------------------------------------- */

  if (!confirmPassword.value) {
    showFieldError(
      confirmPassword,
      confirmPasswordError,
      "Please confirm your new password.",
    );

    isValid = false;
  } else if (confirmPassword.value !== newPassword.value) {
    showFieldError(
      confirmPassword,
      confirmPasswordError,
      "Passwords do not match.",
    );

    isValid = false;
  }

  if (!isValid) {
    return;
  }

  showActionLoading("Changing Password", "Saving your new password...");

  try {
    /*
     * BACKEND INTEGRATION POINT
     *
     * POST /forgot-password/reset
     *
     * {
     *     email: email,
     *     otp: otp,
     *     newPassword: newPassword
     * }
     */

    const response = await fetch("/forgot-password/reset", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        email: email,

        otp: otp,

        newPassword: newPassword.value,
      }),
    });

    const result = await parseJsonResponse(response);

    if (!response.ok || !result.success) {
      showFieldError(
        newPassword,
        newPasswordError,
        result.message || "Unable to change the password.",
      );

      return;
    }

    /*
     * Password successfully changed.
     */

    showResetStep("resetSuccessStep");
  } catch (error) {
    showFieldError(
      newPassword,
      newPasswordError,
      "Unable to change the password right now.",
    );
  } finally {
    hideActionLoading();
  }
}

/* =========================================================
   OPEN FORGOT PASSWORD MODAL
========================================================= */

function openForgotPasswordModal() {
  const modal = document.getElementById("forgotPasswordModal");

  /*
   * Always start at email verification.
   */

  showResetStep("resetEmailStep");

  modal.classList.add("show");

  modal.setAttribute("aria-hidden", "false");

  document.body.classList.add("modal-open");

  /*
   * Focus email field.
   */

  setTimeout(() => {
    const email = document.getElementById("registeredEmail");

    email.focus();
  }, 100);
}

/* =========================================================
   CLOSE FORGOT PASSWORD MODAL
========================================================= */

function closeForgotPasswordModal() {
  const modal = document.getElementById("forgotPasswordModal");

  /*
   * Closing the modal means the user
   * cancelled the entire process.
   *
   * Therefore it is safe to clear the
   * forgot-password fields.
   */

  resetForgotPasswordForm();

  modal.classList.remove("show");

  modal.setAttribute("aria-hidden", "true");

  document.body.classList.remove("modal-open");

  /*
   * Return focus to Forgot Password button.
   */

  const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

  forgotPasswordBtn.focus();
}

/* =========================================================
   RESET FORGOT PASSWORD FORM
========================================================= */

function resetForgotPasswordForm() {
  const fields = ["registeredEmail", "otp", "newPassword", "confirmPassword"];

  fields.forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.value = "";
      input.classList.remove("input-error", "input-success");
    }
  });

  const errors = [
    "registeredEmailError",
    "otpError",
    "newPasswordError",
    "confirmPasswordError",
  ];

  errors.forEach((id) => {
    const error = document.getElementById(id);
    if (error) {
      error.textContent = "";
    }
  });

  /* NEW: reset the masked-email placeholder */
  const otpSentTo = document.getElementById("otpSentTo");
  if (otpSentTo) {
    otpSentTo.textContent = "An OTP was sent to your registered email.";
  }

  showResetStep("resetEmailStep");
}

/* =========================================================
   SHOW RESET STEP
========================================================= */

function showResetStep(stepId) {
  const steps = document.querySelectorAll(".reset-step");

  steps.forEach((step) => {
    step.classList.remove("active");
  });

  const target = document.getElementById(stepId);

  if (target) {
    target.classList.add("active");
  }
}

/* =========================================================
   FIELD ERROR
========================================================= */

function showFieldError(input, errorElement, message) {
  if (input) {
    input.classList.add("input-error");

    input.classList.remove("input-success");
  }

  if (errorElement) {
    errorElement.textContent = message;
  }
}

/* =========================================================
   CLEAR FIELD ERROR
========================================================= */

function clearFieldError(input, errorElement) {
  if (input) {
    input.classList.remove("input-error");
  }

  if (errorElement) {
    errorElement.textContent = "";
  }
}

/* =========================================================
   SERVER ERROR
========================================================= */

function hideServerError() {
  const serverError = document.getElementById("loginServerError");
  if (serverError) {
    serverError.textContent = "";
  }
  const warning = document.getElementById("concurrentLoginWarning");
  if (warning) {
    warning.style.display = "none";
  }
}

function showServerError(message) {
  hideServerError();
  const serverError = document.getElementById("loginServerError");
  if (serverError) {
    serverError.style.display = "";
    serverError.textContent = message;
  }
}

function showConcurrentWarning(message) {
  hideServerError();
  const warning = document.getElementById("concurrentLoginWarning");
  const text = document.getElementById("concurrentLoginWarningText");
  if (text) text.textContent = message;
  if (warning) warning.style.display = "";
}

/* =========================================================
   EMAIL VALIDATION
========================================================= */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* =========================================================
   PASSWORD VALIDATION
========================================================= */

function isValidPassword(password) {
  return password.length >= 8;
}

/* =========================================================
   JSON RESPONSE
========================================================= */

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type");

  if (contentType && contentType.includes("application/json")) {
    return await response.json();
  }

  /*
   * If the backend returns something other
   * than JSON, don't crash the application.
   */

  return {};
}

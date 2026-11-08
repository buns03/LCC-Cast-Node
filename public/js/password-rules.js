/* =========================================================
   PASSWORD RULES (shared)
========================================================= */

const PASSWORD_MIN_LENGTH = 8;

const COMMON_WEAK_PASSWORDS = new Set([
  "12345678",
  "87654321",
]);

function getPasswordFeedback(password) {
  if (!password) {
    return { valid: false, message: "" };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  if (COMMON_WEAK_PASSWORDS.has(password)) {
    return {
      valid: false,
      message: "This password is too common. Please choose another.",
    };
  }

  return { valid: true, message: "Password looks good." };
}

/**
 * Wires live feedback under a password field and gates one or more
 * submit buttons while the password (if the user typed one) is invalid.
 */
function wirePasswordStrengthFeedback({ passwordInputId, feedbackId, getButtons }) {
  const input = document.getElementById(passwordInputId);
  const feedback = document.getElementById(feedbackId);

  if (!input) return;

  function update() {
    const { valid, message } = getPasswordFeedback(input.value);

    if (feedback) {
      feedback.textContent = input.value ? message : "";
      feedback.classList.toggle("valid", !!input.value && valid);
      feedback.classList.toggle("invalid", !!input.value && !valid);
    }

    const buttons = typeof getButtons === "function" ? getButtons() : [];

    buttons.forEach((btn) => {
      if (!btn) return;
      // Only block submission when a password was actually typed —
      // an empty field means "no password change requested" on most of
      // these forms and should not lock the Save button.
      btn.disabled = !!input.value && !valid;
    });
  }

  input.addEventListener("input", update);
  update();
}
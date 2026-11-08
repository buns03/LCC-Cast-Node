/* =========================================================
   LCCAST - GLOBAL LOGOUT MODAL
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeLogoutModal();
});

function initializeLogoutModal() {
  const modal = document.getElementById("logoutModal");

  const triggers = document.querySelectorAll(".logout-trigger");

  const cancelButton = document.getElementById("cancelLogout");

  const confirmButton = document.getElementById("confirmLogout");

  if (!modal || !triggers.length) {
    return;
  }

  /* =====================================================
       OPEN MODAL
    ===================================================== */

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();

      openLogoutModal();
    });
  });

  /* =====================================================
       CANCEL
    ===================================================== */

  if (cancelButton) {
    cancelButton.addEventListener("click", closeLogoutModal);
  }

  /* =====================================================
   CONFIRM LOGOUT
===================================================== */

  if (confirmButton) {
    confirmButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      /*
       * Close the logout confirmation modal
       */
      closeLogoutModal();

      /*
       * Show the existing global loading modal
       */
      if (typeof window.showActionLoading === "function") {
        window.showActionLoading(
          "Logging Out...",
          "Please wait while you are being logged out of LCCast.",
        );
      }

            /*
             * Call the backend to invalidate the session,
             * then redirect.
             */
            fetch("/logout", { method: "POST" })
              .finally(() => {
                setTimeout(() => {
                  window.location.replace("/login");
                }, 300);
              });
    });
  }

  /* =====================================================
       CLICK OUTSIDE
    ===================================================== */

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeLogoutModal();
    }
  });

  /* =====================================================
       ESCAPE
    ===================================================== */

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) {
      closeLogoutModal();
    }
  });

  /* =====================================================
       FUNCTIONS
    ===================================================== */

  function openLogoutModal() {
    modal.classList.add("show");

    modal.setAttribute("aria-hidden", "false");

    document.body.style.overflow = "hidden";
  }

  function closeLogoutModal() {
    modal.classList.remove("show");

    modal.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";
  }
}

/* =========================================================
   GLOBAL ACTION LOADING
========================================================= */

window.showActionLoading = function (title, message) {

    const modal =
        document.getElementById("actionLoadingModal");

    const titleElement =
        document.getElementById("actionLoadingTitle");

    const messageElement =
        document.getElementById("actionLoadingMessage");


    if (!modal) {
        return;
    }


    if (titleElement) {

        titleElement.textContent =
            title || "Processing...";

    }


    if (messageElement) {

        messageElement.textContent =
            message ||
            "Please wait while we process your request.";

    }


    modal.classList.add("show");

    document.body.classList.add("modal-loading");

};

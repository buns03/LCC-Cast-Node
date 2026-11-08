/* ==========================================================
   LCCAST — EMAIL SEND PROGRESS TOAST (shared by all roles)
========================================================== */

(function () {
  const STORAGE_KEY = "lccast.emailJobs";
  const POLL_MS = 1000;
  const MAX_FAILURES = 8;

  const jobs = new Map();
  let stack = null;
  let unloading = false;

  window.addEventListener("pagehide", () => {
    unloading = true;
  });

  function ensureStack() {
    if (stack) return stack;
    stack = document.createElement("div");
    stack.className = "email-progress-stack";
    document.body.appendChild(stack);
    return stack;
  }

  function saveJobs() {
    try {
      const list = [...jobs.values()]
        .filter((j) => !j.done)
        .map(({ jobId, electionId, title, baseUrl }) => ({
          jobId,
          electionId,
          title,
          baseUrl,
        }));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function createCard(job) {
    const card = document.createElement("div");
    card.className = "email-progress-card";
    card.innerHTML = `
      <div class="email-progress-icon"><i class="bi bi-envelope"></i></div>
      <div class="email-progress-body">
        <div class="email-progress-top">
          <strong class="email-progress-heading">Sending Election Email</strong>
          <span class="email-progress-percent">0%</span>
        </div>
        <span class="email-progress-title"></span>
        <div class="email-progress-track">
          <div class="email-progress-bar"></div>
        </div>
        <small class="email-progress-count">Preparing…</small>
      </div>
      <button type="button" class="email-progress-close" aria-label="Dismiss" hidden>
        <i class="bi bi-x-lg"></i>
      </button>
    `;
    card.querySelector(".email-progress-title").textContent = job.title;
    card
      .querySelector(".email-progress-close")
      .addEventListener("click", () => dismiss(job));

    ensureStack().appendChild(card);
    job.card = card;
  }

  function render(job, percent, countText) {
    const card = job.card;
    if (!card) return;
    card.querySelector(".email-progress-bar").style.width = `${percent}%`;
    card.querySelector(".email-progress-percent").textContent = `${percent}%`;
    if (countText) {
      card.querySelector(".email-progress-count").textContent = countText;
    }
  }

  function dismiss(job) {
    clearTimeout(job.timer);
    job.done = true;
    job.card?.remove();
    jobs.delete(job.jobId);
    saveJobs();
  }

  function finish(job, ok, message) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    saveJobs();

    const card = job.card;
    if (!card) return;

    card.classList.add(ok ? "is-success" : "is-error");
    card.querySelector(".email-progress-heading").textContent = ok
      ? "Email Sent"
      : "Email Failed";
    card.querySelector(".email-progress-icon i").className = ok
      ? "bi bi-check-lg"
      : "bi bi-x-circle";
    card.querySelector(".email-progress-close").hidden = false;

    if (ok) {
      render(job, 100);
      if (message) {
        card.querySelector(".email-progress-count").textContent = message;
      }
      setTimeout(() => dismiss(job), 6000);
    } else {
      card.querySelector(".email-progress-count").textContent =
        message || "Unable to send the email.";
    }
  }

  async function poll(job) {
    if (job.done) return;

    try {
      const res = await fetch(
        `${job.baseUrl}/${job.electionId}/email/progress/${encodeURIComponent(job.jobId)}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );

      if (res.status === 404) {
        // Job not registered yet (normal in the first second) — or already gone.
        if (job.postDone) return finish(job, true);
        job.misses += 1;
        if (job.resumed && job.misses > 5) return dismiss(job);
      } else if (!res.ok) {
        throw new Error(`Progress check failed (${res.status}).`);
      } else {
        job.failures = 0;
        const data = await res.json();

        const total = Number(data.total) || 0;
        const sent = Number(data.sent) || 0;
        const percent = Math.min(
          100,
          Math.max(
            0,
            Number.isFinite(data.percent)
              ? data.percent
              : total
                ? Math.round((sent / total) * 100)
                : 0,
          ),
        );
        const status = String(data.status || "").toUpperCase();

        if (status === "COMPLETED") {
          return finish(
            job,
            true,
            total ? `${total} of ${total} voters emailed` : "All emails sent",
          );
        }
        if (status === "FAILED") {
          return finish(job, false, data.message || "Sending failed.");
        }

        render(
          job,
          percent,
          total ? `${sent} of ${total} voters emailed` : "Preparing…",
        );
      }
    } catch (error) {
      job.failures += 1;
      if (job.failures >= MAX_FAILURES) {
        return finish(job, false, "Lost connection while tracking progress.");
      }
    }

    job.timer = setTimeout(() => poll(job), POLL_MS);
  }

  function register(job) {
    jobs.set(job.jobId, job);
    createCard(job);
    saveJobs();
    poll(job);
  }

  function start({ electionId, title, baseUrl }) {
    const jobId =
      (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const job = {
      jobId,
      electionId,
      title,
      baseUrl,
      misses: 0,
      failures: 0,
      done: false,
      postDone: false,
      resumed: false,
      timer: null,
    };

    register(job);

    // Fire the send request WITHOUT blocking the UI; progress comes from polling.
    fetch(
      `${baseUrl}/${electionId}/email/send?jobId=${encodeURIComponent(jobId)}`,
      { method: "POST", headers: { Accept: "application/json" } },
    )
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Failed to send email (${res.status}).`);
        }
        job.postDone = true;
      })
      .catch((error) => {
        if (unloading) return; // page is being left; the server keeps going
        finish(job, false, error.message || "Unable to send the email.");
      });
  }

  // Pick up in-flight jobs after navigating to another page of the app
  function resume() {
    let saved = [];
    try {
      saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    } catch (_) {}

    saved.forEach((s) => {
      if (jobs.has(s.jobId)) return;
      register({
        ...s,
        misses: 0,
        failures: 0,
        done: false,
        postDone: false,
        resumed: true,
        timer: null,
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resume);
  } else {
    resume();
  }

  window.EmailProgress = { start };
})();
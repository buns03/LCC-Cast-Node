/* =========================================================
   LCCAST — GLOBAL JOB PROGRESS (all roles)
   Jobs run on the server; this script re-attaches to them
   on every page load, so navigation never interrupts them.
========================================================= */
(function () {
  if (window.JobProgress) return;

  const POLL_MS = 1000;
  const AUTO_DISMISS_MS = 8000;
  const cards = new Map(); // jobId -> { el, completedFired }
  let stack = null;
  let timer = null;

  const ICONS = {
    VOTER_IMPORT: "bi-upload",
    VOTER_EXPORT: "bi-download",
    VOTER_DELETE: "bi-trash3",
    VOTER_ARCHIVE: "bi-archive",
  };

  function ensureStack() {
    if (stack) return stack;
    stack = document.createElement("div");
    stack.className = "job-progress-stack";
    document.body.appendChild(stack);
    return stack;
  }

  function percent(job) {
    if (job.status === "DONE") return 100;
    if (!job.total) return 0;
    return Math.min(100, Math.round((job.processed / job.total) * 100));
  }

  function heading(job) {
    if (job.status === "DONE") return "Completed";
    if (job.status === "FAILED") return "Failed";
    return job.title + "…";
  }

  function countText(job) {
    if (job.status === "FAILED") return job.message || "Something went wrong.";
    if (job.status === "DONE" && !job.total) return job.message || "Nothing to process.";
    const base = `${job.processed} / ${job.total || "?"} processed`;
    const failed = job.failed ? ` · ${job.failed} skipped/failed` : "";
    const extra = job.type === "VOTER_IMPORT" && job.message ? ` — ${job.message}` : "";
    return base + failed + extra;
  }

  function render(job) {
    let entry = cards.get(job.id);

    if (!entry) {
      const el = document.createElement("div");
      el.className = "job-progress-card";
      el.innerHTML = `
        <div class="job-progress-icon"><i class="bi ${ICONS[job.type] || "bi-gear"}"></i></div>
        <div class="job-progress-body">
          <div class="job-progress-top">
            <strong class="job-progress-heading"></strong>
            <span class="job-progress-percent"></span>
          </div>
          <span class="job-progress-title"></span>
          <div class="job-progress-track"><div class="job-progress-bar"></div></div>
          <small class="job-progress-count"></small>
          <a class="job-progress-download" hidden><i class="bi bi-download"></i> Download file</a>
        </div>
        <button type="button" class="job-progress-close" aria-label="Dismiss" hidden>
          <i class="bi bi-x-lg"></i>
        </button>`;

      el.querySelector(".job-progress-close").addEventListener("click", () => dismiss(job.id));
      el.querySelector(".job-progress-download").addEventListener("click", () =>
        setTimeout(() => dismiss(job.id), 1500)
      );

      ensureStack().appendChild(el);
      entry = { el, completedFired: false };
      cards.set(job.id, entry);
    }

    const el = entry.el;
    const pct = percent(job);
    const finished = job.status !== "RUNNING";

    el.classList.toggle("is-success", job.status === "DONE");
    el.classList.toggle("is-error", job.status === "FAILED");
    el.querySelector(".job-progress-heading").textContent = heading(job);
    el.querySelector(".job-progress-percent").textContent = pct + "%";
    el.querySelector(".job-progress-title").textContent = job.title;
    el.querySelector(".job-progress-bar").style.width = pct + "%";
    el.querySelector(".job-progress-count").textContent = countText(job);
    el.querySelector(".job-progress-close").hidden = !finished;

    const dl = el.querySelector(".job-progress-download");
    dl.hidden = !job.downloadable;
    if (job.downloadable) dl.href = `/api/jobs/${job.id}/download`;

    if (finished && !entry.completedFired) {
      entry.completedFired = true;
      window.dispatchEvent(new CustomEvent("job:completed", { detail: job }));
      if (job.status === "DONE" && !job.downloadable) {
        setTimeout(() => dismiss(job.id), AUTO_DISMISS_MS);
      }
    }
  }

  async function dismiss(id) {
    const entry = cards.get(id);
    if (entry) {
      entry.el.remove();
      cards.delete(id);
    }
    try {
      await fetch(`/api/jobs/${id}`, { method: "DELETE", credentials: "same-origin" });
    } catch (_) {}
  }

  async function poll() {
    timer = null;
    let running = false;

    try {
      const res = await fetch("/api/jobs/active", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        const jobs = await res.json();
        jobs.forEach((job) => {
          render(job);
          if (job.status === "RUNNING") running = true;
        });
      }
    } catch (_) {
      running = true; // network blip, keep trying
    }

    if (running) timer = setTimeout(poll, POLL_MS);
  }

  function kick() {
    if (!timer) timer = setTimeout(poll, 100);
  }

  async function start(url, { method = "POST", body = null } = {}) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status}).`);

    render(data);
    kick();
    return data;
  }

  window.JobProgress = { start, refresh: kick };

  // Re-attach to any running job after navigating to a new page
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kick);
  } else {
    kick();
  }
})();
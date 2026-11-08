/* LCCAST soft cache (sessionStorage + memory, stale-while-revalidate) */
(function () {
  const PREFIX = "lccast:sc:";
  const mem = new Map();
  const inflight = new Map();
  const realFetch = window.fetch.bind(window);
  let gen = 0; // bumps on clear() so late responses can't repopulate stale data

  function readEntry(key) {
    if (mem.has(key)) return mem.get(key);
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      mem.set(key, entry);
      return entry;
    } catch (_) {
      return null;
    }
  }

  function writeEntry(key, data) {
    const entry = { t: Date.now(), data };
    mem.set(key, entry);
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch (_) {
      /* quota exceeded: memory copy still works */
    }
  }

  function clear(prefix = "") {
    gen++;
    inflight.clear();
    for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(PREFIX + prefix)) sessionStorage.removeItem(k);
      }
    } catch (_) {}
  }

  function network(key, url) {
    if (inflight.has(key)) return inflight.get(key);
    const myGen = gen;

    const p = (async () => {
      const res = await realFetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json())?.message || ""; } catch (_) {}
        throw new Error(msg || `Request failed: ${res.status}`);
      }
      const data = await res.json();
      if (myGen === gen) writeEntry(key, data);
      return data;
    })().finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  }

  async function load(url, { ttl = 30000, swr = true, force = false, onRevalidated } = {}) {
    const entry = force ? null : readEntry(url);

    if (entry) {
      if (Date.now() - entry.t < ttl) return entry.data;

      if (swr) {
        network(url, url)
          .then((fresh) => {
            if (onRevalidated && JSON.stringify(fresh) !== JSON.stringify(entry.data)) {
              onRevalidated(fresh);
            }
          })
          .catch(() => {});
        return entry.data;
      }
    }
    return network(url, url);
  }

  // Any successful write (POST/PUT/PATCH/DELETE) invalidates everything.
  window.fetch = function (input, init) {
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const p = realFetch(input, init);
    if (method !== "GET" && method !== "HEAD") {
      p.then((res) => { if (res.ok) clear(); }).catch(() => {});
    }
    return p;
  };

  window.SoftCache = { load, clear };

  document.addEventListener("click", (e) => {
    if (e.target.closest('[href*="logout"], .logout-btn')) window.SoftCache.clear();
  });
  document.addEventListener("submit", (e) => {
    if (String(e.target.action || "").includes("logout")) window.SoftCache.clear();
  });

})();


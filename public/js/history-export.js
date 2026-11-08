/* ==========================================================
   LCCAST — HISTORY EXPORT (CSV / EXCEL / PDF)
   Shared by superadmin, admin-ssc and admin-dept history pages.
========================================================== */

const HistoryExport = (() => {
  const BRAND = {
    name: "LCCAST",
    tagline: "Student Voting System",
    logo: "/images/lcccast_logo.png",
    color: [96, 99, 254], // #6063FE
  };

  const LIBS = {
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    autotable: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  };

  const FORMAT_LABELS = { csv: "CSV", xlsx: "Excel", pdf: "PDF" };

  /* ---------- helpers ---------- */

  const scriptCache = {};

  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => {
        delete scriptCache[src];
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(script);
    });
    return scriptCache[src];
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  async function loadLogo() {
    try {
      const res = await fetch(BRAND.logo);
      const blob = await res.blob();
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      const ratio = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth / img.naturalHeight || 1);
        img.onerror = () => resolve(1);
        img.src = data;
      });
      return { data, ratio };
    } catch {
      return null; // PDF still works without the logo
    }
  }

  /** Reads the current filter controls and returns a readable summary. Missing controls are skipped. */
  function describeFilters(fields) {
    const parts = [];
    fields.forEach(([label, id]) => {
      const el = document.getElementById(id);
      if (!el || !el.value) return;
      const text =
        el.tagName === "SELECT"
          ? el.selectedOptions[0]?.text.trim()
          : el.value.trim();
      if (text) parts.push(`${label}: ${text}`);
    });
    return parts.length ? parts.join("   |   ") : "None (all records)";
  }

  /* ---------- CSV ---------- */

  function toCSV({ headers, rows, filename }) {
    const field = (value) =>
      `"${String(value ?? "").replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`;
    const csv = [headers, ...rows]
      .map((row) => row.map(field).join(","))
      .join("\r\n");

    // BOM so Excel reads UTF-8 (names with ñ, etc.) correctly
    downloadBlob(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
      `${filename}-${dateStamp()}.csv`,
    );
  }

  /* ---------- EXCEL ---------- */

  async function toXLSX({ title, headers, rows, filename }) {
    await loadScript(LIBS.xlsx);

    const sheet = XLSX.utils.aoa_to_sheet([
      headers,
      ...rows.map((row) => row.map((v) => v ?? "")),
    ]);

    sheet["!cols"] = headers.map((header, i) => {
      const longest = rows.reduce(
        (max, row) => Math.max(max, String(row[i] ?? "").length),
        String(header).length,
      );
      return { wch: Math.min(55, longest + 2) };
    });
    sheet["!autofilter"] = { ref: sheet["!ref"] };

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, title.slice(0, 31));
    XLSX.writeFile(book, `${filename}-${dateStamp()}.xlsx`);
  }

  /* ---------- PDF (branded, matches the vote-summary PDF) ---------- */

  async function toPDF({ title, headers, rows, filename, filters }) {
    await loadScript(LIBS.jspdf);
    await loadScript(LIBS.autotable);

    const logo = await loadLogo();
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
      orientation: headers.length > 6 ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });

    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 12;

    const INDIGO = BRAND.color;
    const DARK = [32, 40, 58];
    const BODY = [59, 68, 87];
    const MUTED = [138, 146, 165];
    const LINE = [229, 233, 242];

    const generated = new Date().toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const preparedBy =
      (
        document.querySelector(".profile-info span") ||
        document.querySelector(".profile > span")
      )?.textContent.trim() || "";

    /* ----- brand header (first page) ----- */

    const logoH = 10;
    const logoW = logo ? logoH * logo.ratio : 0;

    if (logo) doc.addImage(logo.data, "PNG", M, 9, logoW, logoH);

    const textX = M + (logo ? logoW + 3 : 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...DARK);
    doc.text(BRAND.name, textX, 15);

    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(BRAND.tagline.toUpperCase(), textX, 19);

    doc.setFontSize(7.5);
    doc.setTextColor(...INDIGO);
    doc.text("HISTORY REPORT", W - M, 15, { align: "right" });

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, 24, W - M, 24);

    /* ----- title + info block ----- */

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(23, 32, 51);
    doc.text(title, M, 34);

    let y = 41;
    const labelW = 30;

    const infoRow = (label, value) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...MUTED);
      doc.text(label.toUpperCase(), M, y);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...BODY);
      const lines = doc.splitTextToSize(String(value), W - M * 2 - labelW);
      doc.text(lines, M + labelW, y);
      y += Math.max(1, lines.length) * 4.6;
    };

    infoRow("Generated", generated);
    if (preparedBy) infoRow("Prepared by", preparedBy);
    infoRow("Records", rows.length.toLocaleString());
    infoRow("Filters", filters || "None (all records)");

    y += 1;
    doc.setDrawColor(...LINE);
    doc.line(M, y, W - M, y);

    /* ----- table ----- */

    doc.autoTable({
      head: [headers],
      body: rows.map((row) => row.map((v) => String(v ?? ""))),
      startY: y + 5,
      margin: { top: 20, left: M, right: M, bottom: 16 },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: 2.2,
        textColor: BODY,
        lineColor: [231, 234, 241],
        lineWidth: 0.1,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: INDIGO,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [250, 251, 255] },
    });

    /* ----- running header (page 2+) and footer (all pages) ----- */

    const pages = doc.getNumberOfPages();

    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);

      if (i > 1) {
        if (logo) doc.addImage(logo.data, "PNG", M, 6, 6 * logo.ratio, 6);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...DARK);
        doc.text(BRAND.name, M + (logo ? 6 * logo.ratio + 2 : 0), 10.5);

        doc.setFontSize(7.5);
        doc.setTextColor(...INDIGO);
        doc.text(title.toUpperCase(), W - M, 10.5, { align: "right" });

        doc.setDrawColor(...LINE);
        doc.line(M, 14, W - M, 14);
      }

      doc.setDrawColor(...LINE);
      doc.line(M, H - 12, W - M, H - 12);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(`${BRAND.name}  •  ${BRAND.tagline}`, M, H - 7.5);
      doc.text(`Page ${i} of ${pages}`, W - M, H - 7.5, { align: "right" });
    }

    doc.save(`${filename}-${dateStamp()}.pdf`);
  }

  /* ---------- run one export ---------- */

  async function run(format, config) {
    window.showHistoryActionLoading?.(
      "Preparing export...",
      "Please wait while your file is being generated.",
    );

    try {
      const data = await config.getData();

      if (!data.rows.length) {
        window.showHistoryToast?.(
          "Nothing to Export",
          data.emptyMessage || "There are no records to export.",
        );
        return;
      }

      if (format === "csv") toCSV(data);
      else if (format === "xlsx") await toXLSX(data);
      else await toPDF(data);

      window.showHistoryToast?.(
        "Export Ready",
        `${data.title} exported as ${FORMAT_LABELS[format]}.`,
      );
    } catch (err) {
      console.error("History export failed", err);
      window.showHistoryToast?.(
        "Export Failed",
        "Could not export these records. Please try again.",
      );
    } finally {
      window.hideHistoryActionLoading?.();
    }
  }

  /* ---------- dropdown wiring ---------- */

  function closeAll() {
    document
      .querySelectorAll(".export-menu.show")
      .forEach((menu) => menu.classList.remove("show"));
    document
      .querySelectorAll(".export-menu-wrapper > button")
      .forEach((btn) => btn.setAttribute("aria-expanded", "false"));
  }

  function init(sections) {
    Object.values(sections).forEach((config) => {
      const button = document.getElementById(config.buttonId);
      const menu = document.getElementById(config.menuId);
      if (!button || !menu) return;

      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = !menu.classList.contains("show");
        closeAll();
        menu.classList.toggle("show", willOpen);
        button.setAttribute("aria-expanded", String(willOpen));
      });

      menu.addEventListener("click", (event) => {
        const item = event.target.closest("[data-format]");
        if (!item) return;
        event.stopPropagation();
        closeAll();
        run(item.dataset.format, config);
      });
    });

    document.addEventListener("click", closeAll);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAll();
    });
  }

  return { init, describeFilters };
})();
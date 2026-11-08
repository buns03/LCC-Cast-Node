/* ==========================================================
   LCCAST — SHARED PDF BRANDING (for jsPDF)
   Used by the analytics pages for the PDF header/footer.
========================================================== */

const PdfBrand = (() => {
  const BRAND = {
    name: "LCCAST",
    tagline: "Student Voting System",
    logo: "/images/lcccast_logo.png",
    color: [96, 99, 254], // #6063FE
  };

  const DARK = [32, 40, 58];
  const BODY = [100, 116, 139];
  const MUTED = [138, 146, 165];
  const LINE = [229, 233, 242];

  let logo = null;

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
      return null; // PDFs still export without the logo
    }
  }

  // Preload so the header can be drawn synchronously at export time
  loadLogo().then((result) => {
    logo = result;
  });

  function fitLine(pdf, text, maxWidth) {
    const lines = pdf.splitTextToSize(String(text || ""), maxWidth);
    if (lines.length <= 1) return lines[0] || "";
    return lines[0].replace(/\s+\S*$/, "") + "...";
  }

  /** Header block: occupies y = 9 → 44 mm, so content can keep starting at y = 48. */
  function drawHeader(
    pdf,
    { title, description = "", sectionLabel = null, report = "Analytics Report", margin = 15 },
  ) {
    const W = pdf.internal.pageSize.getWidth();
    const maxW = W - margin * 2;

    const logoH = 10;
    const logoW = logo ? logoH * logo.ratio : 0;
    if (logo) pdf.addImage(logo.data, "PNG", margin, 9, logoW, logoH);

    const textX = margin + (logo ? logoW + 3 : 0);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(...DARK);
    pdf.text(BRAND.name, textX, 15.5);

    pdf.setFontSize(6.5);
    pdf.setTextColor(...MUTED);
    pdf.text(BRAND.tagline.toUpperCase(), textX, 19.5);

    pdf.setFontSize(7.5);
    pdf.setTextColor(...BRAND.color);
    pdf.text(report.toUpperCase(), W - margin, 15, { align: "right" });

    if (sectionLabel) {
      pdf.setFontSize(7);
      pdf.setTextColor(...MUTED);
      pdf.text(String(sectionLabel), W - margin, 19.5, { align: "right" });
    }

    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.3);
    pdf.line(margin, 24, W - margin, 24);

    // Title
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(23, 32, 51);
    pdf.text(fitLine(pdf, title, maxW), margin, 32);

    // Description (single line)
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...BODY);
    if (description) pdf.text(fitLine(pdf, description, maxW), margin, 37);

    // Generated
    pdf.setFontSize(7.5);
    pdf.setTextColor(...MUTED);
    pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, 41);

    pdf.setDrawColor(...LINE);
    pdf.line(margin, 44, W - margin, 44);

    // Restore the text color the rest of the page code expects
    pdf.setTextColor(30, 41, 59);
  }

  function drawFooter(pdf, { label = "", report = "Election Analytics Report", margin = 15 } = {}) {
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const page = pdf.internal.getCurrentPageInfo().pageNumber;

    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.3);
    pdf.line(margin, H - 14, W - margin, H - 14);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...MUTED);
    pdf.text(
      `${BRAND.name}  •  ${BRAND.tagline}${label ? "  •  " + label : ""}`,
      margin,
      H - 9,
    );
    pdf.text(`${report}  •  Page ${page}`, W - margin, H - 9, { align: "right" });

    pdf.setTextColor(30, 41, 59);
  }

  return { drawHeader, drawFooter };
})();
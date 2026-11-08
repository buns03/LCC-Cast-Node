/* Canonical position order for all voter pages */
function getPositionRank(name) {
  const n = String(name ?? "")
    .toLowerCase()
    .replace(/\./g, "")          // "P.R.O." -> "pro"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const isPro = /\bpro\b/.test(n) || n.includes("public relation");

  if (isPro && /\b(internal|int)\b/.test(n)) return 5;
  if (isPro && /\b(external|ext)\b/.test(n)) return 6;
  if (/\bvice\b/.test(n) && n.includes("president")) return 1;
  if (n.includes("president")) return 0;
  if (n.includes("secretary")) return 2;
  if (n.includes("treasurer")) return 3;
  if (n.includes("auditor")) return 4;

  return 999; // unknown positions go last, original order preserved
}

function sortByPositionOrder(list, getName = (item) => item.name) {
  return [...(list || [])].sort(
    (a, b) => getPositionRank(getName(a)) - getPositionRank(getName(b)),
  );
}
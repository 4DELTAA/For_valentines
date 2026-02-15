export function parseProps(obj) {
  const out = {};
  const raw = obj?.properties;

  if (Array.isArray(raw)) {
    for (const p of raw) {
      const k = String(p?.name ?? "").trim().toLowerCase();
      if (!k) continue;
      out[k] = p?.value;
    }
    return out;
  }

  if (raw && typeof raw === "object") {
    for (const [k0, v] of Object.entries(raw)) {
      const k = String(k0 ?? "").trim().toLowerCase();
      if (!k) continue;
      out[k] = v;
    }
  }

  return out;
}

export function splitCsv(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

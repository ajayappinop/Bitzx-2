/** Normalize FastAPI / admin JSON error bodies for display. */
export function formatAdminApiDetail(data) {
  if (data == null) return null;
  const d = data.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((x) => {
        if (x && typeof x === 'object' && x.msg != null) return String(x.msg);
        if (x && typeof x === 'object' && x.message != null) return String(x.message);
        return typeof x === 'object' ? JSON.stringify(x) : String(x);
      })
      .join('; ');
  }
  if (d != null && typeof d === 'object') return JSON.stringify(d);
  return data.message || null;
}

/**
 * Lightweight SVG sparkline (no chart library).
 */
export function Sparkline({
  values = [],
  width = 200,
  height = 48,
  className = 'w-full h-12',
  stroke = 'rgb(212, 175, 55)',
  fill = 'rgba(212, 175, 55, 0.12)',
}) {
  if (!values.length) {
    return <div className={`${className} rounded-lg bg-white/[.03]`} style={{ minHeight: height }} />;
  }
  const pad = 3;
  const w = width;
  const h = height;
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const rng = vmax - vmin || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(n - 1, 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - vmin) / rng) * (h - 2 * pad);
    return [x, y];
  });
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const areaD = `${lineD} L ${pts[pts.length - 1][0].toFixed(2)} ${h - pad} L ${pad} ${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
      <path d={areaD} fill={fill} stroke="none" />
      <path d={lineD} fill="none" stroke={stroke} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

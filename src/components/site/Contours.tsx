const W = 1440;
const H = 900;
const LINES = 6;

function smooth(points: [number, number][]) {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function line(i: number, phase: number) {
  const pts: [number, number][] = [];
  for (let x = -80; x <= W + 80; x += 80) {
    const hill = -120 * Math.exp(-(((x - 1050) / 320) ** 2)) * (1 - i / (LINES + 3));
    const wave = Math.sin(x * 0.0035 + phase + i * 0.5) * 26;
    pts.push([x, 330 + i * 46 + hill + wave]);
  }
  return smooth(pts);
}

/** A few faint, still contour lines behind the hero on desktop. Drawn once: nothing runs while scrolling. */
export function Contours({ className = "" }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      {Array.from({ length: LINES }, (_, i) => (
        <path key={i} d={line(i, 0.6)} fill="none" stroke="var(--color-ink)" strokeOpacity={0.09} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

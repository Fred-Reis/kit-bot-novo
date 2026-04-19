import { twMerge } from 'tailwind-merge';

interface SparkProps {
  seed: number;
  up: boolean;
  color?: string;
  className?: string;
}

export function Spark({ seed, up, color = 'var(--color-primary)', className }: SparkProps) {
  const W = 80;
  const H = 32;
  const N = 20;

  const points = Array.from({ length: N }, (_, i) => {
    const trend = up ? (i / (N - 1)) * 0.4 : (1 - i / (N - 1)) * 0.4;
    const noise = Math.sin(i * 0.8 + seed) * 0.4 + 0.5;
    const y = (1 - (noise * 0.6 + trend)) * H;
    const x = (i / (N - 1)) * W;
    return `${x.toFixed(1)},${Math.max(1, Math.min(H - 1, y)).toFixed(1)}`;
  });

  const d = `M ${points.join(' L ')}`;

  return (
    <svg
      data-slot="spark"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      className={twMerge('shrink-0', className)}
    >
      <path d={d} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

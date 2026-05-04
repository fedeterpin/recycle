interface Segment {
  label: string;
  bps: number;
  color: string;
}

interface Props {
  segments: Segment[];
}

export function SplitsBar({ segments }: Props) {
  const total = segments.reduce((acc, s) => acc + s.bps, 0);
  return (
    <div>
      <div className="flex h-8 rounded-lg overflow-hidden border border-slate-800">
        {segments.map((s) => (
          <div
            key={s.label}
            style={{ width: `${(s.bps / total) * 100}%`, background: s.color }}
            className="flex items-center justify-center text-[10px] font-medium text-black/80"
          >
            {s.bps / 100}%
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-300">{s.label}</span>
            <span className="text-slate-500 ml-auto">{s.bps / 100}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

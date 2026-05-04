interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "default" | "green" | "red" | "blue";
}

const TONE_CLASS: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-white",
  green:   "text-emerald-300",
  red:     "text-red-300",
  blue:    "text-sky-300",
};

export function StatCard({ label, value, unit, hint, tone = "default" }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-2xl md:text-3xl font-bold tabular-nums ${TONE_CLASS[tone]}`}>
          {value}
        </span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
      {hint && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{hint}</p>}
    </div>
  );
}

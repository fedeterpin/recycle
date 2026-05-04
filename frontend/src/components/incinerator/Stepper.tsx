"use client";

const STEPS = [
  { id: "approving", label: "Approve" },
  { id: "burning",   label: "Burn"    },
  { id: "done",      label: "Done"    },
] as const;

type Step = "idle" | typeof STEPS[number]["id"];

export function Stepper({ current }: { current: Step }) {
  const idx = current === "idle" ? -1 : STEPS.findIndex((s) => s.id === current);

  return (
    <ol className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((s, i) => {
        const isDone = i < idx || current === "done";
        const isActive = i === idx;

        return (
          <li key={s.id} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                ${isDone   ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : ""}
                ${isActive ? "bg-sky-500/15 border-sky-500/40 text-sky-300 shadow-lg shadow-sky-500/10" : ""}
                ${!isDone && !isActive ? "bg-slate-800/40 border-slate-700 text-slate-500" : ""}
              `}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border border-current">
                {isDone ? "✓" : i + 1}
              </span>
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-6 h-px ${isDone ? "bg-emerald-500/40" : "bg-slate-700"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

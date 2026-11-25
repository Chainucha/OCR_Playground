import { RadioGroup } from "radix-ui";

import type { Mode } from "../core/run";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "queue", label: "One at a time", hint: "Each time is accurate, because each model reads alone." },
  {
    value: "parallel",
    label: "All at once",
    hint: "Faster, but times can read high: models on the same computer slow each other down.",
  },
];

/** Two choices side by side. Each one's hint shows on hover and is read out as its description. */
export function ModeToggle({ mode, onMode, locked }: { mode: Mode; onMode: (m: Mode) => void; locked: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span id="mode-label" className="text-sm font-medium">
        How to run
      </span>
      <RadioGroup.Root
        aria-labelledby="mode-label"
        value={mode}
        onValueChange={(v) => onMode(v as Mode)}
        disabled={locked}
        orientation="horizontal"
        className="flex rounded-lg border border-input p-0.5 data-disabled:opacity-60"
      >
        {MODES.map((m) => (
          <RadioGroup.Item
            key={m.value}
            value={m.value}
            title={m.hint}
            className="h-9 rounded-md px-3 text-sm font-medium text-muted-foreground outline-ring not-aria-checked:hover:bg-muted not-aria-checked:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed aria-checked:bg-accent aria-checked:text-foreground aria-checked:ring-1 aria-checked:ring-primary"
          >
            {m.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}

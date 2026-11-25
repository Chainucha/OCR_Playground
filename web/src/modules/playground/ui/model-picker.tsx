import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type EngineStatus, type Readiness, explainError, modelInfo } from "@/modules/engines";

import { type Mode, plural } from "../core/run";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "queue", label: "One at a time", hint: "Each time is accurate, because each model reads alone." },
  {
    value: "parallel",
    label: "All at once",
    hint: "Faster, but times can read high: models on the same computer slow each other down.",
  },
];

export function ModelPicker({
  engines,
  readiness,
  selected,
  onToggle,
  mode,
  onMode,
  locked,
}: {
  engines: EngineStatus[];
  readiness: Record<string, Readiness>;
  selected: ReadonlySet<string>;
  onToggle: (name: string) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  locked: boolean;
}) {
  function about(e: EngineStatus, goodFor: string): string {
    if (!e.available) return "Not set up on this server yet.";
    const r = readiness[e.name];
    if (r?.state === "warming") return "Getting ready: reading a practice page…";
    if (r?.state === "failed") return `Couldn't get ready. ${explainError(e.name, r.error)}`;
    return goodFor;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg">
          {plural(selected.size, "model")}
          <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2 p-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="px-2 py-1 text-sm font-semibold">Models to compare</legend>
          {engines.map((e) => {
            const info = modelInfo(e.name);
            const id = `model-${e.name}`;
            return (
              <div key={e.name} className={`flex gap-3 rounded-md p-2 ${e.available ? "hover:bg-muted" : ""}`}>
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  disabled={!e.available}
                  checked={selected.has(e.name)}
                  onCheckedChange={() => onToggle(e.name)}
                  aria-describedby={`${id}-about`}
                />
                <label htmlFor={id} className={e.available ? "cursor-pointer" : "cursor-not-allowed"}>
                  <span className="block font-medium">{info.name}</span>
                  <span id={`${id}-about`} aria-live="polite" className="block text-sm text-muted-foreground">
                    {about(e, info.goodFor)}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
        <fieldset disabled={locked} className="flex flex-col gap-1 border-t pt-2 disabled:opacity-60">
          <legend className="px-2 py-1 text-sm font-semibold">How to run them</legend>
          <RadioGroup value={mode} onValueChange={(v) => onMode(v as Mode)} disabled={locked} className="gap-1">
            {MODES.map((m) => (
              <div key={m.value} className="flex gap-3 rounded-md p-2 hover:bg-muted">
                <RadioGroupItem
                  id={`mode-${m.value}`}
                  value={m.value}
                  className="mt-0.5 border-input"
                  aria-describedby={`mode-${m.value}-about`}
                />
                <label htmlFor={`mode-${m.value}`} className="cursor-pointer">
                  <span className="block font-medium">{m.label}</span>
                  <span id={`mode-${m.value}-about`} className="block text-sm text-muted-foreground">
                    {m.hint}
                  </span>
                </label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

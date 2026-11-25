import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type EngineStatus, type Readiness, explainError, modelInfo } from "@/modules/engines";

import { plural } from "../core/run";

export function ModelPicker({
  engines,
  readiness,
  selected,
  onToggle,
}: {
  engines: EngineStatus[];
  readiness: Record<string, Readiness>;
  selected: ReadonlySet<string>;
  onToggle: (name: string) => void;
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
      </PopoverContent>
    </Popover>
  );
}

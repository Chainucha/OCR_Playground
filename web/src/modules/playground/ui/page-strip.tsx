import { Check, Loader2, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Page } from "@/modules/documents";

import { plural } from "../core/run";

/** The pages added so far, in reading order. Choosing one shows its results; each can be removed at any time. */
export function PageStrip({
  pages,
  selectedId,
  listRef,
  status,
  onSelect,
  onRemove,
  onRemoveAll,
}: {
  pages: Page[];
  selectedId: string | null;
  listRef: React.Ref<HTMLUListElement>;
  status: (p: Page) => "reading" | "read" | null;
  onSelect: (id: string) => void;
  onRemove: (p: Page) => void;
  onRemoveAll: () => void;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">{plural(pages.length, "page")}</h2>
        <Button variant="link" className="h-8 px-1 text-sm" onClick={onRemoveAll}>
          Remove all
        </Button>
      </div>
      <ul ref={listRef} aria-label="Pages" className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((p) => {
          const current = p.id === selectedId;
          const state = status(p);
          return (
            <li
              key={p.id}
              className={`flex w-60 shrink-0 items-stretch rounded-lg border ${
                current ? "border-primary bg-accent" : "border-input"
              }`}
            >
              <button
                type="button"
                data-page={p.id}
                aria-current={current || undefined}
                onClick={() => onSelect(p.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg p-1.5 text-left hover:bg-muted"
              >
                <Thumbnail page={p} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{p.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.image.kind === "preparing" && "Preparing…"}
                    {p.image.kind === "failed" && <span className="text-destructive">{p.image.reason}</span>}
                    {p.image.kind === "ready" && state === "reading" && "Reading…"}
                    {p.image.kind === "ready" && state === "read" && (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check aria-hidden className="size-3" />
                        Read
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${p.label}`}
                onClick={() => onRemove(p)}
                className="grid w-9 shrink-0 place-items-center rounded-r-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thumbnail({ page }: { page: Page }) {
  if (page.image.kind === "ready") {
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise
    return <img src={page.image.url} alt="" className="h-12 w-10 shrink-0 rounded border bg-white object-cover object-top" />;
  }
  return (
    <span aria-hidden className="grid h-12 w-10 shrink-0 place-items-center rounded border bg-muted text-muted-foreground">
      {page.image.kind === "preparing" ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <TriangleAlert className="size-4 text-destructive" />
      )}
    </span>
  );
}

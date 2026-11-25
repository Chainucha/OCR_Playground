import { FileUp } from "lucide-react";
import { type DragEvent, useId, useState } from "react";

/** The drop area and file picker. Takes many photos, scans and PDFs at once; each PDF page becomes its own page. */
export function PageAdder({
  hasPages,
  inputRef,
  onFiles,
  onWarm,
}: {
  hasPages: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  onFiles: (files: File[]) => void;
  onWarm: () => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const onDrag = (e: DragEvent<HTMLElement>, over: boolean) => {
    e.preventDefault();
    // dragleave also fires when moving onto a child of the drop area.
    if (!over && e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(over);
  };
  return (
    <label
      htmlFor={inputId}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      onDragEnter={(e) => {
        onWarm();
        onDrag(e, true);
      }}
      onDragOver={(e) => onDrag(e, true)}
      onDragLeave={(e) => onDrag(e, false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }}
      className={`flex min-h-14 flex-1 basis-72 cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-2 pr-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${
        dragging ? "border-primary bg-accent" : "border-input"
      }`}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          onFiles(files);
        }}
      />
      <FileUp aria-hidden className="size-6 shrink-0 text-primary" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">
          {hasPages ? "Drag more pages here, or add files" : "Drag pages here, or choose files"}
        </span>
        <span className="text-sm text-muted-foreground">
          Photos, scans (PNG or JPG) or PDFs. Each PDF page becomes its own page.
        </span>
      </span>
    </label>
  );
}

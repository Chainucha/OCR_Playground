export function Missing({ children }: { children: React.ReactNode }) {
  return (
    <del className="mr-0.5 rounded bg-diff-page px-0.5 text-diff-page-foreground decoration-2">
      <span className="sr-only">page says </span>
      {children}
    </del>
  );
}

export function Extra({ children }: { children: React.ReactNode }) {
  return (
    <ins className="rounded bg-diff-model px-0.5 text-diff-model-foreground underline decoration-2 underline-offset-4">
      <span className="sr-only">model wrote </span>
      {children}
    </ins>
  );
}

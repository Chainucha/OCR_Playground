import { Card } from "@/components/ui/card";

/** One column of the results: a head (scores) and a body (text). From md up the two parts sit on rows shared by every
 * column, so the bodies line up. */
export function Column({
  head,
  children,
  busy,
  className = "",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  busy?: boolean;
  className?: string;
}) {
  return (
    <Card aria-busy={busy || undefined} className={`gap-0 py-0 md:row-span-2 md:grid md:grid-rows-subgrid ${className}`}>
      <div className="flex flex-col gap-2 p-4">{head}</div>
      <div className="border-t p-4">{children}</div>
    </Card>
  );
}

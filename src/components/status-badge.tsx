import { STATUS_LABELS, type DealStatus } from "@/lib/crm";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: DealStatus; className?: string }) {
  return (
    <span className={cn("status-chip", `status-${status}`, className)}>
      {STATUS_LABELS[status]}
    </span>
  );
}

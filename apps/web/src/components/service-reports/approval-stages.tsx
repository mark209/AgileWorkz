import { Check } from "lucide-react";

// Presentation of the existing workflow only. Permission and transition guards
// remain in the page and API; extraction-in-progress is not ready for review.
export function ApprovalStages({ status }: { status: string }) {
  const activeStage = status === "LOCKED" ? 3 : status === "CONFIRMED" ? 2 : status === "VERIFIED" ? 1
    : ["PENDING_VERIFICATION", "EXTRACTION_FAILED"].includes(status) ? 0 : -1;
  return <ol aria-label="Report approval stages" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:p-5">
    {[{ title: "Supervisor review", detail: "Technical Supervisor or Supervisor" },
      { title: "Final approval", detail: "Responsible Manager or Super Admin" },
      { title: "Administrative lock", detail: "Protect the approved record" }].map((stage, index) => {
      const complete = activeStage > index;
      const current = activeStage === index;
      return <li key={stage.title} aria-current={current ? "step" : undefined} className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? "bg-emerald-100 text-emerald-800" : current ? "bg-primary text-primary-foreground" : "border bg-muted text-muted-foreground"}`}>
          {complete ? <Check className="h-4 w-4" /> : index + 1}
        </span>
        <div className="min-w-0"><p className="text-sm font-semibold">{stage.title}</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{stage.detail}</p><p className={`mt-1 text-xs font-medium ${complete ? "text-emerald-700" : "text-muted-foreground"}`}>{complete ? "Complete" : current ? "Current stage" : "Upcoming"}</p></div>
      </li>;
    })}
  </ol>;
}

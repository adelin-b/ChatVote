"use client";

import { AlertCircle, AlertTriangle, Info } from "lucide-react";

export interface Warning {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  count: number;
  tab_link: string;
}

interface WarningCardProps {
  warning: Warning;
  onView?: (tabLink: string) => void;
}

export default function WarningCard({ warning, onView }: WarningCardProps) {
  const { severity, message, count, tab_link } = warning;

  const iconClass =
    severity === "critical"
      ? "text-red-500"
      : severity === "warning"
        ? "text-yellow-500"
        : "text-blue-500";

  const bgClass =
    severity === "critical"
      ? "bg-red-500/10 border-red-500/30"
      : severity === "warning"
        ? "bg-yellow-500/10 border-yellow-500/30"
        : "bg-blue-500/10 border-blue-500/30";

  const countBgClass =
    severity === "critical"
      ? "bg-red-500/100"
      : severity === "warning"
        ? "bg-yellow-500/100"
        : "bg-blue-500/100";

  const Icon =
    severity === "critical"
      ? AlertCircle
      : severity === "warning"
        ? AlertTriangle
        : Info;

  return (
    <div
      className={`border-border-subtle flex items-start gap-3 rounded-lg border p-3 ${bgClass}`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconClass}`} />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm">{message}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {count > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${countBgClass}`}
          >
            {count}
          </span>
        )}
        {onView && (
          <button
            type="button"
            onClick={() => onView(tab_link)}
            className="text-muted-foreground hover:text-foreground text-xs font-medium underline"
          >
            View
          </button>
        )}
      </div>
    </div>
  );
}

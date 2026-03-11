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
      ? "bg-red-50 border-red-200"
      : severity === "warning"
        ? "bg-yellow-50 border-yellow-200"
        : "bg-blue-50 border-blue-200";

  const countBgClass =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
        ? "bg-yellow-500"
        : "bg-blue-500";

  const Icon =
    severity === "critical"
      ? AlertCircle
      : severity === "warning"
        ? AlertTriangle
        : Info;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${bgClass}`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconClass}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800">{message}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
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
            className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
          >
            View
          </button>
        )}
      </div>
    </div>
  );
}

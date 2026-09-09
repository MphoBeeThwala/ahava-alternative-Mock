"use client";

import React from "react";
import { Icon, type IconName } from "./Icon";

/** Icon + one line + one optional action. Used for every "nothing here yet" case. */
export function EmptyState({
  icon = "search",
  message,
  action,
  className = "",
}: {
  icon?: IconName;
  message: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 py-10 text-center ${className}`}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
        <Icon name={icon} size={22} />
      </span>
      <p className="text-sm font-medium text-[var(--muted)]">{message}</p>
      {action != null && <div>{action}</div>}
    </div>
  );
}

import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
};

const toneClass: Record<StatusTone, string> = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

/** Status sempre exige texto; a cor apenas reforça a informação. */
export function StatusBadge({ children, tone = 'neutral', className = '' }: StatusBadgeProps) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold ${toneClass[tone]} ${className}`}>{children}</span>;
}

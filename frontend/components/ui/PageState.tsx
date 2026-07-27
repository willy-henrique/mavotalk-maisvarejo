import type { ReactNode } from 'react';

type PageStateProps = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function LoadingState({ title = 'Carregando informações…', description, className = '' }: Omit<PageStateProps, 'action'>) {
  return (
    <section aria-live="polite" aria-busy="true" className={`mavo-card p-8 text-center ${className}`}>
      <div className="mx-auto h-8 w-32 rounded-xl skeleton" aria-hidden="true" />
      <p className="mt-4 text-sm font-bold text-slate-700 dark:text-slate-200">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">{description}</p>}
    </section>
  );
}

export function EmptyState({ title, description, action, className = '' }: PageStateProps) {
  return (
    <section className={`mavo-card p-8 text-center ${className}`}>
      <p className="font-bold text-slate-800 dark:text-slate-100">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </section>
  );
}

export function ErrorState({ title = 'Não foi possível carregar esta área.', description, action, className = '' }: Omit<PageStateProps, 'title'> & { title?: string }) {
  return (
    <section role="alert" className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900/60 dark:bg-rose-950/30 ${className}`}>
      <div>
        <p className="font-bold text-rose-800 dark:text-rose-200">{title}</p>
        {description && <p className="mt-1 text-rose-700 dark:text-rose-300">{description}</p>}
      </div>
      {action}
    </section>
  );
}

import React from 'react';

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  className?: string;
};

export function Pagination({ page, pageSize, total, itemLabel, onPageChange, className = '' }: PaginationProps) {
  if (total <= 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activePage = Math.min(Math.max(1, page), totalPages);
  const first = (activePage - 1) * pageSize + 1;
  const last = Math.min(activePage * pageSize, total);

  return <nav aria-label={`Paginação de ${itemLabel}`} className={`mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300 ${className}`}>
    <span aria-live="polite">Mostrando {first}–{last} de {total} {itemLabel}</span>
    {totalPages > 1 && <div className="flex gap-2"><button type="button" disabled={activePage === 1} onClick={() => onPageChange(activePage - 1)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs" aria-label="Página anterior">Anterior</button><button type="button" disabled={activePage === totalPages} onClick={() => onPageChange(activePage + 1)} className="mavo-button-secondary min-h-0 px-3 py-2 text-xs" aria-label="Próxima página">Próxima</button></div>}
  </nav>;
}

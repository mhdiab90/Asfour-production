/**
 * Metric type and financial value - shared by the classic Dashboard and the
 * Custom Dashboard.
 *
 * Moved here from DashboardView so the Custom Dashboard reuses the exact same
 * toggle, card and data rule instead of a copy:
 *
 *   - Quantity and money are separate measures. Ticking both shows both, side
 *     by side; they are never added, averaged or normalised together.
 *   - Money comes only from actual transactions, filtered only by date and the
 *     cost-centre scope - product, customer, shift and stage do not apply.
 *   - Transactions are read only while financial values are shown, through the
 *     existing cache-first service; a quantity-only dashboard reads nothing.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DashboardMetricMode, metricFlags, metricModeFromFlags } from '../../services/costCenterDashboardPure';
import { aggregateFinancialValue, FinancialTransaction } from '../../services/financialTransactionsPure';
import { listFinancialTransactions } from '../../services/financialTransactionService';
import { formatNumber } from '../../utils/formatters';

export const MetricModeToggle: React.FC<{
  mode: DashboardMetricMode;
  onChange: (mode: DashboardMetricMode) => void;
  language: 'ar' | 'en';
  id?: string;
}> = ({ mode, onChange, language, id = 'dashboard-metric-mode' }) => {
  const { quantity, financial } = metricFlags(mode);
  return (
    <div id={id} className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold text-slate-200">
      <label className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-amber-400 cursor-pointer"
          checked={quantity}
          onChange={() => onChange(metricModeFromFlags(!quantity, financial))}
        />
        {language === 'ar' ? 'الكميات' : 'Quantities'}
      </label>
      <label className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-amber-400 cursor-pointer"
          checked={financial}
          onChange={() => onChange(metricModeFromFlags(quantity, !financial))}
        />
        {language === 'ar' ? 'القيم المالية' : 'Financial values'}
      </label>
    </div>
  );
};

export interface FinancialValueState {
  total: number;
  count: number;
  error: string | null;
}

/**
 * The financial value for a period and cost-centre scope.
 *
 * `enabled` false issues no read at all. The aggregation is the shared pure
 * one; nothing here touches production records.
 */
export function useFinancialValue(
  enabled: boolean,
  scope: { costCenterCodes: ReadonlySet<string> | null; startDate?: string; endDate?: string },
): FinancialValueState {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setError(null);
    listFinancialTransactions()
      .then(setTransactions)
      .catch((err) => setError(String(err?.message ?? err)));
  }, [enabled]);

  const { costCenterCodes, startDate, endDate } = scope;
  const aggregate = useMemo(
    () => aggregateFinancialValue(transactions, { costCenterCodes, startDate, endDate }),
    [transactions, costCenterCodes, startDate, endDate],
  );
  return { total: aggregate.total, count: aggregate.count, error };
}

/** Financial value in its own card - never merged into a quantity card. */
export const FinancialValueCard: React.FC<{
  value: FinancialValueState;
  language: 'ar' | 'en';
  id?: string;
}> = ({ value, language, id = 'dashboard-financial-value' }) => (
  <div id={id} className="bg-white border border-slate-200 border-r-4 border-r-emerald-500 p-5 shadow-xs">
    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
      {language === 'ar' ? 'القيم المالية - المصروفات الفعلية' : 'Financial values - actual spending'}
    </p>
    {value.error ? (
      <p className="text-xs font-bold text-rose-700 mt-2">
        {language === 'ar'
          ? `تعذر قراءة المعاملات المالية: ${value.error}`
          : `Could not read financial transactions: ${value.error}`}
      </p>
    ) : (
      <>
        <p className="text-2xl font-black text-slate-800 tracking-tight font-mono mt-1">{formatNumber(value.total)}</p>
        <p className="text-[11px] text-slate-500 mt-1">
          {language === 'ar'
            ? `عدد المعاملات: ${formatNumber(value.count)} — نطاق التاريخ ومراكز التكاليف نفسها`
            : `Transactions: ${formatNumber(value.count)} — same period and cost-centre scope`}
        </p>
      </>
    )}
  </div>
);

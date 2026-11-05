import { SaleRecord, TaxRules } from '../types';

export interface TaxEngineResult {
  totalEstimatedTaxOwedBase: number;
  equityLtcgGain: number;
  equityStcgGain: number;
  foreignLtcgGain: number;
  foreignStcgGain: number;
  debtGain: number;
  otherGain: number;
  netLossCarriedForward: number;
  taxableIncome: number;
  byFinancialYear: Record<string, {
    equityLtcgTotal: number;
    equityStcgTotal: number;
    foreignLtcgTotal: number;
    foreignStcgTotal: number;
    debtTotal: number;
    estimatedTax: number;
  }>;
}

export function calculateTaxEngine(
  sales: SaleRecord[] = [],
  taxRules: TaxRules
): TaxEngineResult {
  let equityLtcgGain = 0;
  let equityStcgGain = 0;
  let foreignLtcgGain = 0;
  let foreignStcgGain = 0;
  let debtGain = 0;
  let otherGain = 0;

  for (const s of sales) {
    const gainBase = (s.gain || 0) * (s.fxRate || 1);
    if (s.classification === 'LTCG_EQUITY') equityLtcgGain += gainBase;
    else if (s.classification === 'STCG_EQUITY') equityStcgGain += gainBase;
    else if (s.classification === 'FOREIGN_LTCG') foreignLtcgGain += gainBase;
    else if (s.classification === 'FOREIGN_STCG') foreignStcgGain += gainBase;
    else if (s.classification === 'DEBT_SLAB') debtGain += gainBase;
    else otherGain += gainBase;
  }

  // Exemptions & Calculations
  const taxableEquityLtcg = Math.max(0, equityLtcgGain - (taxRules.equityLtcgExemptionLimit || 125000));
  const ltcgTax = (taxableEquityLtcg * (taxRules.equityLtcgRatePct || 12.5)) / 100;
  const stcgTax = Math.max(0, (equityStcgGain * (taxRules.equityStcgRatePct || 20)) / 100);
  const foreignLtcgTax = Math.max(0, (foreignLtcgGain * (taxRules.foreignLtcgRatePct || 20)) / 100);
  const debtTax = Math.max(0, (debtGain * (taxRules.userSlabRatePct || 30)) / 100);
  const foreignStcgTax = Math.max(0, (foreignStcgGain * (taxRules.userSlabRatePct || 30)) / 100);
  const otherTax = Math.max(0, (otherGain * (taxRules.userSlabRatePct || 30)) / 100);

  let totalTax = ltcgTax + stcgTax + foreignLtcgTax + foreignStcgTax + debtTax + otherTax;
  if (taxRules.cessEnabled) {
    totalTax += (totalTax * (taxRules.cessPct || 4)) / 100;
  }

  const byFinancialYear: Record<string, any> = {
    'FY26-27': {
      equityLtcgTotal: equityLtcgGain,
      equityStcgTotal: equityStcgGain,
      foreignLtcgTotal: foreignLtcgGain,
      foreignStcgTotal: foreignStcgGain,
      debtTotal: debtGain,
      estimatedTax: Math.max(0, Math.round(totalTax)),
    },
  };

  return {
    totalEstimatedTaxOwedBase: Math.max(0, Math.round(totalTax)),
    equityLtcgGain,
    equityStcgGain,
    foreignLtcgGain,
    foreignStcgGain,
    debtGain,
    otherGain,
    netLossCarriedForward: 0,
    taxableIncome: Math.max(0, equityLtcgGain + equityStcgGain + foreignLtcgGain + foreignStcgGain + debtGain + otherGain),
    byFinancialYear,
  };
}

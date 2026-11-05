/**
 * CSV serialization and deserialization helpers for NetWorthIQ
 * Supports lossless full-state replication across Holdings, Liabilities, Transactions,
 * Bills, Goals, Income Streams, Credit Scores, Career/Skills/Age/Experience, and ML Models & Half-Predictions.
 */

import {
  Holding,
  Transaction,
  Liability,
  Bill,
  AssetType,
  Goal,
  IncomeStream,
  CreditScoreRecord,
  AppSettings,
  CareerProfile,
  FullMLReplicationState,
  Receivable,
} from '../types';

// Helper to escape CSV cell (encodes embedded newlines safely inside quotes; JSON cells are single-line)
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/\r?\n/g, ' ');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Utility to parse standard CSV line with quote escaping
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// 1. HOLDINGS / ASSETS CSV
export function exportHoldingsToCsv(holdings: Holding[], assetTypes: AssetType[]): string {
  const typeMap = new Map(assetTypes.map((t) => [t.id, t.name]));
  const headers = [
    'type',
    'name',
    'currency',
    'units',
    'current_price',
    'avg_buy_price',
    'principal_or_balance',
    'fixed_rate_pct',
    'expected_rate_pct',
    'start_date',
    'maturity_date',
    'liquidity',
    'notes',
    'id',
    'is_sweep_in',
    'sweep_in_target_account_id',
    'risk_level',
    'market_cap_category',
    'is_matured',
    'created_at',
    'account_last_digits',
  ];

  const rows = holdings.map((h) => [
    escapeCsvCell(typeMap.get(h.typeId) || h.typeId),
    escapeCsvCell(h.name),
    escapeCsvCell(h.currency),
    escapeCsvCell(h.units ?? ''),
    escapeCsvCell(h.currentPrice ?? ''),
    escapeCsvCell(h.avgBuyPrice ?? ''),
    escapeCsvCell(h.principalOrValue ?? ''),
    escapeCsvCell(h.fixedRatePct ?? ''),
    escapeCsvCell(h.expectedRatePct ?? ''),
    escapeCsvCell(h.startDate ?? ''),
    escapeCsvCell(h.maturityDate ?? ''),
    escapeCsvCell(h.liquidityClass),
    escapeCsvCell(h.notes ?? ''),
    escapeCsvCell(h.id),
    escapeCsvCell(h.isSweepIn ? 'true' : 'false'),
    escapeCsvCell(h.sweepInTargetAccountId ?? ''),
    escapeCsvCell(h.riskLevel ?? ''),
    escapeCsvCell(h.marketCapCategory ?? ''),
    escapeCsvCell(h.isMatured ? 'true' : 'false'),
    escapeCsvCell(h.createdAt ?? ''),
    escapeCsvCell(h.accountLastDigits ?? ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseHoldingsCsv(
  csvText: string,
  assetTypes: AssetType[],
  defaultCurrency: string = 'INR'
): { items: Holding[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Holding[] = [];
  const errors: string[] = [];

  if (lines.length < 2) {
    return { items, errors: ['CSV contains no data rows'] };
  }

  const typeByName = new Map(assetTypes.map((t) => [t.name.toLowerCase(), t.id]));
  const typeById = new Set(assetTypes.map((t) => t.id));

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cols = parseCsvLine(raw);
    if (cols.length < 2) continue;

    const typeStr = cols[0] || 'Bank Account';
    const name = cols[1];
    if (!name) {
      errors.push(`Row ${i + 1}: Missing asset name`);
      continue;
    }

    const typeId = typeById.has(typeStr)
      ? typeStr
      : typeByName.get(typeStr.toLowerCase()) || assetTypes[0]?.id || 'type-bank';
    const currency = (cols[2] || defaultCurrency).toUpperCase();
    const units = cols[3] ? parseFloat(cols[3]) : undefined;
    const currentPrice = cols[4] ? parseFloat(cols[4]) : undefined;
    const avgBuyPrice = cols[5] ? parseFloat(cols[5]) : undefined;
    const principalOrValue = cols[6] ? parseFloat(cols[6]) : units && currentPrice ? units * currentPrice : 0;
    const fixedRatePct = cols[7] ? parseFloat(cols[7]) : undefined;
    const expectedRatePct = cols[8] ? parseFloat(cols[8]) : undefined;
    const startDate = cols[9] || undefined;
    const maturityDate = cols[10] || undefined;
    const liquidityClass = (['Immediate', 'Short', 'Locked'].includes(cols[11]) ? cols[11] : 'Immediate') as any;
    const notes = cols[12] || undefined;
    const preservedId = cols[13] || `hold-imp-${Date.now()}-${i}`;
    const isSweepIn = cols[14] === 'true';
    const sweepInTargetAccountId = cols[15] || undefined;
    const riskLevel = (['low', 'medium', 'high'].includes(cols[16]) ? cols[16] : undefined) as any;
    const marketCapCategory = (
      ['mega_cap', 'large_cap', 'mid_cap', 'small_cap', 'none'].includes(cols[17]) ? cols[17] : undefined
    ) as any;
    const isMatured = cols[18] === 'true';
    const createdAt = cols[19] || undefined;
    const accountLastDigits = cols[20] ? cols[20].replace(/\D/g, '').slice(-6) || undefined : undefined;

    items.push({
      id: preservedId,
      name,
      typeId,
      currency,
      units: isNaN(units!) ? undefined : units,
      currentPrice: isNaN(currentPrice!) ? undefined : currentPrice,
      avgBuyPrice: isNaN(avgBuyPrice!) ? undefined : avgBuyPrice,
      principalOrValue: isNaN(principalOrValue) ? 0 : principalOrValue,
      fixedRatePct: isNaN(fixedRatePct!) ? undefined : fixedRatePct,
      expectedRatePct: isNaN(expectedRatePct!) ? undefined : expectedRatePct,
      startDate,
      maturityDate,
      liquidityClass,
      notes,
      ...(isSweepIn ? { isSweepIn: true } : {}),
      ...(sweepInTargetAccountId ? { sweepInTargetAccountId } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      ...(marketCapCategory ? { marketCapCategory } : {}),
      ...(isMatured ? { isMatured: true } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(accountLastDigits ? { accountLastDigits } : {}),
    });
  }

  return { items, errors };
}

// 2. TRANSACTIONS CSV
export function exportTransactionsToCsv(
  transactions: Transaction[],
  holdings: Holding[],
  liabilities: Liability[]
): string {
  const accountMap = new Map<string, string>();
  holdings.forEach((h) => accountMap.set(h.id, h.name));
  liabilities.forEach((l) => accountMap.set(l.id, l.name));

  const headers = [
    'date',
    'kind',
    'amount',
    'currency',
    'reason',
    'category',
    'from_account',
    'to_account',
    'fx_rate',
    'notes',
    'id',
    'from_id',
    'to_id',
    'payment_mode',
    'debit_card_id',
    'tags_json',
    'to_amount',
    'broker_name',
    'brokerage_fee',
    'broker_fee_mode',
    'broker_fee_pct',
    'broker_fee_per_unit',
    'broker_fee_unit_size',
    'prepayment_penalty_paid',
  ];

  const rows = transactions.map((t) => [
    escapeCsvCell(t.date),
    escapeCsvCell(t.kind),
    escapeCsvCell(t.amount),
    escapeCsvCell(t.currency),
    escapeCsvCell(t.reason),
    escapeCsvCell(t.category),
    escapeCsvCell(t.fromId ? accountMap.get(t.fromId) || t.fromId : ''),
    escapeCsvCell(t.toId ? accountMap.get(t.toId) || t.toId : ''),
    escapeCsvCell(t.fxRateUsed ?? 1.0),
    escapeCsvCell(t.notes ?? ''),
    escapeCsvCell(t.id),
    escapeCsvCell(t.fromId ?? ''),
    escapeCsvCell(t.toId ?? ''),
    escapeCsvCell(t.paymentMode ?? ''),
    escapeCsvCell(t.debitCardId ?? ''),
    escapeCsvCell(t.tags && t.tags.length > 0 ? JSON.stringify(t.tags) : ''),
    escapeCsvCell(t.toAmount ?? ''),
    escapeCsvCell(t.brokerName ?? ''),
    escapeCsvCell(t.brokerageFee ?? ''),
    escapeCsvCell(t.brokerFeeMode ?? ''),
    escapeCsvCell(t.brokerFeePct ?? ''),
    escapeCsvCell(t.brokerFeePerUnit ?? ''),
    escapeCsvCell(t.brokerFeeUnitSize ?? ''),
    escapeCsvCell(t.prepaymentPenaltyPaid ?? ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseTransactionsCsv(
  csvText: string,
  holdings: Holding[],
  liabilities: Liability[],
  defaultCurrency: string = 'INR'
): { items: Transaction[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Transaction[] = [];
  const errors: string[] = [];

  if (lines.length < 2) {
    return { items, errors: ['CSV contains no data rows'] };
  }

  const accountByName = new Map<string, string>();
  holdings.forEach((h) => accountByName.set(h.name.toLowerCase(), h.id));
  liabilities.forEach((l) => accountByName.set(l.name.toLowerCase(), l.id));

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cols = parseCsvLine(raw);
    if (cols.length < 3) continue;

    const date = cols[0] || new Date().toISOString().split('T')[0];
    const kind = (cols[1] || 'spend') as any;
    const amount = parseFloat(cols[2]);
    if (isNaN(amount) || amount < 0) {
      errors.push(`Row ${i + 1}: Invalid transaction amount`);
      continue;
    }

    const currency = (cols[3] || defaultCurrency).toUpperCase();
    const reason = cols[4] || 'Expense';
    const category = cols[5] || 'General';
    const fromName = cols[6]?.toLowerCase();
    const toName = cols[7]?.toLowerCase();
    const fxRate = cols[8] ? parseFloat(cols[8]) : 1.0;
    const notes = cols[9] || undefined;

    const preservedId = cols[10] || `tx-imp-${Date.now()}-${i}`;
    const explicitFromId = cols[11] || undefined;
    const explicitToId = cols[12] || undefined;
    const paymentMode = (cols[13] || undefined) as any;
    const debitCardId = cols[14] || undefined;
    let tags: string[] | undefined;
    if (cols[15]) {
      try {
        const parsedTags = JSON.parse(cols[15]);
        if (Array.isArray(parsedTags)) tags = parsedTags;
      } catch {}
    }

    const toAmount = cols[16] ? parseFloat(cols[16]) : undefined;
    const brokerName = cols[17] || undefined;
    const brokerageFee = cols[18] ? parseFloat(cols[18]) : undefined;
    const brokerFeeMode = (['percentage', 'per_unit', 'flat'].includes(cols[19]) ? cols[19] : undefined) as any;
    const brokerFeePct = cols[20] ? parseFloat(cols[20]) : undefined;
    const brokerFeePerUnit = cols[21] ? parseFloat(cols[21]) : undefined;
    const brokerFeeUnitSize = cols[22] ? parseFloat(cols[22]) : undefined;
    const prepaymentPenaltyPaid = cols[23] ? parseFloat(cols[23]) : undefined;

    const fromId = explicitFromId || (fromName ? accountByName.get(fromName) || undefined : undefined);
    const toId = explicitToId || (toName ? accountByName.get(toName) || undefined : undefined);

    items.push({
      id: preservedId,
      date,
      kind,
      amount,
      currency,
      reason,
      category,
      fromId,
      toId,
      fxRateUsed: isNaN(fxRate) ? 1.0 : fxRate,
      notes,
      ...(paymentMode ? { paymentMode } : {}),
      ...(debitCardId ? { debitCardId } : {}),
      ...(tags ? { tags } : {}),
      ...(toAmount !== undefined && !isNaN(toAmount) ? { toAmount } : {}),
      ...(brokerName ? { brokerName } : {}),
      ...(brokerageFee !== undefined && !isNaN(brokerageFee) ? { brokerageFee } : {}),
      ...(brokerFeeMode ? { brokerFeeMode } : {}),
      ...(brokerFeePct !== undefined && !isNaN(brokerFeePct) ? { brokerFeePct } : {}),
      ...(brokerFeePerUnit !== undefined && !isNaN(brokerFeePerUnit) ? { brokerFeePerUnit } : {}),
      ...(brokerFeeUnitSize !== undefined && !isNaN(brokerFeeUnitSize) ? { brokerFeeUnitSize } : {}),
      ...(prepaymentPenaltyPaid !== undefined && !isNaN(prepaymentPenaltyPaid) ? { prepaymentPenaltyPaid } : {}),
    });
  }

  return { items, errors };
}

// 3. LIABILITIES / CARDS CSV
export function exportLiabilitiesToCsv(liabilities: Liability[]): string {
  const headers = [
    'kind',
    'name',
    'currency',
    'outstanding',
    'rate_pct',
    'monthly_emi',
    'emi_day',
    'limit',
    'statement_day',
    'interest_free_days',
    'penalty_monthly_rate',
    'start_date',
    'end_date',
    'id',
    'card_type',
    'linked_account_id',
    'credit_limit',
    'annual_fee',
    'accumulated_cashback',
    'cashback_rate_pct',
    'debit_usage_count',
    'metro_atm_usage_this_month',
    'non_metro_atm_usage_this_month',
    'statements_json',
    'prepayment_lock_in_months',
    'prepayment_penalty_pct',
    'prepayment_fee_basis',
    'tenure_months',
    'applicable_gst_pct',
    'prepayment_policy_json',
    'account_last_digits',
  ];

  const rows = liabilities.map((l) => [
    escapeCsvCell(l.kind),
    escapeCsvCell(l.name),
    escapeCsvCell(l.currency),
    escapeCsvCell(l.outstanding),
    escapeCsvCell(l.ratePct),
    escapeCsvCell(l.monthlyEmi ?? ''),
    escapeCsvCell(l.emiDay ?? ''),
    escapeCsvCell(l.limit ?? l.creditLimit ?? ''),
    escapeCsvCell(l.statementDay ?? ''),
    escapeCsvCell(l.interestFreeDays ?? ''),
    escapeCsvCell(l.penaltyRateMonthlyPct ?? ''),
    escapeCsvCell(l.startDate ?? ''),
    escapeCsvCell(l.endDate ?? ''),
    escapeCsvCell(l.id),
    escapeCsvCell(l.cardType ?? ''),
    escapeCsvCell(l.linkedAccountId ?? ''),
    escapeCsvCell(l.creditLimit ?? l.limit ?? ''),
    escapeCsvCell(l.annualFee ?? ''),
    escapeCsvCell(l.accumulatedCashback ?? ''),
    escapeCsvCell(l.cashbackRatePct ?? ''),
    escapeCsvCell(l.debitUsageCount ?? ''),
    escapeCsvCell(l.metroAtmUsageThisMonth ?? ''),
    escapeCsvCell(l.nonMetroAtmUsageThisMonth ?? ''),
    escapeCsvCell(l.statements && l.statements.length > 0 ? JSON.stringify(l.statements) : ''),
    escapeCsvCell(l.prepaymentLockInMonths ?? ''),
    escapeCsvCell(l.prepaymentPenaltyPct ?? ''),
    escapeCsvCell(l.prepaymentFeeBasis ?? ''),
    escapeCsvCell(l.tenureMonths ?? ''),
    escapeCsvCell(l.applicableGstPct ?? ''),
    escapeCsvCell(l.prepaymentPolicy ? JSON.stringify(l.prepaymentPolicy) : ''),
    escapeCsvCell(l.accountLastDigits ?? ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseLiabilitiesCsv(
  csvText: string,
  defaultCurrency: string = 'INR'
): { items: Liability[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Liability[] = [];
  const errors: string[] = [];

  if (lines.length < 2) {
    return { items, errors: ['CSV contains no data rows'] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;

    const kind = cols[0] === 'loan' ? 'loan' : 'card';
    const name = cols[1];
    if (!name) {
      errors.push(`Row ${i + 1}: Missing liability name`);
      continue;
    }

    const currency = (cols[2] || defaultCurrency).toUpperCase();
    const outstanding = parseFloat(cols[3]);
    const ratePct = parseFloat(cols[4]);
    const preservedId = cols[13] || `liab-imp-${Date.now()}-${i}`;
    const cardType = (['credit', 'debit', 'hybrid'].includes(cols[14]) ? cols[14] : undefined) as any;
    const linkedAccountId = cols[15] || undefined;
    const creditLimit = cols[16] ? parseFloat(cols[16]) : cols[7] ? parseFloat(cols[7]) : undefined;
    const annualFee = cols[17] ? parseFloat(cols[17]) : undefined;
    const accumulatedCashback = cols[18] ? parseFloat(cols[18]) : undefined;
    const cashbackRatePct = cols[19] ? parseFloat(cols[19]) : undefined;
    const debitUsageCount = cols[20] ? parseInt(cols[20], 10) : undefined;
    const metroAtm = cols[21] ? parseInt(cols[21], 10) : undefined;
    const nonMetroAtm = cols[22] ? parseInt(cols[22], 10) : undefined;
    let statements: any[] | undefined;
    if (cols[23]) {
      try {
        const parsedStmts = JSON.parse(cols[23]);
        if (Array.isArray(parsedStmts)) statements = parsedStmts;
      } catch {}
    }

    const prepaymentLockInMonths = cols[24] ? parseInt(cols[24], 10) : undefined;
    const prepaymentPenaltyPct = cols[25] ? parseFloat(cols[25]) : undefined;
    const prepaymentFeeBasis = (
      ['existing_principal', 'prepaid_amount'].includes(cols[26]) ? cols[26] : undefined
    ) as any;
    const tenureMonths = cols[27] ? parseInt(cols[27], 10) : undefined;
    const applicableGstPct = cols[28] ? parseFloat(cols[28]) : undefined;
    let prepaymentPolicy: any;
    if (cols[29]) {
      try {
        const parsedPol = JSON.parse(cols[29]);
        if (parsedPol && typeof parsedPol === 'object') prepaymentPolicy = parsedPol;
      } catch {}
    }
    const accountLastDigits = cols[30] ? cols[30].replace(/\D/g, '').slice(-6) || undefined : undefined;

    items.push({
      id: preservedId,
      kind,
      name,
      currency,
      outstanding: isNaN(outstanding) ? 0 : outstanding,
      ratePct: isNaN(ratePct) ? 0 : ratePct,
      monthlyEmi: cols[5] ? parseFloat(cols[5]) : undefined,
      emiDay: cols[6] ? parseInt(cols[6], 10) : undefined,
      limit: cols[7] ? parseFloat(cols[7]) : creditLimit,
      statementDay: cols[8] ? parseInt(cols[8], 10) : undefined,
      interestFreeDays: cols[9] ? parseInt(cols[9], 10) : undefined,
      penaltyRateMonthlyPct: cols[10] ? parseFloat(cols[10]) : undefined,
      startDate: cols[11] || undefined,
      endDate: cols[12] || undefined,
      ...(cardType ? { cardType } : {}),
      ...(linkedAccountId ? { linkedAccountId } : {}),
      ...(creditLimit !== undefined && !isNaN(creditLimit) ? { creditLimit } : {}),
      ...(annualFee !== undefined && !isNaN(annualFee) ? { annualFee } : {}),
      ...(accumulatedCashback !== undefined && !isNaN(accumulatedCashback) ? { accumulatedCashback } : {}),
      ...(cashbackRatePct !== undefined && !isNaN(cashbackRatePct) ? { cashbackRatePct } : {}),
      ...(debitUsageCount !== undefined && !isNaN(debitUsageCount) ? { debitUsageCount } : {}),
      ...(metroAtm !== undefined && !isNaN(metroAtm) ? { metroAtmUsageThisMonth: metroAtm } : {}),
      ...(nonMetroAtm !== undefined && !isNaN(nonMetroAtm) ? { nonMetroAtmUsageThisMonth: nonMetroAtm } : {}),
      ...(statements ? { statements } : {}),
      ...(prepaymentLockInMonths !== undefined && !isNaN(prepaymentLockInMonths)
        ? { prepaymentLockInMonths }
        : {}),
      ...(prepaymentPenaltyPct !== undefined && !isNaN(prepaymentPenaltyPct)
        ? { prepaymentPenaltyPct }
        : {}),
      ...(prepaymentFeeBasis ? { prepaymentFeeBasis } : {}),
      ...(tenureMonths !== undefined && !isNaN(tenureMonths) ? { tenureMonths } : {}),
      ...(applicableGstPct !== undefined && !isNaN(applicableGstPct) ? { applicableGstPct } : {}),
      ...(prepaymentPolicy ? { prepaymentPolicy } : {}),
      ...(accountLastDigits ? { accountLastDigits } : {}),
    });
  }

  return { items, errors };
}

// 4. BILLS CSV
export function exportBillsToCsv(
  bills: Bill[],
  holdings: Holding[],
  liabilities: Liability[]
): string {
  const accountMap = new Map<string, string>();
  holdings.forEach((h) => accountMap.set(h.id, h.name));
  liabilities.forEach((l) => accountMap.set(l.id, l.name));

  // Export all manual/user bills INCLUDING settled & archived bills so files preserve full history
  const manualBills = bills.filter((b) => !b.isAutoLiabilityBill && !b.isGoalContributionBill);

  const headers = [
    'name',
    'amount',
    'currency',
    'frequency',
    'due_day',
    'category',
    'payment_source',
    'id',
    'source_id',
    'last_posted_date',
    'is_overridden_paid',
    'last_overridden_month',
    'is_archived',
    'archived_at',
  ];

  const rows = manualBills.map((b) => [
    escapeCsvCell(b.name),
    escapeCsvCell(b.amount),
    escapeCsvCell(b.currency),
    escapeCsvCell(b.frequency),
    escapeCsvCell(b.dueDay),
    escapeCsvCell(b.category),
    escapeCsvCell(accountMap.get(b.sourceId) || b.sourceId),
    escapeCsvCell(b.id),
    escapeCsvCell(b.sourceId),
    escapeCsvCell(b.lastPostedDate ?? ''),
    escapeCsvCell(b.isOverriddenPaid ? 'true' : 'false'),
    escapeCsvCell(b.lastOverriddenMonth ?? ''),
    escapeCsvCell(b.isArchived ? 'true' : 'false'),
    escapeCsvCell(b.archivedAt ?? ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseBillsCsv(
  csvText: string,
  holdings: Holding[],
  liabilities: Liability[],
  defaultCurrency: string = 'INR'
): { items: Bill[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Bill[] = [];
  const errors: string[] = [];

  if (lines.length < 2) {
    return { items, errors: ['CSV contains no data rows'] };
  }

  const accountByName = new Map<string, string>();
  holdings.forEach((h) => accountByName.set(h.name.toLowerCase(), h.id));
  liabilities.forEach((l) => accountByName.set(l.name.toLowerCase(), l.id));

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 2) continue;

    const name = cols[0];
    if (!name) continue;
    const amount = parseFloat(cols[1]);
    const currency = (cols[2] || defaultCurrency).toUpperCase();
    const frequency = (['monthly', 'weekly', 'yearly', 'quarterly', 'biweekly'].includes(cols[3]) ? cols[3] : 'monthly') as any;
    const dueDay = cols[4] ? parseInt(cols[4], 10) : 5;
    const category = cols[5] || 'Utilities';
    const sourceName = cols[6]?.toLowerCase();
    const preservedId = cols[7] || `bill-imp-${Date.now()}-${i}`;
    const explicitSourceId = cols[8] || undefined;
    const lastPostedDate = cols[9] || undefined;
    const isOverriddenPaid = cols[10] === 'true';
    const lastOverriddenMonth = cols[11] || undefined;
    const isArchived = cols[12] === 'true';
    const archivedAt = cols[13] || undefined;

    const sourceId =
      explicitSourceId ||
      (sourceName ? accountByName.get(sourceName) || holdings[0]?.id || '' : holdings[0]?.id || '');

    items.push({
      id: preservedId,
      name,
      amount: isNaN(amount) ? 0 : amount,
      currency,
      frequency,
      dueDay: isNaN(dueDay) ? 5 : dueDay,
      category,
      sourceId,
      autoPostPrompt: true,
      ...(lastPostedDate ? { lastPostedDate } : {}),
      ...(isOverriddenPaid ? { isOverriddenPaid: true } : {}),
      ...(lastOverriddenMonth ? { lastOverriddenMonth } : {}),
      ...(isArchived ? { isArchived: true } : {}),
      ...(archivedAt ? { archivedAt } : {}),
    });
  }

  return { items, errors };
}

// 5. GOALS CSV EXPORT & PARSE (Includes completed goals, sources, increments, transaction histories, and full JSON state)
export function exportGoalsToCsv(goals: Goal[], holdings: Holding[] = []): string {
  const holdingMap = new Map(holdings.map((h) => [h.id, h.name]));
  const headers = [
    'id',
    'name',
    'target_amount',
    'currency',
    'accumulated_total',
    'status',
    'priority',
    'deadline',
    'monthly_contribution',
    'sources_allocation_detail',
    'transactions_count',
    'transactions_history',
    'completed_date',
    'payment_tx_id',
    'accumulate_monthly',
    'goal_full_json',
  ];

  const rows = goals.map((g) => {
    const isComp = Boolean(g.isCompleted);
    const sourcesSummary = (g.sources || [])
      .map((s) => {
        const name = holdingMap.get(s.sourceId) || s.sourceId;
        const inc = s.monthlyIncrement ? ` +${s.monthlyIncrement}/mo` : '';
        const amt = s.allocationAmount ? ` (fixed ${s.allocationAmount})` : ` (${s.allocationPct}%)`;
        return `${name}${amt}${inc}`;
      })
      .join('; ');

    const txSummary = (g.transactions || [])
      .map(
        (t) =>
          `${t.date}: ${t.amount} ${g.currency} from ${
            t.sourceAssetName || holdingMap.get(t.sourceAssetId) || 'Asset'
          }`
      )
      .join(' | ');

    return [
      escapeCsvCell(g.id),
      escapeCsvCell(g.name),
      escapeCsvCell(g.cost),
      escapeCsvCell(g.currency),
      escapeCsvCell(g.accumulatedTotal ?? 0),
      escapeCsvCell(isComp ? 'Completed' : 'Active'),
      escapeCsvCell(g.priority || 'mid'),
      escapeCsvCell(g.deadline || ''),
      escapeCsvCell(g.monthlyContribution || ''),
      escapeCsvCell(sourcesSummary),
      escapeCsvCell(g.transactions?.length || 0),
      escapeCsvCell(txSummary),
      escapeCsvCell(g.completedAt || ''),
      escapeCsvCell(g.paymentTxId || ''),
      escapeCsvCell(g.accumulateMonthly !== false ? 'true' : 'false'),
      escapeCsvCell(JSON.stringify(g)),
    ];
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseGoalsCsv(
  csvText: string,
  defaultCurrency: string = 'INR'
): { items: Goal[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Goal[] = [];
  const errors: string[] = [];

  if (lines.length < 2) {
    return { items, errors: [] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;

    // Prefer lossless JSON column if present
    if (cols[15]) {
      try {
        const parsedGoal = JSON.parse(cols[15]) as Goal;
        if (parsedGoal && parsedGoal.name) {
          items.push(parsedGoal);
          continue;
        }
      } catch {}
    }

    const id = cols[0] || `goal-imp-${Date.now()}-${i}`;
    const name = cols[1];
    const cost = parseFloat(cols[2]);
    if (!name || isNaN(cost)) {
      errors.push(`Row ${i + 1}: Invalid goal row`);
      continue;
    }
    const currency = (cols[3] || defaultCurrency).toUpperCase();
    const accumulatedTotal = cols[4] ? parseFloat(cols[4]) : 0;
    const isCompleted = (cols[5] || '').toLowerCase() === 'completed';
    const priority = (['high', 'mid', 'low'].includes(cols[6]) ? cols[6] : 'mid') as any;
    const deadline = cols[7] || undefined;
    const monthlyContribution = cols[8] ? parseFloat(cols[8]) : undefined;
    const completedAt = cols[12] || undefined;
    const paymentTxId = cols[13] || undefined;
    const accumulateMonthly = cols[14] ? cols[14] === 'true' : true;

    items.push({
      id,
      name,
      cost,
      currency,
      accumulatedTotal: isNaN(accumulatedTotal) ? 0 : accumulatedTotal,
      isCompleted,
      priority,
      deadline,
      monthlyContribution: monthlyContribution && !isNaN(monthlyContribution) ? monthlyContribution : undefined,
      sources: [],
      transactions: [],
      completedAt,
      paymentTxId,
      accumulateMonthly,
    });
  }

  return { items, errors };
}

// 6. INCOME STREAMS (SALARY) CSV
export function exportIncomeStreamsToCsv(incomeStreams: IncomeStream[]): string {
  const headers = [
    'id',
    'name',
    'amount_per_period',
    'period',
    'pay_day',
    'pay_schedule_type',
    'deposit_account_id',
    'currency',
    'gross_or_net',
  ];
  const rows = incomeStreams.map((inc) => [
    escapeCsvCell(inc.id),
    escapeCsvCell(inc.name),
    escapeCsvCell(inc.amountPerPeriod),
    escapeCsvCell(inc.period),
    escapeCsvCell(inc.payDay ?? 1),
    escapeCsvCell(inc.payScheduleType ?? 'fixed_day'),
    escapeCsvCell(inc.depositAccountId ?? ''),
    escapeCsvCell(inc.currency),
    escapeCsvCell(inc.grossOrNet ?? 'net'),
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseIncomeStreamsCsv(
  csvText: string,
  defaultCurrency: string = 'INR'
): { items: IncomeStream[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: IncomeStream[] = [];
  const errors: string[] = [];
  if (lines.length < 2) return { items, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;
    const id = cols[0] || `inc-imp-${Date.now()}-${i}`;
    const name = cols[1] || 'Primary Salary';
    const amountPerPeriod = parseFloat(cols[2]);
    if (isNaN(amountPerPeriod)) {
      errors.push(`Row ${i + 1}: Invalid salary amount`);
      continue;
    }
    const period = (['monthly', 'biweekly', 'weekly', 'quarterly', 'yearly'].includes(cols[3])
      ? cols[3]
      : 'monthly') as IncomeStream['period'];
    const payDayParsed = cols[4] ? parseInt(cols[4], 10) : 1;
    const payDay = isNaN(payDayParsed) ? 1 : Math.max(1, Math.min(31, payDayParsed));
    const payScheduleType = (['fixed_day', 'last_working_day', 'last_calendar_day'].includes(cols[5])
      ? cols[5]
      : 'fixed_day') as IncomeStream['payScheduleType'];
    const depositAccountId = cols[6] || undefined;
    const currency = (cols[7] || defaultCurrency).toUpperCase();
    const grossOrNet = (cols[8] === 'gross' ? 'gross' : 'net') as IncomeStream['grossOrNet'];

    items.push({
      id,
      name,
      amountPerPeriod,
      period,
      payDay,
      payScheduleType,
      depositAccountId,
      currency,
      grossOrNet,
    });
  }
  return { items, errors };
}

// 7. CREDIT SCORES CSV
export function exportCreditScoresToCsv(creditScores: CreditScoreRecord[]): string {
  const headers = ['id', 'date', 'score', 'bureau', 'notes'];
  const rows = creditScores.map((cs) => [
    escapeCsvCell(cs.id),
    escapeCsvCell(cs.date),
    escapeCsvCell(cs.score),
    escapeCsvCell(cs.bureau),
    escapeCsvCell(cs.notes ?? ''),
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseCreditScoresCsv(csvText: string): { items: CreditScoreRecord[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: CreditScoreRecord[] = [];
  const errors: string[] = [];
  if (lines.length < 2) return { items, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;
    const id = cols[0] || `score-imp-${Date.now()}-${i}`;
    const date = cols[1] || new Date().toISOString().split('T')[0];
    const score = parseInt(cols[2], 10);
    if (isNaN(score) || score < 300 || score > 900) {
      errors.push(`Row ${i + 1}: Invalid credit score`);
      continue;
    }
    const bureau = cols[3] || 'CIBIL';
    const notes = cols[4] || undefined;
    items.push({ id, date, score, bureau, notes });
  }
  return { items, errors };
}

// 8. PROFILE, AGE, EXPERIENCE, SKILLS & CAREER CSV
export function exportProfileAndCareerToCsv(
  settings: AppSettings,
  careerProfile: CareerProfile
): string {
  const headers = ['field', 'value', 'category'];
  const effectiveAge = careerProfile.age ?? settings.age ?? '';
  const settingsPartial = {
    appName: settings.appName,
    profileName: settings.profileName,
    age: careerProfile.age ?? settings.age,
    baseCurrency: settings.baseCurrency,
    cashFlowBufferAmount: settings.cashFlowBufferAmount,
    minCashCustom: settings.minCashCustom,
    creditUtilizationThresholdPct: settings.creditUtilizationThresholdPct,
    numberGrouping: settings.numberGrouping,
    dateFormat: settings.dateFormat,
    fyStartMonth: settings.fyStartMonth,
  };

  const rows: string[][] = [
    ['profile_name', settings.profileName || '', 'user_profile'],
    ['age', String(effectiveAge), 'user_profile'],
    ['base_currency', settings.baseCurrency || 'INR', 'user_profile'],
    ['current_role', careerProfile.currentRole || '', 'career'],
    ['years_of_experience', String(careerProfile.yearsOfExperience ?? 0), 'career'],
    ['education', careerProfile.education || 'bachelors_tech', 'career'],
    ['educational_major', careerProfile.educationalMajor || '', 'career'],
    ['industry', careerProfile.industry || '', 'career'],
    ['career_goals', careerProfile.careerGoals || '', 'career'],
    ['salary_expectation', String(careerProfile.salaryExpectation ?? ''), 'career'],
    ['target_company_type', careerProfile.targetCompanyType || 'all', 'career'],
    ['technical_skills', (careerProfile.technicalSkills || []).join(' | '), 'skills'],
    ['behavioral_strengths', (careerProfile.behavioralStrengths || []).join(' | '), 'skills'],
    ['weaknesses_or_growth_areas', (careerProfile.weaknessesOrGrowthAreas || []).join(' | '), 'skills'],
    ['previous_salaries_json', JSON.stringify(careerProfile.previousSalaries || []), 'career_history'],
    ['career_transitions_json', JSON.stringify(careerProfile.careerTransitions || []), 'career_history'],
    ['career_profile_full_json', JSON.stringify({ ...careerProfile, age: careerProfile.age ?? settings.age }), 'replication'],
    ['settings_partial_json', JSON.stringify(settingsPartial), 'replication'],
  ];

  return [headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
}

export function parseProfileAndCareerCsv(csvText: string): {
  settingsPartial?: Partial<AppSettings>;
  careerProfile?: CareerProfile;
  errors: string[];
} {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return { errors: [] };

  const kv: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length >= 2 && cols[0]) {
      kv[cols[0]] = cols[1];
    }
  }

  let settingsPartial: Partial<AppSettings> = {};
  if (kv['settings_partial_json']) {
    try {
      settingsPartial = JSON.parse(kv['settings_partial_json']);
    } catch {}
  } else {
    if (kv['profile_name']) settingsPartial.profileName = kv['profile_name'];
    if (kv['age'] && !isNaN(parseFloat(kv['age']))) settingsPartial.age = parseFloat(kv['age']);
    if (kv['base_currency']) settingsPartial.baseCurrency = kv['base_currency'];
  }

  let careerProfile: CareerProfile | undefined;
  if (kv['career_profile_full_json']) {
    try {
      careerProfile = JSON.parse(kv['career_profile_full_json']);
    } catch {}
  }

  if (!careerProfile && Object.keys(kv).length > 0) {
    let prevSalaries: any[] = [];
    let transitions: any[] = [];
    try {
      if (kv['previous_salaries_json']) prevSalaries = JSON.parse(kv['previous_salaries_json']);
    } catch {}
    try {
      if (kv['career_transitions_json']) transitions = JSON.parse(kv['career_transitions_json']);
    } catch {}

    careerProfile = {
      currentRole: kv['current_role'] || '',
      yearsOfExperience: kv['years_of_experience'] ? parseFloat(kv['years_of_experience']) || 0 : 0,
      age: kv['age'] && !isNaN(parseFloat(kv['age'])) ? parseFloat(kv['age']) : undefined,
      education: (kv['education'] as any) || 'bachelors_tech',
      educationalMajor: kv['educational_major'] || undefined,
      industry: kv['industry'] || '',
      careerGoals: kv['career_goals'] || undefined,
      salaryExpectation: kv['salary_expectation'] ? parseFloat(kv['salary_expectation']) : undefined,
      targetCompanyType: (kv['target_company_type'] as any) || 'all',
      technicalSkills: kv['technical_skills']
        ? kv['technical_skills'].split('|').map((s) => s.trim()).filter(Boolean)
        : [],
      behavioralStrengths: kv['behavioral_strengths']
        ? kv['behavioral_strengths'].split('|').map((s) => s.trim()).filter(Boolean)
        : [],
      weaknessesOrGrowthAreas: kv['weaknesses_or_growth_areas']
        ? kv['weaknesses_or_growth_areas'].split('|').map((s) => s.trim()).filter(Boolean)
        : [],
      previousSalaries: prevSalaries,
      careerTransitions: transitions,
    };
  }

  return { settingsPartial, careerProfile, errors: [] };
}

// 9. ML MODELS, WEIGHTS, BIASES & HALF-PREDICTIONS CSV
export function exportMLStateToCsv(mlBundle: FullMLReplicationState): string {
  const headers = ['model_domain', 'parameter', 'value', 'notes'];
  const online = mlBundle.onlineSpendIncomeState;
  const cw = mlBundle.careerModelWeights;
  const crw = mlBundle.creditModelWeights || {};
  const snap = mlBundle.halfPredictionsSnapshot;

  const rows: string[][] = [
    ['credit_ml', 'predicted_score', String(snap?.creditPrediction?.predictedScore ?? ''), 'Current predicted credit score'],
    ['credit_ml', 'bias_intercept', String(crw.bias ?? ''), 'Learned credit score intercept'],
    ['credit_ml', 'utilization_weight', String(crw.utilizationWeight ?? ''), 'Learned credit utilization slope'],
    ['career_ml', 'base_intercept', String(cw?.baseIntercept ?? ''), 'Learned compensation intercept'],
    ['career_ml', 'experience_coeff', String(cw?.experienceCoeff ?? ''), 'Learned experience slope'],
    ['career_ml', 'mnc_increment_bias', String(cw?.mncIncrementBias ?? 0), 'MNC reality vs prediction bias'],
    ['career_ml', 'startup_increment_bias', String(cw?.startupIncrementBias ?? 0), 'Startup reality vs prediction bias'],
    ['career_ml', 'tune_iterations', String(cw?.tuneIterations ?? 0), 'Total reality/feedback calibrations'],
    ['online_learner', 'spend_forecast_bias', String(online?.spendForecastBias ?? 1.0), 'Learned monthly spend bias'],
    ['online_learner', 'monthly_spend_baseline_ema', String(online?.monthlySpendBaselineEma ?? 0), 'EMA monthly spend baseline'],
    ['online_learner', 'essential_spend_ema', String(online?.essentialSpendEma ?? 0), 'EMA monthly essential spend'],
    ['online_learner', 'annual_salary_ema', String(online?.annualSalaryEma ?? 0), 'EMA annual salary run-rate'],
    ['online_learner', 'salary_growth_rate_ema', String(online?.salaryGrowthRateEma ?? 0), 'EMA observed salary jump rate'],
    ['half_predictions', 'observed_month_key', String(online?.halfPredictions?.observedMonthKey ?? ''), 'Partial month key'],
    ['half_predictions', 'month_elapsed_fraction', String(online?.halfPredictions?.monthElapsedFraction ?? ''), 'Elapsed fraction of month'],
    ['half_predictions', 'partial_month_observed_spend', String(online?.halfPredictions?.partialMonthObservedSpendBase ?? 0), 'Observed spend so far this month'],
    ['half_predictions', 'projected_full_month_spend', String(online?.halfPredictions?.projectedFullMonthSpendBase ?? 0), 'Half-month blended full-month forecast'],
    ['half_predictions', 'projected_remaining_month_spend', String(online?.halfPredictions?.projectedRemainingMonthSpendBase ?? 0), 'Remaining spend expected this month'],
    ['half_predictions', 'next_month_spend_estimate', String(online?.halfPredictions?.nextMonthSpendEstimateBase ?? 0), 'Next cycle spend forecast'],
    ['half_predictions', 'predicted_possible_bills_total', String(snap?.predictedBills?.totalPredictedAmountBase ?? 0), 'ML predicted upcoming bills'],
    ['closed_loop_ml', 'active_strategy', String(mlBundle.closedLoopMLState?.activeStrategy ?? 'direct_cost_impact'), 'Active adaptive communication strategy'],
    ['closed_loop_ml', 'total_reality_audits', String(mlBundle.closedLoopMLState?.totalRealityAudits ?? 0), 'Total ledger vs prediction audits'],
    ['replication', 'full_ml_replication_bundle_json', JSON.stringify(mlBundle), 'Lossless continuation state for all ML models and half-predictions'],
  ];

  return [headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
}

export function parseMLStateCsv(csvText: string): {
  mlBundle?: FullMLReplicationState;
  errors: string[];
} {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return { errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length >= 3 && cols[1] === 'full_ml_replication_bundle_json' && cols[2]) {
      try {
        const mlBundle = JSON.parse(cols[2]) as FullMLReplicationState;
        return { mlBundle, errors: [] };
      } catch (e) {
        return { errors: ['Failed to parse embedded ML replication JSON cell'] };
      }
    }
  }
  return { errors: [] };
}

// 9B. RECEIVABLES & PERSONAL LOANS / PEER BALANCES CSV (Includes active and settled/archived records)
export function exportReceivablesToCsv(receivables: Receivable[]): string {
  const headers = [
    'id',
    'debtor_name',
    'confidence_pct',
    'principal_amount',
    'disbursed_amount',
    'transfer_fee_amount',
    'outstanding_amount',
    'currency',
    'issue_date',
    'expected_date',
    'status',
    'interest_rate_pct',
    'funding_source_id',
    'broker_name',
    'fee_mode',
    'fee_pct',
    'fee_per_unit_amount',
    'fee_unit_size',
    'pass_fee_to_borrower',
    'notes',
    'direction',
    'is_archived',
    'actual_date',
    'receivable_full_json',
  ];

  const rows = receivables.map((r) => [
    escapeCsvCell(r.id),
    escapeCsvCell(r.debtorName),
    escapeCsvCell(r.confidencePct ?? 85),
    escapeCsvCell(r.principalAmount),
    escapeCsvCell(r.disbursedAmount ?? r.principalAmount),
    escapeCsvCell(r.transferFeeAmount ?? 0),
    escapeCsvCell(r.outstandingAmount),
    escapeCsvCell(r.currency),
    escapeCsvCell(r.issueDate),
    escapeCsvCell(r.expectedDate ?? ''),
    escapeCsvCell(r.status),
    escapeCsvCell(r.interestRatePct ?? 0),
    escapeCsvCell(r.fundingSourceId ?? ''),
    escapeCsvCell(r.brokerName ?? ''),
    escapeCsvCell(r.feeMode ?? ''),
    escapeCsvCell(r.feePct ?? ''),
    escapeCsvCell(r.feePerUnitAmount ?? ''),
    escapeCsvCell(r.feeUnitSize ?? ''),
    escapeCsvCell(r.passFeeToBorrower !== false ? 'true' : 'false'),
    escapeCsvCell(r.notes ?? ''),
    escapeCsvCell(r.direction || 'lent'),
    escapeCsvCell(r.isArchived ? 'true' : 'false'),
    escapeCsvCell(r.actualDate ?? ''),
    escapeCsvCell(JSON.stringify(r)),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function parseReceivablesCsv(
  csvText: string,
  defaultCurrency: string = 'INR'
): { items: Receivable[]; errors: string[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const items: Receivable[] = [];
  const errors: string[] = [];
  if (lines.length < 2) return { items, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 4) continue;

    // Support both legacy 21-column JSON cell and 24-column JSON cell
    for (const jsonColIdx of [23, 20, 21]) {
      if (cols[jsonColIdx] && cols[jsonColIdx].startsWith('{')) {
        try {
          const parsedRec = JSON.parse(cols[jsonColIdx]) as Receivable;
          if (parsedRec && parsedRec.debtorName) {
            items.push(parsedRec);
            cols.length = 0; // mark handled
            break;
          }
        } catch {}
      }
    }
    if (cols.length === 0) continue;

    const id = cols[0] || `rec-imp-${Date.now()}-${i}`;
    const debtorName = cols[1];
    const confidenceParsed = cols[2] ? parseFloat(cols[2]) : 85;
    const confidencePct = isNaN(confidenceParsed) ? 85 : Math.min(100, Math.max(0, confidenceParsed));
    const principalAmount = parseFloat(cols[3]);
    if (!debtorName || isNaN(principalAmount)) {
      errors.push(`Row ${i + 1}: Invalid receivable row`);
      continue;
    }
    const disbursedAmount = cols[4] ? parseFloat(cols[4]) : principalAmount;
    const transferFeeAmount = cols[5] ? parseFloat(cols[5]) : 0;
    const outstandingAmount = cols[6] ? parseFloat(cols[6]) : principalAmount;
    const currency = (cols[7] || defaultCurrency).toUpperCase();
    const issueDate = cols[8] || new Date().toISOString().split('T')[0];
    const expectedDate = cols[9] || undefined;
    const status = (
      ['active', 'partially_collected', 'collected', 'overdue', 'written_off'].includes(cols[10])
        ? cols[10]
        : 'active'
    ) as Receivable['status'];
    const interestRatePct = cols[11] ? parseFloat(cols[11]) : 0;
    const fundingSourceId = cols[12] || undefined;
    const brokerName = cols[13] || undefined;
    const feeMode = (['none', 'percent', 'per_unit', 'flat'].includes(cols[14]) ? cols[14] : undefined) as Receivable['feeMode'];
    const feePct = cols[15] ? parseFloat(cols[15]) : undefined;
    const feePerUnitAmount = cols[16] ? parseFloat(cols[16]) : undefined;
    const feeUnitSize = cols[17] ? parseFloat(cols[17]) : undefined;
    const passFeeToBorrower = cols[18] ? cols[18] === 'true' : true;
    const notes = cols[19] || undefined;
    const direction = cols[20] === 'borrowed' ? 'borrowed' : 'lent';
    const isArchived = cols[21] === 'true' || status === 'collected' || status === 'written_off';
    const actualDate = cols[22] || undefined;

    items.push({
      id,
      debtorName,
      confidencePct,
      principalAmount,
      disbursedAmount: isNaN(disbursedAmount) ? principalAmount : disbursedAmount,
      transferFeeAmount: isNaN(transferFeeAmount) ? 0 : transferFeeAmount,
      outstandingAmount: isNaN(outstandingAmount) ? principalAmount : outstandingAmount,
      currency,
      issueDate,
      expectedDate,
      actualDate,
      status,
      interestRatePct: isNaN(interestRatePct) ? 0 : interestRatePct,
      fundingSourceId,
      brokerName,
      feeMode,
      direction,
      isArchived,
      ...(feePct !== undefined && !isNaN(feePct) ? { feePct } : {}),
      ...(feePerUnitAmount !== undefined && !isNaN(feePerUnitAmount) ? { feePerUnitAmount } : {}),
      ...(feeUnitSize !== undefined && !isNaN(feeUnitSize) ? { feeUnitSize } : {}),
      passFeeToBorrower,
      repayments: [],
      notes,
    });
  }

  return { items, errors };
}

// 10. MASTER ALL-IN-ONE DATA FILE (Contains every financial table, receivables, profile/career/skills/age, and ML models + half-predictions)
export function exportMasterCsv(
  holdings: Holding[],
  assetTypes: AssetType[],
  liabilities: Liability[],
  transactions: Transaction[],
  bills: Bill[],
  goals: Goal[] = [],
  extra?: {
    incomeStreams?: IncomeStream[];
    creditScores?: CreditScoreRecord[];
    receivables?: Receivable[];
    settings?: AppSettings;
    careerProfile?: CareerProfile;
    mlBundle?: FullMLReplicationState;
  }
): string {
  const holdingsCsv = exportHoldingsToCsv(holdings, assetTypes);
  const liabilitiesCsv = exportLiabilitiesToCsv(liabilities);
  const transactionsCsv = exportTransactionsToCsv(transactions, holdings, liabilities);
  const billsCsv = exportBillsToCsv(bills, holdings, liabilities);
  const goalsCsv = exportGoalsToCsv(goals, holdings);
  const incomeCsv = exportIncomeStreamsToCsv(extra?.incomeStreams || []);
  const scoresCsv = exportCreditScoresToCsv(extra?.creditScores || []);
  const receivablesCsv = exportReceivablesToCsv(extra?.receivables || []);
  const profileCsv =
    extra?.settings && extra?.careerProfile
      ? exportProfileAndCareerToCsv(extra.settings, extra.careerProfile)
      : 'field,value,category';
  const mlCsv = extra?.mlBundle
    ? exportMLStateToCsv(extra.mlBundle)
    : 'model_domain,parameter,value,notes';

  return [
    '# ========================================================',
    '# NETWORTHIQ UNIFIED MASTER REPLICATION FILE (CSV) — SCHEMA v4',
    '# Schema Version: 4',
    `# Exported: ${new Date().toISOString()}`,
    '# Includes Holdings, Liabilities, Transactions, Bills, Goals, Salary Streams, Credit Scores, Receivables, Profile/Skills/Age/Experience, and ML Models & Half-Predictions',
    '# ========================================================',
    '',
    '### SECTION: HOLDINGS',
    holdingsCsv,
    '',
    '### SECTION: LIABILITIES',
    liabilitiesCsv,
    '',
    '### SECTION: TRANSACTIONS',
    transactionsCsv,
    '',
    '### SECTION: BILLS',
    billsCsv,
    '',
    '### SECTION: GOALS',
    goalsCsv,
    '',
    '### SECTION: INCOME_STREAMS',
    incomeCsv,
    '',
    '### SECTION: CREDIT_SCORES',
    scoresCsv,
    '',
    '### SECTION: RECEIVABLES',
    receivablesCsv,
    '',
    '### SECTION: PROFILE_AND_CAREER',
    profileCsv,
    '',
    '### SECTION: ML_MODELS_AND_HALF_PREDICTIONS',
    mlCsv,
    '',
  ].join('\n');
}

export function parseMasterCsv(
  masterText: string,
  assetTypes: AssetType[],
  existingHoldings: Holding[] = [],
  existingLiabilities: Liability[] = [],
  defaultCurrency: string = 'INR'
): {
  holdings: Holding[];
  liabilities: Liability[];
  transactions: Transaction[];
  bills: Bill[];
  goals: Goal[];
  incomeStreams: IncomeStream[];
  creditScores: CreditScoreRecord[];
  receivables: Receivable[];
  settingsPartial?: Partial<AppSettings>;
  careerProfile?: CareerProfile;
  mlBundle?: FullMLReplicationState;
  errors: string[];
} {
  const sections: Record<string, string[]> = {
    HOLDINGS: [],
    LIABILITIES: [],
    TRANSACTIONS: [],
    BILLS: [],
    GOALS: [],
    INCOME_STREAMS: [],
    CREDIT_SCORES: [],
    RECEIVABLES: [],
    PROFILE_AND_CAREER: [],
    ML_MODELS_AND_HALF_PREDICTIONS: [],
  };

  let currentSection = '';
  const lines = masterText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && !trimmed.startsWith('### SECTION:')) {
      continue;
    }
    if (trimmed.startsWith('### SECTION:')) {
      const secName = trimmed.replace('### SECTION:', '').trim().toUpperCase();
      currentSection = secName;
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }
    if (currentSection && sections[currentSection] !== undefined) {
      sections[currentSection].push(line);
    }
  }

  const allErrors: string[] = [];

  const hText = sections['HOLDINGS'].join('\n').trim();
  const parsedHoldings = hText ? parseHoldingsCsv(hText, assetTypes, defaultCurrency) : { items: [], errors: [] };
  allErrors.push(...parsedHoldings.errors.map((e) => `[Holdings] ${e}`));

  const combinedHoldings = [...existingHoldings, ...parsedHoldings.items];

  const lText = sections['LIABILITIES'].join('\n').trim();
  const parsedLiabilities = lText ? parseLiabilitiesCsv(lText, defaultCurrency) : { items: [], errors: [] };
  allErrors.push(...parsedLiabilities.errors.map((e) => `[Liabilities] ${e}`));

  const combinedLiabilities = [...existingLiabilities, ...parsedLiabilities.items];

  const tText = sections['TRANSACTIONS'].join('\n').trim();
  const parsedTxs = tText
    ? parseTransactionsCsv(tText, combinedHoldings, combinedLiabilities, defaultCurrency)
    : { items: [], errors: [] };
  allErrors.push(...parsedTxs.errors.map((e) => `[Transactions] ${e}`));

  const bText = sections['BILLS'].join('\n').trim();
  const parsedBills = bText
    ? parseBillsCsv(bText, combinedHoldings, combinedLiabilities, defaultCurrency)
    : { items: [], errors: [] };
  allErrors.push(...parsedBills.errors.map((e) => `[Bills] ${e}`));

  const gText = sections['GOALS'].join('\n').trim();
  const parsedGoals = gText ? parseGoalsCsv(gText, defaultCurrency) : { items: [], errors: [] };
  allErrors.push(...parsedGoals.errors.map((e) => `[Goals] ${e}`));

  const incText = sections['INCOME_STREAMS'].join('\n').trim();
  const parsedInc = incText ? parseIncomeStreamsCsv(incText, defaultCurrency) : { items: [], errors: [] };
  allErrors.push(...parsedInc.errors.map((e) => `[Income] ${e}`));

  const csText = sections['CREDIT_SCORES'].join('\n').trim();
  const parsedScores = csText ? parseCreditScoresCsv(csText) : { items: [], errors: [] };
  allErrors.push(...parsedScores.errors.map((e) => `[Credit Scores] ${e}`));

  const recText = sections['RECEIVABLES'].join('\n').trim();
  const parsedReceivables = recText
    ? parseReceivablesCsv(recText, defaultCurrency)
    : { items: [], errors: [] };
  allErrors.push(...parsedReceivables.errors.map((e) => `[Receivables] ${e}`));

  const profText = sections['PROFILE_AND_CAREER'].join('\n').trim();
  const parsedProf = profText ? parseProfileAndCareerCsv(profText) : { errors: [] };
  allErrors.push(...parsedProf.errors.map((e) => `[Profile] ${e}`));

  const mlText = sections['ML_MODELS_AND_HALF_PREDICTIONS'].join('\n').trim();
  const parsedMl = mlText ? parseMLStateCsv(mlText) : { errors: [] };
  allErrors.push(...parsedMl.errors.map((e) => `[ML State] ${e}`));

  return {
    holdings: parsedHoldings.items,
    liabilities: parsedLiabilities.items,
    transactions: parsedTxs.items,
    bills: parsedBills.items,
    goals: parsedGoals.items,
    incomeStreams: parsedInc.items,
    creditScores: parsedScores.items,
    receivables: parsedReceivables.items,
    settingsPartial: parsedProf.settingsPartial,
    careerProfile: parsedProf.careerProfile,
    mlBundle: parsedMl.mlBundle,
    errors: allErrors,
  };
}

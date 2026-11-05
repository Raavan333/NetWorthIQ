/**
 * High-precision, decimal-safe financial mathematics, validation, and reconciliation engine.
 * Protects NetWorthIQ from IEEE-754 precision drift, invalid records, and balance discrepancies.
 */

import { Holding, Transaction } from '../types';

export type ProvenanceSource = 'user_entered' | 'imported' | 'calculated' | 'estimated' | 'verified';

export interface DataProvenance {
  source: ProvenanceSource;
  timestamp: string;
  modifiedAt?: string;
  notes?: string;
  version?: number;
}

/**
 * Decimal-safe rounding for monetary values (default 2 decimal places, or up to 6 for crypto/units)
 */
export function roundCurrency(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Safe addition of multiple numbers avoiding float rounding drift
 */
export function safeAdd(...nums: number[]): number {
  const sum = nums.reduce((acc, n) => {
    const val = Number.isFinite(n) ? n : 0;
    return acc + Math.round((val + Number.EPSILON) * 100);
  }, 0);
  return sum / 100;
}

/**
 * Safe subtraction (a - b)
 */
export function safeSub(a: number, b: number): number {
  const vA = Number.isFinite(a) ? a : 0;
  const vB = Number.isFinite(b) ? b : 0;
  return (Math.round((vA + Number.EPSILON) * 100) - Math.round((vB + Number.EPSILON) * 100)) / 100;
}

/**
 * Safe multiplication (a * b)
 */
export function safeMul(a: number, b: number, decimals: number = 2): number {
  const vA = Number.isFinite(a) ? a : 0;
  const vB = Number.isFinite(b) ? b : 0;
  return roundCurrency(vA * vB, decimals);
}

/**
 * Safe division (a / b) with division by zero guard
 */
export function safeDiv(a: number, b: number, fallback: number = 0, decimals: number = 4): number {
  const vA = Number.isFinite(a) ? a : 0;
  const vB = Number.isFinite(b) ? b : 0;
  if (Math.abs(vB) < 1e-9) return fallback;
  return roundCurrency(vA / vB, decimals);
}

/**
 * Standard factory for creating DataProvenance metadata.
 * Streamlines provenance footprint for petty/micro spends (< 500) without notes,
 * while retaining comprehensive audit trail metadata for high-value transactions and loans.
 */
export function createProvenance(
  source: ProvenanceSource = 'user_entered',
  notes?: string,
  amount?: number
): DataProvenance {
  if (typeof amount === 'number' && amount < 500 && !notes) {
    return {
      source,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    source,
    timestamp: new Date().toISOString(),
    notes,
    version: 1,
  };
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates monetary amount
 */
export function validateMonetaryAmount(amount: number, fieldName: string = 'Amount', allowNegative: boolean = false): ValidationResult {
  const errors: string[] = [];
  if (typeof amount !== 'number' || isNaN(amount) || !Number.isFinite(amount)) {
    errors.push(`${fieldName} must be a valid finite number.`);
  } else if (!allowNegative && amount < 0) {
    errors.push(`${fieldName} cannot be negative.`);
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates ISO date format YYYY-MM-DD
 */
export function validateDateString(dateStr: string, fieldName: string = 'Date'): ValidationResult {
  const errors: string[] = [];
  if (!dateStr || typeof dateStr !== 'string') {
    errors.push(`${fieldName} is required.`);
    return { isValid: false, errors };
  }
  const match = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) {
    errors.push(`${fieldName} must be in YYYY-MM-DD format.`);
  } else {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      errors.push(`${fieldName} represents an invalid calendar date.`);
    }
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates Currency Code
 */
export function validateCurrencyCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  return /^[A-Z]{3}$/.test(code.trim().toUpperCase());
}

/**
 * Reconciles an account holding's balance against historical transaction ledger.
 * This audits whether recorded deposits, spends, and transfers match the current balance,
 * flagging unrecorded transactions or drift without silently overwriting actual bank balances.
 */
export interface HoldingReconciliationReport {
  holdingId: string;
  holdingName: string;
  currentBalance: number;
  recordedInflows: number;
  recordedOutflows: number;
  netLedgerFlow: number;
  discrepancy: number; // currentBalance - netLedgerFlow
  isReconciled: boolean;
  status: 'exact' | 'has_untracked_drift' | 'untracked_opening_balance';
  message: string;
}

export function reconcileHolding(holding: Holding, transactions: Transaction[]): HoldingReconciliationReport {
  let inflows = 0;
  let outflows = 0;

  for (const tx of transactions) {
    const amt = tx.amount || 0;
    // Check if tx increases this holding
    if (tx.toId === holding.id || (tx.kind === 'income' && tx.toId === holding.id)) {
      inflows = safeAdd(inflows, amt);
    }
    // Check if tx decreases this holding
    if (
      tx.fromId === holding.id ||
      tx.sourceId === holding.id ||
      (tx.kind === 'spend' && (tx.fromId === holding.id || tx.sourceId === holding.id))
    ) {
      outflows = safeAdd(outflows, amt);
    }
  }

  const netFlow = safeSub(inflows, outflows);
  const curVal = holding.principalOrValue || 0;
  const discrepancy = safeSub(curVal, netFlow);

  let status: HoldingReconciliationReport['status'] = 'exact';
  let message = 'Ledger and balance are synchronized.';

  if (Math.abs(discrepancy) > 1) {
    if (transactions.length === 0) {
      status = 'untracked_opening_balance';
      message = `Account has an initial balance of ${curVal} without prior transactions logged.`;
    } else {
      status = 'has_untracked_drift';
      message = `Difference of ${discrepancy > 0 ? '+' : ''}${discrepancy} between current balance and net ledger activity.`;
    }
  }

  return {
    holdingId: holding.id,
    holdingName: holding.name,
    currentBalance: curVal,
    recordedInflows: inflows,
    recordedOutflows: outflows,
    netLedgerFlow: netFlow,
    discrepancy,
    isReconciled: Math.abs(discrepancy) <= 1,
    status,
    message,
  };
}

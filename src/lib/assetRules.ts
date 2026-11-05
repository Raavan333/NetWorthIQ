import { AssetType, Holding, Liability } from '../types';
import { getHoldingLocalValue } from './calcEngine';

/**
 * Institutional Asset & Liability Classification Rules
 *
 * Enforces strict separation between:
 * 1. Spendable liquid cash/bank accounts (positive balances can settle bills and fund goals)
 * 2. Locked & market-linked holdings (FD, RD, Stocks, Bonds, Mutual Funds, P2P) — NEVER directly spendable on bills or goals
 * 3. Credit / Hybrid card facilities — Credit lines can settle non-debt bills, NEVER debt bills ("not killing a bill with another bill") and NEVER counted toward goals.
 */

export function resolveAssetTypeLabel(holding: Holding, assetTypes?: AssetType[]): string {
  const matched = assetTypes?.find((t) => t.id === holding.typeId);
  if (matched?.name) return matched.name;
  if (holding.customCategory?.trim()) return holding.customCategory.trim();
  const tid = (holding.typeId || '').toLowerCase();
  if (tid.includes('bank')) return 'Bank Account';
  if (tid.includes('cash')) return 'Cash in Hand';
  if (tid.includes('fd')) return 'Fixed Deposit';
  if (tid.includes('rd')) return 'Recurring Deposit';
  if (tid.includes('mf')) return 'Mutual Fund';
  if (tid.includes('stock')) return 'Equities';
  if (tid.includes('bond')) return 'Bond';
  return 'Asset';
}

export function isFixedOrRecurringDeposit(holding: Holding, assetTypes?: AssetType[]): boolean {
  if (Boolean(holding.isSweepIn)) return true;
  const tid = (holding.typeId || '').toLowerCase();
  const tName = (assetTypes?.find((t) => t.id === holding.typeId)?.name || '').toLowerCase();
  const hName = (holding.name || '').toLowerCase();
  const cat = (holding.customCategory || '').toLowerCase();

  if (
    tid === 'type-fd' ||
    tid === 'type-rd' ||
    tid.includes('fd') ||
    tid.includes('rd') ||
    tid.includes('deposit') ||
    tName.includes('fixed deposit') ||
    tName.includes('recurring deposit') ||
    /\bfd\b/.test(tName) ||
    /\brd\b/.test(tName) ||
    cat.includes('deposit') ||
    Boolean(holding.maturityDate && holding.fixedRatePct !== undefined && tid !== 'type-bank')
  ) {
    return true;
  }

  if ((/\bfd\b/.test(hName) || /\brd\b/.test(hName)) && tid !== 'type-bank') {
    return true;
  }

  return false;
}

/**
 * Returns true if the holding is a locked deposit or market investment
 * (FD, Sweep-In FD, RD, Stocks, Bonds, Mutual Funds, ETFs, Gold, Crypto, P2P, Real Estate, etc.).
 * Note: Sweep-In FDs are locked deposits that cannot be picked directly as a bill payment account;
 * instead, they auto-redeem in LIFO order through their linked bank account when needed.
 */
export function isLockedOrMarketAsset(holding: Holding, assetTypes?: AssetType[]): boolean {
  if (isFixedOrRecurringDeposit(holding, assetTypes)) return true;
  if (holding.units !== undefined && holding.units > 0) return true;
  if (holding.liquidityClass === 'Locked' || holding.liquidityClass === 'Short') return true;

  const tid = (holding.typeId || '').toLowerCase();
  const matched = assetTypes?.find((t) => t.id === holding.typeId);
  const tName = (matched?.name || '').toLowerCase();
  const tCat = (matched?.category || holding.customCategory || '').toLowerCase();

  const lockedKeywords = [
    'stock',
    'equity',
    'equities',
    'share',
    'mutual',
    'type-mf',
    'etf',
    'index',
    'bond',
    'debenture',
    'gilt',
    'treasury',
    'p2p',
    'lending',
    'ppf',
    'epf',
    'nps',
    'provident',
    'gold',
    'silver',
    'crypto',
    'real estate',
    'property',
  ];

  for (const kw of lockedKeywords) {
    if (tid.includes(kw) || tName.includes(kw) || tCat.includes(kw)) {
      return true;
    }
  }

  return false;
}

export function isCashHolding(holding: Holding, assetTypes?: AssetType[]): boolean {
  const tid = (holding.typeId || '').toLowerCase();
  const matched = assetTypes?.find((t) => t.id === holding.typeId);
  const tName = (matched?.name || '').toLowerCase();
  const hName = (holding.name || '').toLowerCase();
  return (
    tid === 'type-cash' ||
    tid === 'type-cash-hand' ||
    tid.includes('cash') ||
    tName.includes('cash') ||
    hName.includes('cash') ||
    Boolean(holding.withdrawnFromSourceId)
  );
}

/**
 * Returns true if the holding is a Bank / Checking / Savings / Salary / Current account
 * eligible to fund Fixed Deposits, link Debit/Hybrid cards, or receive Sweep-In/Maturity settlements.
 */
export function isBankAccountHolding(holding: Holding, assetTypes?: AssetType[]): boolean {
  if (isLockedOrMarketAsset(holding, assetTypes)) return false;
  const tid = (holding.typeId || '').toLowerCase();
  const matched = assetTypes?.find((t) => t.id === holding.typeId);
  const tName = (matched?.name || '').toLowerCase();
  const hName = (holding.name || '').toLowerCase();

  // Exclude physical cash in hand from bank-only rails (FD creation, Debit/Hybrid card link)
  const isHandCash = isCashHolding(holding, assetTypes);

  if (isHandCash) return false;

  if (
    tid === 'type-bank' ||
    tid.includes('bank') ||
    tid.includes('saving') ||
    tid.includes('current') ||
    tid.includes('checking') ||
    tName.includes('bank') ||
    tName.includes('saving') ||
    tName.includes('current') ||
    tName.includes('salary') ||
    hName.includes('bank') ||
    hName.includes('saving') ||
    holding.liquidityClass === 'Immediate'
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true if the holding is an unlocked liquid cash/bank/wallet account
 * (excludes all locked & market assets: FD, RD, Stocks, Bonds, Mutual Funds, P2P).
 */
export function isSpendableLiquidHolding(holding: Holding, assetTypes?: AssetType[]): boolean {
  if (isLockedOrMarketAsset(holding, assetTypes)) return false;
  return holding.liquidityClass === 'Immediate' || isBankAccountHolding(holding, assetTypes) || (holding.typeId || '').includes('cash');
}

/**
 * Returns true if the holding is an unlocked liquid cash/bank account with a strictly positive (> 0) balance.
 */
export function isPositiveLiquidHolding(holding: Holding, assetTypes?: AssetType[]): boolean {
  return isSpendableLiquidHolding(holding, assetTypes) && getHoldingLocalValue(holding) > 0;
}

/**
 * Returns a clean, unambiguous, professional display name for any asset holding,
 * ensuring dropdowns and selectors never render blank or unnamed items.
 */
export function getSafeAssetName(holding?: Holding | null, assetTypes?: AssetType[]): string {
  if (!holding) return 'Unnamed Account';
  const trimmed = (holding.name || '').trim();
  if (trimmed.length > 0) return trimmed;
  return `${resolveAssetTypeLabel(holding, assetTypes)} (${holding.currency || 'INR'})`;
}

/**
 * Returns a clean, unambiguous, professional display name for any liability/card.
 */
export function getSafeLiabilityName(liability?: Liability | null): string {
  if (!liability) return 'Unnamed Liability';
  const trimmed = (liability.name || '').trim();
  if (trimmed.length > 0) return trimmed;
  if (liability.kind === 'loan') return `Loan (${liability.currency || 'INR'})`;
  if (liability.cardType === 'debit') return `Debit Card (${liability.currency || 'INR'})`;
  if (liability.cardType === 'hybrid') return `Hybrid Card (${liability.currency || 'INR'})`;
  return `Credit Card (${liability.currency || 'INR'})`;
}

/**
 * Formats an asset option label cleanly for `<select>` controls so the asset name always leads first.
 */
export function formatAssetOptionLabel(
  holding: Holding,
  assetTypes?: AssetType[],
  options?: { currSymbol?: string; sweepInAmount?: number; showType?: boolean }
): string {
  const name = getSafeAssetName(holding, assetTypes);
  const typeLabel = resolveAssetTypeLabel(holding, assetTypes);
  const bal = getHoldingLocalValue(holding);
  const sym = options?.currSymbol || `${holding.currency} `;
  const formattedBal = `${sym}${bal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const sweepSuffix =
    options?.sweepInAmount && options.sweepInAmount > 0
      ? ` + ${sym}${options.sweepInAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} Sweep-In`
      : '';
  const typePart = options?.showType !== false ? ` · ${typeLabel}` : '';
  return `${name}${typePart} — Avail: ${formattedBal}${sweepSuffix}`;
}

/**
 * Formats a card/liability option label cleanly for `<select>` controls so the card/liability name leads first.
 */
export function formatCardOptionLabel(
  card: Liability,
  effectiveMode: 'credit' | 'debit',
  currSymbol?: string
): string {
  const name = getSafeLiabilityName(card);
  const sym = currSymbol || `${card.currency} `;
  const limit = card.creditLimit || card.limit || 0;
  const availCredit = Math.max(0, limit - (card.outstanding || 0));

  if (card.cardType === 'hybrid') {
    if (effectiveMode === 'debit') {
      return `${name} · Hybrid Card (Debit Active) — Credit Backup: ${sym}${availCredit.toLocaleString()}`;
    }
    return `${name} · Hybrid Card (Credit Mode) — Avail Credit: ${sym}${availCredit.toLocaleString()}`;
  }

  if (card.cardType === 'debit') {
    return `${name} · Debit Card`;
  }

  return `${name} · Credit Card — Avail Credit: ${sym}${availCredit.toLocaleString()}`;
}

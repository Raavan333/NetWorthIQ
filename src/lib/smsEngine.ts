/**
 * Standalone On-Device SMS Signal-to-Noise Filter, Deterministic Parser,
 * Incremental Account/Card/Loan Router, Balance Discrepancy Verifier,
 * Strict 5-Minute Deduplicator & Co-Learning ML Engine.
 *
 * 100% Offline & On-Device: Zero network calls, zero external telemetry.
 */

import {
  Holding,
  Liability,
  SmsBalanceDiscrepancy,
  SmsFlagReason,
  SmsParsedTxKind,
  SmsPaymentMode,
  SmsRuleOverride,
  SmsSuggestedReason,
  SpendCategoryConfig,
  StagedSmsItem,
  Transaction,
} from '../types';
import { suggestCategoryFromDescription } from './categorySuggester';
import { roundCurrency, createProvenance } from './financialMath';
import { executeTransactionReversal, ReversalResult } from './reversalEngine';
import { computeSmsFingerprint } from './smsSyncRegistry';

export const SMS_STRICT_DUPLICATE_WINDOW_MINUTES = 5;
export const SMS_STRICT_DUPLICATE_WINDOW_MS = SMS_STRICT_DUPLICATE_WINDOW_MINUTES * 60 * 1000;

export type SmsDropCategory =
  | 'empty'
  | 'otp_or_auth'
  | 'promotional_spam'
  | 'passive_balance_or_statement'
  | 'missing_financial_trigger'
  | 'unparseable_amount';

export interface SmsFilterClassification {
  passed: boolean;
  dropCategory?: SmsDropCategory;
  reason: string;
  matchedTriggers: string[];
}

export interface ParsedFinancialSms {
  rawSms: string;
  sender?: string;
  amount: number;
  currency: string;
  direction: 'debit' | 'credit';
  txKind: SmsParsedTxKind;
  isCardOrLoanRepayment: boolean;
  merchantName: string;
  rawCounterparty?: string;
  accountLastDigits?: string;
  bankHint?: string;
  paymentMode: SmsPaymentMode;
  refId?: string;
  reportedBalance?: number;
  reportedAvailableLimit?: number;
  parsedDate: string; // YYYY-MM-DD
  parsedTimestampIso: string;
  patternSignature: string;
  baseConfidence: number;
}

const MONTH_INDEX_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/**
 * Canonical bank / card institution keywords (used for bankHint extraction & "from <Bank>" vs "from <External Counterparty>" direction detection).
 * Note: 'paytm' is intentionally NOT treated as a pure bank when inside a UPI VPA handle like paytm-8774066@ptybl.
 */
const KNOWN_BANK_KEYWORDS = [
  'canara',
  'hdfc',
  'sbi',
  'state bank',
  'icici',
  'axis',
  'kotak',
  'idfc',
  'indusind',
  'yes bank',
  'pnb',
  'punjab national',
  'bob',
  'bank of baroda',
  'union bank',
  'indian bank',
  'central bank',
  'bank of india',
  'federal',
  'rbl',
  'au bank',
  'bandhan',
  'standard chartered',
  'hsbc',
  'citi',
  'amex',
  'american express',
  'onecard',
  'slice',
  'jupiter',
  'fi money',
  'dbs',
  'south indian',
  'karur vysya',
  'karnataka bank',
  'uco bank',
  'idbi',
];

/**
 * Normalizes a merchant / counterparty label into a canonical lowercase lookup key
 * for `sms_rule_overrides` (e.g., "Hungerbox Pvt Ltd" / "Hungerbox" -> "hungerbox").
 */
export function normalizeMerchantAlias(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/@[a-z0-9._-]+/g, '') // strip UPI handle domain if present
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pvt|ltd|limited|private|india|ind|llp|inc|corp|merchant|upi|vpa|pos)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a raw counterparty handle / VPA / sender token for exact co-learning lookup
 * (e.g. "paytm-8774066@ptybl" -> "paytm-8774066@ptybl", "INNOFINSOLUT" -> "innofinsolut").
 */
export function normalizeCounterpartyKey(raw?: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Returns true when a merchant/counterparty string is an opaque VPA, gateway code, or generic placeholder
 * where the user will likely want to supply or confirm a human-readable reason (e.g. "paytm-8774066@ptybl").
 */
export function isOpaqueCounterpartyOrPlaceholder(
  merchantName: string,
  rawCounterparty?: string
): boolean {
  const raw = (rawCounterparty || '').trim();
  const m = (merchantName || '').trim();
  if (!m) return true;
  if (/^(?:card\s*\/\s*upi\s*spend|account\s*credit|upi\s*spend)$/i.test(m)) return true;
  // Opaque gateway VPA like paytm-8774066@ptybl, paytmqr..., bharatpe..., gpay-... with digits
  if (
    /^(?:paytm|bharatpe|phonepe|gpay|q\d+|merchant|vyapar|pinelabs|razorpay)[-._]?\d+/i.test(raw) ||
    /^(?:paytm|bharatpe|phonepe|gpay|q\d+|merchant|vyapar|pinelabs|razorpay)\s+\d+/i.test(m)
  ) {
    return true;
  }
  if (/^\d{5,}$/.test(m.replace(/\s+/g, ''))) return true;
  return false;
}

/**
 * Extracts distinct digit candidate strings (e.g., last 3-6 digits each) from a user-supplied multi-number string.
 * Supports comma, slash, semicolon, pipe, and whitespace separated numbers:
 * "3230, 6382", "3230 6382", "3230/6382", "··3230, ··6382".
 */
export function extractDigitsList(val?: string): string[] {
  if (!val) return [];
  const parts = val
    .split(/[,/;\s|]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => s.length >= 2 && s.length <= 10);
  return Array.from(new Set(parts));
}

/**
 * Normalizes user input for multiple last-digit allocations into a clean comma-separated string,
 * e.g. "3230 6382" -> "3230, 6382", or "3230,6382" -> "3230, 6382".
 */
export function cleanAccountDigitsInput(raw?: string): string | undefined {
  if (!raw) return undefined;
  const list = extractDigitsList(raw);
  if (list.length === 0) return undefined;
  return list.join(', ');
}

/**
 * Formats one or multiple account last digits for classy, professional UI display (e.g. "··3230, ··6382").
 */
export function formatLastDigitsDisplay(raw?: string): string {
  if (!raw) return '';
  const tokens = extractDigitsList(raw);
  if (tokens.length === 0) return raw.trim();
  return tokens.map((t) => `··${t}`).join(', ');
}

/**
 * Evaluates single trailing digit pair match.
 */
function scoreSingleTrailingDigitsMatch(
  a: string,
  b: string,
  bankHintMatches: boolean = false
): number {
  if (!a || !b) return 0;
  if (a === b) return 100;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  // Incremental suffix check from the right-most digit leftward
  if (shorter.length >= 4 && longer.endsWith(shorter)) {
    return 96;
  }
  if (shorter.length === 3 && longer.endsWith(shorter)) {
    return bankHintMatches ? 94 : 90;
  }
  // If both are 4+ digits and share the exact last 3 digits (e.g., masked truncation differences)
  if (a.length >= 3 && b.length >= 3 && a.slice(-3) === b.slice(-3)) {
    if (a.length >= 4 && b.length >= 4 && a.slice(-4) !== b.slice(-4)) {
      // Different 4th-from-right digit means distinct accounts (e.g., 1913 vs 4913)
      return 0;
    }
    return bankHintMatches ? 92 : 88;
  }
  if (shorter.length === 2 && longer.endsWith(shorter) && bankHintMatches) {
    return 75;
  }

  return 0;
}

/**
 * Incremental trailing-digit matcher (checks from last digit leftward: 4 digits, 3 digits, and 2 digits with bank hint).
 * Supports multi-number accounts / cards where a stored string contains multiple trailing numbers (e.g. "3230, 6382").
 * Example: Stored `accountLastDigits: "3230, 6382"` matches SMS `XX3230` and SMS `XX6382`.
 */
export function scoreTrailingDigitsMatch(
  smsDigitsRaw?: string,
  storedDigitsRaw?: string,
  bankHintMatches: boolean = false
): number {
  if (!smsDigitsRaw || !storedDigitsRaw) return 0;

  // Multi-digit support: if either operand has multiple separated digits (comma, space, slash, etc.)
  if (/[,/;\s|]/.test(smsDigitsRaw) || /[,/;\s|]/.test(storedDigitsRaw)) {
    const listA = extractDigitsList(smsDigitsRaw);
    const listB = extractDigitsList(storedDigitsRaw);
    const tokensA = listA.length > 0 ? listA : [smsDigitsRaw.replace(/\D/g, '')].filter(Boolean);
    const tokensB = listB.length > 0 ? listB : [storedDigitsRaw.replace(/\D/g, '')].filter(Boolean);
    let best = 0;
    for (const a of tokensA) {
      for (const b of tokensB) {
        const s = scoreSingleTrailingDigitsMatch(a, b, bankHintMatches);
        if (s > best) best = s;
      }
    }
    return best;
  }

  const a = smsDigitsRaw.replace(/\D/g, '');
  const b = storedDigitsRaw.replace(/\D/g, '');
  return scoreSingleTrailingDigitsMatch(a, b, bankHintMatches);
}

/**
 * Extracts digit groups from a holding/liability (including all allocated multiple last 4 digits for cards/accounts,
 * as well as digit tokens in name or notes) to match incrementally when parsing incoming SMS.
 */
function extractCandidateDigitTokensFromEntity(entity: {
  accountLastDigits?: string;
  name?: string;
  notes?: string;
  id?: string;
}): { digits: string; weight: number }[] {
  const out: { digits: string; weight: number }[] = [];
  if (entity.accountLastDigits) {
    const tokens = extractDigitsList(entity.accountLastDigits);
    for (const t of tokens) {
      if (t.length >= 2) {
        out.push({ digits: t, weight: 1.0 });
      }
    }
    const cleanAll = entity.accountLastDigits.replace(/\D/g, '');
    if (cleanAll.length >= 2 && cleanAll.length <= 6 && !tokens.includes(cleanAll)) {
      out.push({ digits: cleanAll, weight: 1.0 });
    }
  }
  const textSources = [entity.name || '', entity.notes || ''];
  for (const src of textSources) {
    const matches = src.match(/\d{3,6}/g) || [];
    for (const m of matches) {
      out.push({ digits: m, weight: 0.9 });
    }
  }
  if (entity.id) {
    // Support legacy IDs containing embedded account digits (e.g. hold-1793093398606 matching 3986 only on exact 4+ substring if no explicit digits)
    out.push({ digits: entity.id, weight: 0.65 });
  }
  return out;
}

/**
 * Builds a deterministic structural pattern signature for an SMS template.
 * Replaces variable amounts, dates, masked digits, and reference numbers with structural tokens
 * so blacklisting a faulty pattern blocks future identical templates without over-blocking valid bank alerts.
 */
export function computeSmsPatternSignature(rawSms: string, sender?: string): string {
  const senderPrefix = (sender || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(-8);

  const skeleton = (rawSms || '')
    .toLowerCase()
    .replace(/(?:rs\.?|inr|₹|\$|usd|eur|gbp)\s*[\d,]+(?:\.\d{1,2})?/gi, '<amt>')
    .replace(/\b\d{1,2}[-/\s](?:[a-z]{3,9}|\d{1,2})(?:[-/\s]\d{2,4})?\b/gi, '<date>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b(?:x+|\*+|ending\s*(?:with)?\s*)\d{2,6}\b/gi, '<acct>')
    .replace(/\b(?:ref(?:\s*no)?\.?|utr|txn\s*id|upi(?:\s*ref)?|imps|neft)[:\s#-]*[a-z0-9]{4,}\b/gi, '<ref>')
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/[^a-z<>]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);

  return senderPrefix ? `${senderPrefix}::${skeleton}` : skeleton;
}

/**
 * Strips fraud helpline / block-card footers (e.g. "Not You? Call 18002586161/SMS BLOCK CC 3230 to 7308080808")
 * before extracting amounts, dates, merchants, or references so helpline numbers are never misread.
 */
function stripHelplineAndDisputeFooter(rawText: string): string {
  return (rawText || '')
    .replace(/\b(?:not\s+you\??|if\s+not\s+(?:done\s+by\s+)?you\b|unauthori[sz]ed\??)[\s\S]*$/i, '')
    .replace(/\b(?:call\s+1800\d+|sms\s+block\b)[\s\S]*$/i, '')
    .trim();
}

/**
 * Detects whether an SMS is a Credit Card / Loan-Against-Credit-Card bill payment confirmation
 * (e.g., "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 14690.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 6382...").
 */
export function isCardOrLoanRepaymentSms(rawText: string): boolean {
  const text = stripHelplineAndDisputeFooter(rawText);
  if (
    /\bpayment\s+of\b[\s\S]{1,45}?\b(?:received|credited)\b[\s\S]{1,50}?\b(?:towards|for|to|in)\b[\s\S]{0,40}?\b(?:credit\s+card|card|loan)\b/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /\b(?:received|credited)\s+(?:a\s+)?payment\s+of\b[\s\S]{1,50}?\b(?:credit\s+card|card|loan)\b/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /\bthank\s+you\s+for\s+(?:your\s+)?payment\s+of\b[\s\S]{1,60}?\b(?:credit\s+card|card)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Checks whether an entity string after `"from ..."` refers to a bank/card/own-account (meaning money left the user -> DEBIT)
 * vs an external counterparty/company/person (meaning money arrived from them -> CREDIT).
 */
function isBankOrOwnAccountPhrase(entityRaw: string): boolean {
  const lower = (entityRaw || '').trim().toLowerCase();
  if (!lower) return false;
  if (
    /\b(?:your\s+|my\s+)?(?:a\/c|acct|account|ac\b|card|credit\s*card|debit\s*card|savings|current\s*a\/c|wallet)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/^(?:x+|\*+)\d{2,6}\b/i.test(lower)) {
    return true;
  }
  if (/\bbank\b/i.test(lower)) {
    return true;
  }
  const compact = lower.replace(/[^a-z0-9\s]/g, ' ');
  for (const kw of KNOWN_BANK_KEYWORDS) {
    if (compact === kw || compact.startsWith(`${kw} `) || compact.endsWith(` ${kw}`) || compact.includes(`${kw}bank`)) {
      return true;
    }
  }
  return false;
}

/**
 * MODULE 1: Standalone Signal-to-Noise Financial Message Classifier.
 *
 * 1. Drops OTPs / Authentication codes (`OTP`, `verification code`, `do not share`, etc.)
 * 2. Drops Promotional / Marketing spam (`loan approved`, `discount`, `apply now`, `cashback offer`, etc.)
 * 3. Drops Pure balance updates / passive statements without active movement (`available balance is`, `statement generated`)
 * 4. Accepts active financial movements including:
 *    - Full verbs (`debited`, `credited`, `spent`, `paid to`, `transferred`, `withdrawn`, `payment of ... received towards`)
 *    - Compact bank/card formats (`Txn Rs.52.00 On HDFC Bank Card 3230 ... by UPI ...`)
 *    - Abbreviated ledger notations (`A/c XX913 Cr INR 54.90 ... IMPS: ...`, `Dr INR ...`)
 *    - Directional `"from <Counterparty/Bank>"` with currency amount and account/card/IMPS/NEFT/UPI context.
 */
export function classifyFinancialSms(rawText: string, _sender?: string): SmsFilterClassification {
  const text = (rawText || '').trim();
  if (!text || text.length < 8) {
    return {
      passed: false,
      dropCategory: 'empty',
      reason: 'Message is empty or too short.',
      matchedTriggers: [],
    };
  }

  // 1. MUST IGNORE: OTPs / Authentication codes (even if they mention Card, A/c, or Rs amount)
  const otpPatterns = [
    /\botp\b/i,
    /\bone[\s-]?time[\s-]?password\b/i,
    /\bverification\s+code\b/i,
    /\bauth(?:entication)?\s+code\b/i,
    /\bsecurity\s+code\b/i,
    /\blogin\s+code\b/i,
    /\bsecret\s+code\b/i,
    /\bdo\s+not\s+share\s+(?:this|your|it|otp|code|pin)\b/i,
    /\bdon'?t\s+share\s+(?:this|your|it|otp|code|pin)\b/i,
    /\bdo\s+not\s+share\b.*\b(?:code|otp|pin|anyone)\b/i,
    /\bis\s+your\s+\d{4,8}\s+digit\b/i,
  ];
  for (const pat of otpPatterns) {
    if (pat.test(text)) {
      return {
        passed: false,
        dropCategory: 'otp_or_auth',
        reason: 'Dropped authentication / OTP message.',
        matchedTriggers: [],
      };
    }
  }
  if (
    /\bdo\s+not\s+share\b/i.test(text) &&
    !/\b(?:debited|credited|cr|dr|txn)\b/i.test(text)
  ) {
    return {
      passed: false,
      dropCategory: 'otp_or_auth',
      reason: 'Dropped security / authentication notice.',
      matchedTriggers: [],
    };
  }

  // 2. MUST IGNORE: Promotional / Marketing Spam
  const promoPatterns = [
    /\bloan\s+approved\b/i,
    /\bpre[\s-]?approved\b/i,
    /\bapply\s+now\b/i,
    /\bcashback\s+offer\b/i,
    /\bdiscount\b/i,
    /\bget\s+flat\s+\d+%\s+off\b/i,
    /\bpromo\s+code\b/i,
    /\buse\s+code\b/i,
    /\boffer\s+valid\b/i,
    /\blimited\s+(?:period|time)\s+offer\b/i,
    /\bwin\s+(?:up\s+to|assured|exciting)\b/i,
    /\bcongratulations[!,\s]+you\s+are\s+eligible\b/i,
    /\binstant\s+(?:personal\s+)?loan\b/i,
    /\bupgrade\s+your\s+(?:credit\s+)?card\b/i,
    /\bincrease\s+your\s+credit\s+limit\b/i,
  ];
  for (const pat of promoPatterns) {
    if (pat.test(text)) {
      return {
        passed: false,
        dropCategory: 'promotional_spam',
        reason: 'Dropped promotional / marketing offer.',
        matchedTriggers: [],
      };
    }
  }

  const coreBody = stripHelplineAndDisputeFooter(text);

  // Active movement signals:
  // - Standard verbs: debited, credited, spent, paid to, sent to, transferred, withdrawn, deposited, received from, purchase of
  // - Card/Loan bill payment received: payment of Rs ... received towards ...
  // - Compact transaction prefix: Txn Rs.52.00 / Txn of INR ...
  // - Abbreviated Cr / Dr next to currency or account: A/c XX913 Cr INR 54.90 / Dr Rs. 200
  // - IMPS / NEFT / RTGS / UPI reference with amount
  const activeMovementRegex =
    /\b(debited|credited|spent|paid\s+to|paid\s+towards|sent\s+to|transferred|withdrawn|deposited|received\s+from|received\s+towards|payment\s+of|purchase\s+of|imps|neft|rtgs)\b/i;
  const compactTxnRegex =
    /\b(?:txn|transaction)\s*(?:of\s*|for\s*)?(?:rs\.?|inr|₹|\$|usd|eur|gbp)\s*[\d,]+/i;
  const abbrevCrDrRegex =
    /(?:\b(?:cr|dr)\.?\s+(?:rs\.?|inr|₹)\s*[\d,]+|\b(?:a\/c|acct|account)\s+[x*\d]+\s+(?:cr|dr)\b|(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s*(?:cr|dr)\b)/i;
  const byUpiMovementRegex = /\b(?:by|via)\s+upi\b/i;
  const directionalFromWithAmtRegex =
    /(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?[\s\S]{0,60}?\bfrom\s+[A-Za-z0-9]/i;

  const hasActiveMovement =
    activeMovementRegex.test(coreBody) ||
    compactTxnRegex.test(coreBody) ||
    abbrevCrDrRegex.test(coreBody) ||
    byUpiMovementRegex.test(coreBody) ||
    directionalFromWithAmtRegex.test(coreBody);

  // 3. MUST IGNORE: Pure balance updates or statement notices without active movement
  const passiveBalanceOrStatementPatterns = [
    /\bavailable\s+balance\s+is\b/i,
    /\bavl\.?\s*bal(?:ance)?\s*(?:is|:)\b/i,
    /\bclear\s+balance\s+is\b/i,
    /\bledger\s+balance\s+is\b/i,
    /\bstatement\s+(?:is\s+|has\s+been\s+)?generated\b/i,
    /\be-?statement\s+(?:for|is\s+ready|generated)\b/i,
    /\bbill\s+(?:is\s+)?generated\b/i,
    /\bminimum\s+amount\s+due\b/i,
  ];
  if (!hasActiveMovement) {
    for (const pat of passiveBalanceOrStatementPatterns) {
      if (pat.test(coreBody)) {
        return {
          passed: false,
          dropCategory: 'passive_balance_or_statement',
          reason: 'Dropped passive balance / statement notification without active transaction movement.',
          matchedTriggers: [],
        };
      }
    }
  }

  // 4. MUST CONTAIN: Explicit financial triggers
  const triggerDefinitions: { label: string; regex: RegExp }[] = [
    { label: 'debited', regex: /\b(?:debited|dr)\b/i },
    { label: 'credited', regex: /\b(?:credited|cr)\b/i },
    { label: 'spent', regex: /\bspent\b/i },
    { label: 'paid', regex: /\b(?:paid\s+to|payment\s+of)\b/i },
    { label: 'transferred', regex: /\btransferred\b/i },
    { label: 'withdrawn', regex: /\bwithdrawn\b/i },
    { label: 'Txn', regex: /\b(?:txn|transaction)\b/i },
    { label: 'IMPS/NEFT', regex: /\b(?:imps|neft|rtgs)\b/i },
    { label: 'UPI', regex: /\bupi\b/i },
    { label: 'A/c', regex: /\b(?:a\/c|acct|account)\b/i },
    { label: 'Card', regex: /\bcard(?:member)?\b/i },
  ];

  const matchedTriggers = triggerDefinitions
    .filter((t) => t.regex.test(coreBody))
    .map((t) => t.label);

  if (matchedTriggers.length === 0 || !hasActiveMovement) {
    return {
      passed: false,
      dropCategory: 'missing_financial_trigger',
      reason: 'Missing required active financial movement trigger.',
      matchedTriggers,
    };
  }

  const extractedAmt = extractTransactionAmount(coreBody);
  if (extractedAmt === null || extractedAmt <= 0) {
    return {
      passed: false,
      dropCategory: 'unparseable_amount',
      reason: 'No positive transaction amount detected.',
      matchedTriggers,
    };
  }

  return {
    passed: true,
    reason: 'Valid active financial transaction SMS.',
    matchedTriggers,
  };
}

/**
 * Extracts post-transaction reported bank balance when present in the SMS
 * (e.g. "; Bal INR 13,403.67-CanaraBank" -> 13403.67, "Avl Bal: Rs. 5,210.00" -> 5210).
 */
export function extractReportedBalance(rawText: string): number | undefined {
  const core = stripHelplineAndDisputeFooter(rawText);
  const patterns = [
    /(?:;|,|\.|\s|^)(?:avl\.?\s*bal(?:ance)?|available\s+bal(?:ance)?|clear\s+bal(?:ance)?|updated\s+bal(?:ance)?|closing\s+bal(?:ance)?|bal(?:ance)?)\s*(?:is\b|:|-)?\s*(?:rs\.?|inr|₹|\$|usd|eur|gbp)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\b(?:avl\.?\s*bal(?:ance)?|available\s+bal(?:ance)?|closing\s+bal(?:ance)?|bal(?:ance)?\s+is)\s*[:=-]?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pat of patterns) {
    const m = core.match(pat);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val >= 0) {
        return roundCurrency(val);
      }
    }
  }
  return undefined;
}

/**
 * Extracts post-transaction reported available credit card limit when present
 * (e.g. "YOUR AVAILABLE LIMIT IS RS. 21376.00" -> 21376).
 */
export function extractReportedAvailableLimit(rawText: string): number | undefined {
  const core = stripHelplineAndDisputeFooter(rawText);
  const patterns = [
    /\b(?:your\s+)?(?:available|avl\.?)\s+(?:credit\s+)?limit\s*(?:is\b|:|-)?\s*(?:rs\.?|inr|₹|\$|usd|eur|gbp)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\blimit\s+available\s*(?:is\b|:|-)?\s*(?:rs\.?|inr|₹|\$|usd|eur|gbp)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const pat of patterns) {
    const m = core.match(pat);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val >= 0) {
        return roundCurrency(val);
      }
    }
  }
  return undefined;
}

/**
 * Extracts the primary transacted amount while ignoring trailing "Bal / Avl Bal / Available Limit" figures.
 */
export function extractTransactionAmount(rawText: string): number | null {
  const parsed = extractAmountAndCurrency(rawText);
  return parsed ? parsed.amount : null;
}

export function extractAmountAndCurrency(
  rawText: string,
  defaultCurrency: string = 'INR'
): { amount: number; currency: string } | null {
  const withoutFooter = stripHelplineAndDisputeFooter(rawText || '');
  // Strip balance & credit-limit clauses so trailing balances/limits are never mistaken for transaction amount
  const cleaned = withoutFooter
    .replace(
      /(?:;|,|\.|\s|^)(?:your\s+)?(?:avl\.?\s*bal(?:ance)?|available\s+bal(?:ance)?|clear\s+bal(?:ance)?|updated\s+bal(?:ance)?|closing\s+bal(?:ance)?|bal(?:ance)?|available\s+(?:credit\s+)?limit|avl\.?\s*limit|limit\s+available)\s*(?:is\b|:|-)?\s*(?:rs\.?|inr|₹|\$|usd|eur|gbp)?\s*[\d,]+(?:\.\d{1,2})?/gi,
      ' '
    );

  const currencyMap: { regex: RegExp; code: string }[] = [
    {
      regex: /(?:₹|\binr\b|\brs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
      code: 'INR',
    },
    {
      regex: /([\d,]+(?:\.\d{1,2})?)\s*(?:₹|\binr\b|\brs\.?)\b/i,
      code: 'INR',
    },
    {
      regex: /(?:\$|\busd\b)\s*([\d,]+(?:\.\d{1,2})?)/i,
      code: 'USD',
    },
    {
      regex: /(?:€|\beur\b)\s*([\d,]+(?:\.\d{1,2})?)/i,
      code: 'EUR',
    },
    {
      regex: /(?:£|\bgbp\b)\s*([\d,]+(?:\.\d{1,2})?)/i,
      code: 'GBP',
    },
  ];

  for (const item of currencyMap) {
    const match = cleaned.match(item.regex);
    if (match && match[1]) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        return { amount: roundCurrency(val), currency: item.code };
      }
    }
  }

  // Fallback: amount right next to debited/credited/cr/dr/spent/paid
  const verbAmtMatch = cleaned.match(
    /\b(?:debited|credited|cr|dr|spent|paid|withdrawn|transferred|txn)\s+(?:by|for|of|with)?\s*([\d,]+(?:\.\d{1,2})?)\b/i
  );
  if (verbAmtMatch && verbAmtMatch[1]) {
    const val = parseFloat(verbAmtMatch[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0) {
      return { amount: roundCurrency(val), currency: defaultCurrency };
    }
  }

  return null;
}

/**
 * Determines whether the SMS represents an outflow ('debit') or inflow ('credit') for the user.
 *
 * Rules:
 * 1. Credit card / loan repayment SMS ("Payment of Rs 14690 received towards your credit card") -> 'debit' from user's bank towards liability (`txKind: 'cardPayment'`).
 * 2. Explicit user-account anchored phrases ("debited from A/c", "credited to A/c", "A/c XX913 Cr INR 54.90", "A/c XX913 Dr INR ...").
 * 3. Compact card/UPI spend ("Txn Rs.52.00 On HDFC Bank Card 3230 At ...") -> 'debit'.
 * 4. Smart `"from <Entity>"` rule:
 *    - If SMS says `from <EXTERNAL_COUNTERPARTY>` (e.g. `from INNOFINSOLUT`, `from HEJEMENSMBD`) and NOT `debited`/`spent`/`withdrawn` -> `'credit'`.
 *    - If SMS says `from <BANK_OR_OWN_ACCOUNT>` (e.g. `from HDFC Bank`, `from Canara Bank`, `from A/c XX913`) -> `'debit'`.
 */
export function extractDirection(rawText: string): 'debit' | 'credit' {
  const core = stripHelplineAndDisputeFooter(rawText);
  const lower = core.toLowerCase();

  // 1. Card / Loan repayment is an outflow from user's bank account to pay down card/loan debt
  if (isCardOrLoanRepaymentSms(core)) {
    return 'debit';
  }

  // 2. Explicit user-account anchored phrases (handles UPI SMS where "debited from A/c ... credited to VPA ..." appears)
  if (/\bdebited\s+(?:from|for|in)\s+(?:your\s+)?(?:a\/c|acct|account|card)\b/i.test(core)) {
    return 'debit';
  }
  if (/\bcredited\s+(?:to|in|into|by)\s+(?:your\s+)?(?:a\/c|acct|account)\b/i.test(core)) {
    return 'credit';
  }
  if (/\b(?:a\/c|acct|account)\s+[x*#.\d-]+\s+(?:is\s+|has\s+been\s+)?(?:debited|dr\b)/i.test(core)) {
    return 'debit';
  }
  if (/\b(?:a\/c|acct|account)\s+[x*#.\d-]+\s+(?:is\s+|has\s+been\s+)?(?:credited|cr\b)/i.test(core)) {
    return 'credit';
  }

  // Abbreviated standalone Cr / Dr next to currency (e.g. "Cr INR 54.90" or "Dr INR 54.90")
  const hasExplicitCrToken =
    /\bcr\.?\s+(?:rs\.?|inr|₹|\$|usd)\s*[\d,]+/i.test(core) ||
    /(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s+cr\b/i.test(core);
  const hasExplicitDrToken =
    /\bdr\.?\s+(?:rs\.?|inr|₹|\$|usd)\s*[\d,]+/i.test(core) ||
    /(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s+dr\b/i.test(core);

  if (hasExplicitCrToken && !hasExplicitDrToken) return 'credit';
  if (hasExplicitDrToken && !hasExplicitCrToken) return 'debit';

  // 3. Compact "Txn Rs.52.00 On ... Card ... At ..." is a card spend (debit) unless refund/reversed/cr
  if (
    /\b(?:txn|transaction)\s*(?:of\s*)?(?:rs\.?|inr|₹)/i.test(core) &&
    /\bon\s+[^\n]*\bcard\b/i.test(core) &&
    !/\b(?:refund|credited|cr|reversed)\b/i.test(core)
  ) {
    return 'debit';
  }

  // 4. Smart "from <Entity>" rule when neither explicit `debited` nor `credited` settles it first
  const debitIdx = lower.search(/\b(debited|spent|paid\s+to|sent\s+to|withdrawn|purchase)\b/);
  const creditIdx = lower.search(/\b(credited|received\s+from|deposited|refund)\b/);

  if (debitIdx !== -1 && creditIdx !== -1) {
    return debitIdx <= creditIdx ? 'debit' : 'credit';
  }
  if (debitIdx !== -1) return 'debit';
  if (creditIdx !== -1) return 'credit';

  // Evaluate `from <Entity>` (e.g. "from HEJEMENSMBD" -> credit vs "from HDFC Bank" / "from Canara Bank" -> debit)
  const fromMatch = core.match(
    /\bfrom\s+([A-Za-z0-9@._-]+(?:\s+[A-Za-z0-9@._-]+){0,3}?)(?=(?:[;.,\n]|\s+(?:on|via|by|imps|neft|rtgs|upi|ref|utr|bal|avl|to)\b|$))/i
  );
  if (fromMatch && fromMatch[1]) {
    const fromEntity = fromMatch[1].trim();
    if (isBankOrOwnAccountPhrase(fromEntity)) {
      return 'debit';
    }
    return 'credit';
  }

  return 'debit';
}

/**
 * Extracts masked account or card trailing digits (supports 3–6 digits such as "XX913" -> "913", "Card 3230" -> "3230", "ENDING WITH 6382" -> "6382").
 */
export function extractAccountLastDigits(rawText: string): string | undefined {
  const core = stripHelplineAndDisputeFooter(rawText);
  const patterns = [
    /\b(?:credit\s+card|debit\s+card|card)\s*(?:no\.?|number)?\s*(?:ending(?:\s+with)?\s*)?[x*#.-]*(\d{3,6})\b/i,
    /\b(?:a\/c|acct|account|ac)(?:\s*no\.?)?\s*(?:ending(?:\s+with)?\s*)?[x*#.-]*(\d{3,6})\b/i,
    /\bending\s+(?:with\s+|in\s+)?[x*#.-]*(\d{3,6})\b/i,
    /\b(?:x{2,}|\*{2,})(\d{3,6})\b/i,
  ];
  for (const pat of patterns) {
    const m = core.match(pat);
    if (m && m[1]) {
      return m[1];
    }
  }
  return undefined;
}

/**
 * Extracts payment mode (`upi`, `imps`, `neft`, `atm`, `credit_card`, `debit_card`, `netbanking`, `other`).
 */
function extractPaymentMode(rawText: string): SmsPaymentMode {
  const core = stripHelplineAndDisputeFooter(rawText);
  if (/\bimps\b/i.test(core)) return 'imps';
  if (/\bneft\b|\brtgs\b/i.test(core)) return 'neft';
  if (/\bupi\b|\bvpa\b|@[a-z]{3,}\b/i.test(core)) return 'upi';
  if (/\batm\b|\bwithdrawn\s+at\b/i.test(core)) return 'atm';
  if (/\bcredit\s+card\b/i.test(core)) return 'credit_card';
  if (/\bdebit\s+card\b|\bpos\b/i.test(core)) return 'debit_card';
  if (/\bcard\b/i.test(core)) return 'credit_card';
  if (/\bnet\s*banking\b/i.test(core)) return 'netbanking';
  return 'other';
}

/**
 * Extracts transaction reference / UTR / UPI / IMPS number
 * (e.g. "Ref: 123456", "by UPI 173332464899", "IMPS: 630702890694").
 */
export function extractRefId(rawText: string): string | undefined {
  const core = stripHelplineAndDisputeFooter(rawText);
  const patterns = [
    /\b(?:upi\s*ref(?:\s*no\.?)?|ref(?:\s*no\.?)?|utr(?:\s*no\.?)?|txn\s*id|rrn)[:\s#-]+([a-z0-9]{4,24})\b/i,
    /\b(?:imps|neft|rtgs)\s*(?:ref(?:\s*no\.?)?)?[:\s/-]+([a-z0-9]{6,24})\b/i,
    /\b(?:by|via)\s+upi\s*[:#-]?\s*(\d{6,24})\b/i,
    /\(upi\s*ref[:\s#]*([a-z0-9]{4,24})\)/i,
  ];
  for (const pat of patterns) {
    const m = core.match(pat);
    if (m && m[1]) {
      return m[1].trim();
    }
  }
  return undefined;
}

/**
 * Extracts both a clean human-readable `merchantName` and the exact `rawCounterparty` token (e.g. VPA `paytm-8774066@ptybl` or `INNOFINSOLUT`).
 */
export function extractCounterpartyDetails(
  rawText: string,
  direction: 'debit' | 'credit',
  accountLastDigits?: string
): { merchantName: string; rawCounterparty?: string } {
  const core = stripHelplineAndDisputeFooter(rawText);

  if (isCardOrLoanRepaymentSms(core)) {
    const bankLabel = extractBankHint(core);
    const upperBank = bankLabel ? bankLabel.toUpperCase() : 'Credit';
    const suffix = accountLastDigits ? ` ··${accountLastDigits}` : '';
    return {
      merchantName: `${upperBank} Card Payment${suffix}`,
      rawCounterparty: accountLastDigits ? `card-repayment-${accountLastDigits}` : 'card-repayment',
    };
  }

  const cleanRawToken = (raw: string): string => {
    return raw
      .split(
        /\b(?:by\s+upi|via\s+upi|upi\s*ref|ref(?:\s*no)?\.?|utr|txn\s*id|imps|neft|rtgs|avl\.?\s*bal|available\s*bal|available\s*limit|bal\s+(?:inr|rs)|not\s+you|if\s+not)\b/i
      )[0]
      .replace(/\s+on\s+\d{1,2}[-/\s][a-z0-9]{2,9}(?:[-/\s]\d{2,4})?[\s\S]*$/i, '')
      .replace(/[.,;:)(\]\r\n]+$/g, '')
      .replace(/^[.,;:(\[\r\n]+/g, '')
      .trim();
  };

  const humanizeToken = (token: string): string => {
    let m = token;
    if (/^[a-z0-9._-]+@[a-z0-9._-]+$/i.test(m)) {
      const handleUser = m.split('@')[0].replace(/[._-]+/g, ' ').trim();
      if (handleUser.length >= 2) {
        m = handleUser.replace(/\b\w/g, (ch) => ch.toUpperCase());
      }
    }
    return m.slice(0, 60).trim();
  };

  const debitPatterns = [
    /\bvia\s+upi\s+to\s+(?:vpa\s+)?([^\n.,;]+?)(?=(?:\.\s*|\s+by\s+upi\b|\s+ref\b|\s+upi\s+ref\b|\s+utr\b|\s+on\s+\d|\r|\n|$))/i,
    /\b(?:paid|sent|transferred)\s+to\s+(?:vpa\s+)?([^\n.,;]+?)(?=(?:\.\s*|\s+on\s+\d|\s+by\s+upi\b|\s+via\b|\s+ref\b|\s+utr\b|\r|\n|$))/i,
    /\bto\s+vpa\s+([^\s,;]+)/i,
    /\bat\s+([^\n,;]+?)(?=(?:\s+by\s+upi\b|\s+via\s+upi\b|\s+on\s+\d|\.\s+|\s+avl\b|\s+bal\b|\s+ref\b|\r|\n|$))/i,
    /\btowards\s+([^\n.,;]+?)(?=(?:\.\s*|\s+on\s+\d|\s+ref\b|\r|\n|$))/i,
    /\bto\s+([A-Za-z0-9][A-Za-z0-9@._\s&'-]{1,44}?)(?=(?:\.\s*|\s+by\s+upi\b|\s+on\s+\d|\s+ref\b|\s+utr\b|\s+avl\b|\s+bal\b|\r|\n|$))/i,
  ];

  const creditPatterns = [
    /\b(?:received\s+from|from)\s+(?:vpa\s+)?([^\n,;]+?)(?=(?:;|\.\s*|\s+on\s+\d|\s+via\b|\s+by\b|\s+imps\b|\s+neft\b|\s+rtgs\b|\s+ref\b|\s+utr\b|\s+bal\b|\r|\n|$))/i,
    /\bby\s+(?:vpa\s+)?([A-Za-z][A-Za-z0-9@._\s&'-]{1,40}?)(?=(?:;|\.\s*|\s+on\s+\d|\s+ref\b|\s+utr\b|\r|\n|$))/i,
  ];

  const ordered = direction === 'credit' ? [...creditPatterns, ...debitPatterns] : debitPatterns;

  for (const pat of ordered) {
    const match = core.match(pat);
    if (match && match[1]) {
      const rawToken = cleanRawToken(match[1]);
      if (
        rawToken.length >= 2 &&
        !/^(?:a\/c|acct|account|your\s+a\/c|xx\d+|card|upi)$/i.test(rawToken) &&
        !(direction === 'credit' && isBankOrOwnAccountPhrase(rawToken))
      ) {
        return {
          merchantName: humanizeToken(rawToken),
          rawCounterparty: rawToken,
        };
      }
    }
  }

  if (/\batm\b/i.test(core)) {
    return { merchantName: 'ATM Cash Withdrawal', rawCounterparty: 'atm' };
  }
  return {
    merchantName: direction === 'credit' ? 'Account Credit' : 'Card / UPI Spend',
  };
}

export function extractMerchantName(rawText: string, direction: 'debit' | 'credit'): string {
  return extractCounterpartyDetails(rawText, direction).merchantName;
}

/**
 * Extracts transaction date & ISO timestamp from SMS text.
 * Supports:
 * - `DD-MMM-YY` / `DD-MMM-YYYY` (e.g. `02-Nov-26`, `2 Nov 2026`)
 * - `YYYY-MM-DD` (e.g. `2026-11-02`)
 * - `D-M-YYYY` / `DD/MM/YY` (e.g. `3-10-2026` -> `2026-10-03`, `03/11/26` -> `2026-11-03`)
 * - `On DD-MM` / `on DD/MM` without year (e.g. `On 15-07` -> infers year from `fallbackReceivedIso` / current date)
 * - Fallback to **current date** (`fallbackReceivedIso` or `new Date()`) when date is omitted.
 */
export function extractSmsDateAndTimestamp(
  rawText: string,
  fallbackReceivedIso?: string
): { parsedDate: string; parsedTimestampIso: string } {
  const core = stripHelplineAndDisputeFooter(rawText);
  const fallbackDateObj = fallbackReceivedIso ? new Date(fallbackReceivedIso) : new Date();
  const safeFallback = isNaN(fallbackDateObj.getTime()) ? new Date() : fallbackDateObj;

  const buildResultForDateStr = (dateStr: string): { parsedDate: string; parsedTimestampIso: string } => {
    const timeMatch = core.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    if (timeMatch) {
      const hh = String(Math.min(23, parseInt(timeMatch[1], 10))).padStart(2, '0');
      const mm = String(Math.min(59, parseInt(timeMatch[2], 10))).padStart(2, '0');
      const ss = String(Math.min(59, parseInt(timeMatch[3] || '0', 10))).padStart(2, '0');
      const constructed = new Date(`${dateStr}T${hh}:${mm}:${ss}`);
      if (!isNaN(constructed.getTime())) {
        return { parsedDate: dateStr, parsedTimestampIso: constructed.toISOString() };
      }
    }
    if (safeFallback.toISOString().startsWith(dateStr)) {
      return { parsedDate: dateStr, parsedTimestampIso: safeFallback.toISOString() };
    }
    return {
      parsedDate: dateStr,
      parsedTimestampIso: new Date(`${dateStr}T12:00:00.000Z`).toISOString(),
    };
  };

  // 1. Match DD-MMM-YY or DD-MMM-YYYY (e.g. 02-Nov-26, 2 Nov 2026)
  const alphaDateMatch = core.match(/\b(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})\b/);
  if (alphaDateMatch) {
    const day = parseInt(alphaDateMatch[1], 10);
    const monKey = alphaDateMatch[2].toLowerCase();
    let year = parseInt(alphaDateMatch[3], 10);
    if (year < 100) year += 2000;
    const monthIdx = MONTH_INDEX_MAP[monKey];
    if (monthIdx !== undefined && day >= 1 && day <= 31) {
      const dateStr = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return buildResultForDateStr(dateStr);
    }
  }

  // 2. Match DD-MMM without year (e.g. "On 15-Jul" or "on 15 Jul")
  const alphaShortMatch = core.match(/\bon\s+(\d{1,2})[-/\s]([A-Za-z]{3,9})\b/i);
  if (alphaShortMatch) {
    const day = parseInt(alphaShortMatch[1], 10);
    const monKey = alphaShortMatch[2].toLowerCase();
    const monthIdx = MONTH_INDEX_MAP[monKey];
    if (monthIdx !== undefined && day >= 1 && day <= 31) {
      const year = safeFallback.getUTCFullYear();
      const dateStr = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return buildResultForDateStr(dateStr);
    }
  }

  // 3. Match YYYY-MM-DD
  const isoMatch = core.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const dateStr = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return buildResultForDateStr(dateStr);
  }

  // 4. Match DD/MM/YYYY or D-M-YYYY or DD/MM/YY (e.g. 3-10-2026, 03/11/26)
  const numDateMatch = core.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numDateMatch) {
    const day = parseInt(numDateMatch[1], 10);
    const month = parseInt(numDateMatch[2], 10);
    let year = parseInt(numDateMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return buildResultForDateStr(dateStr);
    }
  }

  // 5. Match "On DD-MM" or "on DD/MM" without year (e.g. "On 15-07" -> July 15 of current/received year)
  const shortDayMonthMatch = core.match(/\bon\s+(\d{1,2})[/-](\d{1,2})(?![/-]\d)\b/i);
  if (shortDayMonthMatch) {
    const day = parseInt(shortDayMonthMatch[1], 10);
    const month = parseInt(shortDayMonthMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = safeFallback.getUTCFullYear();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return buildResultForDateStr(dateStr);
    }
  }

  // 6. Default to current/received date when SMS has no date
  return {
    parsedDate: safeFallback.toISOString().slice(0, 10),
    parsedTimestampIso: safeFallback.toISOString(),
  };
}

/**
 * Extracts issuing bank / institution keyword from sender header or SMS body
 * (ignoring UPI VPA handles like `paytm-8774066@ptybl` so `paytm` inside a merchant VPA never overrides `HDFC Bank`).
 */
export function extractBankHint(rawText: string, sender?: string): string | undefined {
  const withoutVpaHandles = stripHelplineAndDisputeFooter(rawText).replace(
    /[a-z0-9._-]+@[a-z0-9._-]+/gi,
    ' '
  );
  const combined = `${sender || ''} ${withoutVpaHandles}`.toLowerCase();
  for (const kw of KNOWN_BANK_KEYWORDS) {
    if (combined.includes(kw)) return kw;
  }
  return undefined;
}

/**
 * MODULE 2: Deterministic SMS Parser (invoked after `classifyFinancialSms` passes).
 */
export function parseFinancialSms(
  rawSms: string,
  options?: {
    sender?: string;
    receivedAtIso?: string;
    defaultCurrency?: string;
  }
): ParsedFinancialSms | null {
  const verdict = classifyFinancialSms(rawSms, options?.sender);
  if (!verdict.passed) return null;

  const amtCurr = extractAmountAndCurrency(rawSms, options?.defaultCurrency || 'INR');
  if (!amtCurr) return null;

  const isRepayment = isCardOrLoanRepaymentSms(rawSms);
  const direction = extractDirection(rawSms);
  const txKind: SmsParsedTxKind = isRepayment
    ? 'cardPayment'
    : direction === 'credit'
    ? 'income'
    : 'spend';

  const accountLastDigits = extractAccountLastDigits(rawSms);
  const paymentMode = extractPaymentMode(rawSms);
  const refId = extractRefId(rawSms);
  const { merchantName, rawCounterparty } = extractCounterpartyDetails(
    rawSms,
    direction,
    accountLastDigits
  );
  const bankHint = extractBankHint(rawSms, options?.sender);
  const reportedBalance = extractReportedBalance(rawSms);
  const reportedAvailableLimit = extractReportedAvailableLimit(rawSms);
  const { parsedDate, parsedTimestampIso } = extractSmsDateAndTimestamp(
    rawSms,
    options?.receivedAtIso
  );
  const patternSignature = computeSmsPatternSignature(rawSms, options?.sender);

  let baseConfidence = 0.82;
  if (accountLastDigits) baseConfidence += 0.08;
  if (refId) baseConfidence += 0.05;
  if (
    merchantName &&
    merchantName !== 'Card / UPI Spend' &&
    merchantName !== 'Account Credit' &&
    !isOpaqueCounterpartyOrPlaceholder(merchantName, rawCounterparty)
  ) {
    baseConfidence += 0.05;
  }

  return {
    rawSms: rawSms.trim(),
    sender: options?.sender,
    amount: amtCurr.amount,
    currency: amtCurr.currency,
    direction,
    txKind,
    isCardOrLoanRepayment: isRepayment,
    merchantName,
    rawCounterparty,
    accountLastDigits,
    bankHint,
    paymentMode,
    refId,
    reportedBalance,
    reportedAvailableLimit,
    parsedDate,
    parsedTimestampIso,
    patternSignature,
    baseConfidence: Math.min(0.99, roundCurrency(baseConfidence)),
  };
}

function entityMatchesBankHint(
  entity: { name?: string; notes?: string; lender?: string },
  bankHint?: string
): boolean {
  if (!bankHint) return false;
  const h = bankHint.toLowerCase();
  const hay = `${entity.name || ''} ${entity.notes || ''} ${entity.lender || ''}`.toLowerCase();
  return hay.includes(h);
}

/**
 * Routes a parsed SMS to the exact Holding (`hold-*`) and/or Card/Loan Liability (`liab-*` / `card-*` / `loan-*`)
 * using:
 * 1. Learned `sms_rule_overrides` (`repayment_routing` & `account_mapping`, with incremental trailing-digit matching)
 * 2. Incremental trailing-digit matching (`4913` <-> `913`, `3230` <-> `3230`, `6382` <-> `6382`) across cards, loans (including Loans Against Credit Cards), and bank holdings
 * 3. Cards linked (`linkedAccountId`) to a bank account matching `bankHint` (e.g., `On HDFC Bank Card 3230` checks cards linked to HDFC bank accounts as well as standalone HDFC cards)
 * 4. Bank / institution hint fallback.
 */
export function resolveSmsTargetSource(
  parsed: ParsedFinancialSms,
  holdings: Holding[],
  liabilities: Liability[],
  ruleOverrides: SmsRuleOverride[]
): {
  sourceId?: string;
  targetLiabilityId?: string;
  resolvedTxKind: SmsParsedTxKind;
  fromLearnedRepaymentRule?: boolean;
  confidenceBoost: number;
} {
  const excludedIds = new Set<string>();
  for (const r of ruleOverrides) {
    const digitHit =
      r.accountLastDigits &&
      parsed.accountLastDigits &&
      scoreTrailingDigitsMatch(parsed.accountLastDigits, r.accountLastDigits, true) >= 88;
    if ((r.patternSignature && r.patternSignature === parsed.patternSignature) || digitHit) {
      for (const ex of r.excludedSourceIds || []) {
        excludedIds.add(ex);
      }
    }
  }

  const isAllowed = (id: string) => !excludedIds.has(id);

  const liquidHoldings = holdings.filter(
    (h) => (h.liquidityClass === 'Immediate' || h.typeId === 'type-bank') && isAllowed(h.id)
  );
  const allAllowedHoldings = holdings.filter((h) => isAllowed(h.id));
  const cards = liabilities.filter((l) => l.kind === 'card' && isAllowed(l.id));
  const loans = liabilities.filter((l) => l.kind === 'loan' && isAllowed(l.id));
  const allAllowedLiabilities = liabilities.filter((l) => isAllowed(l.id));

  // Helper to find best bank holding matching bankHint (e.g. HDFC Bank)
  const findBankHoldingByHint = (hint?: string): Holding | undefined => {
    if (!hint) return liquidHoldings.length === 1 ? liquidHoldings[0] : undefined;
    return (
      liquidHoldings.find((h) => entityMatchesBankHint(h, hint)) ||
      allAllowedHoldings.find((h) => entityMatchesBankHint(h, hint)) ||
      (liquidHoldings.length === 1 ? liquidHoldings[0] : undefined)
    );
  };

  // CASE A: Credit Card / Loan-Against-Credit-Card Repayment SMS (e.g. "PAYMENT OF Rs. 14690.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 6382")
  if (parsed.isCardOrLoanRepayment) {
    // 1. Check learned `repayment_routing` override first (e.g. user previously mapped 6382 to Loan Against Credit Card + HDFC Bank)
    const learnedRepay = ruleOverrides.find((r) => {
      if (r.ruleType !== 'repayment_routing' || r.isBlacklisted || r.confidence <= 0) return false;
      if (parsed.accountLastDigits && r.accountLastDigits) {
        return scoreTrailingDigitsMatch(parsed.accountLastDigits, r.accountLastDigits, true) >= 88;
      }
      return Boolean(r.patternSignature && r.patternSignature === parsed.patternSignature);
    });

    if (learnedRepay) {
      const validSource =
        learnedRepay.mappedSourceId &&
        holdings.some((h) => h.id === learnedRepay.mappedSourceId)
          ? learnedRepay.mappedSourceId
          : findBankHoldingByHint(parsed.bankHint)?.id;
      const validTarget =
        learnedRepay.mappedTargetLiabilityId &&
        liabilities.some((l) => l.id === learnedRepay.mappedTargetLiabilityId)
          ? learnedRepay.mappedTargetLiabilityId
          : undefined;

      if (validTarget || validSource) {
        const targetObj = liabilities.find((l) => l.id === validTarget);
        const kind: SmsParsedTxKind =
          learnedRepay.mappedTxKind ||
          (targetObj?.kind === 'loan' ? 'emi' : 'cardPayment');
        return {
          sourceId: validSource,
          targetLiabilityId: validTarget,
          resolvedTxKind: kind,
          fromLearnedRepaymentRule: true,
          confidenceBoost: 0.14,
        };
      }
    }

    // 2. Match target liability (check both Cards AND Loans — e.g. Loan Against Credit Card ending 6382!)
    let matchedTarget: Liability | undefined;
    if (parsed.accountLastDigits) {
      let bestScore = 0;
      for (const liab of allAllowedLiabilities) {
        const bankMatches = entityMatchesBankHint(liab, parsed.bankHint);
        for (const cand of extractCandidateDigitTokensFromEntity(liab)) {
          const rawScore =
            cand.weight < 0.7
              ? cand.digits.includes(parsed.accountLastDigits)
                ? 70
                : 0
              : scoreTrailingDigitsMatch(parsed.accountLastDigits, cand.digits, bankMatches);
          const weighted = rawScore * cand.weight;
          if (weighted > bestScore) {
            bestScore = weighted;
            matchedTarget = liab;
          }
        }
      }
    }
    if (!matchedTarget && parsed.bankHint) {
      matchedTarget =
        cards.find((c) => entityMatchesBankHint(c, parsed.bankHint)) ||
        loans.find((l) => entityMatchesBankHint(l, parsed.bankHint));
    }

    // 3. Default paying bank account = target liability's linkedAccountId -> bank holding matching bankHint (e.g. HDFC Bank) -> single bank account
    const defaultPayingBankId =
      (matchedTarget?.linkedAccountId &&
      holdings.some((h) => h.id === matchedTarget?.linkedAccountId)
        ? matchedTarget.linkedAccountId
        : undefined) || findBankHoldingByHint(parsed.bankHint)?.id;

    return {
      sourceId: defaultPayingBankId,
      targetLiabilityId: matchedTarget?.id,
      resolvedTxKind: matchedTarget?.kind === 'loan' ? 'emi' : 'cardPayment',
      fromLearnedRepaymentRule: false,
      confidenceBoost: matchedTarget ? 0.08 : 0.03,
    };
  }

  // CASE B: Standard Spend or Income SMS
  // 1. High-priority learned account digit override in `sms_rule_overrides` (using incremental suffix match!)
  if (parsed.accountLastDigits) {
    const learnedAcct = ruleOverrides.find(
      (r) =>
        r.ruleType === 'account_mapping' &&
        !r.isBlacklisted &&
        r.confidence > 0 &&
        r.accountLastDigits &&
        scoreTrailingDigitsMatch(parsed.accountLastDigits, r.accountLastDigits, true) >= 88 &&
        r.mappedSourceId &&
        isAllowed(r.mappedSourceId)
    );
    if (learnedAcct?.mappedSourceId) {
      const existsInVault =
        holdings.some((h) => h.id === learnedAcct.mappedSourceId) ||
        liabilities.some((l) => l.id === learnedAcct.mappedSourceId);
      if (existsInVault) {
        return {
          sourceId: learnedAcct.mappedSourceId,
          resolvedTxKind: parsed.txKind,
          confidenceBoost: 0.12,
        };
      }
    }
  }

  const isCardSms =
    /\bcard\b/i.test(stripHelplineAndDisputeFooter(parsed.rawSms)) &&
    !/\ba\/c\b|\bacct\b|\baccount\b/i.test(stripHelplineAndDisputeFooter(parsed.rawSms));

  // Build set of bank holdings matching bankHint so we can also prioritize cards linked (`linkedAccountId`) to that bank!
  const matchingBankHoldingIds = new Set(
    parsed.bankHint
      ? allAllowedHoldings
          .filter((h) => entityMatchesBankHint(h, parsed.bankHint))
          .map((h) => h.id)
      : []
  );

  const cardMatchesBankOrLinkedAccount = (card: Liability): boolean => {
    if (entityMatchesBankHint(card, parsed.bankHint)) return true;
    if (card.linkedAccountId && matchingBankHoldingIds.has(card.linkedAccountId)) return true;
    return false;
  };

  // 2. Incremental trailing-digit match across Cards & Holdings
  if (parsed.accountLastDigits) {
    const digits = parsed.accountLastDigits;

    const scoreEntity = (
      entity: { id: string; accountLastDigits?: string; name?: string; notes?: string },
      bankMatches: boolean
    ): number => {
      let best = 0;
      for (const cand of extractCandidateDigitTokensFromEntity(entity)) {
        const s =
          cand.weight < 0.7
            ? digits.length >= 4 && cand.digits.includes(digits)
              ? 72
              : 0
            : scoreTrailingDigitsMatch(digits, cand.digits, bankMatches);
        const total = s * cand.weight + (bankMatches && s > 0 ? 4 : 0);
        if (total > best) best = total;
      }
      return best;
    };

    if (isCardSms) {
      let bestCard: Liability | undefined;
      let bestCardScore = 0;
      for (const c of cards) {
        const sc = scoreEntity(c, cardMatchesBankOrLinkedAccount(c));
        if (sc > bestCardScore) {
          bestCardScore = sc;
          bestCard = c;
        }
      }
      if (bestCard && bestCardScore >= 45) {
        return { sourceId: bestCard.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.1 };
      }
    }

    let bestHold: Holding | undefined;
    let bestHoldScore = 0;
    for (const h of allAllowedHoldings) {
      const bankMatches = entityMatchesBankHint(h, parsed.bankHint);
      const isLiquidBonus = h.liquidityClass === 'Immediate' || h.typeId === 'type-bank' ? 2 : 0;
      const sc = scoreEntity(h, bankMatches) + (scoreEntity(h, bankMatches) > 0 ? isLiquidBonus : 0);
      if (sc > bestHoldScore) {
        bestHoldScore = sc;
        bestHold = h;
      }
    }
    if (bestHold && bestHoldScore >= 45) {
      return { sourceId: bestHold.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.1 };
    }

    let fallbackCard: Liability | undefined;
    let fallbackCardScore = 0;
    for (const c of cards) {
      const sc = scoreEntity(c, cardMatchesBankOrLinkedAccount(c));
      if (sc > fallbackCardScore) {
        fallbackCardScore = sc;
        fallbackCard = c;
      }
    }
    if (fallbackCard && fallbackCardScore >= 45) {
      return { sourceId: fallbackCard.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.08 };
    }
  }

  // 3. Match bank / institution keyword in SMS against Cards (including cards linked to matching bank account!) or Holdings
  if (parsed.bankHint) {
    if (isCardSms) {
      // Check cards linked to the matching bank account first, or cards whose name matches bankHint
      const linkedCards = cards.filter((c) => cardMatchesBankOrLinkedAccount(c));
      if (linkedCards.length === 1) {
        return { sourceId: linkedCards[0].id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.06 };
      }
      if (linkedCards.length > 1) {
        // Prefer credit card if SMS says Credit Card, else first linked card
        const preferred =
          linkedCards.find((c) => c.cardType === 'credit') || linkedCards[0];
        return { sourceId: preferred.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.04 };
      }
      // If user has not added the card yet, check if they have the bank account so it's pre-selected for review
      const parentBank = findBankHoldingByHint(parsed.bankHint);
      if (parentBank) {
        return { sourceId: parentBank.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.02 };
      }
    }

    const bankHold =
      liquidHoldings.find((h) => entityMatchesBankHint(h, parsed.bankHint)) ||
      allAllowedHoldings.find((h) => entityMatchesBankHint(h, parsed.bankHint));
    if (bankHold) {
      return { sourceId: bankHold.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.06 };
    }
  }

  // 4. Direct holding name substring match in SMS body
  for (const h of liquidHoldings) {
    const cleanName = h.name.trim().toLowerCase();
    if (cleanName.length >= 4 && parsed.rawSms.toLowerCase().includes(cleanName)) {
      return { sourceId: h.id, resolvedTxKind: parsed.txKind, confidenceBoost: 0.05 };
    }
  }

  // 5. Unambiguous single Immediate bank account fallback (if only 1 bank account exists)
  if (!isCardSms && liquidHoldings.length === 1) {
    return { sourceId: liquidHoldings[0].id, resolvedTxKind: parsed.txKind, confidenceBoost: 0 };
  }

  return { sourceId: undefined, resolvedTxKind: parsed.txKind, confidenceBoost: 0 };
}

/**
 * Co-Learning ML Reason & Category Predictor:
 * Suggests likely human reasons & categories for an SMS spend/credit based on:
 * 1. Exact learned `rawCounterpartyKey` or `merchantAlias` in `sms_rule_overrides`
 * 2. Historical ledger transactions with matching VPA/counterparty
 * 3. Historical ledger spends with similar amount (±25% or ±₹15) and/or same card/bank source (e.g. past ₹50–₹55 UPI spends -> "Tea & Snacks", "Auto / Commute").
 */
export function suggestSmsReasonsFromHistory(
  parsed: ParsedFinancialSms,
  matchedSourceId: string | undefined,
  ruleOverrides: SmsRuleOverride[],
  pastTransactions: Transaction[]
): SmsSuggestedReason[] {
  const suggestions: SmsSuggestedReason[] = [];
  const seenReasons = new Set<string>();

  const pushUnique = (item: SmsSuggestedReason) => {
    const key = `${item.reason.trim().toLowerCase()}::${item.category.trim().toLowerCase()}`;
    if (!item.reason.trim() || seenReasons.has(key)) return;
    seenReasons.add(key);
    suggestions.push(item);
  };

  const cpKey = normalizeCounterpartyKey(parsed.rawCounterparty);
  const alias = normalizeMerchantAlias(parsed.merchantName);

  // 1. Exact learned counterparty / merchant overrides
  for (const r of ruleOverrides) {
    if (r.ruleType !== 'merchant_category' || r.isBlacklisted || r.confidence <= 0) continue;
    const exactCpMatch = Boolean(cpKey && r.rawCounterpartyKey && r.rawCounterpartyKey === cpKey);
    const aliasMatch = Boolean(alias && r.merchantAlias && r.merchantAlias === alias);
    if (exactCpMatch || aliasMatch) {
      const reason = r.mappedReason || r.merchantDisplayName || parsed.merchantName;
      if (reason && !isOpaqueCounterpartyOrPlaceholder(reason)) {
        pushUnique({
          reason,
          category: r.mappedCategory || 'General',
          confidence: 0.98,
          basis: exactCpMatch ? 'Learned from your past review of this VPA' : 'Learned merchant rule',
        });
      }
    }
  }

  // 2. Historical transactions matching same VPA / merchant or similar amount + source
  const desiredKind = parsed.direction === 'credit' ? 'income' : 'spend';
  const reasonBuckets = new Map<
    string,
    { reason: string; category: string; score: number; count: number; basis: string }
  >();

  for (const tx of pastTransactions) {
    if (tx.isReversed) continue;
    if (tx.kind !== desiredKind) continue;
    const cleanReason = (tx.reason || '').trim();
    if (!cleanReason || isOpaqueCounterpartyOrPlaceholder(cleanReason)) continue;

    let score = 0;
    let basis = '';

    const txCp = normalizeCounterpartyKey(tx.smsMetadata?.rawCounterparty);
    const txAlias = normalizeMerchantAlias(tx.smsMetadata?.merchantName || cleanReason);

    if (cpKey && txCp && cpKey === txCp) {
      score += 80;
      basis = 'Same UPI handle';
    } else if (alias && txAlias && alias.length >= 3 && (alias === txAlias || txAlias.includes(alias))) {
      score += 65;
      basis = 'Same merchant';
    }

    const amtDiff = Math.abs(tx.amount - parsed.amount);
    const relDiff = parsed.amount > 0 ? amtDiff / parsed.amount : 1;
    if (amtDiff < 0.01) {
      score += 38;
      if (!basis) basis = `Exact ₹${parsed.amount} match`;
    } else if (relDiff <= 0.25 || amtDiff <= 15) {
      score += 24;
      if (!basis) basis = `Similar amount (~₹${Math.round(tx.amount)})`;
    }

    const txSrc = tx.fromId || tx.sourceId || tx.toId;
    if (matchedSourceId && txSrc === matchedSourceId && score > 0) {
      score += 12;
    }
    if (parsed.paymentMode === 'upi' && tx.paymentMode === 'upi' && score > 0) {
      score += 6;
    }

    if (score >= 24) {
      const bucketKey = cleanReason.toLowerCase();
      const prev = reasonBuckets.get(bucketKey);
      if (prev) {
        prev.score += Math.min(25, score * 0.5);
        prev.count += 1;
      } else {
        reasonBuckets.set(bucketKey, {
          reason: cleanReason,
          category: tx.category || (desiredKind === 'income' ? 'Income' : 'General'),
          score,
          count: 1,
          basis,
        });
      }
    }
  }

  const ranked = Array.from(reasonBuckets.values()).sort(
    (a, b) => b.score - a.score || b.count - a.count
  );
  for (const item of ranked.slice(0, 4)) {
    pushUnique({
      reason: item.reason,
      category: item.category,
      confidence: Math.min(0.95, roundCurrency(0.55 + item.score / 200)),
      basis: item.count > 1 ? `${item.basis} (${item.count}x)` : item.basis,
    });
  }

  return suggestions.slice(0, 3);
}

/**
 * Resolves the transaction category AND learned human reason for a parsed SMS by consulting
 * `sms_rule_overrides` (`rawCounterpartyKey` and `merchantAlias`) FIRST, then ML history suggestions,
 * then `suggestCategoryFromDescription`.
 */
export function resolveSmsCategoryAndReason(
  parsed: ParsedFinancialSms,
  matchedSourceId: string | undefined,
  ruleOverrides: SmsRuleOverride[],
  pastTransactions: Transaction[],
  availableCategories: SpendCategoryConfig[]
): {
  category: string;
  resolvedReason: string;
  fromLearnedOverride: boolean;
  suggestedReasons: SmsSuggestedReason[];
} {
  if (parsed.isCardOrLoanRepayment) {
    return {
      category: 'Credit Cards',
      resolvedReason: parsed.merchantName,
      fromLearnedOverride: false,
      suggestedReasons: [],
    };
  }

  const cpKey = normalizeCounterpartyKey(parsed.rawCounterparty);
  const alias = normalizeMerchantAlias(parsed.merchantName);
  const suggestedReasons = suggestSmsReasonsFromHistory(
    parsed,
    matchedSourceId,
    ruleOverrides,
    pastTransactions
  );

  // 1. Exact rawCounterpartyKey match (e.g. learned VPA `paytm-8774066@ptybl` -> reason "Morning Tea" + category "Food & Dining")
  if (cpKey) {
    const exactCpRule = ruleOverrides
      .filter(
        (r) =>
          r.ruleType === 'merchant_category' &&
          !r.isBlacklisted &&
          r.confidence > 0 &&
          r.rawCounterpartyKey &&
          r.rawCounterpartyKey === cpKey
      )
      .sort((a, b) => b.confidence - a.confidence || b.hitCount - a.hitCount)[0];

    if (exactCpRule) {
      return {
        category:
          exactCpRule.mappedCategory ||
          (parsed.direction === 'credit' ? 'Income' : 'General'),
        resolvedReason:
          exactCpRule.mappedReason ||
          exactCpRule.merchantDisplayName ||
          parsed.merchantName,
        fromLearnedOverride: true,
        suggestedReasons,
      };
    }
  }

  // 2. Merchant alias match (skip generic "paytm" prefix if rawCounterparty is an unlearned `paytm-<digits>@...` merchant QR)
  const isUnlearnedGatewayQr = isOpaqueCounterpartyOrPlaceholder(
    parsed.merchantName,
    parsed.rawCounterparty
  );
  if (alias && !isUnlearnedGatewayQr) {
    const learnedRule = ruleOverrides
      .filter(
        (r) =>
          r.ruleType === 'merchant_category' &&
          !r.isBlacklisted &&
          r.confidence > 0 &&
          r.mappedCategory &&
          r.merchantAlias &&
          (r.merchantAlias === alias ||
            (alias.length >= 4 &&
              r.merchantAlias.length >= 4 &&
              (alias.includes(r.merchantAlias) || r.merchantAlias.includes(alias))))
      )
      .sort((a, b) => b.confidence - a.confidence || b.hitCount - a.hitCount)[0];

    if (learnedRule?.mappedCategory) {
      return {
        category: learnedRule.mappedCategory,
        resolvedReason: learnedRule.mappedReason || parsed.merchantName,
        fromLearnedOverride: true,
        suggestedReasons,
      };
    }
  }

  if (parsed.direction === 'credit') {
    const topIncomeSuggestion = suggestedReasons[0];
    return {
      category: topIncomeSuggestion?.category || 'Income',
      resolvedReason: parsed.merchantName,
      fromLearnedOverride: false,
      suggestedReasons,
    };
  }

  const suggestion = suggestCategoryFromDescription(
    parsed.merchantName,
    pastTransactions,
    availableCategories
  );
  if (suggestion?.category && !isUnlearnedGatewayQr) {
    return {
      category: suggestion.category,
      resolvedReason: parsed.merchantName,
      fromLearnedOverride: false,
      suggestedReasons,
    };
  }

  if (suggestedReasons.length > 0) {
    return {
      category: suggestedReasons[0].category || 'General',
      resolvedReason: isUnlearnedGatewayQr ? parsed.merchantName : suggestedReasons[0].reason,
      fromLearnedOverride: false,
      suggestedReasons,
    };
  }

  return {
    category: 'General',
    resolvedReason: parsed.merchantName,
    fromLearnedOverride: false,
    suggestedReasons,
  };
}

export function resolveSmsCategory(
  parsed: ParsedFinancialSms,
  ruleOverrides: SmsRuleOverride[],
  pastTransactions: Transaction[],
  availableCategories: SpendCategoryConfig[]
): { category: string; fromLearnedOverride: boolean } {
  const res = resolveSmsCategoryAndReason(
    parsed,
    undefined,
    ruleOverrides,
    pastTransactions,
    availableCategories
  );
  return { category: res.category, fromLearnedOverride: res.fromLearnedOverride };
}

/**
 * Evaluates post-transaction bank balance consistency when SMS reports an explicit closing/available balance.
 * Example: Existing Canara Bank balance in app = ₹12,000, SMS credits ₹54.90 and reports `Bal INR 13,403.67`.
 * Expected = `12000 + 54.90 = 12054.90` != `13403.67` -> raises `SmsBalanceDiscrepancy` (`delta = +1348.77`) so user can investigate or sync!
 */
export function evaluateSmsBalanceDiscrepancy(params: {
  stagingId: string;
  holding: Holding | undefined;
  smsAmount: number;
  direction: 'debit' | 'credit';
  reportedBalance?: number;
  accountLastDigits?: string;
  parsedDate: string;
  rawSms: string;
}): SmsBalanceDiscrepancy | undefined {
  const {
    stagingId,
    holding,
    smsAmount,
    direction,
    reportedBalance,
    accountLastDigits,
    parsedDate,
    rawSms,
  } = params;

  if (!holding || reportedBalance === undefined || isNaN(reportedBalance)) {
    return undefined;
  }

  const previousAppBalance = roundCurrency(holding.principalOrValue || 0);
  const expectedAppBalance =
    direction === 'credit'
      ? roundCurrency(previousAppBalance + smsAmount)
      : roundCurrency(previousAppBalance - smsAmount);

  const delta = roundCurrency(reportedBalance - expectedAppBalance);
  if (Math.abs(delta) < 0.01) {
    return undefined;
  }

  return {
    id: `bal-mismatch-${stagingId}`,
    holdingId: holding.id,
    holdingName: holding.name,
    accountLastDigits: accountLastDigits || holding.accountLastDigits,
    smsAmount: roundCurrency(smsAmount),
    direction,
    previousAppBalance,
    expectedAppBalance,
    smsReportedBalance: roundCurrency(reportedBalance),
    delta,
    currency: holding.currency,
    parsedDate,
    rawSms,
    resolved: false,
  };
}

/**
 * Checks whether a parsed SMS matches a user-invalidated blacklist rule (`confidence === 0` or `isBlacklisted`).
 */
export function isSmsBlacklistedByOverrides(
  parsed: ParsedFinancialSms,
  ruleOverrides: SmsRuleOverride[]
): SmsRuleOverride | undefined {
  const alias = normalizeMerchantAlias(parsed.merchantName);
  return ruleOverrides.find((r) => {
    if (!r.isBlacklisted && r.confidence > 0) return false;
    if (r.ruleType !== 'pattern_blacklist') return false;
    if (r.patternSignature && r.patternSignature === parsed.patternSignature) {
      if (r.merchantAlias && alias) {
        return r.merchantAlias === alias;
      }
      return true;
    }
    return false;
  });
}

/**
 * Strict 5-Minute Duplication Prevention Check (`duplicateDetectionWindowMinutes: 5`).
 */
export function findSmsDuplicateWithinWindow(
  candidate: {
    amount: number;
    parsedTimestampIso: string;
    parsedDate: string;
    matchedSourceId?: string;
    merchantName: string;
    refId?: string;
    direction: 'debit' | 'credit';
    rawSms?: string;
    rawSmsFingerprint?: string;
    deviceMessageId?: string;
  },
  existingTransactions: Transaction[],
  existingStagingQueue: StagedSmsItem[] = [],
  windowMinutes: number = SMS_STRICT_DUPLICATE_WINDOW_MINUTES
): { isDuplicate: boolean; duplicateTxId?: string; reason?: string } {
  const strictWindowMs = Math.max(1, windowMinutes) * 60 * 1000;
  const candTimeMs = new Date(candidate.parsedTimestampIso).getTime();
  const candAlias = normalizeMerchantAlias(candidate.merchantName);
  const candRawClean = (candidate.rawSms || '').trim();

  // 1. Check main ledger transactions
  for (const tx of existingTransactions) {
    if (tx.isReversed) continue;

    // Cross-sync check A: Identical globally unique bank reference ID
    if (
      candidate.refId &&
      candidate.refId.length >= 5 &&
      tx.smsMetadata?.refId &&
      tx.smsMetadata.refId.toLowerCase() === candidate.refId.toLowerCase()
    ) {
      return {
        isDuplicate: true,
        duplicateTxId: tx.id,
        reason: `Identical bank reference ID (${candidate.refId}) already recorded.`,
      };
    }

    // Cross-sync check B: Identical raw SMS message text
    if (
      candRawClean &&
      tx.smsMetadata?.rawSms &&
      tx.smsMetadata.rawSms.trim() === candRawClean
    ) {
      return {
        isDuplicate: true,
        duplicateTxId: tx.id,
        reason: `Identical SMS message body already recorded in transaction ${tx.id}.`,
      };
    }

    // Cross-sync check C: Identical canonical SMS fingerprint
    if (
      candidate.rawSmsFingerprint &&
      tx.smsMetadata?.rawSmsFingerprint &&
      tx.smsMetadata.rawSmsFingerprint === candidate.rawSmsFingerprint
    ) {
      return {
        isDuplicate: true,
        duplicateTxId: tx.id,
        reason: `Identical SMS fingerprint already recorded in transaction ${tx.id}.`,
      };
    }

    if (Math.abs(tx.amount - candidate.amount) >= 0.01) continue;

    const txSource = candidate.direction === 'debit' ? tx.fromId || tx.sourceId : tx.toId;
    if (candidate.matchedSourceId && txSource && candidate.matchedSourceId !== txSource) {
      continue;
    }

    // If both transactions have distinct, different reference IDs, they are distinct real spends
    const hasDifferentRefId = Boolean(
      candidate.refId &&
        tx.smsMetadata?.refId &&
        candidate.refId.toLowerCase() !== tx.smsMetadata.refId.toLowerCase()
    );
    if (hasDifferentRefId) {
      continue;
    }

    // Cross-sync check D: Exact same calendar date, account, amount, and merchant name
    if (candidate.parsedDate === tx.date) {
      const txAlias = normalizeMerchantAlias(tx.smsMetadata?.merchantName || tx.reason);
      if (candAlias && txAlias && candAlias === txAlias) {
        return {
          isDuplicate: true,
          duplicateTxId: tx.id,
          reason: `Transaction of ${candidate.amount} on ${candidate.parsedDate} already recorded in ledger (${tx.id}).`,
        };
      }
    }

    const txTimeStr = tx.createdAt || `${tx.date}T12:00:00.000Z`;
    const txTimeMs = new Date(txTimeStr).getTime();
    if (isNaN(candTimeMs) || isNaN(txTimeMs)) continue;

    const timeDiffMs = Math.abs(candTimeMs - txTimeMs);
    if (timeDiffMs <= strictWindowMs) {
      const txAlias = normalizeMerchantAlias(tx.smsMetadata?.merchantName || tx.reason);
      const reasonMatches =
        !candAlias ||
        !txAlias ||
        candAlias === txAlias ||
        txAlias.includes(candAlias) ||
        candAlias.includes(txAlias);

      if (reasonMatches) {
        return {
          isDuplicate: true,
          duplicateTxId: tx.id,
          reason: `Duplicate within ${windowMinutes}-minute window of ledger transaction ${tx.id}.`,
        };
      }
    }
  }

  // 2. Check active staged items
  for (const staged of existingStagingQueue) {
    if (staged.status !== 'staged' && staged.status !== 'committed') continue;

    // Cross-sync staging check A: Identical bank reference ID
    if (
      candidate.refId &&
      candidate.refId.length >= 5 &&
      staged.refId &&
      staged.refId.toLowerCase() === candidate.refId.toLowerCase()
    ) {
      return {
        isDuplicate: true,
        duplicateTxId: staged.committedTxId || staged.id,
        reason: `Identical reference ID (${candidate.refId}) already in staging queue.`,
      };
    }

    // Cross-sync staging check B: Identical raw SMS message text
    if (
      candRawClean &&
      staged.rawSms &&
      staged.rawSms.trim() === candRawClean
    ) {
      return {
        isDuplicate: true,
        duplicateTxId: staged.committedTxId || staged.id,
        reason: `Identical SMS message body already in staging queue (${staged.id}).`,
      };
    }

    // Cross-sync staging check C: Identical canonical SMS fingerprint
    if (
      candidate.rawSmsFingerprint &&
      staged.rawSmsFingerprint &&
      staged.rawSmsFingerprint === candidate.rawSmsFingerprint
    ) {
      return {
        isDuplicate: true,
        duplicateTxId: staged.committedTxId || staged.id,
        reason: `Identical SMS fingerprint already in staging queue (${staged.id}).`,
      };
    }

    if (Math.abs(staged.amount - candidate.amount) >= 0.01) continue;
    if (
      candidate.matchedSourceId &&
      staged.matchedSourceId &&
      candidate.matchedSourceId !== staged.matchedSourceId
    ) {
      continue;
    }

    const hasDifferentRefId = Boolean(
      candidate.refId &&
        staged.refId &&
        candidate.refId.toLowerCase() !== staged.refId.toLowerCase()
    );
    if (hasDifferentRefId) {
      continue;
    }

    const stagedMs = new Date(staged.parsedTimestampIso).getTime();
    if (!isNaN(candTimeMs) && !isNaN(stagedMs) && Math.abs(candTimeMs - stagedMs) <= strictWindowMs) {
      const stagedAlias = normalizeMerchantAlias(staged.merchantName);
      if (!candAlias || candAlias === stagedAlias) {
        return {
          isDuplicate: true,
          duplicateTxId: staged.committedTxId || staged.id,
          reason: `Duplicate within ${windowMinutes}-minute staging window.`,
        };
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Builds a `Transaction` object ready for atomic ledger insertion from a `StagedSmsItem`.
 * Supports `spend`, `income`, `cardPayment`, and `emi` (e.g. Loan Against Credit Card).
 */
export function buildLedgerTransactionFromStagedSms(
  staged: StagedSmsItem,
  fxRateUsed: number = 1.0
): Transaction {
  const txId = `tx-sms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const kind: SmsParsedTxKind =
    staged.txKind || (staged.direction === 'debit' ? 'spend' : 'income');

  const mappedPaymentMode: Transaction['paymentMode'] =
    staged.paymentMode === 'upi'
      ? 'upi'
      : staged.paymentMode === 'imps'
      ? 'imps'
      : staged.paymentMode === 'neft' || staged.paymentMode === 'netbanking'
      ? 'neft'
      : staged.paymentMode === 'debit_card' || staged.paymentMode === 'atm'
      ? 'debit_card'
      : undefined;

  const isRepayment = kind === 'cardPayment' || kind === 'emi';

  return {
    id: txId,
    date: staged.parsedDate,
    createdAt: staged.parsedTimestampIso,
    kind,
    amount: roundCurrency(staged.amount),
    currency: staged.currency,
    ...(isRepayment
      ? {
          fromId: staged.matchedSourceId,
          sourceId: staged.matchedSourceId,
          toId: staged.matchedTargetLiabilityId,
        }
      : kind === 'spend'
      ? { fromId: staged.matchedSourceId, sourceId: staged.matchedSourceId }
      : { toId: staged.matchedSourceId }),
    reason: staged.merchantName,
    category:
      staged.matchedCategory ||
      (kind === 'emi'
        ? 'Loans & EMI'
        : kind === 'cardPayment'
        ? 'Credit Cards'
        : kind === 'income'
        ? 'Income'
        : 'General'),
    paymentMode: mappedPaymentMode,
    tags: [
      'SMS Auto-Captured',
      ...(staged.paymentMode === 'upi' ? ['UPI'] : []),
      ...(staged.paymentMode === 'imps' ? ['IMPS'] : []),
    ],
    fxRateUsed,
    reconciled: !staged.balanceDiscrepancy,
    notes: staged.refId
      ? `Captured on-device from SMS (Ref: ${staged.refId})`
      : 'Captured on-device from financial SMS',
    smsMetadata: {
      stagingId: staged.id,
      patternSignature: staged.patternSignature,
      merchantName: staged.merchantName,
      rawCounterparty: staged.rawCounterparty,
      accountLastDigits: staged.accountLastDigits,
      refId: staged.refId,
      reportedBalance: staged.reportedBalance,
      rawSms: staged.rawSms,
      rawSmsFingerprint: staged.rawSmsFingerprint,
      deviceMessageId: staged.deviceMessageId,
    },
    provenance: createProvenance('imported', 'On-device SMS parser & RL router'),
  };
}

/**
 * Full on-device SMS Ingestion Pipeline:
 * 1. Filters noise (OTPs, promos, passive balance notices)
 * 2. Extracts structured fields deterministically (including `Txn`, `Cr`, `IMPS`, `DD-MM` dates, `reportedBalance`, and Card/Loan repayments)
 * 3. Applies `sms_rule_overrides` (blacklists, incremental trailing-digit account/card/loan mappings, learned VPA/merchant reasons & categories)
 * 4. Evaluates post-transaction bank balance discrepancy (`existingBalance +/- amount !== reportedBalance`)
 * 5. Stages items requiring user review (such as Credit Card / Loan-Against-Card repayments or unlearned opaque UPI handles), while auto-committing unambiguous matches when `autoCommit` is enabled.
 */
export function processIncomingSmsBatchOnDevice(params: {
  messages: { id?: string; sender?: string; body: string; timestampMs?: number }[];
  holdings: Holding[];
  liabilities: Liability[];
  transactions: Transaction[];
  spendCategories: SpendCategoryConfig[];
  ruleOverrides: SmsRuleOverride[];
  stagingQueue: StagedSmsItem[];
  defaultCurrency?: string;
  autoCommit?: boolean;
}): {
  updatedHoldings: Holding[];
  updatedLiabilities: Liability[];
  updatedTransactions: Transaction[];
  updatedStagingQueue: StagedSmsItem[];
  newlyCommittedTransactions: Transaction[];
  newlyStagedItems: StagedSmsItem[];
  balanceDiscrepancies: SmsBalanceDiscrepancy[];
  droppedNoiseCount: number;
  discardedDuplicateCount: number;
  blacklistedCount: number;
} {
  const {
    messages,
    spendCategories,
    ruleOverrides,
    defaultCurrency = 'INR',
    autoCommit = true,
  } = params;

  const workingHoldings = (params.holdings || []).map((h) => ({ ...h }));
  const workingLiabilities = (params.liabilities || []).map((l) => ({ ...l }));
  const workingTransactions = [...(params.transactions || [])];
  const workingStaging = [...(params.stagingQueue || [])];

  const newlyCommittedTransactions: Transaction[] = [];
  const newlyStagedItems: StagedSmsItem[] = [];
  const balanceDiscrepancies: SmsBalanceDiscrepancy[] = [];
  let droppedNoiseCount = 0;
  let discardedDuplicateCount = 0;
  let blacklistedCount = 0;

  for (const msg of messages) {
    const receivedIso = msg.timestampMs
      ? new Date(msg.timestampMs).toISOString()
      : new Date().toISOString();

    const verdict = classifyFinancialSms(msg.body, msg.sender);
    if (!verdict.passed) {
      droppedNoiseCount++;
      continue;
    }

    const parsed = parseFinancialSms(msg.body, {
      sender: msg.sender,
      receivedAtIso: receivedIso,
      defaultCurrency,
    });
    if (!parsed) {
      droppedNoiseCount++;
      continue;
    }

    const stagingId = `sms-stage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Check active RL blacklist overrides
    const blacklistHit = isSmsBlacklistedByOverrides(parsed, ruleOverrides);
    if (blacklistHit) {
      blacklistedCount++;
      const blacklistedItem: StagedSmsItem = {
        id: stagingId,
        rawSms: parsed.rawSms,
        sender: parsed.sender,
        receivedAt: receivedIso,
        parsedDate: parsed.parsedDate,
        parsedTimestampIso: parsed.parsedTimestampIso,
        amount: parsed.amount,
        currency: parsed.currency,
        direction: parsed.direction,
        txKind: parsed.txKind,
        merchantName: parsed.merchantName,
        rawCounterparty: parsed.rawCounterparty,
        accountLastDigits: parsed.accountLastDigits,
        bankHint: parsed.bankHint,
        paymentMode: parsed.paymentMode,
        refId: parsed.refId,
        patternSignature: parsed.patternSignature,
        matchedCategory: 'Blacklisted',
        confidence: 0,
        status: 'blacklisted',
        dropReason: `Blocked by user override (${blacklistHit.flagReason || 'invalid'})`,
      };
      workingStaging.unshift(blacklistedItem);
      continue;
    }

    const {
      sourceId,
      targetLiabilityId,
      resolvedTxKind,
      fromLearnedRepaymentRule,
      confidenceBoost,
    } = resolveSmsTargetSource(parsed, workingHoldings, workingLiabilities, ruleOverrides);

    const {
      category,
      resolvedReason,
      fromLearnedOverride,
      suggestedReasons,
    } = resolveSmsCategoryAndReason(
      parsed,
      sourceId,
      ruleOverrides,
      workingTransactions,
      spendCategories
    );

    const confidence = Math.min(
      1.0,
      roundCurrency(parsed.baseConfidence + confidenceBoost + (fromLearnedOverride ? 0.08 : 0))
    );

    const rawSmsFingerprint = computeSmsFingerprint(msg);

    // Strict duplicate guard (cross-sync refId, rawSms text, fingerprint, and timing checks)
    const dupCheck = findSmsDuplicateWithinWindow(
      {
        amount: parsed.amount,
        parsedTimestampIso: parsed.parsedTimestampIso,
        parsedDate: parsed.parsedDate,
        matchedSourceId: sourceId,
        merchantName: resolvedReason,
        refId: parsed.refId,
        direction: parsed.direction,
        rawSms: parsed.rawSms,
        rawSmsFingerprint,
        deviceMessageId: msg.id,
      },
      workingTransactions,
      workingStaging,
      SMS_STRICT_DUPLICATE_WINDOW_MINUTES
    );

    if (dupCheck.isDuplicate) {
      discardedDuplicateCount++;
      const dupItem: StagedSmsItem = {
        id: stagingId,
        deviceMessageId: msg.id,
        rawSms: parsed.rawSms,
        rawSmsFingerprint,
        sender: parsed.sender,
        receivedAt: receivedIso,
        parsedDate: parsed.parsedDate,
        parsedTimestampIso: parsed.parsedTimestampIso,
        amount: parsed.amount,
        currency: parsed.currency,
        direction: parsed.direction,
        txKind: resolvedTxKind,
        merchantName: resolvedReason,
        rawCounterparty: parsed.rawCounterparty,
        accountLastDigits: parsed.accountLastDigits,
        bankHint: parsed.bankHint,
        paymentMode: parsed.paymentMode,
        refId: parsed.refId,
        patternSignature: parsed.patternSignature,
        matchedSourceId: sourceId,
        matchedTargetLiabilityId: targetLiabilityId,
        matchedCategory: category,
        confidence,
        status: 'discarded_duplicate',
        duplicateOfTxId: dupCheck.duplicateTxId,
        dropReason: dupCheck.reason,
      };
      workingStaging.unshift(dupItem);
      continue;
    }

    // Evaluate post-transaction balance discrepancy BEFORE mutating holding balance
    const targetBankHolding =
      resolvedTxKind === 'spend' || resolvedTxKind === 'income'
        ? workingHoldings.find((h) => h.id === sourceId)
        : undefined;
    const balanceDiscrepancy = evaluateSmsBalanceDiscrepancy({
      stagingId,
      holding: targetBankHolding,
      smsAmount: parsed.amount,
      direction: parsed.direction,
      reportedBalance: parsed.reportedBalance,
      accountLastDigits: parsed.accountLastDigits,
      parsedDate: parsed.parsedDate,
      rawSms: parsed.rawSms,
    });
    if (balanceDiscrepancy) {
      balanceDiscrepancies.push(balanceDiscrepancy);
    }

    // Determine whether this SMS should pause in the Staging Queue for user review:
    // 1. Card / Loan-Against-Card repayments ALWAYS stage in queue for review (unless user already trained an explicit `repayment_routing` rule with both bank + target liability, OR if user asked to review card payments in queue — per user spec: "add them in queue user will review them and edit and update them based on that ml model should do the same user reviews", so we stage card repayments with pre-filled learned defaults!)
    // 2. Opaque VPA handles (`paytm-8774066@ptybl`) that have NOT been learned yet stage in queue with ML suggested reasons so user can enter/pick the exact reason.
    // 3. Card SMS where no card digits matched a configured card (fell back to bank holding) stages in queue so user can confirm card/account.
    const isUnmatchedCardDigits =
      parsed.accountLastDigits &&
      /\bcard\b/i.test(parsed.rawSms) &&
      !parsed.isCardOrLoanRepayment &&
      sourceId &&
      !workingLiabilities.some((l) => l.id === sourceId);

    const needsOpaqueReasonInput =
      !fromLearnedOverride &&
      isOpaqueCounterpartyOrPlaceholder(resolvedReason, parsed.rawCounterparty);

    let requiresReview = false;
    let reviewHint: string | undefined;

    if (parsed.isCardOrLoanRepayment) {
      requiresReview = true;
      reviewHint = fromLearnedRepaymentRule
        ? 'Pre-filled from your previous review — confirm or adjust paying bank & card/loan target.'
        : `Card / loan payment towards ··${parsed.accountLastDigits || 'card'} — confirm whether this settles a Credit Card bill or a Loan Against Credit Card.`;
    } else if (isUnmatchedCardDigits) {
      requiresReview = true;
      reviewHint = `Card ending ··${parsed.accountLastDigits} is not yet linked to a card in Liabilities — select the card or add its last 4 digits.`;
    } else if (needsOpaqueReasonInput) {
      requiresReview = true;
      reviewHint =
        suggestedReasons.length > 0
          ? 'UPI merchant handle is numeric — pick a suggested reason from your past spends or enter one so the model remembers it.'
          : 'Enter a short reason for this UPI handle — the model will remember it for future spends.';
    }

    const canAutoCommitNow =
      autoCommit &&
      !requiresReview &&
      Boolean(sourceId) &&
      (resolvedTxKind === 'cardPayment' || resolvedTxKind === 'emi'
        ? Boolean(targetLiabilityId)
        : true) &&
      confidence >= 0.7;

    const stagedItem: StagedSmsItem = {
      id: stagingId,
      deviceMessageId: msg.id,
      rawSms: parsed.rawSms,
      rawSmsFingerprint,
      sender: parsed.sender,
      receivedAt: receivedIso,
      parsedDate: parsed.parsedDate,
      parsedTimestampIso: parsed.parsedTimestampIso,
      amount: parsed.amount,
      currency: parsed.currency,
      direction: parsed.direction,
      txKind: resolvedTxKind,
      merchantName: resolvedReason,
      rawCounterparty: parsed.rawCounterparty,
      accountLastDigits: parsed.accountLastDigits,
      bankHint: parsed.bankHint,
      paymentMode: parsed.paymentMode,
      refId: parsed.refId,
      patternSignature: parsed.patternSignature,
      matchedSourceId: sourceId,
      matchedTargetLiabilityId: targetLiabilityId,
      matchedCategory:
        resolvedTxKind === 'emi' && category === 'Credit Cards' ? 'Loans & EMI' : category,
      reportedBalance: parsed.reportedBalance,
      reportedAvailableLimit: parsed.reportedAvailableLimit,
      requiresReview,
      reviewHint,
      suggestedReasons,
      balanceDiscrepancy,
      confidence,
      status: 'staged',
    };

    if (canAutoCommitNow) {
      const newTx = buildLedgerTransactionFromStagedSms(stagedItem, 1.0);
      applyTransactionBalanceMutationInMemory(
        newTx,
        workingHoldings,
        workingLiabilities
      );
      stagedItem.status = 'committed';
      stagedItem.committedTxId = newTx.id;
      workingTransactions.unshift(newTx);
      newlyCommittedTransactions.push(newTx);
    } else {
      newlyStagedItems.push(stagedItem);
    }

    workingStaging.unshift(stagedItem);
  }

  return {
    updatedHoldings: workingHoldings,
    updatedLiabilities: workingLiabilities,
    updatedTransactions: workingTransactions,
    updatedStagingQueue: workingStaging.slice(0, 500),
    newlyCommittedTransactions,
    newlyStagedItems,
    balanceDiscrepancies,
    droppedNoiseCount,
    discardedDuplicateCount,
    blacklistedCount,
  };
}

/**
 * Mutates holding / card / loan balances in-memory for atomic commit to IndexedDB.
 */
export function applyTransactionBalanceMutationInMemory(
  tx: Transaction,
  holdings: Holding[],
  liabilities: Liability[]
): void {
  if (tx.kind === 'spend') {
    const srcId = tx.fromId || tx.sourceId;
    if (!srcId) return;
    const hold = holdings.find((h) => h.id === srcId);
    if (hold) {
      hold.principalOrValue = roundCurrency((hold.principalOrValue || 0) - tx.amount);
      return;
    }
    const card = liabilities.find((l) => l.id === srcId && l.kind === 'card');
    if (card) {
      if (card.cardType === 'debit' && card.linkedAccountId) {
        const linked = holdings.find((h) => h.id === card.linkedAccountId);
        if (linked) {
          linked.principalOrValue = roundCurrency((linked.principalOrValue || 0) - tx.amount);
        }
        card.debitUsageCount = (card.debitUsageCount || 0) + 1;
      } else {
        card.outstanding = roundCurrency((card.outstanding || 0) + tx.amount);
      }
    }
  } else if (tx.kind === 'income') {
    if (!tx.toId) return;
    const hold = holdings.find((h) => h.id === tx.toId);
    if (hold) {
      hold.principalOrValue = roundCurrency((hold.principalOrValue || 0) + tx.amount);
    }
  } else if (tx.kind === 'cardPayment' || tx.kind === 'emi') {
    const srcId = tx.fromId || tx.sourceId;
    if (srcId) {
      const hold = holdings.find((h) => h.id === srcId);
      if (hold) {
        hold.principalOrValue = roundCurrency((hold.principalOrValue || 0) - tx.amount);
      }
    }
    if (tx.toId) {
      const targetLiab = liabilities.find((l) => l.id === tx.toId);
      if (targetLiab) {
        targetLiab.outstanding = Math.max(
          0,
          roundCurrency((targetLiab.outstanding || 0) - tx.amount)
        );
      }
    }
  }
}

/**
 * ACTIVE CO-LEARNING — User Review & Edit of a Staged SMS Item:
 * Learns from every review choice the user makes before committing:
 * 1. If it's a Card / Loan-Against-Card repayment (`cardPayment` or `emi`), stores a `repayment_routing` rule
 *    mapping `accountLastDigits` (e.g. `6382`) -> `{ mappedSourceId, mappedTargetLiabilityId, mappedTxKind }`
 *    so future SMS messages for `6382` automatically pre-select the user's Loan Against Credit Card + paying bank!
 * 2. Stores `account_mapping` when user assigns or corrects `sourceId` for `accountLastDigits`.
 * 3. Stores `merchant_category` mapping `rawCounterpartyKey` (e.g. `paytm-8774066@ptybl`) and `merchantAlias`
 *    -> `{ mappedReason, mappedCategory }` so future spends at that VPA/merchant automatically know the human reason & category!
 */
export function learnFromUserSmsReview(params: {
  stagedItem: StagedSmsItem;
  finalSourceId?: string;
  finalTargetLiabilityId?: string;
  finalTxKind: SmsParsedTxKind;
  finalReason: string;
  finalCategory: string;
  existingOverrides: SmsRuleOverride[];
}): SmsRuleOverride[] {
  const {
    stagedItem,
    finalSourceId,
    finalTargetLiabilityId,
    finalTxKind,
    finalReason,
    finalCategory,
    existingOverrides,
  } = params;

  const nowIso = new Date().toISOString();
  let next = existingOverrides.map((r) => ({ ...r }));

  // 1. Learn Card / Loan-Against-Card Repayment routing
  if (
    (finalTxKind === 'cardPayment' || finalTxKind === 'emi') &&
    (finalTargetLiabilityId || finalSourceId)
  ) {
    const existingRepayIdx = next.findIndex(
      (r) =>
        r.ruleType === 'repayment_routing' &&
        ((stagedItem.accountLastDigits &&
          r.accountLastDigits &&
          scoreTrailingDigitsMatch(stagedItem.accountLastDigits, r.accountLastDigits, true) >= 88) ||
          r.patternSignature === stagedItem.patternSignature)
    );

    const repayRule: SmsRuleOverride = {
      id:
        existingRepayIdx >= 0
          ? next[existingRepayIdx].id
          : `sms-rule-repay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ruleType: 'repayment_routing',
      patternSignature: stagedItem.patternSignature,
      accountLastDigits: stagedItem.accountLastDigits,
      bankHint: stagedItem.bankHint,
      mappedSourceId: finalSourceId,
      mappedTargetLiabilityId: finalTargetLiabilityId,
      mappedTxKind: finalTxKind,
      mappedReason: finalReason.trim() || undefined,
      mappedCategory: finalCategory.trim() || undefined,
      isBlacklisted: false,
      confidence: 1.0,
      hitCount: existingRepayIdx >= 0 ? (next[existingRepayIdx].hitCount || 0) + 1 : 1,
      createdAt: existingRepayIdx >= 0 ? next[existingRepayIdx].createdAt : nowIso,
      updatedAt: nowIso,
    };

    if (existingRepayIdx >= 0) {
      next[existingRepayIdx] = repayRule;
    } else {
      next.unshift(repayRule);
    }
  } else if (finalSourceId && stagedItem.accountLastDigits) {
    // 2. Learn standard account/card digit -> sourceId mapping
    const existingAcctIdx = next.findIndex(
      (r) =>
        r.ruleType === 'account_mapping' &&
        r.accountLastDigits &&
        scoreTrailingDigitsMatch(stagedItem.accountLastDigits, r.accountLastDigits, true) >= 88
    );

    const acctRule: SmsRuleOverride = {
      id:
        existingAcctIdx >= 0
          ? next[existingAcctIdx].id
          : `sms-rule-acct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ruleType: 'account_mapping',
      accountLastDigits: stagedItem.accountLastDigits,
      bankHint: stagedItem.bankHint,
      patternSignature: stagedItem.patternSignature,
      mappedSourceId: finalSourceId,
      isBlacklisted: false,
      confidence: 1.0,
      hitCount: existingAcctIdx >= 0 ? (next[existingAcctIdx].hitCount || 0) + 1 : 1,
      createdAt: existingAcctIdx >= 0 ? next[existingAcctIdx].createdAt : nowIso,
      updatedAt: nowIso,
    };

    if (existingAcctIdx >= 0) {
      next[existingAcctIdx] = acctRule;
    } else {
      next.unshift(acctRule);
    }
  }

  // 3. Learn VPA / merchant -> human reason & category
  if (finalTxKind === 'spend' || finalTxKind === 'income') {
    next = learnCategoryOverrideFromMerchant(
      stagedItem.merchantName,
      finalCategory,
      next,
      {
        rawCounterparty: stagedItem.rawCounterparty,
        mappedReason: finalReason,
      }
    );
  }

  return next;
}

/**
 * ACTIVE REINFORCEMENT LEARNING — User Flag / Invalid Action:
 * Rolls back ledger balances atomically and updates `sms_rule_overrides`.
 */
export function applySmsFlagFeedback(params: {
  transaction: Transaction;
  flagReason: SmsFlagReason;
  replacementSourceId?: string;
  holdings: Holding[];
  liabilities: Liability[];
  transactions: Transaction[];
  ruleOverrides: SmsRuleOverride[];
  stagingQueue: StagedSmsItem[];
}): {
  reversalResult: ReversalResult;
  updatedRuleOverrides: SmsRuleOverride[];
  updatedStagingQueue: StagedSmsItem[];
  repostedTransaction?: Transaction;
} {
  const {
    transaction,
    flagReason,
    replacementSourceId,
    holdings,
    liabilities,
    transactions,
    ruleOverrides,
    stagingQueue,
  } = params;

  const reasonLabel =
    flagReason === 'never_occurred'
      ? 'SMS Flagged: Never Occurred'
      : flagReason === 'wrong_source'
      ? 'SMS Flagged: Wrong Source Account'
      : 'SMS Flagged: Invalid SMS Parse';

  const reversalResult = executeTransactionReversal(
    transaction,
    holdings,
    liabilities,
    transactions,
    reasonLabel
  );

  const nowIso = new Date().toISOString();
  const signature =
    transaction.smsMetadata?.patternSignature ||
    computeSmsPatternSignature(transaction.reason, 'ledger');
  const merchantName = transaction.smsMetadata?.merchantName || transaction.reason;
  const merchantAlias = normalizeMerchantAlias(merchantName);
  const acctDigits = transaction.smsMetadata?.accountLastDigits;
  const wrongSourceId = transaction.fromId || transaction.sourceId || transaction.toId;

  const nextOverrides = ruleOverrides.map((r) => ({ ...r }));

  if (flagReason === 'invalid' || flagReason === 'never_occurred') {
    const existingIdx = nextOverrides.findIndex(
      (r) =>
        r.ruleType === 'pattern_blacklist' &&
        r.patternSignature === signature &&
        (r.merchantAlias || '') === merchantAlias
    );

    if (existingIdx >= 0) {
      nextOverrides[existingIdx] = {
        ...nextOverrides[existingIdx],
        isBlacklisted: true,
        flagReason,
        confidence: 0,
        hitCount: (nextOverrides[existingIdx].hitCount || 0) + 1,
        updatedAt: nowIso,
      };
    } else {
      nextOverrides.unshift({
        id: `sms-rule-blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ruleType: 'pattern_blacklist',
        patternSignature: signature,
        merchantAlias,
        merchantDisplayName: merchantName,
        accountLastDigits: acctDigits,
        isBlacklisted: true,
        flagReason,
        confidence: 0,
        hitCount: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  } else if (flagReason === 'wrong_source') {
    const existingAcctIdx = nextOverrides.findIndex(
      (r) =>
        r.ruleType === 'account_mapping' &&
        ((acctDigits && r.accountLastDigits === acctDigits) || r.patternSignature === signature)
    );

    const prevExcluded =
      existingAcctIdx >= 0 ? nextOverrides[existingAcctIdx].excludedSourceIds || [] : [];
    const updatedExcluded = wrongSourceId
      ? Array.from(new Set([...prevExcluded, wrongSourceId]))
      : prevExcluded;

    const learnedRule: SmsRuleOverride = {
      id:
        existingAcctIdx >= 0
          ? nextOverrides[existingAcctIdx].id
          : `sms-rule-acct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ruleType: 'account_mapping',
      patternSignature: signature,
      accountLastDigits: acctDigits,
      mappedSourceId: replacementSourceId || undefined,
      excludedSourceIds: updatedExcluded,
      isBlacklisted: !replacementSourceId,
      flagReason: 'wrong_source',
      confidence: replacementSourceId ? 1.0 : 0,
      hitCount: existingAcctIdx >= 0 ? (nextOverrides[existingAcctIdx].hitCount || 0) + 1 : 1,
      createdAt: existingAcctIdx >= 0 ? nextOverrides[existingAcctIdx].createdAt : nowIso,
      updatedAt: nowIso,
    };

    if (existingAcctIdx >= 0) {
      nextOverrides[existingAcctIdx] = learnedRule;
    } else {
      nextOverrides.unshift(learnedRule);
    }
  }

  const nextStaging = stagingQueue.map((item) => {
    if (
      item.committedTxId === transaction.id ||
      (transaction.smsMetadata?.stagingId && item.id === transaction.smsMetadata.stagingId)
    ) {
      return {
        ...item,
        status: (flagReason === 'wrong_source' ? 'rolled_back' : 'blacklisted') as StagedSmsItem['status'],
        confidence: 0,
        dropReason: reasonLabel,
      };
    }
    return item;
  });

  let repostedTransaction: Transaction | undefined;
  if (flagReason === 'wrong_source' && replacementSourceId) {
    const isDebit =
      transaction.kind === 'spend' ||
      transaction.kind === 'cardPayment' ||
      transaction.kind === 'emi';
    repostedTransaction = {
      ...transaction,
      id: `tx-sms-reroute-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...(isDebit
        ? { fromId: replacementSourceId, sourceId: replacementSourceId }
        : { toId: replacementSourceId }),
      isReversed: false,
      reversedAt: undefined,
      reversalReason: undefined,
      reversalRecordId: undefined,
      notes: `${transaction.notes || ''} [Re-routed to verified source]`.trim(),
    };
    applyTransactionBalanceMutationInMemory(
      repostedTransaction,
      reversalResult.updatedHoldings,
      reversalResult.updatedLiabilities
    );
  }

  return {
    reversalResult,
    updatedRuleOverrides: nextOverrides,
    updatedStagingQueue: nextStaging,
    repostedTransaction,
  };
}

/**
 * ACTIVE REINFORCEMENT LEARNING — User Re-categorization & Reason Learning:
 * Maps merchant alias AND/OR exact UPI `rawCounterpartyKey` -> `{ mappedCategory, mappedReason }` with confidence `1.0`.
 */
export function learnCategoryOverrideFromMerchant(
  merchantOrReason: string,
  newCategory: string,
  existingOverrides: SmsRuleOverride[],
  options?: {
    rawCounterparty?: string;
    mappedReason?: string;
  }
): SmsRuleOverride[] {
  const cleanCategory = (newCategory || '').trim();
  const cleanMappedReason = (options?.mappedReason || '').trim();
  const cpKey = normalizeCounterpartyKey(options?.rawCounterparty);
  const isOpaqueQr = isOpaqueCounterpartyOrPlaceholder(merchantOrReason, options?.rawCounterparty);
  // For opaque gateway handles like `paytm-8774066@ptybl`, key by exact `rawCounterpartyKey` so we don't map all Paytm QRs to one shop!
  const alias = isOpaqueQr && cpKey ? normalizeMerchantAlias(cpKey) : normalizeMerchantAlias(merchantOrReason);

  if ((!alias || alias.length < 2) && !cpKey) {
    return existingOverrides;
  }
  if (!cleanCategory && !cleanMappedReason) {
    return existingOverrides;
  }

  const nowIso = new Date().toISOString();
  const next = existingOverrides.map((r) => ({ ...r }));
  const idx = next.findIndex((r) => {
    if (r.ruleType !== 'merchant_category') return false;
    if (cpKey && r.rawCounterpartyKey) {
      return r.rawCounterpartyKey === cpKey;
    }
    if (!isOpaqueQr && alias && r.merchantAlias && !r.rawCounterpartyKey) {
      return r.merchantAlias === alias;
    }
    return false;
  });

  const displayLabel =
    cleanMappedReason && !isOpaqueCounterpartyOrPlaceholder(cleanMappedReason)
      ? cleanMappedReason
      : merchantOrReason.trim();

  if (idx >= 0) {
    next[idx] = {
      ...next[idx],
      merchantDisplayName: displayLabel || next[idx].merchantDisplayName,
      rawCounterpartyKey: cpKey || next[idx].rawCounterpartyKey,
      mappedReason:
        cleanMappedReason && !isOpaqueCounterpartyOrPlaceholder(cleanMappedReason)
          ? cleanMappedReason
          : next[idx].mappedReason,
      mappedCategory: cleanCategory || next[idx].mappedCategory,
      isBlacklisted: false,
      confidence: 1.0,
      hitCount: (next[idx].hitCount || 0) + 1,
      updatedAt: nowIso,
    };
  } else {
    next.unshift({
      id: `sms-rule-cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ruleType: 'merchant_category',
      merchantAlias: isOpaqueQr ? undefined : alias,
      rawCounterpartyKey: cpKey || undefined,
      merchantDisplayName: options?.rawCounterparty || merchantOrReason.trim(),
      mappedReason:
        cleanMappedReason && !isOpaqueCounterpartyOrPlaceholder(cleanMappedReason)
          ? cleanMappedReason
          : undefined,
      mappedCategory: cleanCategory || 'General',
      isBlacklisted: false,
      confidence: 1.0,
      hitCount: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  return next;
}

/**
 * ACTIVE REINFORCEMENT LEARNING — User Rejection / Deletion Feedback from Review Queue:
 * When the user deletes/rejects a staged message from the review queue, records the rejection reason
 * (e.g. invalid message, wrong amount, wrong account/card, duplicate, promotional spam)
 * and updates `sms_rule_overrides` so the ML parser continuously improves across all formats.
 */
export function applySmsRejectionLearning(params: {
  stagedItem: StagedSmsItem;
  rejectionReason: string;
  existingOverrides: SmsRuleOverride[];
}): SmsRuleOverride[] {
  const { stagedItem, rejectionReason, existingOverrides } = params;
  const nowIso = new Date().toISOString();
  const next = existingOverrides.map((r) => ({ ...r }));

  const signature =
    stagedItem.patternSignature || computeSmsPatternSignature(stagedItem.rawSms, stagedItem.sender);
  const merchantAlias = normalizeMerchantAlias(stagedItem.merchantName);
  const acctDigits = stagedItem.accountLastDigits;
  const matchedSourceId = stagedItem.matchedSourceId;

  const lowerReason = (rejectionReason || '').toLowerCase();
  const isInvalidOrSpam =
    lowerReason.includes('invalid') ||
    lowerReason.includes('otp') ||
    lowerReason.includes('spam') ||
    lowerReason.includes('promo') ||
    lowerReason.includes('never');

  const isWrongSource =
    lowerReason.includes('wrong account') ||
    lowerReason.includes('wrong source') ||
    lowerReason.includes('wrong card');

  if (isInvalidOrSpam) {
    const existingIdx = next.findIndex(
      (r) =>
        r.ruleType === 'pattern_blacklist' &&
        r.patternSignature === signature &&
        (r.merchantAlias || '') === merchantAlias
    );
    if (existingIdx >= 0) {
      next[existingIdx] = {
        ...next[existingIdx],
        isBlacklisted: true,
        flagReason: 'invalid',
        confidence: 0,
        hitCount: (next[existingIdx].hitCount || 0) + 1,
        updatedAt: nowIso,
      };
    } else {
      next.unshift({
        id: `sms-rule-blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ruleType: 'pattern_blacklist',
        patternSignature: signature,
        merchantAlias,
        merchantDisplayName: stagedItem.merchantName,
        accountLastDigits: acctDigits,
        isBlacklisted: true,
        flagReason: 'invalid',
        confidence: 0,
        hitCount: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  } else if (isWrongSource && matchedSourceId) {
    const existingAcctIdx = next.findIndex(
      (r) =>
        r.ruleType === 'account_mapping' &&
        ((acctDigits && r.accountLastDigits === acctDigits) || r.patternSignature === signature)
    );
    const prevExcluded =
      existingAcctIdx >= 0 ? next[existingAcctIdx].excludedSourceIds || [] : [];
    const updatedExcluded = Array.from(new Set([...prevExcluded, matchedSourceId]));

    const learnedRule: SmsRuleOverride = {
      id:
        existingAcctIdx >= 0
          ? next[existingAcctIdx].id
          : `sms-rule-acct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ruleType: 'account_mapping',
      patternSignature: signature,
      accountLastDigits: acctDigits,
      excludedSourceIds: updatedExcluded,
      isBlacklisted: false,
      flagReason: 'wrong_source',
      confidence: 0,
      hitCount: existingAcctIdx >= 0 ? (next[existingAcctIdx].hitCount || 0) + 1 : 1,
      createdAt: existingAcctIdx >= 0 ? next[existingAcctIdx].createdAt : nowIso,
      updatedAt: nowIso,
    };
    if (existingAcctIdx >= 0) {
      next[existingAcctIdx] = learnedRule;
    } else {
      next.unshift(learnedRule);
    }
  } else {
    // General rejection (e.g. wrong amount, duplicate, cancelled, custom write-in)
    const existingIdx = next.findIndex((r) => r.patternSignature === signature);
    if (existingIdx >= 0) {
      next[existingIdx] = {
        ...next[existingIdx],
        confidence: Math.max(0, (next[existingIdx].confidence || 1.0) - 0.25),
        updatedAt: nowIso,
      };
    } else {
      next.unshift({
        id: `sms-rule-rej-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ruleType: 'pattern_blacklist',
        patternSignature: signature,
        merchantAlias,
        merchantDisplayName: stagedItem.merchantName,
        accountLastDigits: acctDigits,
        isBlacklisted: true,
        flagReason: 'invalid',
        confidence: 0,
        hitCount: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  return next;
}


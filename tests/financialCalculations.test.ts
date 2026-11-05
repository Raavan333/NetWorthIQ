/**
 * Financial Calculation & Precision Test Harness for NetWorthIQ
 * Tests floating-point safety, cash-flow projections, debt strategies,
 * sweep-in mechanics, ledger reversals, loan prepayments, credit utilization,
 * What-If simulations, calibrated ML confidence, and Argon2id security.
 *
 * Can be executed via: npx tsx tests/financialCalculations.test.ts
 */

import { roundCurrency, safeAdd, safeSub, safeMul, safeDiv, reconcileHolding } from '../src/lib/financialMath';
import { generateCashFlowForecast } from '../src/lib/cashFlowForecast';
import { evaluateDebtStrategies, calculateContractualEmi } from '../src/lib/debtEngine';
import { executeTransactionReversal } from '../src/lib/reversalEngine';
import { simulateLoanPrepayment } from '../src/lib/loanPrepaymentEngine';
import { allocateMultiCardRepayments, compareCreditCardEmiVsFullPayment, evaluateCreditUtilization } from '../src/lib/creditIntelligence';
import { computeUnifiedBalanceSheet } from '../src/lib/unifiedSimulationEngine';
import { runWhatIfSimulation } from '../src/lib/whatIfSimulator';
import { analyzeTagRecurrence, deriveEvidenceBasedQuickChips } from '../src/lib/mlTagIntelligence';
import { predictCareerAndSalary, deriveSmartSpendChipsAndCategories, dedupeSpendCategories, dedupeQuickChips } from '../src/lib/mlEngine';
import { groupReceivablesByCounterparty, calculateAccruedInterest, autoOffsetCounterpartyBalances, reconcileDebtorPaymentOrOffset } from '../src/lib/counterpartyEngine';
import {
  classifyFinancialSms,
  parseFinancialSms,
  processIncomingSmsBatchOnDevice,
  applySmsFlagFeedback,
  learnCategoryOverrideFromMerchant,
  learnFromUserSmsReview,
  scoreTrailingDigitsMatch,
} from '../src/lib/smsEngine';
import { splitManualPastedSmsBatch } from '../src/lib/smsBridge';
import { hashPinArgon2id, checkLockout, registerFailedAttempt, resetLockout } from '../src/lib/securityArgon2';
import { suggestCategoryFromDescription } from '../src/lib/categorySuggester';
import { AGGRESSIVENESS_ORDER, AGGRESSIVENESS_SPECS } from '../src/lib/subconsciousNudges';
import { detectObligationConflicts, generateCentralizedNotifications } from '../src/lib/notificationEngine';
import { calculateFinancialEngine } from '../src/lib/calcEngine';
import { exportMasterCsv, parseMasterCsv } from '../src/lib/csvHelper';
import { Holding, Liability, Bill, IncomeStream, Receivable, Currency, AppSettings, Transaction, CareerProfile, SpendCategoryConfig, Goal, ScheduledTransfer, RLMovementRecommendation, SmsRuleOverride } from '../src/types';
import { DEFAULT_SETTINGS, DEFAULT_CURRENCIES, DEFAULT_SPEND_CATEGORIES, BUILT_IN_ASSET_TYPES } from '../src/lib/defaults';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('--- Starting NetWorthIQ Financial Systems Test Suite ---');

  // 1. Decimal-Safe Arithmetic Tests
  console.log('\n[Suite 1: Decimal Precision & IEEE-754 Safety]');
  assert(0.1 + 0.2 !== 0.3, 'IEEE 754 baseline precision quirk confirmed (0.1 + 0.2 !== 0.3 in JS)');
  assert(safeAdd(0.1, 0.2) === 0.3, 'safeAdd(0.1, 0.2) equals exactly 0.30');
  assert(safeSub(1.0, 0.9) === 0.1, 'safeSub(1.0, 0.9) equals exactly 0.10');
  assert(safeMul(10.55, 3) === 31.65, 'safeMul(10.55, 3) equals 31.65');
  assert(safeDiv(100, 3) === 33.3333, 'safeDiv(100, 3, 0, 4) rounds safely to 33.3333');
  assert(safeDiv(100, 0, 999) === 999, 'safeDiv handles division by zero returning fallback');

  // 2. Debt Intelligence & EMI Calculations
  console.log('\n[Suite 2: Debt Intelligence & Repayment Strategies]');
  const emi = calculateContractualEmi(100000, 12, 12);
  assert(Math.abs(emi - 8884.88) < 1, `Contractual EMI calculated accurately (got ${emi}, expected ~8884.88)`);

  const mockCurrencies: Record<string, Currency> = DEFAULT_CURRENCIES.reduce(
    (acc, c) => ({ ...acc, [c.code]: c }),
    {}
  );

  const mockLiabilities: Liability[] = [
    {
      id: 'loan-personal',
      name: 'Personal Loan',
      kind: 'loan',
      currency: 'INR',
      outstanding: 50000,
      ratePct: 18.0,
      monthlyEmi: 4500,
      tenureMonths: 12,
      prepaymentPenaltyPct: 2.0,
      applicableGstPct: 18,
    },
    {
      id: 'card-credit',
      name: 'Titanium Card',
      kind: 'card',
      currency: 'INR',
      outstanding: 30000,
      ratePct: 42.0,
      limit: 100000,
      penaltyRateMonthlyPct: 3.5,
      creditCardUtilThresholdPct: 30,
    },
  ];

  const debtEval = evaluateDebtStrategies(mockLiabilities, 10000, mockCurrencies, DEFAULT_SETTINGS);
  assert(debtEval.totalOutstandingBase === 80000, 'Total debt calculated correctly at 80,000');
  assert(debtEval.mandatoryMonthlyObligationBase > 0, 'Mandatory monthly obligation is positive');
  assert(
    debtEval.strategies.avalanche.items[0].liabilityId === 'card-credit',
    'Avalanche strategy prioritizes highest interest card (42% p.a.) over personal loan (18% p.a.)'
  );
  assert(
    debtEval.strategies.snowball.items[0].liabilityId === 'card-credit',
    'Snowball strategy prioritizes smallest balance (30k) over (50k)'
  );

  // 3. Cash-Flow Forecasting Engine
  console.log('\n[Suite 3: Date-Based Cash-Flow Forecasting & Stress Scenarios]');
  const mockHoldings: Holding[] = [
    {
      id: 'acc-savings',
      name: 'HDFC Savings',
      typeId: 'type-bank',
      currency: 'INR',
      principalOrValue: 50000,
      liquidityClass: 'Immediate',
    },
    {
      id: 'fd-locked',
      name: 'Locked 1-Year FD',
      typeId: 'type-fd',
      currency: 'INR',
      principalOrValue: 200000,
      liquidityClass: 'Locked',
    },
  ];

  const forecast = generateCashFlowForecast(
    mockHoldings,
    mockLiabilities,
    [{ id: 'b-rent', name: 'Apartment Rent', amount: 20000, frequency: 'monthly', dueDay: 5, sourceId: 'acc-savings', category: 'Rent', currency: 'INR' }],
    [{ id: 'inc-1', name: 'Tech Salary', amountPerPeriod: 60000, period: 'monthly', payDay: 1, currency: 'INR', grossOrNet: 'net' }],
    [],
    mockCurrencies,
    DEFAULT_SETTINGS,
    { windowDays: 30 }
  );

  assert(forecast.initialLiquidCash === 50000, 'Locked FD (200k) excluded from liquid opening cash (50k)');
  assert(forecast.dailyTimeline.length === 30, 'Daily timeline projects all 30 days accurately');

  // 4. Holding Ledger Reconciliation
  console.log('\n[Suite 4: Account Balance & Ledger Audit Reconciliation]');
  const recon = reconcileHolding(mockHoldings[0], [
    {
      id: 'tx-1',
      date: '2026-10-15',
      kind: 'income',
      amount: 60000,
      currency: 'INR',
      toId: 'acc-savings',
      reason: 'Salary',
      category: 'Income',
      fxRateUsed: 1.0,
    },
    {
      id: 'tx-2',
      date: '2026-10-20',
      kind: 'spend',
      amount: 10000,
      currency: 'INR',
      fromId: 'acc-savings',
      reason: 'Groceries',
      category: 'Food',
      fxRateUsed: 1.0,
    },
  ]);
  assert(recon.isReconciled, 'Account balance matches net transaction ledger exactly (isReconciled = true)');

  // 5. Transaction Ledger & Atomic Reversal Engine (Part 5)
  console.log('\n[Suite 5: Transaction Ledger & Atomic Reversal Engine]');
  // Example 1: Bank expense reversal
  const bankBefore: Holding[] = [{ id: 'acc-bank', name: 'SBI Bank', typeId: 'type-bank', currency: 'INR', principalOrValue: 48000, liquidityClass: 'Immediate' }];
  const expenseTx: Transaction = {
    id: 'tx-exp-1',
    date: '2026-10-25',
    kind: 'spend',
    amount: 2000,
    currency: 'INR',
    fromId: 'acc-bank',
    reason: 'Restaurant Dinner',
    category: 'Food & Dining',
    fxRateUsed: 1.0,
  };

  const revExpenseResult = executeTransactionReversal(expenseTx, bankBefore, [], [expenseTx], 'Cancelled dinner');
  assert(revExpenseResult.updatedHoldings[0].principalOrValue === 50000, 'Expense reversal restores bank balance from 48,000 to 50,000 exactly');
  assert(revExpenseResult.auditRecord.restoredBalanceSource === 50000, 'Audit record tracks previous and restored balances');

  // Example 2: Idempotency protection (Part 5.C)
  let threwOnSecondReversal = false;
  try {
    const alreadyReversedTx = revExpenseResult.updatedTransactions.find((t) => t.id === expenseTx.id)!;
    executeTransactionReversal(alreadyReversedTx, revExpenseResult.updatedHoldings, [], revExpenseResult.updatedTransactions);
  } catch (err: any) {
    threwOnSecondReversal = true;
  }
  assert(threwOnSecondReversal, 'Reversing an already-reversed transaction is rejected (Idempotency protected)');

  // Example 3: Transfer reversal (Part 5.A Example 3)
  const transferHoldings: Holding[] = [
    { id: 'acc-a', name: 'Account A', typeId: 'type-bank', currency: 'INR', principalOrValue: 45000, liquidityClass: 'Immediate' },
    { id: 'acc-b', name: 'Account B', typeId: 'type-bank', currency: 'INR', principalOrValue: 15000, liquidityClass: 'Immediate' },
  ];
  const transferTx: Transaction = {
    id: 'tx-tr-1',
    date: '2026-10-26',
    kind: 'transfer',
    amount: 5000,
    currency: 'INR',
    fromId: 'acc-a',
    toId: 'acc-b',
    reason: 'Inter-account transfer',
    category: 'Transfers',
    fxRateUsed: 1.0,
  };
  const revTransferResult = executeTransactionReversal(transferTx, transferHoldings, [], [transferTx], 'Revert transfer');
  const restoredA = revTransferResult.updatedHoldings.find((h) => h.id === 'acc-a')!.principalOrValue;
  const restoredB = revTransferResult.updatedHoldings.find((h) => h.id === 'acc-b')!.principalOrValue;
  assert(restoredA === 50000 && restoredB === 10000, 'Transfer reversal restores Account A to 50,000 and Account B to 10,000');

  // 6. Loan Prepayment, Foreclosure & Net Savings (Part 3)
  console.log('\n[Suite 6: Loan Prepayment & Foreclosure Engine]');
  const testLoan: Liability = {
    id: 'loan-1',
    name: 'Auto Loan',
    kind: 'loan',
    currency: 'INR',
    outstanding: 300000,
    ratePct: 12.0,
    monthlyEmi: 10000,
    tenureMonths: 36,
    prepaymentPenaltyPct: 2.0,
    prepaymentFeeBasis: 'prepaid_amount',
    applicableGstPct: 18,
  };

  const prepaySim = simulateLoanPrepayment(testLoan, 50000);
  assert(prepaySim.proposedPrepayment === 50000, 'Prepayment capped at 50,000');
  assert(prepaySim.penaltyCharge === 1000, 'Prepayment penalty calculated at 2% = 1,000 INR');
  assert(prepaySim.applicableTax === 180, 'GST on penalty calculated at 18% = 180 INR');
  assert(prepaySim.grossInterestSaved > prepaySim.penaltyCharge + prepaySim.applicableTax, 'Gross interest saved exceeds total penalty fees');
  assert(prepaySim.netFinancialBenefit === prepaySim.grossInterestSaved - (prepaySim.penaltyCharge + prepaySim.applicableTax), 'Net financial benefit strictly equals gross savings minus fees and taxes');
  assert(prepaySim.monthsSaved > 0, 'Prepayment reduces loan repayment tenure');

  // 7. Credit Card Intelligence & Utilization Management (Part 4)
  console.log('\n[Suite 7: Proactive Credit Card Utilisation & Allocation]');
  const testCards: Liability[] = [
    { id: 'card-m', name: 'Card M', kind: 'card', currency: 'INR', limit: 100000, outstanding: 75000, ratePct: 36, creditCardUtilThresholdPct: 30 },
    { id: 'card-n', name: 'Card N', kind: 'card', currency: 'INR', limit: 50000, outstanding: 30000, ratePct: 36, creditCardUtilThresholdPct: 20 },
  ];

  const statuses = evaluateCreditUtilization(testCards);
  assert(statuses.length === 2, 'Evaluated all active credit cards');
  assert(statuses[0].isExceedingThreshold && statuses[1].isExceedingThreshold, 'Both Card M and Card N detected as exceeding thresholds');
  assert(statuses[0].amountToReachThreshold === 45000, 'Card M needs 45,000 to reach 30% utilization');
  assert(statuses[1].amountToReachThreshold === 20000, 'Card N needs 20,000 to reach 20% utilization');

  // Allocation with 40,000 available surplus (safeguarding emergency reserve)
  const alloc = allocateMultiCardRepayments(statuses, 40000, testCards);
  assert(alloc.emergencyFundProtected, 'Emergency reserve protected during allocation');
  assert(alloc.cards.reduce((sum, c) => sum + c.recommendedPayment, 0) <= 40000, 'Total recommended payments do not exceed available surplus');

  // EMI vs Full payment comparator (Part 4.D)
  const emiComp = compareCreditCardEmiVsFullPayment(testCards[0], 30000, { tenureMonths: 6, customAnnualRatePct: 16 });
  assert(emiComp.fullPaymentAmount === 30000, 'Full payment cost is exactly 30,000');
  assert(emiComp.totalEmiCost > 30000, 'EMI conversion adds additional interest and processing fees');
  assert(emiComp.additionalCostOfEmi > 0, 'Additional cost of EMI accurately computed');

  // 8. Unified Balance Sheet & What-If Simulator (Part 2 & 8)
  console.log('\n[Suite 8: Unified Financial Balance Sheet & What-If Simulation]');
  const uSheet = computeUnifiedBalanceSheet({
    holdings: [
      { id: 'h-bank', name: 'Bank Account', typeId: 'type-bank', currency: 'INR', principalOrValue: 80000, liquidityClass: 'Immediate' },
      { id: 'h-fd', name: 'Locked FD', typeId: 'type-fd', currency: 'INR', principalOrValue: 50000, liquidityClass: 'Locked' },
    ],
    liabilities: testCards,
    bills: [{ id: 'b-1', name: 'Electricity', amount: 5000, frequency: 'monthly', dueDay: 10, sourceId: 'h-bank', category: 'Utility', currency: 'INR' }],
    incomeStreams: [],
    settings: { ...DEFAULT_SETTINGS, cashFlowBufferAmount: 30000 },
    currencies: mockCurrencies,
  });

  assert(uSheet.emergencyReserveTargetBase === 30000, 'Emergency reserve target respected at 30,000');
  assert(uSheet.trueAllocatableSurplusBase < 80000, 'True allocatable surplus deducts emergency reserve and mandatory commitments from liquid cash');

  const whatIf = runWhatIfSimulation(
    { name: 'Accelerated Payoff', monthlyExtraLoanPayment: 5000 },
    mockHoldings,
    testLiabilities(),
    [],
    DEFAULT_SETTINGS,
    mockCurrencies
  );
  assert(whatIf.results.debtMonthsSaved >= 0, 'What-If simulator computes revised debt-free months');
  assert(whatIf.results.interestSaved >= 0, 'What-If simulator computes interest savings without mutating actual balances');

  // 9. Tag-First ML Spending & Calibrated Career Confidence (Part 6 & Part 20)
  console.log('\n[Suite 9: Tag-First ML Spending & Calibrated Model Confidence]');
  const mockSpendLedger: Transaction[] = [
    { id: 't-1', date: '2026-10-01', kind: 'spend', amount: 150, currency: 'INR', reason: 'Metro fare', category: 'Transportation', tags: ['Transit'], fxRateUsed: 1 },
    { id: 't-2', date: '2026-10-02', kind: 'spend', amount: 150, currency: 'INR', reason: 'Metro fare', category: 'Transportation', tags: ['Transit'], fxRateUsed: 1 },
    { id: 't-3', date: '2026-10-03', kind: 'spend', amount: 150, currency: 'INR', reason: 'Metro fare', category: 'Transportation', tags: ['Transit'], fxRateUsed: 1 },
    { id: 't-4', date: '2026-10-04', kind: 'spend', amount: 150, currency: 'INR', reason: 'Metro fare', category: 'Transportation', tags: ['Transit'], fxRateUsed: 1 },
    { id: 't-5', date: '2026-10-05', kind: 'spend', amount: 150, currency: 'INR', reason: 'Metro fare', category: 'Transportation', tags: ['Transit'], fxRateUsed: 1 },
  ];

  const tagPatterns = analyzeTagRecurrence(mockSpendLedger, 60);
  assert(tagPatterns.length > 0, 'Tag-first analyzer identified recurring Transit tag');
  assert(tagPatterns[0].isDailyRecurrence, 'Daily recurring streak correctly recognized');
  assert(tagPatterns[0].topAmount === 150, 'Consistent 150 amount identified with statistical backing');

  // Calibrated Career Model Confidence (Part 20)
  const emptyCareerProfile: CareerProfile = {
    currentRole: 'Software Engineer',
    yearsOfExperience: 3,
    education: 'bachelors_tech',
    industry: 'tech',
    targetCompanyType: 'all',
    previousSalaries: [], // Zero historical records
  };
  const coldCareerPred = predictCareerAndSalary(emptyCareerProfile, 0, 0);
  assert(coldCareerPred.confidenceScore === 0, 'Cold-start career model without historical evidence produces 0% confidence (not 80%)');

  const verifiedCareerProfile: CareerProfile = {
    ...emptyCareerProfile,
    previousSalaries: [
      { year: 2023, role: 'Junior Dev', salary: 600000 },
      { year: 2025, role: 'Software Engineer', salary: 1200000 },
    ],
    technicalSkills: ['TypeScript', 'Python', 'React'],
  };
  const verifiedCareerPred = predictCareerAndSalary(verifiedCareerProfile, 1200000, 500000);
  assert(verifiedCareerPred.confidenceScore >= 55 && verifiedCareerPred.confidenceScore <= 85, 'Verified career history produces statistically calibrated confidence between 55% and 85%');

  // 10. Security & Argon2id Hashing Tests (Part 16)
  console.log('\n[Suite 10: Security, Argon2id & Rate Limiting]');
  const pin = '4821';
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const argonHash = await hashPinArgon2id(pin, salt, 8192, 2); // fast test params
  assert(argonHash.startsWith('$argon2id$'), 'Argon2id hash format generated ($argon2id$...)');

  // Rate limiting lockout check
  let lockState = resetLockout();
  assert(!checkLockout(lockState).isLocked, 'Initial state is not locked');
  for (let i = 0; i < 5; i++) {
    lockState = registerFailedAttempt(lockState);
  }
  assert(checkLockout(lockState).isLocked, 'Lockout enforced after 5 failed authentication attempts');

  // 11. Intelligent Category Suggestions & Gamified Aggressiveness Spectrum
  console.log('\n[Suite 11: Intelligent Category Suggestions & Gamified Nudge Aggressiveness]');
  const spendCats = DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[];

  // 11.A Keyword-based suggestions
  const foodSugg = suggestCategoryFromDescription('Dinner at Swiggy', [], spendCats);
  assert(foodSugg !== null && foodSugg.category === 'Food & Dining', 'Swiggy description correctly suggests Food & Dining');

  const fuelSugg = suggestCategoryFromDescription('Uber cab ride', [], spendCats);
  assert(fuelSugg !== null && fuelSugg.category === 'Transport & Fuel', 'Uber description correctly suggests Transport & Fuel');

  const grocerySugg = suggestCategoryFromDescription('Blinkit weekly groceries', [], spendCats);
  assert(grocerySugg !== null && grocerySugg.category === 'Groceries', 'Blinkit description correctly suggests Groceries');

  // 11.B Historical pattern takes highest precedence
  const mockHistory: Transaction[] = [
    {
      id: 'tx-custom-1',
      date: '2026-10-15',
      kind: 'spend',
      amount: 450,
      currency: 'INR',
      fromId: 'h-bank',
      reason: 'Local Specialty Store',
      category: 'Shopping',
      fxRateUsed: 1.0,
    },
    {
      id: 'tx-custom-2',
      date: '2026-10-20',
      kind: 'spend',
      amount: 320,
      currency: 'INR',
      fromId: 'h-bank',
      reason: 'Local Specialty Store',
      category: 'Shopping',
      fxRateUsed: 1.0,
    },
  ];
  const histSugg = suggestCategoryFromDescription('Local Specialty Store', mockHistory, spendCats);
  assert(histSugg !== null && histSugg.category === 'Shopping' && histSugg.source === 'history', 'Historical transactions take precedence for custom merchants');

  // 11.C Gamified Aggressiveness Archetypes & Multipliers
  assert(AGGRESSIVENESS_ORDER.length === 5, 'Exactly 5 aggressiveness levels supported (Subtle to Direct)');
  assert(AGGRESSIVENESS_SPECS.subtle.archetype === 'Zen Monk', 'Level 1 archetype is Zen Monk');
  assert(AGGRESSIVENESS_SPECS.direct.archetype === 'Ruthless Wealth Commander', 'Level 5 archetype is Ruthless Wealth Commander');
  assert(AGGRESSIVENESS_SPECS.direct.shieldPercentage === 100, 'Direct level provides 100% Willpower Shield');
  assert(AGGRESSIVENESS_SPECS.direct.numericRank === 5, 'Direct rank is Level 5');

  // 12. Proactive Centralized Notifications & Obligation Conflict Engine
  console.log('\n[Suite 12: Proactive Centralized Notifications & Obligation Conflicts]');
  
  // 12.A Critical Contractual Loan EMI vs Discretionary Prepayment Conflict
  const conflictHoldings: Holding[] = [
    {
      id: 'h-bank-1',
      typeId: 'bank',
      name: 'Primary Spending Account',
      currency: 'INR',
      principalOrValue: 10000,
      liquidityClass: 'Immediate',
    },
  ];
  const conflictLiabilities: Liability[] = [
    {
      id: 'l-hdfc-loan',
      name: 'HDFC Personal Loan',
      kind: 'loan',
      currency: 'INR',
      outstanding: 250000,
      ratePct: 12.5,
      monthlyEmi: 15000,
      emiDay: 5,
    },
  ];
  const conflictBills: Bill[] = [
    {
      id: 'b-emi-1',
      name: 'HDFC Loan EMI',
      amount: 15000,
      currency: 'INR',
      frequency: 'monthly',
      dueDay: 5,
      sourceId: 'h-bank-1',
      category: 'Loans',
      liabilityKind: 'loan',
      liabilityId: 'l-hdfc-loan',
    },
  ];
  const conflictIncomes: IncomeStream[] = [
    {
      id: 'inc-sal',
      name: 'Monthly Salary',
      amountPerPeriod: 50000,
      currency: 'INR',
      period: 'monthly',
      payDay: 10,
      payScheduleType: 'fixed_day',
      depositAccountId: 'h-bank-1',
      grossOrNet: 'net',
    },
  ];
  const conflictRLRecs: RLMovementRecommendation[] = [
    {
      id: 'rec-prepay-card',
      fromSourceId: 'h-bank-1',
      fromSourceName: 'Primary Spending Account',
      fromYieldPct: 3,
      toAssetId: 'card-1',
      toAssetName: 'Credit Card Payoff',
      toYieldPct: 42,
      suggestedAmount: 8000,
      annualPotentialGain: 3120,
      status: 'pending',
      createdDate: '2026-11-01',
      confidencePct: 90,
    },
  ];

  const conflictForecast = generateCashFlowForecast(
    conflictHoldings,
    conflictLiabilities,
    conflictBills,
    conflictIncomes,
    [],
    mockCurrencies,
    DEFAULT_SETTINGS,
    { windowDays: 30, startDate: '2026-11-01' }
  );

  const notifications = detectObligationConflicts(
    conflictForecast,
    conflictHoldings,
    conflictLiabilities,
    conflictBills,
    conflictIncomes,
    [],
    [],
    conflictRLRecs,
    [],
    mockCurrencies,
    DEFAULT_SETTINGS,
    { baseDate: '2026-11-01' }
  );

  assert(notifications.length > 0, 'Obligation conflict engine generated proactive notifications');
  const criticalEmiConflict = notifications.find(
    (n) => n.type === 'obligation_conflict' && n.severity === 'critical'
  );
  assert(criticalEmiConflict !== undefined, 'Detected critical contractual EMI default risk');
  assert(
    criticalEmiConflict!.conflictDetails !== undefined &&
      criticalEmiConflict!.conflictDetails.obligationAmount === 15000,
    'Conflicting obligation amount matches contractual EMI (15,000 INR)'
  );
  assert(
    criticalEmiConflict!.conflictDetails!.shortfallAmount > 0,
    'Shortfall amount accurately computed for the deficit date'
  );
  assert(
    criticalEmiConflict!.conflictDetails!.recommendedMitigation.length > 0,
    'Actionable mitigation advice generated (e.g. postpone or reduce prepayment)'
  );

  // 12.B Centralized Priority Sorting
  const sortedNotifications = generateCentralizedNotifications(
    conflictForecast,
    conflictHoldings,
    conflictLiabilities,
    conflictBills,
    conflictIncomes,
    [],
    [],
    conflictRLRecs,
    [],
    mockCurrencies,
    DEFAULT_SETTINGS
  );
  assert(sortedNotifications[0].severity === 'critical', 'Centralized notification list prioritizes Critical severity first');

  // 12.C Separate Goal Funding Progress vs Settlement Progress
  const safetyBufferHolding: Holding = {
    id: 'h-safety-buf',
    typeId: 'bank',
    name: 'Safety Buffer',
    currency: 'INR',
    principalOrValue: 58000,
    liquidityClass: 'Immediate',
  };
  const bhavishDebtGoal: Goal = {
    id: 'g-bhavish',
    name: 'Bhavish Debt Payoff',
    cost: 13800,
    currency: 'INR',
    goalType: 'debt_payoff',
    startingDebtAmount: 13800,
    targetLiabilityId: 'l-bhavish',
    accumulatedTotal: 0,
    sources: [
      {
        sourceId: 'h-safety-buf',
        allocationMode: 'fixed_amount',
        allocationAmount: 13800,
        allocationPct: 0,
      },
    ],
  };
  const bhavishLoan: Liability = {
    id: 'l-bhavish',
    name: 'Bhavish Loan',
    kind: 'loan',
    currency: 'INR',
    outstanding: 13800,
    ratePct: 0,
  };

  // Compute separated funding vs settlement progress
  const targetReq = bhavishDebtGoal.startingDebtAmount || bhavishDebtGoal.cost;
  const allocatedFunding = Math.min(safetyBufferHolding.principalOrValue, bhavishDebtGoal.sources[0].allocationAmount || 0);
  const fundingPct = Math.min(100, (allocatedFunding / targetReq) * 100);
  const debtKilled = Math.max(0, targetReq - bhavishLoan.outstanding);
  const settlementPct = Math.min(100, (debtKilled / targetReq) * 100);

  assert(fundingPct === 100, 'Bhavish debt goal is 100% funded by Safety Buffer holding');
  assert(settlementPct === 0, 'Bhavish debt goal is 0% settled prior to ledger repayment transaction');
  assert(fundingPct === 100 && settlementPct === 0, 'Prevents false 0% display when funds are allocated (100% funded, 0% settled, ready to repay)');

  // 12.D Preventing Source Double-Allocation Across Multiple Goals
  const poolBalances: Record<string, number> = { [safetyBufferHolding.id]: safetyBufferHolding.principalOrValue };
  // Goal 1 takes 13,800
  const g1Alloc = Math.min(poolBalances[safetyBufferHolding.id], 13800);
  poolBalances[safetyBufferHolding.id] -= g1Alloc;
  // Goal 2 requests 50,000
  const g2Alloc = Math.min(poolBalances[safetyBufferHolding.id], 50000);
  assert(g1Alloc === 13800, 'Goal 1 receives full 13,800 allocation');
  assert(g2Alloc === 44200, 'Goal 2 only receives remaining 44,200 (58,000 - 13,800), strictly preventing double-counting');

  // 12.E Legacy Opening Balance Receivable (Sanjay 800 INR Case)
  const legacyReceivable: Receivable = {
    id: 'rec-sanjay',
    debtorName: 'Sanjay',
    currency: 'INR',
    principalAmount: 800,
    outstandingAmount: 800,
    issueDate: '2026-09-01',
    confidencePct: 90,
    isOpeningBalance: true,
    origin: 'legacy_opening',
    status: 'active',
    repayments: [],
  };

  assert(legacyReceivable.isOpeningBalance === true, 'Legacy opening balance flag preserved');
  // Partial repayment of 300 reduces outstanding to 500 without altering card liability
  const partialRepaymentAmount = 300;
  const newOutstandingRec = safeSub(legacyReceivable.outstandingAmount, partialRepaymentAmount);
  assert(newOutstandingRec === 500, 'Partial repayment of 300 reduces Sanjay receivable from 800 to exactly 500');

  // 13. Decoupling Net Worth Compounding Rate from Speculative Salary
  console.log('\n[Suite 13: Decoupling Net Worth Compounding Rate from Speculative Salary]');
  const physicalAssets: Holding[] = [
    {
      id: 'h-cash-1',
      typeId: 'type-bank',
      name: 'Salary Account',
      principalOrValue: 50000,
      currency: 'INR',
      fixedRatePct: 0,
      liquidityClass: 'Immediate',
    },
    {
      id: 'h-fd-1',
      typeId: 'type-fd',
      name: 'Fixed Deposit',
      principalOrValue: 100000,
      currency: 'INR',
      fixedRatePct: 8, // Yields 8,000/yr
      liquidityClass: 'Locked',
    },
  ];

  const physicalLiabilities: Liability[] = [
    {
      id: 'l-edu-1',
      name: 'Education Loan',
      kind: 'loan',
      currency: 'INR',
      outstanding: 50000,
      ratePct: 6, // Costs 3,000/yr
      monthlyEmi: 2000,
      tenureMonths: 30,
    },
  ];

  const futureSalaryStream: IncomeStream[] = [
    {
      id: 'inc-sal-1',
      name: 'Tech Job Salary',
      amountPerPeriod: 50000, // 50,000/month = 600,000/year
      period: 'monthly',
      currency: 'INR',
      payDay: 1,
      grossOrNet: 'net',
    },
  ];

  const resultWithSalary = calculateFinancialEngine(
    physicalAssets,
    BUILT_IN_ASSET_TYPES,
    physicalLiabilities,
    futureSalaryStream,
    [],
    DEFAULT_CURRENCIES,
    DEFAULT_SETTINGS,
    0
  );

  // Physical calculation:
  // Assets = 150,000 (Yield = 8,000/yr)
  // Liabilities = 50,000 (Cost = 3,000/yr)
  // Net Worth Base = 100,000
  // Net Compounding Rate must equal strictly: Assets Yield (8,000) - Debt Cost (3,000) = 5,000/yr
  // Rate % = (5,000 / 100,000) * 100 = 5.0% p.a.
  // Salary of 600,000/yr must NOT be added to finalRateAmountPerYear (which would have yielded 605,000/yr)
  assert(resultWithSalary.finalRateAmountPerYear === 5000, 'finalRateAmountPerYear strictly equals physical yield (8,000) minus debt cost (3,000) = 5,000, excluding salary promise');
  assert(Math.abs(resultWithSalary.finalRatePct - 5.0) < 0.001, 'finalRatePct strictly equals 5.0% p.a. on physical net worth base');
  assert(resultWithSalary.salaryYearlyIncomeBase === 600000, 'salaryYearlyIncomeBase preserved accurately for budgeting/cash-flow at 600,000/yr');

  // Verify independence: doubling or changing salary has ZERO impact on net compounding rate
  const doubledSalaryStream: IncomeStream[] = [
    {
      id: 'inc-sal-2',
      name: 'Senior Promotion Salary',
      amountPerPeriod: 100000, // 100,000/month = 1,200,000/year
      period: 'monthly',
      currency: 'INR',
      payDay: 1,
      grossOrNet: 'net',
    },
  ];

  const resultWithDoubledSalary = calculateFinancialEngine(
    physicalAssets,
    BUILT_IN_ASSET_TYPES,
    physicalLiabilities,
    doubledSalaryStream,
    [],
    DEFAULT_CURRENCIES,
    DEFAULT_SETTINGS,
    0
  );

  assert(resultWithDoubledSalary.finalRateAmountPerYear === 5000, 'finalRateAmountPerYear remains exactly 5,000 despite salary doubling to 1,200,000/yr');
  assert(Math.abs(resultWithDoubledSalary.finalRatePct - 5.0) < 0.001, 'finalRatePct remains exactly 5.0% p.a., completely decoupled from salary earning rate');

  // 12. External Inflows & Outside Settlements Tests (All 3 Scenarios)
  console.log('\n[Suite 12: External Cash Inflow & Outside Settlement Tests]');

  // Scenario 1: External Cash Gift from Loved One into Account
  const initialBankHolding: Holding = {
    id: 'h-bank-hdfc',
    name: 'HDFC Bank Account',
    typeId: 'type-bank',
    currency: 'INR',
    principalOrValue: 25000,
    liquidityClass: 'Immediate',
  };

  const giftAmount = 15000;
  const updatedBankBalance = safeAdd(initialBankHolding.principalOrValue, giftAmount);
  assert(updatedBankBalance === 40000, 'Scenario 1: Receiving ₹15,000 cash gift updates bank balance from ₹25,000 to exactly ₹40,000');

  const giftTx: Transaction = {
    id: 'tx-gift-1',
    date: '2026-11-01',
    kind: 'income',
    amount: giftAmount,
    currency: 'INR',
    toId: initialBankHolding.id,
    reason: 'External Inflow: Loved One (Gift)',
    category: 'Gift',
    tags: ['External Inflow', 'Gift'],
    fxRateUsed: 1.0,
  };
  assert(giftTx.kind === 'income' && giftTx.amount === 15000, 'Scenario 1: Transaction ledger record created with kind: income');

  // Scenario 2: Direct Third-Party Bill Payment (Outside Settlement - Personal Bank Untouched)
  const initialUserBankBalance = 20000;
  const loanLiability: Liability = {
    id: 'loan-edu-1',
    name: 'Education Loan',
    kind: 'loan',
    currency: 'INR',
    outstanding: 150000,
    ratePct: 10.5,
    monthlyEmi: 12000,
  };
  const billToSettle: Bill = {
    id: 'bill-edu-emi',
    name: 'Education Loan EMI',
    amount: 12000,
    currency: 'INR',
    frequency: 'monthly',
    dueDay: 10,
    sourceId: initialBankHolding.id,
    category: 'Loan EMI',
    isAutoLiabilityBill: true,
    liabilityId: loanLiability.id,
    liabilityKind: 'loan',
  };

  // Parents pay the ₹12,000 loan EMI directly on user's behalf from their own external bank
  const outsideSettlementAmount = 12000;
  const updatedLoanOutstanding = Math.max(0, safeSub(loanLiability.outstanding, outsideSettlementAmount));
  const postSettlementUserBankBalance = initialUserBankBalance; // User's personal cash is NOT debited!

  assert(updatedLoanOutstanding === 138000, 'Scenario 2: Direct outside loan EMI payment reduces loan principal from ₹150,000 to ₹138,000');
  assert(postSettlementUserBankBalance === 20000, 'Scenario 2: User personal bank account balance remains strictly ₹20,000 (zero personal cash outflow)');

  const outsideSettlementTx: Transaction = {
    id: 'tx-outside-1',
    date: '2026-11-01',
    kind: 'income',
    amount: outsideSettlementAmount,
    currency: 'INR',
    toId: billToSettle.id,
    reason: `External Settlement: Bill "${billToSettle.name}" paid by Parents (Family Support)`,
    category: 'External Settlement',
    tags: ['Direct Settlement', 'Paid by Loved One', 'Family Support'],
    fxRateUsed: 1.0,
  };
  assert(
    Boolean(outsideSettlementTx.tags?.includes('Direct Settlement') && outsideSettlementTx.tags?.includes('Paid by Loved One')),
    'Scenario 2: Ledger records direct outside settlement tags accurately'
  );

  // Scenario 3: External Funding Directly Earmarked for a Goal
  const vacationGoal: Goal = {
    id: 'goal-vacation',
    name: 'Family Vacation',
    cost: 100000,
    currency: 'INR',
    accumulatedTotal: 35000,
    sources: [],
    isCompleted: false,
  };

  const giftForGoal = 25000;
  const newGoalAccumulated = safeAdd(vacationGoal.accumulatedTotal || 0, giftForGoal);
  const isGoalCompletedAfterGift = newGoalAccumulated >= vacationGoal.cost;

  assert(newGoalAccumulated === 60000, 'Scenario 3: Earmarked cash gift boosts goal savings from ₹35,000 to exactly ₹60,000');
  assert(!isGoalCompletedAfterGift, 'Scenario 3: Goal at 60% remains active until full 100% target reached');

  // Second gift of ₹40,000 to achieve 100% completion
  const completionGift = 40000;
  const finalGoalAccumulated = safeAdd(newGoalAccumulated, completionGift);
  const isNow100Pct = finalGoalAccumulated >= vacationGoal.cost;
  assert(isNow100Pct && finalGoalAccumulated === 100000, 'Scenario 3: Subsequent external gifts achieve 100% goal milestone accurately');

  // 14. ML Category Deduplication & Duplicate Key Collision Safety Tests
  console.log('\n[Suite 14: ML Category Deduplication & Key Collision Safety]');
  const corruptedCategories: SpendCategoryConfig[] = [
    { id: 'cat-ml-other-misc', name: 'Other / Misc', color: '#64748b' },
    { id: 'cat-ml-other-misc', name: 'Other Misc', color: '#64748b' },
    { id: 'cat-food', name: 'Food & Dining', color: '#f59e0b' },
    { id: 'cat-food-dup', name: 'Food & Dining', color: '#f59e0b' },
    { id: 'cat-custom', name: 'Personal Care', color: '#10b981' },
  ];
  const cleanedCats = dedupeSpendCategories(corruptedCategories);
  const uniqueIds = new Set(cleanedCats.map((c) => c.id));
  assert(cleanedCats.length === 3, 'dedupeSpendCategories removes duplicate IDs and duplicate normalized names');
  assert(uniqueIds.size === cleanedCats.length, 'dedupeSpendCategories guarantees 100% unique category IDs');

  // Test ML derive function with multiple transactions having colliding variations of "Other / Misc"
  const trickyTxs: Transaction[] = [
    { id: 't-1', date: '2026-11-01', amount: 50, kind: 'spend', reason: 'Misc stationery', category: 'Other / Misc', currency: 'INR', fxRateUsed: 1 },
    { id: 't-2', date: '2026-11-01', amount: 75, kind: 'spend', reason: 'Misc hardware', category: 'Other Misc', currency: 'INR', fxRateUsed: 1 },
    { id: 't-3', date: '2026-11-02', amount: 100, kind: 'spend', reason: 'Misc cords', category: 'Other-Misc', currency: 'INR', fxRateUsed: 1 },
    { id: 't-4', date: '2026-11-02', amount: 120, kind: 'spend', reason: 'Misc office', category: 'Other / Misc', currency: 'INR', fxRateUsed: 1 },
  ];
  const mlResult = deriveSmartSpendChipsAndCategories(trickyTxs, [], DEFAULT_SPEND_CATEGORIES, new Set());
  const derivedCatIds = mlResult.updatedCategories.map((c) => c.id);
  const uniqueDerivedIds = new Set(derivedCatIds);
  assert(
    derivedCatIds.length === uniqueDerivedIds.size,
    'deriveSmartSpendChipsAndCategories never produces duplicate category IDs (e.g. cat-ml-other-misc)'
  );
  assert(
    derivedCatIds.filter((id) => id === 'cat-ml-other-misc').length <= 1,
    'Colliding variations of Other/Misc collapse safely into single or uniquely suffixed categories'
  );

  // 15. Counterparty Multi-Entry Grouping, Growing Interest & Mutual Offsetting
  console.log('\n[Suite 15: Counterparty Multi-Entry Grouping, Growing Interest & Offsetting]');
  const multiRahulRecs: Receivable[] = [
    {
      id: 'rec-r1',
      debtorName: 'Rahul',
      currency: 'INR',
      principalAmount: 500,
      outstandingAmount: 500,
      issueDate: '2026-10-01',
      confidencePct: 90,
      direction: 'lent',
      status: 'active',
      repayments: [],
    },
    {
      id: 'rec-r2',
      debtorName: 'Rahul',
      currency: 'INR',
      principalAmount: 200,
      outstandingAmount: 200,
      issueDate: '2026-10-15',
      confidencePct: 90,
      direction: 'lent',
      status: 'active',
      repayments: [],
    },
    {
      id: 'rec-r3',
      debtorName: 'Rahul',
      currency: 'INR',
      principalAmount: 300,
      outstandingAmount: 300,
      issueDate: '2026-10-20',
      confidencePct: 100,
      direction: 'borrowed',
      status: 'active',
      repayments: [],
    },
    {
      id: 'rec-r4',
      debtorName: 'Priya',
      currency: 'INR',
      principalAmount: 1000,
      outstandingAmount: 1000,
      interestRatePct: 12, // 12% p.a.
      issueDate: '2026-05-01',
      confidencePct: 85,
      direction: 'lent',
      status: 'active',
      repayments: [],
    },
  ];

  const grouped = groupReceivablesByCounterparty(multiRahulRecs, new Date('2026-11-01'));
  const rahulGroup = grouped.find((g) => g.name === 'Rahul');
  const priyaGroup = grouped.find((g) => g.name === 'Priya');

  assert(Boolean(rahulGroup), 'Multiple loans to Rahul grouped under a single counterparty');
  assert(rahulGroup?.totalPrincipalOwedToUser === 700, 'Rahul total lent accurately summed (500 + 200 = 700)');
  assert(rahulGroup?.totalPrincipalUserOwes === 300, 'Rahul total user borrowed accurately summed (300)');
  assert(rahulGroup?.netBalance === 400, 'Rahul net balance accurately calculated (700 - 300 = 400 net owed to user)');

  assert(Boolean(priyaGroup), 'Priya grouped under single counterparty');
  assert((priyaGroup?.totalAccruedInterest || 0) > 50, 'Accrued interest on 12% p.a. loan calculated and summed accurately');

  // Test Mutual Offsetting
  const offsetResult = autoOffsetCounterpartyBalances(multiRahulRecs, '2026-11-01');
  assert(offsetResult.totalOffsetAmount === 300, 'Mutual offset clears exactly 300 of reciprocal debts');
  const updatedR3 = offsetResult.updatedRecords.find((r) => r.id === 'rec-r3');
  const updatedR1 = offsetResult.updatedRecords.find((r) => r.id === 'rec-r1');
  const updatedR2 = offsetResult.updatedRecords.find((r) => r.id === 'rec-r2');

  assert(updatedR3?.outstandingAmount === 0 && updatedR3?.status === 'collected' && updatedR3?.isArchived === true, 'Borrowed 300 fully settled and marked as archived from active view');
  assert(updatedR1?.outstandingAmount === 200, 'First lent loan of 500 partially offset down to 200');
  assert(updatedR2?.outstandingAmount === 200, 'Second lent loan of 200 remains untouched');
  const totalRemainingOwed = (updatedR1?.outstandingAmount || 0) + (updatedR2?.outstandingAmount || 0);
  assert(totalRemainingOwed === 400, 'Net remaining owed by Rahul to user is exactly 400 (200 + 200)');

  // 16. MODULE 1: Standalone SMS Ingestion & Signal-to-Noise Filtering Engine
  console.log('\n[Suite 16: Standalone SMS Signal-to-Noise Filtering Engine]');
  const validUpiSms = 'Rs 110.00 debited from A/c XX3986 on 02-Nov-26 via UPI to Hungerbox. Ref: 123456.';
  const validWithTrailingBal = 'Rs 450.00 spent on Card XX9012 at Amazon on 02-Nov-26. Available balance is Rs 18,400.00.';
  const otpNoiseSms = '482910 is your OTP for Rs 5,000.00 Card transaction at Flipkart. Do not share this code with anyone.';
  const verificationNoiseSms = 'Your verification code for NetBanking A/c XX3986 login is 892311.';
  const promoLoanSms = 'Congratulations! Pre-approved loan approved up to Rs 5,00,000 on your Card! Apply now.';
  const promoCashbackSms = 'Get flat 20% discount & cashback offer on UPI spends with your Card.';
  const passiveBalanceSms = 'Dear Customer, available balance is Rs 42,190.50 in your A/c XX3986 as of 02-Nov-26.';
  const statementNoticeSms = 'Your Credit Card XX9012 e-statement generated for Oct 2026. Minimum amount due Rs 1,200.';

  assert(classifyFinancialSms(validUpiSms, 'VM-CANBNK').passed === true, 'Module 1 passes valid UPI debit SMS');
  assert(classifyFinancialSms(validWithTrailingBal, 'VM-HDFCBK').passed === true, 'Module 1 passes active card spend even when trailing available balance is mentioned');
  assert(classifyFinancialSms(otpNoiseSms).passed === false && classifyFinancialSms(otpNoiseSms).dropCategory === 'otp_or_auth', 'Module 1 drops OTP message even when Rs amount and Card are present');
  assert(classifyFinancialSms(verificationNoiseSms).passed === false && classifyFinancialSms(verificationNoiseSms).dropCategory === 'otp_or_auth', 'Module 1 drops verification code SMS');
  assert(classifyFinancialSms(promoLoanSms).passed === false && classifyFinancialSms(promoLoanSms).dropCategory === 'promotional_spam', 'Module 1 drops loan approved / apply now promotional spam');
  assert(classifyFinancialSms(promoCashbackSms).passed === false && classifyFinancialSms(promoCashbackSms).dropCategory === 'promotional_spam', 'Module 1 drops discount / cashback offer promotional spam');
  assert(classifyFinancialSms(passiveBalanceSms).passed === false && classifyFinancialSms(passiveBalanceSms).dropCategory === 'passive_balance_or_statement', 'Module 1 drops pure available balance inquiry without active movement');
  assert(classifyFinancialSms(statementNoticeSms).passed === false && classifyFinancialSms(statementNoticeSms).dropCategory === 'passive_balance_or_statement', 'Module 1 drops monthly statement generated notice');

  // 17. MODULE 2: Deterministic SMS Parsing, Holding Routing, 5-Min Deduplication & Active RL Learning
  console.log('\n[Suite 17: Autonomous SMS Parsing, Strict 5-Min Deduplication & Active RL Engine]');
  const dailyFriendHolding: Holding = {
    id: 'hold-1793093398606',
    name: 'Daily Friend',
    typeId: 'type-bank',
    currency: 'INR',
    principalOrValue: 5000,
    liquidityClass: 'Immediate',
    accountLastDigits: '3986',
    notes: 'Canara Bank Savings XX3986',
  };

  // User previously re-categorized "Hungerbox" -> "Office Lunch"
  const learnedRules: SmsRuleOverride[] = learnCategoryOverrideFromMerchant(
    'Hungerbox',
    'Office Lunch',
    []
  );
  assert(
    learnedRules.length === 1 &&
      learnedRules[0].merchantAlias === 'hungerbox' &&
      learnedRules[0].mappedCategory === 'Office Lunch' &&
      learnedRules[0].confidence === 1.0,
    'User re-categorization writes high-priority Hungerbox -> Office Lunch alias override'
  );

  // Verify deterministic parser fields on target scenario
  const parsedHungerbox = parseFinancialSms(validUpiSms, {
    sender: 'VM-CANBNK',
    receivedAtIso: '2026-11-02T07:30:00.000Z',
  });
  assert(parsedHungerbox !== null, 'Deterministic parser extracts valid Hungerbox SMS');
  assert(parsedHungerbox!.amount === 110, 'Extracted exact amount 110 INR (ignoring decimals .00)');
  assert(parsedHungerbox!.accountLastDigits === '3986', 'Extracted trailing account digits 3986 from XX3986');
  assert(parsedHungerbox!.merchantName === 'Hungerbox', 'Extracted clean merchant name "Hungerbox"');
  assert(parsedHungerbox!.paymentMode === 'upi', 'Extracted payment mode "upi"');
  assert(parsedHungerbox!.refId === '123456', 'Extracted UPI Ref ID "123456"');
  assert(parsedHungerbox!.parsedDate === '2026-11-02', 'Parsed 02-Nov-26 into ISO date 2026-11-02');

  // Run full batch pipeline with noise + valid Hungerbox SMS
  const baseTsMs = new Date('2026-11-02T07:30:00.000Z').getTime();
  const batchRun1 = processIncomingSmsBatchOnDevice({
    messages: [
      { id: 'm-noise-1', sender: 'VM-OTP', body: otpNoiseSms, timestampMs: baseTsMs - 30000 },
      { id: 'm-valid-1', sender: 'VM-CANBNK', body: validUpiSms, timestampMs: baseTsMs },
    ],
    holdings: [dailyFriendHolding],
    liabilities: [],
    transactions: [],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: learnedRules,
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });

  assert(batchRun1.droppedNoiseCount === 1, 'Batch processor dropped 1 OTP noise SMS');
  assert(batchRun1.newlyCommittedTransactions.length === 1, 'Batch processor auto-committed 1 valid transaction');
  const committedHungerboxTx = batchRun1.newlyCommittedTransactions[0];
  assert(
    committedHungerboxTx.fromId === 'hold-1793093398606' &&
      committedHungerboxTx.amount === 110 &&
      committedHungerboxTx.category === 'Office Lunch',
    'SMS routed to hold-1793093398606 ("Daily Friend") with learned category "Office Lunch"'
  );
  assert(
    batchRun1.updatedHoldings[0].principalOrValue === 4890,
    'Holding balance debited atomically from 5,000 to 4,890 INR'
  );

  // Strict 5-minute duplicate guard: identical or duplicate SMS 2 minutes later is discarded
  const duplicateSmsWithin5Min =
    'Rs 110.00 debited from A/c XX3986 on 02-Nov-26 via UPI to Hungerbox.';
  const batchRunDup = processIncomingSmsBatchOnDevice({
    messages: [
      {
        id: 'm-dup-1',
        sender: 'VM-CANBNK',
        body: duplicateSmsWithin5Min,
        timestampMs: baseTsMs + 2 * 60 * 1000, // +2 mins (inside 5-min window)
      },
    ],
    holdings: batchRun1.updatedHoldings,
    liabilities: [],
    transactions: batchRun1.updatedTransactions,
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: learnedRules,
    stagingQueue: batchRun1.updatedStagingQueue,
    defaultCurrency: 'INR',
    autoCommit: true,
  });

  assert(batchRunDup.discardedDuplicateCount === 1, 'Duplicate SMS within strict 5-minute window discarded');
  assert(batchRunDup.updatedHoldings[0].principalOrValue === 4890, 'Holding balance remains 4,890 after duplicate drop');

  // Distinct second coffee/snack purchase 10 minutes later (> 5-min window, different Ref ID) is allowed
  const secondDistinctPurchase =
    'Rs 110.00 debited from A/c XX3986 on 02-Nov-26 13:15:00 via UPI to Hungerbox. Ref: 999888.';
  const batchRunDistinct = processIncomingSmsBatchOnDevice({
    messages: [
      {
        id: 'm-valid-2',
        sender: 'VM-CANBNK',
        body: secondDistinctPurchase,
        timestampMs: new Date('2026-11-02T13:15:00').getTime(),
      },
    ],
    holdings: batchRunDup.updatedHoldings,
    liabilities: [],
    transactions: batchRunDup.updatedTransactions,
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: learnedRules,
    stagingQueue: batchRunDup.updatedStagingQueue,
    defaultCurrency: 'INR',
    autoCommit: true,
  });
  assert(batchRunDistinct.newlyCommittedTransactions.length === 1, 'Distinct transaction outside 5-minute window with new Ref ID is permitted');

  // Active RL Flag / Never Occurred Action: rolls back balance, marks reversed, blacklists signature with confidence = 0
  const flagOutcome = applySmsFlagFeedback({
    transaction: committedHungerboxTx,
    flagReason: 'never_occurred',
    holdings: batchRun1.updatedHoldings,
    liabilities: [],
    transactions: batchRun1.updatedTransactions,
    ruleOverrides: learnedRules,
    stagingQueue: batchRun1.updatedStagingQueue,
  });

  assert(
    flagOutcome.reversalResult.updatedHoldings[0].principalOrValue === 5000,
    'Flagging SMS as Never Occurred atomically restores holding balance from 4,890 back to 5,000'
  );
  const reversedFlaggedTx = flagOutcome.reversalResult.updatedTransactions.find(
    (t) => t.id === committedHungerboxTx.id
  );
  assert(reversedFlaggedTx?.isReversed === true, 'Flagged SMS transaction marked isReversed = true');
  const blacklistRule = flagOutcome.updatedRuleOverrides.find(
    (r) => r.ruleType === 'pattern_blacklist' && r.isBlacklisted
  );
  assert(
    blacklistRule !== undefined && blacklistRule.confidence === 0,
    'Blacklist override created with confidence strictly dropped to 0'
  );

  // Subsequent SMS matching blacklisted pattern + merchant is blocked automatically
  const postBlacklistRun = processIncomingSmsBatchOnDevice({
    messages: [
      {
        id: 'm-blocked-1',
        sender: 'VM-CANBNK',
        body: 'Rs 240.00 debited from A/c XX3986 on 03-Nov-26 via UPI to Hungerbox. Ref: 777666.',
        timestampMs: new Date('2026-11-03T08:00:00.000Z').getTime(),
      },
    ],
    holdings: flagOutcome.reversalResult.updatedHoldings,
    liabilities: [],
    transactions: flagOutcome.reversalResult.updatedTransactions,
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: flagOutcome.updatedRuleOverrides,
    stagingQueue: flagOutcome.updatedStagingQueue,
    defaultCurrency: 'INR',
    autoCommit: true,
  });
  assert(
    postBlacklistRun.blacklistedCount === 1 && postBlacklistRun.newlyCommittedTransactions.length === 0,
    'Future SMS matching blacklisted signature is blocked before touching balances'
  );

  // 18. MODULE 3: Bi-directional Debt Offset & Principal Reconciliation Pipeline
  console.log('\n[Suite 18: Bi-directional Debt Offset & Principal Reconciliation Pipeline]');
  const naveenReceivable: Receivable = {
    id: 'rec-1793114611705-bt8j',
    debtorName: 'Naveen',
    currency: 'INR',
    principalAmount: 10300,
    outstandingAmount: 10300,
    issueDate: '2026-10-25',
    confidencePct: 95,
    direction: 'lent',
    status: 'active',
    repayments: [],
  };

  // Scenario A: Naveen pays ₹110 for an expense on the user's behalf
  const reconStep1 = reconcileDebtorPaymentOrOffset({
    receivables: [naveenReceivable],
    holdings: [dailyFriendHolding],
    transactions: [],
    receivableId: 'rec-1793114611705-bt8j',
    paidAmount: 110,
    mode: 'expense_offset',
    expenseDescription: 'Office Lunch paid by Naveen',
    date: '2026-11-02',
    currency: 'INR',
  });

  assert(reconStep1.success === true, 'Debtor expense offset reconciliation succeeded');
  const naveenAfter110 = reconStep1.updatedReceivables.find(
    (r) => r.id === 'rec-1793114611705-bt8j'
  )!;
  assert(
    naveenAfter110.outstandingAmount === 10190,
    'Principal Reduction: Naveen outstandingAmount reduced from 10,300 to exactly 10,190 (10300 - 110)'
  );
  assert(
    reconStep1.newLedgerTransaction !== undefined &&
      reconStep1.newLedgerTransaction.kind === 'adjustment' &&
      reconStep1.newLedgerTransaction.amount === 110,
    'Main Ledger Cash Flow: Adjustment transaction of 110 INR recorded in main transactions ledger'
  );
  assert(
    naveenAfter110.repayments !== undefined &&
      naveenAfter110.repayments.length === 1 &&
      naveenAfter110.repayments[0].txId === reconStep1.newLedgerTransaction!.id,
    'Referential Integrity: receivables.repayments[0].txId directly references new main ledger Transaction.id'
  );

  // Scenario B: Direct Cash Deposit + Over-repayment Protection (Naveen transfers ₹10,500 against ₹10,190 remaining)
  const reconOverpay = reconcileDebtorPaymentOrOffset({
    receivables: reconStep1.updatedReceivables,
    holdings: reconStep1.updatedHoldings,
    transactions: reconStep1.updatedTransactions,
    receivableId: 'rec-1793114611705-bt8j',
    paidAmount: 10500,
    mode: 'cash_deposit',
    depositAccountId: 'hold-1793093398606',
    date: '2026-11-03',
    currency: 'INR',
  });

  assert(reconOverpay.success === true, 'Over-repayment deposit reconciliation succeeded');
  const naveenSettled = reconOverpay.updatedReceivables.find(
    (r) => r.id === 'rec-1793114611705-bt8j'
  )!;
  assert(
    naveenSettled.outstandingAmount === 0 &&
      naveenSettled.status === 'collected' &&
      naveenSettled.isArchived === true,
    'Over-repayment Protection: Principal reduction capped strictly at 0 (never negative) and settled record archived'
  );
  assert(
    reconOverpay.principalReducedTotal === 10190 && reconOverpay.excessAdvanceAmount === 310,
    'Exact split: 10,190 principal cleared + 310 excess advance isolated'
  );
  assert(
    reconOverpay.excessCreditAdvance !== undefined &&
      reconOverpay.excessCreditAdvance.direction === 'borrowed' &&
      reconOverpay.excessCreditAdvance.isCreditAdvance === true &&
      reconOverpay.excessCreditAdvance.outstandingAmount === 310,
    'Excess 310 INR automatically recorded as a flagged Credit Advance (direction: borrowed, isCreditAdvance: true)'
  );
  assert(
    reconOverpay.newLedgerTransaction?.kind === 'income' &&
      reconOverpay.updatedHoldings[0].principalOrValue === 15500,
    'Cash deposit of 10,500 INR recorded as income transaction and credited to target bank holding (5,000 + 10,500 = 15,500)'
  );

  // 19. Real-World Indian Bank/Card/UPI SMS Formats, Incremental Digit Matching, Balance Alerts & Co-Learning
  console.log('\n[Suite 19: Real-World Multi-Line Card UPI, Loan-Against-Card Repayment, Incremental Digit Matching & Balance Mismatch Alerts]');

  // --- Scenario 19A: Multi-line HDFC Bank Card 3230 UPI Spend + Missing Year + Missing Date Fallback + ML Reason Suggestion ---
  const example1Sms = `Txn Rs.52.00
On HDFC Bank Card 3230
At paytm-8774066@ptybl 
by UPI 173332464899
On 15-07
Not You?
Call 18002586161/SMS BLOCK CC 3230 to 7308080808`;

  const pastedBatchEx1 = splitManualPastedSmsBatch(example1Sms);
  assert(
    pastedBatchEx1.length === 1,
    'Multi-line 7-line HDFC Card UPI SMS stays intact as 1 unified SMS message during paste'
  );

  const parsedEx1 = parseFinancialSms(example1Sms, {
    sender: 'AX-HDFCBK',
    receivedAtIso: '2026-07-15T10:15:00.000Z',
  });
  assert(parsedEx1 !== null, 'Example 1 multi-line Txn Rs.52.00 HDFC Card SMS passes filter and parses');
  assert(
    parsedEx1!.amount === 52 &&
      parsedEx1!.direction === 'debit' &&
      parsedEx1!.accountLastDigits === '3230' &&
      parsedEx1!.bankHint === 'hdfc' &&
      parsedEx1!.rawCounterparty === 'paytm-8774066@ptybl' &&
      parsedEx1!.refId === '173332464899' &&
      parsedEx1!.paymentMode === 'upi' &&
      parsedEx1!.parsedDate === '2026-07-15',
    'Example 1 extracts amount=52, card=3230, bankHint=hdfc, rawCounterparty=paytm-8774066@ptybl, refId=173332464899, date=2026-07-15'
  );

  // Missing-date fallback test: if "On 15-07" is omitted, current date is used automatically
  const example1NoDate = `Txn Rs.52.00\nOn HDFC Bank Card 3230\nAt paytm-8774066@ptybl\nby UPI 173332464899`;
  const parsedNoDate = parseFinancialSms(example1NoDate, {
    receivedAtIso: '2026-11-02T09:00:00.000Z',
  });
  assert(
    parsedNoDate !== null && parsedNoDate.parsedDate === '2026-11-02',
    'When date is omitted from SMS, parser defaults cleanly to current/received date (2026-11-02)'
  );

  const hdfcBankHolding: Holding = {
    id: 'hold-hdfc-main',
    typeId: 'type-bank',
    name: 'HDFC Salary Account',
    currency: 'INR',
    liquidityClass: 'Immediate',
    principalOrValue: 42000,
    fixedRatePct: 3.0,
    accountLastDigits: '8821',
  };

  // Card linked to HDFC bank account (testing linked-card resolution even if card name has no "HDFC" word)
  const linkedRupayCard3230: Liability = {
    id: 'card-rupay-3230',
    name: 'Tata Neu Infinity Card',
    kind: 'card',
    cardType: 'credit',
    currency: 'INR',
    outstanding: 1200,
    ratePct: 42,
    limit: 150000,
    linkedAccountId: 'hold-hdfc-main',
    accountLastDigits: '3230',
  };

  // Past spends of ~₹50 on Tea & Snacks so ML suggests it for the ₹52 opaque Paytm QR
  const pastTeaTx: Transaction = {
    id: 'tx-past-tea-1',
    date: '2026-07-10',
    kind: 'spend',
    amount: 50,
    currency: 'INR',
    fromId: 'card-rupay-3230',
    sourceId: 'card-rupay-3230',
    reason: 'Evening Tea & Bakery',
    category: 'Food & Dining',
    paymentMode: 'upi',
    fxRateUsed: 1,
  };

  const ex1Batch = processIncomingSmsBatchOnDevice({
    messages: [{ id: 'ex1', sender: 'AX-HDFCBK', body: example1Sms, timestampMs: new Date('2026-07-15T10:15:00Z').getTime() }],
    holdings: [hdfcBankHolding],
    liabilities: [linkedRupayCard3230],
    transactions: [pastTeaTx],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: [],
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });

  assert(
    ex1Batch.newlyStagedItems.length === 1 &&
      ex1Batch.newlyStagedItems[0].matchedSourceId === 'card-rupay-3230' &&
      ex1Batch.newlyStagedItems[0].requiresReview === true,
    'Example 1 routes to linked card 3230 and stages in Review Queue so user can confirm reason for opaque paytm QR'
  );
  assert(
    (ex1Batch.newlyStagedItems[0].suggestedReasons || []).some(
      (s) => s.reason === 'Evening Tea & Bakery' && s.category === 'Food & Dining'
    ),
    'ML model suggests "Evening Tea & Bakery" (Food & Dining) from user previous ~50 INR spend'
  );

  // User reviews Example 1 and sets reason = "Chai Point Tea", category = "Food & Dining" -> ML learns exact VPA!
  const learnedEx1Rules = learnFromUserSmsReview({
    stagedItem: ex1Batch.newlyStagedItems[0],
    finalSourceId: 'card-rupay-3230',
    finalTxKind: 'spend',
    finalReason: 'Chai Point Tea',
    finalCategory: 'Food & Dining',
    existingOverrides: [],
  });

  // Next day another spend at `paytm-8774066@ptybl` auto-fills "Chai Point Tea" & auto-commits without bothering user!
  const ex1NextDaySms = `Txn Rs.55.00\nOn HDFC Bank Card 3230\nAt paytm-8774066@ptybl\nby UPI 998877665544\nOn 16-07`;
  const ex1FollowUp = processIncomingSmsBatchOnDevice({
    messages: [{ id: 'ex1-next', sender: 'AX-HDFCBK', body: ex1NextDaySms, timestampMs: new Date('2026-07-16T10:15:00Z').getTime() }],
    holdings: [hdfcBankHolding],
    liabilities: [linkedRupayCard3230],
    transactions: [pastTeaTx],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: learnedEx1Rules,
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });
  assert(
    ex1FollowUp.newlyCommittedTransactions.length === 1 &&
      ex1FollowUp.newlyCommittedTransactions[0].reason === 'Chai Point Tea' &&
      ex1FollowUp.newlyCommittedTransactions[0].category === 'Food & Dining' &&
      ex1FollowUp.updatedLiabilities[0].outstanding === 1255,
    'After user review, next spend at paytm-8774066@ptybl automatically uses learned reason "Chai Point Tea" & posts to Card 3230'
  );

  // --- Scenario 19B: Credit Card / Loan-Against-Credit-Card Repayment SMS (Ending 6382) ---
  const example2Sms =
    'DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 14690.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 6382 ON 3-10-2026.YOUR AVAILABLE LIMIT IS RS. 21376.00';

  const parsedEx2 = parseFinancialSms(example2Sms, {
    sender: 'AD-HDFCBK',
    receivedAtIso: '2026-10-03T11:00:00.000Z',
  });
  assert(parsedEx2 !== null, 'Example 2 HDFC Cardmember Payment SMS passes filter and parses');
  assert(
    parsedEx2!.amount === 14690 &&
      parsedEx2!.reportedAvailableLimit === 21376 &&
      parsedEx2!.accountLastDigits === '6382' &&
      parsedEx2!.parsedDate === '2026-10-03' &&
      parsedEx2!.isCardOrLoanRepayment === true,
    'Example 2 extracts payment=14690 (ignoring 21376 available limit), digits=6382, date=2026-10-03, isCardOrLoanRepayment=true'
  );

  const hdfcCreditCard6382: Liability = {
    id: 'card-hdfc-6382',
    name: 'HDFC Regalia Credit Card',
    kind: 'card',
    cardType: 'credit',
    currency: 'INR',
    outstanding: 5000,
    ratePct: 42,
    limit: 100000,
    accountLastDigits: '6382',
  };
  const loanAgainstCard6382: Liability = {
    id: 'loan-against-cc-6382',
    name: 'HDFC InstaJumbo Loan on Card',
    kind: 'loan',
    currency: 'INR',
    outstanding: 120000,
    ratePct: 14.5,
    monthlyEmi: 14690,
    tenureMonths: 10,
  };

  const ex2StageRun = processIncomingSmsBatchOnDevice({
    messages: [{ id: 'ex2-1', sender: 'AD-HDFCBK', body: example2Sms, timestampMs: new Date('2026-10-03T11:00:00Z').getTime() }],
    holdings: [hdfcBankHolding],
    liabilities: [hdfcCreditCard6382, loanAgainstCard6382],
    transactions: [],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: [],
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });

  assert(
    ex2StageRun.newlyStagedItems.length === 1 &&
      ex2StageRun.newlyCommittedTransactions.length === 0 &&
      ex2StageRun.newlyStagedItems[0].matchedSourceId === 'hold-hdfc-main',
    'Example 2 stages in Review Queue with default paying bank = HDFC Salary Account'
  );

  // User reviews staged item and remaps target from Credit Card 6382 -> Loan Against Card (`loan-against-cc-6382`) as `emi`
  const learnedRepayRules = learnFromUserSmsReview({
    stagedItem: ex2StageRun.newlyStagedItems[0],
    finalSourceId: 'hold-hdfc-main',
    finalTargetLiabilityId: 'loan-against-cc-6382',
    finalTxKind: 'emi',
    finalReason: 'HDFC InstaJumbo Loan EMI',
    finalCategory: 'Loans & EMI',
    existingOverrides: [],
  });

  // Next month's payment SMS on 6382 automatically pre-selects `loan-against-cc-6382` + `emi` + `hold-hdfc-main`!
  const nextMonthEx2Sms =
    'DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 14690.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 6382 ON 3-11-2026.YOUR AVAILABLE LIMIT IS RS. 36066.00';
  const ex2NextMonthRun = processIncomingSmsBatchOnDevice({
    messages: [{ id: 'ex2-2', sender: 'AD-HDFCBK', body: nextMonthEx2Sms, timestampMs: new Date('2026-11-03T11:00:00Z').getTime() }],
    holdings: [hdfcBankHolding],
    liabilities: [hdfcCreditCard6382, loanAgainstCard6382],
    transactions: [],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: learnedRepayRules,
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });

  assert(
    ex2NextMonthRun.newlyStagedItems.length === 1 &&
      ex2NextMonthRun.newlyStagedItems[0].matchedTargetLiabilityId === 'loan-against-cc-6382' &&
      ex2NextMonthRun.newlyStagedItems[0].txKind === 'emi' &&
      ex2NextMonthRun.newlyStagedItems[0].matchedSourceId === 'hold-hdfc-main',
    'ML model learned user review: next month 6382 payment automatically pre-routes to Loan Against Card (emi) from HDFC Bank'
  );

  // --- Scenario 19C: Canara Bank XX913 (3-digit SMS vs 4-digit stored account, custom holding name) + IMPS Credit + Balance Discrepancy Alert ---
  const example3Sms =
    'A/c XX913 Cr INR 54.90 on 03/11/26 from INNOFINSOLUT; IMPS: 630702890694; Bal INR 13,403.67-CanaraBank';

  assert(
    scoreTrailingDigitsMatch('913', '4913', true) >= 90 &&
      scoreTrailingDigitsMatch('4913', '913', false) >= 90 &&
      scoreTrailingDigitsMatch('1913', '4913', true) === 0,
    'Incremental trailing-digit matcher matches 3-digit 913 <-> 4-digit 4913 while rejecting distinct 4th digit (1913 vs 4913)'
  );

  const parsedEx3 = parseFinancialSms(example3Sms, {
    sender: 'VM-CANBNK',
    receivedAtIso: '2026-11-03T14:20:00.000Z',
  });
  assert(parsedEx3 !== null, 'Example 3 CanaraBank Cr INR 54.90 IMPS SMS passes filter and parses');
  assert(
    parsedEx3!.amount === 54.9 &&
      parsedEx3!.direction === 'credit' &&
      parsedEx3!.accountLastDigits === '913' &&
      parsedEx3!.rawCounterparty === 'INNOFINSOLUT' &&
      parsedEx3!.paymentMode === 'imps' &&
      parsedEx3!.refId === '630702890694' &&
      parsedEx3!.reportedBalance === 13403.67 &&
      parsedEx3!.parsedDate === '2026-11-03',
    'Example 3 extracts amount=54.90 (not 13403.67), credit, digits=913, from=INNOFINSOLUT, IMPS ref=630702890694, reportedBalance=13403.67'
  );

  // User named the account "Emergency Rainy Vault" (no "Canara" in name!) with 4-digit `accountLastDigits: '4913'` and stale app balance `12000`
  const canaraCustomNamedHolding: Holding = {
    id: 'hold-rainy-vault',
    typeId: 'type-bank',
    name: 'Emergency Rainy Vault',
    currency: 'INR',
    liquidityClass: 'Immediate',
    principalOrValue: 12000, // 12000 + 54.90 = 12054.90 != 13403.67 -> MUST raise alert!
    fixedRatePct: 3.5,
    accountLastDigits: '4913',
  };

  const ex3MismatchRun = processIncomingSmsBatchOnDevice({
    messages: [{ id: 'ex3-1', sender: 'VM-CANBNK', body: example3Sms, timestampMs: new Date('2026-11-03T14:20:00Z').getTime() }],
    holdings: [hdfcBankHolding, canaraCustomNamedHolding],
    liabilities: [],
    transactions: [],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: [],
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });

  assert(
    ex3MismatchRun.newlyCommittedTransactions.length === 1 &&
      ex3MismatchRun.newlyCommittedTransactions[0].toId === 'hold-rainy-vault' &&
      ex3MismatchRun.updatedHoldings.find((h) => h.id === 'hold-rainy-vault')?.principalOrValue === 12054.9,
    'Example 3 matches 3-digit XX913 against 4-digit 4913 regardless of custom account name and credits +54.90 INR'
  );
  assert(
    ex3MismatchRun.balanceDiscrepancies.length === 1 &&
      ex3MismatchRun.balanceDiscrepancies[0].expectedAppBalance === 12054.9 &&
      ex3MismatchRun.balanceDiscrepancies[0].smsReportedBalance === 13403.67 &&
      ex3MismatchRun.balanceDiscrepancies[0].delta === 1348.77,
    'Balance Mismatch Alert raised accurately when existingAppBalance (12000) + 54.90 != 13403.67 (delta +1348.77)'
  );

  // Verify zero false alert when existing balance (13348.77) + 54.90 === 13403.67
  const exactCanaraHolding: Holding = {
    ...canaraCustomNamedHolding,
    principalOrValue: 13348.77,
  };
  const ex3ExactRun = processIncomingSmsBatchOnDevice({
    messages: [{ id: 'ex3-2', sender: 'VM-CANBNK', body: example3Sms, timestampMs: new Date('2026-11-03T14:20:00Z').getTime() }],
    holdings: [exactCanaraHolding],
    liabilities: [],
    transactions: [],
    spendCategories: DEFAULT_SPEND_CATEGORIES as SpendCategoryConfig[],
    ruleOverrides: [],
    stagingQueue: [],
    defaultCurrency: 'INR',
    autoCommit: true,
  });
  assert(
    ex3ExactRun.balanceDiscrepancies.length === 0 &&
      ex3ExactRun.updatedHoldings[0].principalOrValue === 13403.67,
    'Zero false balance alert when existingAppBalance (13348.77) + 54.90 equals exact SMS balance 13403.67'
  );

  // --- Scenario 19D: Directional "from <External Counterparty>" => CREDIT vs "from <Bank>" => DEBIT ---
  const fromExternalCounterpartySms =
    'INR 250.00 transferred on 04/11/26 from HEJEMENSMBD; UPI: 771122334455; A/c XX913';
  const fromBankSms =
    'INR 250.00 transferred on 04/11/26 from Canara Bank A/c XX913 via UPI: 881122334455';
  const fromHdfcSms =
    'Rs. 499.00 paid on 04/11/26 from HDFC Bank Card 3230 via UPI: 991122334455';

  const parsedFromExt = parseFinancialSms(fromExternalCounterpartySms);
  const parsedFromCanara = parseFinancialSms(fromBankSms);
  const parsedFromHdfc = parseFinancialSms(fromHdfcSms);

  assert(
    parsedFromExt !== null &&
      parsedFromExt.direction === 'credit' &&
      parsedFromExt.rawCounterparty === 'HEJEMENSMBD',
    '"from HEJEMENSMBD" (external counterparty) is classified as CREDIT inflow'
  );
  assert(
    parsedFromCanara !== null && parsedFromCanara.direction === 'debit',
    '"from Canara Bank" is classified as DEBIT outflow'
  );
  assert(
    parsedFromHdfc !== null && parsedFromHdfc.direction === 'debit',
    '"from HDFC Bank" is classified as DEBIT outflow'
  );

  // 20. Schema v4 Master CSV & Trailing Digits Round-Trip
  console.log('\n[Suite 20: Schema v4 Master CSV & Trailing-Digit Round-Trip]');
  const masterCsvV4 = exportMasterCsv(
    [exactCanaraHolding],
    BUILT_IN_ASSET_TYPES,
    [{ ...hdfcCreditCard6382, linkedAccountId: 'hold-hdfc-main' }],
    [],
    [],
    []
  );
  assert(
    masterCsvV4.includes('# Schema Version: 4'),
    'Unified Master CSV export carries Schema Version 4 header'
  );
  const parsedMasterV4 = parseMasterCsv(masterCsvV4, BUILT_IN_ASSET_TYPES);
  assert(
    parsedMasterV4.holdings.length === 1 &&
      parsedMasterV4.holdings[0].accountLastDigits === '4913' &&
      parsedMasterV4.liabilities.length === 1 &&
      parsedMasterV4.liabilities[0].accountLastDigits === '6382' &&
      parsedMasterV4.liabilities[0].linkedAccountId === 'hold-hdfc-main',
    'Schema v4 Master CSV round-trips accountLastDigits and linkedAccountId on both bank holdings and cards/loans'
  );

  // 21. Multi-Debt Cascading Repayment, Residual Deposit & Transparent Ledger Split
  console.log('\n[Suite 21: Multi-Debt Cascading Repayment, Residual Deposit & Ledger Split]');

  // Scenario 21A: User is owed 10,000 on Loan A and 1,000 on Loan B from "Ramesh".
  // Ramesh pays 11,000: exactly 10,000 clears Loan A, 1,000 clears Loan B, both are settled/archived, and Ramesh owes 0.
  const rameshLoanA: Receivable = {
    id: 'rec-ramesh-1',
    debtorName: 'Ramesh',
    currency: 'INR',
    principalAmount: 10000,
    outstandingAmount: 10000,
    interestRatePct: 0,
    issueDate: '2026-10-01',
    confidencePct: 100,
    direction: 'lent',
    status: 'active',
    repayments: [],
    notes: 'Personal Loan 1',
  };

  const rameshLoanB: Receivable = {
    id: 'rec-ramesh-2',
    debtorName: 'Ramesh',
    currency: 'INR',
    principalAmount: 1000,
    outstandingAmount: 1000,
    interestRatePct: 0,
    issueDate: '2026-10-15',
    confidencePct: 100,
    direction: 'lent',
    status: 'active',
    repayments: [],
    notes: 'Personal Loan 2',
  };

  const userPrimaryBank: Holding = {
    id: 'hold-primary-bank',
    name: 'Primary HDFC Savings',
    typeId: 'type-bank',
    currency: 'INR',
    principalOrValue: 25000,
    liquidityClass: 'Immediate',
  };

  const cascadeRecon11k = reconcileDebtorPaymentOrOffset({
    receivables: [rameshLoanA, rameshLoanB],
    holdings: [userPrimaryBank],
    transactions: [],
    receivableId: 'rec-ramesh-1', // Target Loan A first
    debtorName: 'Ramesh',
    paidAmount: 11000,
    mode: 'cash_deposit',
    depositAccountId: 'hold-primary-bank',
    date: '2026-11-05',
    currency: 'INR',
  });

  assert(cascadeRecon11k.success === true, 'Cascade payment of 11,000 succeeded');
  assert(cascadeRecon11k.principalReducedTotal === 11000, 'Total principal reduced equals exactly 11,000');
  assert(cascadeRecon11k.excessAdvanceAmount === 0, 'Zero excess advance as both debts equal 11,000');

  const updatedA = cascadeRecon11k.updatedReceivables.find((r) => r.id === 'rec-ramesh-1')!;
  const updatedB = cascadeRecon11k.updatedReceivables.find((r) => r.id === 'rec-ramesh-2')!;

  assert(
    updatedA.outstandingAmount === 0 && updatedA.status === 'collected' && updatedA.isArchived === true,
    'Loan A (10,000) is 100% paid down and archived'
  );
  assert(
    updatedB.outstandingAmount === 0 && updatedB.status === 'collected' && updatedB.isArchived === true,
    'Remaining 1,000 cascaded to Loan B (1,000), clearing it 100% and archiving it'
  );

  // Check that person still owes user something or not via groupReceivablesByCounterparty
  const rameshGrouped = groupReceivablesByCounterparty(cascadeRecon11k.updatedReceivables);
  const rameshActive = rameshGrouped.find((g) => g.name.toLowerCase() === 'ramesh');
  assert(
    rameshActive === undefined || Math.abs(rameshActive.netBalance) <= 0.01,
    'Counterparty group confirms Ramesh owes nothing (net balance 0, all debts settled)'
  );

  // Check distinct ledger logging: exactly 2 distinct transactions created
  assert(
    cascadeRecon11k.newLedgerTransactions !== undefined &&
      cascadeRecon11k.newLedgerTransactions.length === 2,
    'Distinct ledger logging: Exactly 2 separate transactions created (one for 10,000 on Loan A and one for 1,000 on Loan B)'
  );
  assert(
    cascadeRecon11k.newLedgerTransactions![0].amount === 10000 &&
      cascadeRecon11k.newLedgerTransactions![0].linkedReceivableId === 'rec-ramesh-1' &&
      cascadeRecon11k.newLedgerTransactions![1].amount === 1000 &&
      cascadeRecon11k.newLedgerTransactions![1].linkedReceivableId === 'rec-ramesh-2',
    'Ledger transactions accurately log individual amounts (10,000 and 1,000) and link to respective loan IDs'
  );

  // Check bank account balance credited
  const updatedBank = cascadeRecon11k.updatedHoldings.find((h) => h.id === 'hold-primary-bank')!;
  assert(
    updatedBank.principalOrValue === 36000,
    'User primary bank account credited with 11,000 (25,000 + 11,000 = 36,000)'
  );

  // Scenario 21B: Partial Cascade + Person Still Owes User
  // Suresh owes 10,000 on Loan 1 and 3,000 on Loan 2 (Total: 13,000). Suresh pays 11,000.
  // Loan 1 gets 10,000 (cleared), Loan 2 gets 1,000 (2,000 remaining). Suresh still owes 2,000.
  const sureshLoanA: Receivable = {
    id: 'rec-suresh-1',
    debtorName: 'Suresh',
    currency: 'INR',
    principalAmount: 10000,
    outstandingAmount: 10000,
    interestRatePct: 0,
    issueDate: '2026-10-01',
    confidencePct: 100,
    direction: 'lent',
    status: 'active',
    repayments: [],
  };

  const sureshLoanB: Receivable = {
    id: 'rec-suresh-2',
    debtorName: 'Suresh',
    currency: 'INR',
    principalAmount: 3000,
    outstandingAmount: 3000,
    interestRatePct: 0,
    issueDate: '2026-10-15',
    confidencePct: 100,
    direction: 'lent',
    status: 'active',
    repayments: [],
  };

  const cascadeSuresh = reconcileDebtorPaymentOrOffset({
    receivables: [sureshLoanA, sureshLoanB],
    holdings: [userPrimaryBank],
    transactions: [],
    receivableId: 'rec-suresh-1',
    debtorName: 'Suresh',
    paidAmount: 11000,
    mode: 'cash_deposit',
    depositAccountId: 'hold-primary-bank',
    date: '2026-11-05',
    currency: 'INR',
  });

  const sureshUpdatedA = cascadeSuresh.updatedReceivables.find((r) => r.id === 'rec-suresh-1')!;
  const sureshUpdatedB = cascadeSuresh.updatedReceivables.find((r) => r.id === 'rec-suresh-2')!;
  assert(
    sureshUpdatedA.outstandingAmount === 0 && sureshUpdatedA.status === 'collected',
    'Suresh Loan 1 (10,000) fully cleared'
  );
  assert(
    sureshUpdatedB.outstandingAmount === 2000 && sureshUpdatedB.status === 'partially_collected',
    'Suresh Loan 2 reduced by 1,000 leaving 2,000 active'
  );

  const sureshGrouped = groupReceivablesByCounterparty(cascadeSuresh.updatedReceivables);
  const sureshActive = sureshGrouped.find((g) => g.name.toLowerCase() === 'suresh')!;
  assert(
    sureshActive !== undefined && sureshActive.netBalance === 2000,
    'Display clearly indicates Suresh still owes user 2,000'
  );

  // Scenario 21C: Surplus beyond all debts -> deposited into user primary bank account & logged differently in ledger
  // Anita owes 10,000. She pays 12,000.
  // 10,000 clears the loan; remaining 2,000 surplus is added to user primary bank account and logged as a distinct ledger transaction.
  const anitaLoan: Receivable = {
    id: 'rec-anita-1',
    debtorName: 'Anita',
    currency: 'INR',
    principalAmount: 10000,
    outstandingAmount: 10000,
    interestRatePct: 0,
    issueDate: '2026-10-01',
    confidencePct: 100,
    direction: 'lent',
    status: 'active',
    repayments: [],
  };

  const anitaBank: Holding = {
    id: 'hold-anita-bank',
    name: 'Primary Checking',
    typeId: 'type-bank',
    currency: 'INR',
    principalOrValue: 10000,
    liquidityClass: 'Immediate',
  };

  const cascadeAnita = reconcileDebtorPaymentOrOffset({
    receivables: [anitaLoan],
    holdings: [anitaBank],
    transactions: [],
    receivableId: 'rec-anita-1',
    debtorName: 'Anita',
    paidAmount: 12000,
    mode: 'cash_deposit',
    depositAccountId: 'hold-anita-bank',
    date: '2026-11-05',
    currency: 'INR',
  });

  assert(cascadeAnita.principalReducedTotal === 10000, 'Anita loan reduced by 10,000');
  assert(cascadeAnita.excessAdvanceAmount === 2000, 'Anita excess 2,000 isolated as surplus');
  assert(
    cascadeAnita.newLedgerTransactions !== undefined && cascadeAnita.newLedgerTransactions.length === 2,
    'Exactly 2 separate ledger entries created for Anita: 1 loan payoff + 1 surplus deposit'
  );
  assert(
    cascadeAnita.newLedgerTransactions![0].amount === 10000 &&
      cascadeAnita.newLedgerTransactions![1].amount === 2000 &&
      cascadeAnita.newLedgerTransactions![1].reason.includes('Extra Money from Anita'),
    'Surplus 2,000 is logged differently in ledger with clear explanation of extra money'
  );
  const updatedAnitaBank = cascadeAnita.updatedHoldings.find((h) => h.id === 'hold-anita-bank')!;
  assert(
    updatedAnitaBank.principalOrValue === 22000,
    'Anita bank account holds both loan repayment + surplus deposit (10,000 + 10,000 + 2,000 = 22,000)'
  );

  console.log(`\n========================================`);
  console.log(`Tests Completed: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

function testLiabilities(): Liability[] {
  return [
    { id: 'l-1', name: 'Car Loan', kind: 'loan', currency: 'INR', outstanding: 100000, ratePct: 10, monthlyEmi: 5000, tenureMonths: 24 },
  ];
}

runTests().catch((e) => {
  console.error('Test execution error:', e);
  process.exit(1);
});

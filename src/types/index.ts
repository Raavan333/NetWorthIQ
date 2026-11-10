export type LiquidityClass = 'Immediate' | 'Short' | 'Locked';
export type ReturnMode = 'fixed' | 'realised-only';
export type LiabilityKind = 'loan' | 'card';
export type ProvenanceSource = 'user_entered' | 'imported' | 'calculated' | 'estimated' | 'verified';

export interface DataProvenance {
  source: ProvenanceSource;
  timestamp: string;
  modifiedAt?: string;
  notes?: string;
  version?: number;
}

export type TransactionKind =
  | 'spend'
  | 'income'
  | 'transfer'
  | 'cardPayment'
  | 'emi'
  | 'interest'
  | 'dividend'
  | 'saleProceeds'
  | 'adjustment';

export type TaxClassification =
  | 'STCG_EQUITY'
  | 'LTCG_EQUITY'
  | 'FOREIGN_STCG'
  | 'FOREIGN_LTCG'
  | 'DEBT_SLAB'
  | 'OTHER';

export interface Currency {
  code: string;
  symbol: string;
  rateToBase: number; // e.g. 1 USD = 86.5 INR if INR is base. Base currency has rateToBase = 1.
  updatedAt: string; // ISO date string
}

export interface AssetType {
  id: string;
  name: string;
  category?: string; // Bucket: 'Cash & Liquid Assets' | 'Equities & Market' | 'Fixed Income & Lending' | string
  returnMode: ReturnMode;
  defaultLiquidity: LiquidityClass;
  isBuiltIn: boolean;
}

export type InterestPayoutFrequency = 'monthly' | 'quarterly' | 'yearly' | 'at_maturity';
export type RenewalOption = 'renew_principal_and_interest' | 'renew_principal_only' | 'do_not_renew';
export type MarketCapCategory = 'mega_cap' | 'large_cap' | 'mid_cap' | 'small_cap';
export type GoalPriority = 'high' | 'mid' | 'low';

export type RiskAssessment = 'ultra_safe' | 'low_risk' | 'moderate_risk' | 'high_risk' | 'speculative';

export interface Holding {
  id: string;
  name: string;
  typeId: string;
  customCategory?: string;
  currency: string;
  principalOrValue: number;
  expectedRatePct?: number; // informational for market assets (0 or greater supported)
  fixedRatePct?: number; // for fixed-return assets (0 or greater supported, e.g. 0% for 0% growth / friend loan)
  startDate?: string;
  createdAt?: string;
  maturityDate?: string;
  liquidityClass: LiquidityClass;
  units?: number;
  avgBuyPrice?: number;
  currentPrice?: number;
  notes?: string;
  isAssumed?: boolean;
  withdrawnFromSourceId?: string; // for hand cash: tracks where cash originated
  cashAdvanceFee?: number; // for hand cash withdrawn from card
  isSweepIn?: boolean; // for Fixed Deposits: sweep-in facility makes it immediately cashable on demand
  sweepInTargetAccountId?: string; // bank account holding ID where redeemed sweep-in cash reflects
  interestPayoutAccountId?: string; // bank account holding ID where periodic interest payouts are credited
  interestPayoutFrequency?: InterestPayoutFrequency; // 'monthly' | 'quarterly' | 'yearly' | 'at_maturity'
  renewalOption?: RenewalOption; // 'renew_principal_and_interest' | 'renew_principal_only' | 'do_not_renew'
  maturitySettlementAccountId?: string; // bank account holding ID where principal+interest goes upon maturity if not renewed
  lastInterestSettledDate?: string; // YYYY-MM-DD
  isMatured?: boolean;
  marketCapCategory?: MarketCapCategory; // 'mega_cap' | 'large_cap' | 'mid_cap' | 'small_cap'
  riskLevel?: RiskAssessment; // user assessed risk level: 'ultra_safe' | 'low_risk' | 'moderate_risk' | 'high_risk' | 'speculative'
  riskNotes?: string;
  realisedGainLoss?: number;
  unrealisedGainLoss?: number;
  isOverdraftActive?: boolean;
  overdraftAmount?: number;
  overdraftAt?: string; // timestamp when overdraft occurred
  isZeroInterestLoan?: boolean; // 0% p.a. friendly loan / borrowing
  accountLastDigits?: string; // Last digits for on-device SMS routing (supports multiple comma-separated numbers, e.g. '4913, 913')
  provenance?: DataProvenance;
}

export interface CreditCardStatement {
  id: string;
  periodStart: string;
  periodEnd: string;
  statementDate: string;
  dueDate: string;
  amount: number; // original billed amount
  cashbackApplied?: number; // cashback deduction applied to this bill
  netPayableAmount?: number; // reduced statement amount after cashback deduction
  paidAmount: number; // amount settled
  actualPaidInLedger?: number; // actual statement amount user recorded in ledger
}

export type PrepaymentPolicyMode = 'penalty_free' | 'flat_rate' | 'tenure_tiered';

export interface PrepaymentTenureTier {
  id: string;
  minRemainingMonths: number;
  maxRemainingMonths: number | null; // null = no upper limit ("and above")
  penaltyPct: number;
}

export interface LoanPrepaymentPolicy {
  mode: PrepaymentPolicyMode;
  lockInMonths: number;
  feeBasis: 'existing_principal' | 'prepaid_amount';
  flatPenaltyPct: number;
  tenureTiers?: PrepaymentTenureTier[];
  foreclosureOverridePct?: number;
  applicableTaxPct: number;
  isConfigured: boolean;
}

export interface BaseLiability {
  id: string;
  name: string;
  kind: LiabilityKind;
  currency: string;
  outstanding: number;
  ratePct: number; // annual interest rate % (0 for 0% peer loans or cards in grace period)
  startDate?: string;
  endDate?: string;
  isAssumed?: boolean;
  dueDay?: number; // billing or EMI due day of the month
  userDesiredPayoffDate?: string; // user target debt payoff date (independent of contractual due date)
  provenance?: DataProvenance;
  notes?: string;
  accountLastDigits?: string; // Last digits for on-device SMS routing (supports multiple comma-separated numbers, e.g. '3230, 6382' for physical Visa + virtual wrapper/UPI token)
}

/**
 * 1. High-interest revolving debt & credit facilities (Credit, Debit, Hybrid cards)
 * Handles billing cycles, grace/cool-off periods, penalty rates, cashback, and utilization thresholds.
 */
export interface CreditLiability extends BaseLiability {
  kind: 'card';
  cardType?: 'credit' | 'debit' | 'hybrid';
  linkedAccountId?: string; // Strictly linked to a bank account holding for debit cards and hybrid cards
  limit?: number;
  creditLimit?: number;
  statementDay?: number;
  nextStatementDate?: string; // YYYY-MM-DD next statement generation date
  coolOffDays?: number; // cool off period in days from statement date to last payment date (e.g. 20 days)
  interestFreeDays?: number; // legacy alias / grace days (default 20)
  penaltyRateMonthlyPct?: number; // default 3.5%
  alertLeadDays?: number; // default 5
  statements?: CreditCardStatement[];
  annualFee?: number; // Card annual fee (e.g. 0 for lifetime free, 500, 1000, 2500, etc.)
  annualFeeWaiverSpend?: number; // Annual spend threshold to waive annual fee
  accumulatedCashback?: number; // Accumulated cashback balance available to reduce next statement
  cashbackRatePct?: number; // Card default cashback reward percentage (e.g. 5% or 2%)
  creditCardUtilThresholdPct?: number; // Card-specific utilization threshold override (default e.g. 30%)
  emiConversionAvailable?: boolean;
  emiConversionRatePct?: number; // Annual interest % for EMI conversion
  emiConversionProcessingFee?: number; // Processing fee in currency units
  metroAtmUsageThisMonth?: number;
  nonMetroAtmUsageThisMonth?: number;
  debitUsageCount?: number; // Total POS / online / ATM debit usages
  lastAtmUsageMonth?: string; // YYYY-MM
  metroAtmFreeLimit?: number; // default 5
  nonMetroAtmFreeLimit?: number; // default 3
  atmExtraFeeAmount?: number; // extra fee per transaction beyond threshold (e.g. 21)
  // Optional shared fields for polymorphic access
  monthlyEmi?: number;
  emiDay?: number;
  tenureMonths?: number;
  lender?: string;
  loanCategory?: string;
  originalPrincipal?: number;
  prepaymentPolicy?: LoanPrepaymentPolicy;
  prepaymentPenaltyPct?: number;
  prepaymentFeeBasis?: 'existing_principal' | 'prepaid_amount';
  foreclosurePenaltyPct?: number;
  processingFeePct?: number;
  applicableGstPct?: number;
  interestCalculationMethod?: 'reducing_balance' | 'flat' | 'compound';
  minimumPrepaymentAmount?: number;
  prepaymentRestrictions?: string;
  prepaymentLockInMonths?: number;
  counterpartyName?: string;
  debtorName?: string;
  confidenceScore?: number;
  expectedSettlementDate?: string;
  isPeerBorrow?: boolean;
}

/**
 * 2. Formal institutional loans (Mortgages, Auto Loans, Personal Loans, Student Loans)
 * Handles fixed contractual EMIs, remaining tenure, lender names, and prepayment lock-in penalties.
 */
export interface FormalLoanLiability extends BaseLiability {
  kind: 'loan';
  lender?: string;
  loanCategory?: string; // 'Home Loan' | 'Personal Loan' | 'Auto Loan' | 'Education Loan' | string
  originalPrincipal?: number;
  monthlyEmi?: number;
  emiDay?: number;
  tenureMonths?: number; // remaining tenure in months
  linkedAccountId?: string; // default bank account for EMI debit
  prepaymentPolicy?: LoanPrepaymentPolicy; // User-defined one-time prepayment policy (zero assumptions)
  prepaymentPenaltyPct?: number; // % fee for partial prepayment
  prepaymentFeeBasis?: 'existing_principal' | 'prepaid_amount'; // whether penalty % is calculated on existing principal or prepaid slice
  foreclosurePenaltyPct?: number; // % fee for full foreclosure
  processingFeePct?: number; // % processing fee or charges
  applicableGstPct?: number; // GST/tax % on penalty fees (0% default unless specified)
  interestCalculationMethod?: 'reducing_balance' | 'flat' | 'compound';
  minimumPrepaymentAmount?: number;
  prepaymentRestrictions?: string;
  prepaymentLockInMonths?: number;
  // Optional shared fields for polymorphic access
  cardType?: 'credit' | 'debit' | 'hybrid';
  limit?: number;
  creditLimit?: number;
  statementDay?: number;
  nextStatementDate?: string;
  coolOffDays?: number;
  interestFreeDays?: number;
  penaltyRateMonthlyPct?: number;
  alertLeadDays?: number;
  statements?: CreditCardStatement[];
  annualFee?: number;
  annualFeeWaiverSpend?: number;
  accumulatedCashback?: number;
  cashbackRatePct?: number;
  creditCardUtilThresholdPct?: number;
  emiConversionAvailable?: boolean;
  emiConversionRatePct?: number;
  emiConversionProcessingFee?: number;
  metroAtmUsageThisMonth?: number;
  nonMetroAtmUsageThisMonth?: number;
  debitUsageCount?: number;
  lastAtmUsageMonth?: string;
  metroAtmFreeLimit?: number;
  nonMetroAtmFreeLimit?: number;
  atmExtraFeeAmount?: number;
  counterpartyName?: string;
  debtorName?: string;
  confidenceScore?: number;
  expectedSettlementDate?: string;
  isPeerBorrow?: boolean;
}

/**
 * 3. Informal peer-to-peer debts (Money borrowed from friends/family, e.g. "Owed to Radhika")
 * Typically 0% or low-rate friendly debt, tracked with counterparty details, promised return date, and confidence scores.
 */
export interface InformalDebtLiability extends BaseLiability {
  kind: 'loan';
  counterpartyName?: string;
  debtorName?: string;
  confidenceScore?: number; // 0 to 100% confidence of settlement
  expectedSettlementDate?: string;
  isPeerBorrow?: boolean; // true if borrowed from peer
  // Optional shared fields for polymorphic access
  cardType?: 'credit' | 'debit' | 'hybrid';
  linkedAccountId?: string;
  limit?: number;
  creditLimit?: number;
  statementDay?: number;
  nextStatementDate?: string;
  coolOffDays?: number;
  interestFreeDays?: number;
  penaltyRateMonthlyPct?: number;
  alertLeadDays?: number;
  statements?: CreditCardStatement[];
  annualFee?: number;
  annualFeeWaiverSpend?: number;
  accumulatedCashback?: number;
  cashbackRatePct?: number;
  creditCardUtilThresholdPct?: number;
  emiConversionAvailable?: boolean;
  emiConversionRatePct?: number;
  emiConversionProcessingFee?: number;
  metroAtmUsageThisMonth?: number;
  nonMetroAtmUsageThisMonth?: number;
  debitUsageCount?: number;
  lastAtmUsageMonth?: string;
  metroAtmFreeLimit?: number;
  nonMetroAtmFreeLimit?: number;
  atmExtraFeeAmount?: number;
  monthlyEmi?: number;
  emiDay?: number;
  tenureMonths?: number;
  lender?: string;
  loanCategory?: string;
  originalPrincipal?: number;
  prepaymentPolicy?: LoanPrepaymentPolicy;
  prepaymentPenaltyPct?: number;
  prepaymentFeeBasis?: 'existing_principal' | 'prepaid_amount';
  foreclosurePenaltyPct?: number;
  processingFeePct?: number;
  applicableGstPct?: number;
  interestCalculationMethod?: 'reducing_balance' | 'flat' | 'compound';
  minimumPrepaymentAmount?: number;
  prepaymentRestrictions?: string;
  prepaymentLockInMonths?: number;
}

/**
 * Polymorphic Liability Contract
 * Explicitly distinguishes Revolving Credit, Institutional Loans, and Informal Peer Debts
 */
export type Liability = CreditLiability | FormalLoanLiability | InformalDebtLiability;

export type ExternalInflowCategory =
  | 'Gift'
  | 'Family Support'
  | 'Reimbursement'
  | 'Bonus'
  | 'Side Income'
  | 'Loan Returned'
  | 'Other';

export interface ExternalInflowParams {
  sourceName: string;
  category: ExternalInflowCategory;
  amount: number;
  currency: string;
  destinationType: 'account' | 'direct_bill' | 'direct_liability';
  targetAccountId?: string;
  targetBillId?: string;
  targetLiabilityId?: string;
  earmarkedGoalId?: string;
  date?: string;
  notes?: string;
}

export interface IncomeStream {
  id: string;
  name: string;
  amountPerPeriod: number;
  period: 'monthly' | 'weekly' | 'biweekly' | 'quarterly' | 'yearly';
  payDay: number;
  payScheduleType?: 'fixed_day' | 'last_working_day' | 'last_calendar_day';
  depositAccountId?: string;
  currency: string;
  grossOrNet: 'gross' | 'net'; // default net
}

export interface ScheduledTransfer {
  id: string;
  name: string;
  fromId: string;
  toId: string;
  amount: number;
  currency: string;
  dayOfMonth: number; // 1-31
  frequency: 'monthly' | 'quarterly' | 'once';
  isActive: boolean;
  lastExecutedMonth?: string; // YYYY-MM
  lastExecutedDate?: string; // YYYY-MM-DD
  nextExecutionDate?: string; // YYYY-MM-DD
  createdAt?: string; // YYYY-MM-DD
  notes?: string;
}

export interface SpendCategoryConfig {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  isMlGenerated?: boolean;
  usageCount?: number;
}

export interface QuickSpendChip {
  id: string;
  label: string;
  reason: string;
  category: string;
  amount?: number;
  sourceId?: string;
  isMlGenerated?: boolean;
  usageCount?: number;
}

export interface CreditScoreRecord {
  id: string;
  date: string; // YYYY-MM-DD
  score: number; // 300 to 900
  bureau: string; // 'CIBIL' | 'Experian' | 'Equifax' | 'FICO' | 'Manual'
  notes?: string;
}

export interface CreditScorePrediction {
  predictedScore: number;
  confidenceScore: number; // 0 - 100%
  creditUtilizationPct: number;
  isHighUtilization: boolean; // >30% or threshold
  weights: {
    utilization: number;
    paymentHistory: number;
    debtRatio: number;
    bias: number;
  };
  lastModelUpdate?: string;
  isBaselineHeuristic?: boolean;
  sampleCount?: number;
  evidenceStatus?: 'sufficient' | 'sparse' | 'insufficient';
  missingEvidenceReason?: string;
}

export interface RLMovementRecommendation {
  id: string;
  fromSourceId: string;
  fromSourceName: string;
  fromYieldPct: number;
  toAssetId: string;
  toAssetName: string;
  toYieldPct: number;
  suggestedAmount: number;
  annualPotentialGain: number;
  status: 'pending' | 'followed' | 'dismissed' | 'expired';
  feedbackReason?: string;
  createdDate: string;
  confidencePct: number;
  riskWarning?: string;
}

export interface RLModelWeights {
  policyWeights: {
    highYieldSweep: number;
    debtPrepay: number;
    liquiditySafety: number;
  };
  explorationRate: number;
  learningRate: number;
  confidenceScore: number;
  totalDecisions: number;
  successfulTransfers: number;
}

export type EducationLevel =
  | 'tier1_tech'       // Tier-1 Engineering / Tech (IIT, NIT, BITS, Top Global)
  | 'tier1_mba'        // Tier-1 Business School (IIM, ISB, Ivy League)
  | 'masters'          // Master's Degree (M.Tech, MS, MCA, MBA)
  | 'bachelors_tech'   // Bachelor's Degree in Tech/Engg (B.Tech, BE, BCA)
  | 'bachelors_other'  // Bachelor's Degree in Science/Commerce/Arts
  | 'doctorate'        // Ph.D. / Research Doctorate
  | 'bootcamp_selftaught'; // Self-Taught / Bootcamp / Diploma

export interface PreviousSalaryRecord {
  year: number;
  role: string;
  salary: number; // annual in base currency
  companyType?: 'mnc' | 'startup' | 'midsize';
}

export interface CareerFeedbackRecord {
  id: string;
  timestamp: string;
  predictedSalary: number;
  userActualOrTargetSalary?: number;
  roleFeedback: 'aligned' | 'too_senior' | 'too_junior' | 'different_field' | 'management_focus' | 'technical_focus';
  salaryFeedback?: 'accurate' | 'too_high' | 'too_low';
  comments?: string;
  weightsAdjustmentDelta?: number;
}

export interface CareerTransitionRecord {
  id: string;
  recordedAt: string;
  year: number;
  transitionType: 'previous' | 'current_update' | 'next_offer';
  role: string;
  actualSalary: number;
  companyType: 'mnc' | 'startup' | 'midsize';
  experienceAtTransition: number;
  ageAtTransition?: number;
  modelPredictedSalary: number;
  modelPredictedRole: string;
  predictionErrorAmount: number;
  predictionErrorPct: number;
  weightShifts: {
    baseInterceptDelta: number;
    experienceCoeffDelta: number;
    companyBiasDelta: number;
  };
}

export interface CareerModelWeights {
  baseIntercept: number;
  experienceCoeff: number;
  educationCoeff: number;
  technicalSkillCoeff: number;
  behavioralStrengthCoeff: number;
  weaknessPenaltyCoeff: number;
  mncIncrementBias?: number;
  startupIncrementBias?: number;
  learningRate: number;
  tuneIterations: number;
  lastTunedAt?: string;
}

export interface CareerProfile {
  age?: number;
  currentRole: string;
  yearsOfExperience: number;
  education: EducationLevel;
  educationalMajor?: string;
  industry: string;
  targetCompanyType: 'all' | 'mnc' | 'startup';
  careerGoals?: string;
  salaryExpectation?: number;
  technicalSkills?: string[];
  behavioralStrengths?: string[];
  weaknessesOrGrowthAreas?: string[];
  previousSalaries: PreviousSalaryRecord[];
  careerTransitions?: CareerTransitionRecord[];
  feedbackLog?: CareerFeedbackRecord[];
  updatedAt?: string;
}

export interface CareerPredictionResult {
  currentAnnualSalary: number;
  predictedCurrentMarketMedian: number;
  predictedRange: [number, number]; // [min, max]
  marketPosition: 'underpaid' | 'fair' | 'top_percentile';
  personalizedAdvice?: string;
  skillGaps?: string[];
  tuningIteration?: number;
  activeWeights?: CareerModelWeights;
  
  // Predictive Path A: Top Tier MNC / Enterprise
  mncPrediction: {
    nextRole: string;
    expectedSalary: number;
    expectedIncrementPct: number;
    annualRsuBonus: number;
    stabilityScore: number; // 0-100
    skillsInDemand: string[];
    timelineMonths: number;
  };

  // Predictive Path B: High-Growth Venture / Startup
  startupPrediction: {
    nextRole: string;
    expectedSalary: number;
    expectedIncrementPct: number;
    equityUpsidePct: number;
    upsidePotentialScore: number; // 0-100
    skillsInDemand: string[];
    timelineMonths: number;
  };

  // Human Capital NPV (Lifetime Skill Asset Valuation)
  humanCapitalNpv5Yr: number;
  humanCapitalNpv10Yr: number;
  confidenceScore: number;
  historicalGrowthCagr: number;
  netRateContributionPct: number; // contribution to total net rate
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt?: string; // Precise ISO timestamp for sub-day duplicate detection windows
  kind: TransactionKind;
  amount: number;
  currency: string;
  fromId?: string;
  sourceId?: string; // payment source holding or liability ID
  toId?: string;
  reason: string;
  category: string;
  chipId?: string; // QuickSpendChip ID if captured via one-tap shortcut or matched chip
  chipLabel?: string;
  duplicateOverrideConfirmed?: boolean;
  tags?: string[];
  fxRateUsed: number; // stored at entry time and NEVER changed later
  toAmount?: number; // cross-currency transfer amount received
  notes?: string;
  paymentMode?: 'upi' | 'debit_card' | 'hybrid_card' | 'neft' | 'imps' | 'cheque';
  debitCardId?: string;
  atmZone?: 'metro' | 'non_metro';
  impsFee?: number;
  brokerName?: string;
  brokerageFee?: number;
  brokerFeeMode?: 'none' | 'percent' | 'per_unit' | 'flat';
  brokerFeePct?: number;
  brokerFeePerUnit?: number;
  brokerFeeUnitSize?: number;
  prepaymentPenaltyPaid?: number;
  isDebitCardPayment?: boolean;
  reconciled?: boolean;
  isReversed?: boolean;
  reversedAt?: string;
  reversalReason?: string;
  reversalOfTxId?: string;
  reversalRecordId?: string;
  linkedReceivableId?: string;
  smsMetadata?: {
    stagingId: string;
    patternSignature: string;
    merchantName: string;
    rawCounterparty?: string;
    accountLastDigits?: string;
    refId?: string;
    reportedBalance?: number;
    rawSms?: string;
    rawSmsFingerprint?: string;
    deviceMessageId?: string;
  };
  provenance?: DataProvenance;
}

export interface ReversalAuditRecord {
  id: string;
  originalTxId: string;
  reversalTxId: string;
  timestamp: string;
  amount: number;
  currency: string;
  transactionKind: TransactionKind;
  sourceId?: string;
  destinationId?: string;
  sourceName?: string;
  destinationName?: string;
  reason?: string;
  previousBalanceSource?: number;
  restoredBalanceSource?: number;
  previousBalanceDestination?: number;
  restoredBalanceDestination?: number;
  dependentTxCount?: number;
}

export interface AmortizationScheduleMonth {
  monthIndex: number;
  dateStr: string;
  openingPrincipal: number;
  emi: number;
  principalComponent: number;
  interestComponent: number;
  prepaymentAmount: number;
  closingPrincipal: number;
  cumulativeInterest: number;
}

export interface LoanPrepaymentSimulation {
  loanId: string;
  loanName: string;
  currentOutstanding: number;
  proposedPrepayment: number;
  prepaymentPenaltyPct: number;
  prepaymentFeeBasis?: 'existing_principal' | 'prepaid_amount';
  isLockedIn?: boolean;
  remainingLockInMonths?: number;
  unlockDateStr?: string;
  penaltyCharge: number;
  applicableTax: number; // optional GST on penalty
  totalPrepaymentOutflow: number; // prepayment + penalty + tax
  revisedPrincipal: number;
  originalRemainingMonths: number;
  revisedRemainingMonths: number;
  monthsSaved: number;
  originalTotalInterest: number;
  revisedTotalInterest: number;
  grossInterestSaved: number;
  netFinancialBenefit: number; // gross interest saved - total penalty charges & taxes
  isFinanciallyBeneficial: boolean;
  revisedMonthlyEmi?: number;
  amortizationPreview: AmortizationScheduleMonth[];
}

export interface CreditCardEmiComparison {
  cardId: string;
  cardName: string;
  eligibleOutstanding: number;
  // Option A: Full Payment
  fullPaymentAmount: number;
  fullPaymentTotalCost: number;
  // Option B: EMI Conversion
  emiConversionAvailable: boolean;
  tenureMonths: number;
  annualInterestRatePct: number;
  processingFee: number;
  processingFeeGst: number;
  monthlyEmi: number;
  totalEmiInterest: number;
  totalEmiRepayment: number;
  totalEmiCost: number; // principal + interest + processing fee + GST
  additionalCostOfEmi: number; // totalEmiCost - fullPaymentAmount
}

export interface DebtRestructureComparison {
  id: string;
  existingDebts: {
    liabilityId: string;
    name: string;
    outstanding: number;
    interestRatePct: number;
    monthlyEmi: number;
    remainingMonths: number;
    foreclosureChargePct: number;
  }[];
  totalExistingOutstanding: number;
  totalExistingMonthlyEmi: number;
  totalExistingRemainingInterest: number;
  // Proposed Restructuring / Refinancing / Consolidation
  proposedOfferName: string;
  proposedInterestRatePct: number;
  proposedTenureMonths: number;
  transferOrProcessingFeePct: number;
  foreclosureChargesTotal: number;
  transferFeeAmount: number;
  taxesOnFees: number;
  proposedNewPrincipal: number; // existing outstanding + fees capitalized (or fees upfront)
  proposedMonthlyEmi: number;
  proposedTotalInterest: number;
  proposedTotalRepayment: number;
  netFinancialSavings: number; // total existing remaining - total proposed cost
  isRecommended: boolean;
  explanation: string;
}

export interface FinancialAnomaly {
  id: string;
  anomalyType:
    | 'duplicate_transaction'
    | 'unusual_large_expense'
    | 'unexpected_balance_shift'
    | 'recurring_spike'
    | 'unusual_card_spend'
    | 'unexpected_loan_fee';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  detectedAt: string;
  transactionId?: string;
  accountId?: string;
  amount?: number;
  historicalBaseline?: string;
  suggestedAction: string;
  confidenceScore: number;
  status: 'active' | 'dismissed' | 'reviewed';
}

export interface WhatIfScenario {
  id: string;
  name: string;
  description: string;
  changes: {
    monthlyExtraLoanPayment?: number;
    targetLoanId?: string;
    monthlySpendCutPct?: number;
    additionalMonthlySavings?: number;
    creditCardLumpSumPayment?: number;
    targetCardId?: string;
    emergencyReserveAdjustment?: number;
  };
  results: {
    baselineDebtFreeMonths: number;
    projectedDebtFreeMonths: number;
    debtMonthsSaved: number;
    baselineTotalInterest: number;
    projectedTotalInterest: number;
    interestSaved: number;
    baselineNetWorth1Yr: number;
    projectedNetWorth1Yr: number;
    monthlyCashFlowImpact: number;
    emergencyReserveProtected: boolean;
  };
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: 'monthly' | 'weekly' | 'biweekly' | 'yearly' | 'quarterly';
  dueDay: number;
  sourceId: string;
  category: string;
  autoPostPrompt?: boolean;
  lastPostedDate?: string;
  // Auto-liability & goal contribution extensions
  isAutoLiabilityBill?: boolean;
  liabilityId?: string;
  liabilityKind?: 'loan' | 'card';
  isGoalContributionBill?: boolean;
  isCompletedGoalBill?: boolean;
  goalId?: string;
  goalSourceId?: string;
  // External "Already Paid" override tracking
  lastOverriddenMonth?: string; // e.g. '2026-10'
  isOverriddenPaid?: boolean;
  overrideCount?: number;
  repaymentPriority?: number; // 1 = Loan EMI, 2 = Credit Cards, 3 = Utilities & Bills, 4 = Goal Streams
  // Credit card statement cycle awareness
  dueDateStr?: string; // YYYY-MM-DD
  statementDateStr?: string; // YYYY-MM-DD
  isStatementGenerated?: boolean;
  coolOffDays?: number;
  paymentMode?: 'upi' | 'debit_card' | 'hybrid_card' | 'neft' | 'imps' | 'cheque';
  atmZone?: 'metro' | 'non_metro';
  impsFee?: number;
  isDebitCardPayment?: boolean;
  isCreditCardSource?: boolean;
  cashbackApplied?: number;
  originalStatementAmount?: number;
  isPeerBorrowBill?: boolean;
  peerName?: string;
  isArchived?: boolean;
  archivedAt?: string;
  provenance?: DataProvenance;
}

export type RecurringBill = Bill;

export type GoalPaymentMode = 'upi' | 'debit_card' | 'hybrid_card' | 'neft' | 'imps' | 'cheque';
export type DebitAtmZone = 'metro' | 'non_metro';

export interface GoalSource {
  sourceId: string;
  sourceType?: 'asset' | 'credit_card';
  sourceName?: string;
  allocationMode?: 'percentage' | 'fixed_amount' | 'units';
  allocationPct: number; // e.g. 50 for 50%
  allocationAmount?: number; // e.g. 1000 for 1,000 currency units (per value)
  allocationUnits?: number; // stock/share quantity (stock no)
  unitPriceAtAllocation?: number; // price per unit at allocation
  monthlyIncrement?: number; // amount allocated in increments of X per month (e.g. 50/mo)
  accumulatedAmount?: number; // total accumulated from this source so far
  paymentMode?: GoalPaymentMode; // 'upi' (default) | 'debit_card' | 'neft' | 'imps'
  atmZone?: DebitAtmZone; // 'non_metro' (default) | 'metro'
}

export interface GoalTransactionRecord {
  id: string;
  date: string;
  amount: number;
  sourceAssetId: string;
  sourceAssetName: string;
  ledgerTxId?: string;
  billId?: string;
  notes?: string;
}

export interface Goal {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  cost: number;
  currency: string;
  deadline?: string;
  sources: GoalSource[];
  goalType?: 'asset_accumulation' | 'debt_payoff';
  targetLiabilityId?: string; // target loan or credit card to kill
  startingDebtAmount?: number; // baseline debt balance when goal was set
  priority?: GoalPriority; // 'high' | 'mid' | 'low'
  // Incremental contribution & loan payoff features
  extraMonthlyPayment?: number; // for loan killing: extra amount beyond EMI to accelerate payoff
  monthlyContribution?: number; // incremental contribution amount
  contributionFrequency?: 'monthly' | 'biweekly' | 'weekly' | 'quarterly'; // contribution cadence
  contributionSourceId?: string; // bank account holding ID to debit
  syncToBills?: boolean; // sync incremental contribution to recurring bills ledger
  accumulateMonthly?: boolean; // true = recurring monthly accumulation bill; false = track readiness against net liquid surplus without monthly bill
  linkedBillId?: string;
  accumulatedTotal?: number; // total accumulated so far towards cost (e.g. 6000 -> 12000)
  transactions?: GoalTransactionRecord[]; // keep track of n transactions from these assets on these dates
  isCompleted?: boolean;
  paymentVerified?: boolean;
  paymentTxId?: string;
  completedAt?: string;
  completionNotified?: boolean; // informed only once on 100% completion
  paidInOneGo?: boolean;
  excludeFromNetWorth?: boolean; // exclude accumulated goal savings from net worth / virtually deduct from asset
  nextInstallmentDueMonth?: string; // e.g. '2026-11' for next partial increment due
  partialPaymentsHistory?: {
    id: string;
    date: string;
    amount: number;
    percentage: number;
    txId: string;
    sourceName?: string;
    paymentMode?: GoalPaymentMode;
    nextDueMonth?: string;
  }[];
  provenance?: DataProvenance;
}

// Phase 5: Dedicated Receivables (Personal Loans Lent to Others)
export interface ReceivableRepayment {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  depositAccountId?: string; // holding ID where received or cleared
  txId?: string; // Direct foreign-key reference to main ledger Transaction.id
  isExpenseOffset?: boolean; // True when debtor settled an expense/bill directly on user's behalf
  excessCreditAdvanceId?: string; // Receivable ID created when payment exceeded outstanding balance
  notes?: string;
}

export interface Receivable {
  id: string;
  debtorName: string; // person or entity who borrowed money
  currency: string;
  principalAmount: number; // total receivable owed by borrower (includes passed-through fee when applicable)
  disbursedAmount?: number; // net principal handed to borrower (before brokerage/transfer fee)
  transferFeeAmount?: number; // brokerage / card-to-bank / transfer fee incurred on disbursement
  brokerName?: string; // broker / platform used to withdraw or disburse funds
  feeMode?: 'none' | 'percent' | 'per_unit' | 'flat';
  feePct?: number;
  feePerUnitAmount?: number; // X fixed amount
  feeUnitSize?: number; // for every N amount
  passFeeToBorrower?: boolean; // default true: borrower repays disbursedAmount + transferFeeAmount
  outstandingAmount: number; // remaining unpaid balance
  interestRatePct?: number; // annual interest rate % (0 for friendly/zero interest loan)
  issueDate: string; // YYYY-MM-DD
  expectedDate?: string; // promised collection date
  actualDate?: string; // settlement date if fully paid
  confidencePct: number; // 0 to 100% confidence of collection
  fundingSourceId?: string; // holding ID or card liability ID
  fundingSourceType?: 'holding' | 'credit_card';
  status: 'active' | 'partially_collected' | 'collected' | 'overdue' | 'written_off';
  isOpeningBalance?: boolean; // Legacy opening balance (no disbursement spend transaction generated)
  origin?: 'legacy_opening' | 'app_disbursed';
  direction?: 'lent' | 'borrowed'; // 'lent' (they owe user), 'borrowed' (user owes them)
  counterpartyName?: string;
  linkedBillId?: string;
  linkedGoalId?: string;
  isCreditAdvance?: boolean; // Flagged when created from over-repayment excess above principal
  sourceOverpaymentTxId?: string;
  isArchived?: boolean;
  archivedAt?: string;
  notes?: string;
  repayments: ReceivableRepayment[];
  provenance?: DataProvenance;
}

export type CounterpartyDirection = 'lent' | 'borrowed';

export interface CounterpartyRateBucket {
  direction: CounterpartyDirection;
  interestRatePct: number;
  principalTotal: number;
  accruedInterest: number;
  totalWithInterest: number;
  count: number;
  recordIds: string[];
}

export interface GroupedCounterparty {
  name: string;
  totalPrincipalOwedToUser: number; // they owe user (lent)
  totalPrincipalUserOwes: number; // user owes them (borrowed)
  totalAccruedInterest: number; // net accrued interest (lent interest - borrowed interest)
  totalAccruedLentInterest?: number;
  totalAccruedBorrowedInterest?: number;
  netBalance: number; // > 0: they owe user, < 0: user owes them, == 0: settled
  activeCount: number;
  settledCount: number;
  records: Receivable[];
  rateBuckets: CounterpartyRateBucket[];
  effectiveInterestRatePct: number;
  status: 'active' | 'settled' | 'written_off';
}

// Phase 4: Debt Intelligence Engine
export type DebtRepaymentStrategy = 'mandatory_first' | 'avalanche' | 'snowball';

export interface DebtPlanItem {
  liabilityId: string;
  name: string;
  kind: LiabilityKind;
  outstanding: number;
  interestRatePct: number;
  contractualDueDay?: number;
  contractualDueDate?: string;
  userDesiredPayoffDate?: string;
  minMonthlyPayment: number;
  recommendedPayment: number;
  priorityRank: number;
  estimatedMonthsToPayoff: number;
  estimatedTotalInterest: number;
  lockInMonthsRemaining?: number;
  prepaymentPenaltyPct?: number;
  prepaymentFeeBasis?: 'existing_principal' | 'prepaid_amount';
  estimatedPrepaymentPenalties?: number;
  status: 'current' | 'due_soon' | 'overdue' | 'paid_off';
}

export interface DebtStrategyComparison {
  strategy: DebtRepaymentStrategy;
  strategyName: string;
  totalMonthlyAllocation: number;
  totalInterestProjected: number;
  totalPrepaymentPenaltiesProjected?: number;
  totalOutOfPocketCost?: number;
  debtFreeMonths: number;
  interestSavedComparedToMin: number;
  netSavingsComparedToMin?: number;
  isRecommendedBest?: boolean;
  items: DebtPlanItem[];
  rationale: string;
}

// Phase 3: Cash Flow Forecast Engine
export interface CashFlowEvent {
  id: string;
  date: string; // YYYY-MM-DD
  type: 'inflow' | 'outflow';
  category: 'salary' | 'investment_income' | 'receivable' | 'bill' | 'emi' | 'card_payment' | 'goal_contribution' | 'expense_stress';
  name: string;
  amount: number;
  currency: string;
  isConfirmed: boolean; // true = confirmed regular event, false = estimated/scenario
  sourceOrTargetName?: string;
  notes?: string;
}

export interface DailyCashProjection {
  date: string;
  dayOfWeek: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  events: CashFlowEvent[];
  isBelowBuffer: boolean;
  isNegative: boolean;
}

export interface CashFlowForecastResult {
  windowDays: number;
  startDate: string;
  endDate: string;
  initialLiquidCash: number;
  totalProjectedInflows: number;
  totalProjectedOutflows: number;
  finalProjectedBalance: number;
  minProjectedBalance: number;
  minBalanceDate: string;
  negativeCashDates: string[];
  daysBelowSafetyBuffer: number;
  dailyTimeline: DailyCashProjection[];
  scenarioApplied?: 'normal' | 'delayed_salary' | 'delayed_receivables' | 'unexpected_expense' | 'income_shock';
  scenarioDescription?: string;
  missingInputsWarnings: string[];
}

export interface SaleRecord {
  id: string;
  assetId?: string;
  assetName: string;
  buyDate: string;
  sellDate: string;
  unitsSold: number;
  buyPrice: number;
  sellPrice: number;
  brokerageBuy: number;
  brokerageSell: number;
  currency: string;
  fxRate: number;
  classification: TaxClassification;
  gain: number;
  depositAccountId?: string;
}

export interface Snapshot {
  id: string;
  date: string; // YYYY-MM-DD
  assets: number;
  liabilities: number;
  netWorth: number;
  finalRatePct: number;
  finalRateAmount: number;
}

export interface TaxRules {
  equityLtcgThresholdMonths: number;
  equityStcgRatePct: number;
  equityLtcgRatePct: number;
  equityLtcgExemptionLimit: number;
  foreignLtcgThresholdMonths: number;
  foreignLtcgRatePct: number;
  userSlabRatePct: number;
  isSlabAssumed: boolean;
  cessPct: number;
  cessEnabled: boolean;
  lossSetoffEnabled: boolean;
}

export interface AppSettings {
  appName: string;
  profileName: string;
  age?: number;
  avatarColor: string;
  baseCurrency: string;
  staleRateDays: number;
  minCashThresholdMode: 'auto' | 'custom';
  minCashMonths: number;
  minCashCustom: number;
  cashFlowBufferAmount?: number; // User-configured safe buffer amount (default e.g. 50,000 INR)
  defaultCardInterestFreeDays: number;
  defaultCardPenaltyRateMonthly: number;
  defaultAlertLeadDays: number;
  cardCompoundingPenalty: boolean;
  finalRateDenominator: 'netWorth' | 'totalAssets';
  showAfterExpensesRate: boolean;
  includeTaxInLiabilities: boolean;
  creditUtilizationThresholdPct: number; // default 30%
  numberGrouping: 'inr' | 'international' | 'auto';
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  fyStartMonth: number;
  reduceMotion: boolean;
  pinLockEnabled: boolean;
  pinHash: string;
  pinSalt: string;
  autoLockMinutes: number;
  biometricsEnabled: boolean;
  lockOnScreenOff?: boolean;
  goalForecastWindow: 'monthly_avg' | '3m' | '6m' | '12m' | 'custom';
  // Debit card ATM configurable limits
  debitCardMetroAtmLimit: number; // default 5
  debitCardNonMetroAtmLimit: number; // default 3
  debitCardExtraFeePerWithdrawal: number; // default 21
  // Strategy Enforcement & Duplicate Time-Range Governance
  enforcePrepaymentStrategy?: boolean; // Strictly block negative-net or higher-fee prepayments
  enforceDuplicateGuard?: boolean; // Strictly gate predicted duplicates within configured window
  duplicateDetectionWindowMinutes?: number; // Minimum time window (minutes) for 4-factor duplicate prediction
  enableSubtleGuidanceFraming?: boolean; // Executive choice-architecture guidance & pre-anchoring
  // Subconscious Nudge Preferences
  subconsciousNudgePrefs?: SubconsciousNudgePreferences;
}

export type SubconsciousNudgeFrequency = 'paused' | 'minimal' | 'balanced' | 'frequent';

export type GuidanceAggressiveness = 'subtle' | 'gentle' | 'balanced' | 'assertive' | 'direct';

export interface SubconsciousNudgePreferences {
  enabled: boolean;
  frequency: SubconsciousNudgeFrequency;
  guidanceAggressiveness?: GuidanceAggressiveness;
  aggressiveSavings: boolean;
  gentleSpendingReminders: boolean;
  goalMilestoneAlerts: boolean;
  capitalRetentionGuards: boolean;
  autoCycleWhispers: boolean;
  lastDismissedAt?: string;
}

// ML Model Feedback & Self-Tuning Weights for Wealth Maximization & Stock Allocation
export interface MLInvestmentModelWeights {
  debtPayoffWeight: number; // preference for killing loans vs investing
  megaCapWeight: number;    // % target allocation for mega cap
  largeCapWeight: number;   // % target allocation for large cap
  midCapWeight: number;     // % target allocation for mid cap
  smallCapWeight: number;   // % target allocation for small cap
  highYieldFdWeight: number;// preference for safe sweep-in / FDs
  riskToleranceBias: number;// -1 (defensive) to +1 (aggressive)
  learningRate: number;
  iteration: number;
  lastTunedDate?: string;
  virtualOverrideCount?: number;
  virtualOverridePenaltyBuffer?: number;
}

export interface MLInvestmentSuggestion {
  id: string;
  timestamp: string;
  excessCashAmount: number;
  billsDueAmount: number;
  safeBufferAmount: number;
  deployableAmount: number;
  recommendedCategory: 'debt_payoff' | 'mega_cap' | 'large_cap' | 'mid_cap' | 'small_cap' | 'high_yield_fd';
  recommendedAction: string;
  reasoning: string;
  expectedAnnualGain: number;
  suggestedAllocationPct: number;
  targetGoalId?: string;
  status: 'pending' | 'accepted' | 'ignored';
  userActionTaken?: string;
}

export interface MLModelFeedbackRecord {
  id: string;
  timestamp: string;
  suggestionId?: string;
  feedbackType: 'too_aggressive' | 'too_conservative' | 'prefer_debt_reduction' | 'prefer_growth' | 'realised_gain_report' | 'unrealised_loss_report' | 'asset_created_aligned' | 'asset_created_different';
  realisedOrUnrealisedAmount?: number;
  marketCapReported?: MarketCapCategory;
  note?: string;
  weightDeltaApplied?: Partial<MLInvestmentModelWeights>;
}

export interface AppTheme {
  id: string;
  name: string;
  isDark: boolean;
  colors: {
    bg: string;
    surface: string;
    card: string;
    text: string;
    textMuted: string;
    primary: string;
    accent: string;
    positive: string;
    negative: string;
    alert: string;
    border: string;
  };
  componentOverrides?: {
    cardBg?: string;
    buttonBg?: string;
    navBg?: string;
  };
  fontStack: 'sans' | 'serif' | 'mono' | 'rounded' | string;
  fontSizeScale: number; // 0.85 to 1.25
  bgStyle?: 'solid' | 'radial' | 'mesh' | 'grid';
}

export type InsightType = 'positive' | 'warning' | 'neutral';

export interface InsightCardData {
  id: string;
  type: InsightType;
  category: 'comparison' | 'trend' | 'anomaly' | 'pattern' | 'loss' | 'goal' | 'tax' | 'sample';
  headline: string;
  evidence: string;
  suggestedAction?: string;
  actionPayload?: {
    type: 'payCard' | 'reviewSpend' | 'adjustGoal' | 'taxLoss' | 'navigate';
    targetId?: string;
    tab?: string;
  };
  confidence: number; // 0 to 1
  dismissed?: boolean;
  snoozedUntil?: string;
  timestamp: string;
}

export interface AttentionItem {
  id: string;
  level: 'critical' | 'warning' | 'info' | 'positive';
  title: string;
  description: string;
  sourceType: 'currency' | 'card' | 'assumed' | 'cash' | 'bill';
  sourceId?: string;
  linkTab?: string;
  actionLabel?: string;
  requiresAction?: boolean;
}

export type NotificationType =
  | 'obligation_conflict'
  | 'negative_balance'
  | 'bill_due'
  | 'goal_ready'
  | 'coaching_alert'
  | 'positive_milestone'
  | 'overdue_receivable'
  | 'balance_mismatch';

export interface ObligationConflictDetails {
  obligationName: string;
  obligationAmount: number;
  obligationDate: string;
  obligationType: 'emi' | 'bill' | 'card_due';
  conflictingPlanName?: string;
  conflictingAmount?: number;
  shortfallAmount: number;
  projectedBalanceOnDueDate: number;
  recommendedMitigation: string;
}

export interface FinancialNotification {
  id: string;
  type: NotificationType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  conflictDetails?: ObligationConflictDetails;
  actionLabel?: string;
  actionModal?: string;
  actionTab?: 'home' | 'assets' | 'liabilities' | 'spend' | 'insights';
  timestamp: string;
  requiresAction?: boolean;
  isDismissed?: boolean;
  isRead?: boolean;
}

export interface PredictedBillItem {
  id: string;
  label: string;
  category: string;
  estimatedAmountBase: number;
  confidencePct: number;
  occurrences: number;
  typicalDayOfMonth?: number;
  rationale: string;
}

export interface PredictedBillsSummary {
  items: PredictedBillItem[];
  totalPredictedAmountBase: number;
  monthlyEssentialBaselineBase: number;
  confidencePct: number;
}

export interface GoalContributorSuggestion {
  assetId: string;
  assetName: string;
  currency: string;
  availableBalanceLocal: number;
  suggestedAmountLocal: number;
  suggestedAmountBase: number;
  pctOfAsset: number;
  pctOfGoalRemaining: number;
}

export interface GoalMLAssessment {
  goalId: string;
  goalName: string;
  targetAmountLocal: number;
  accumulatedAmountLocal: number;
  remainingAmountLocal: number;
  remainingAmountBase: number;
  fundedPct: number;
  achievableFromSurplusPct: number;
  combinedReadinessPct: number;
  allocatableSurplusLocal: number;
  allocatableSurplusBase: number;
  shortfallAfterSurplusLocal: number;
  estimatedMonthsToComplete: number | null;
  contributors: GoalContributorSuggestion[];
  contributorSummaryText: string;
  mlMotivationHeadline: string;
  mlMotivationBody: string;
}

export interface GoalLiquidSurplusPlan {
  grossPositiveLiquidBase: number;
  safetyBufferBase: number;
  unpaidRecurringBillsBase: number;
  predictedPossibleBillsBase: number;
  netLiquidSurplusBase: number;
  estimatedMonthlyNetSavingsBase: number;
  assessmentsByGoalId: Record<string, GoalMLAssessment>;
}

export interface OnlineSpendIncomeModelState {
  monthlySpendBaselineEma: number;
  essentialSpendEma: number;
  discretionarySpendEma: number;
  spendForecastBias: number; // learned multiplier bias (default 1.0) adjusted when actual monthly spend != predicted
  categoryEmaMonthly: Record<string, number>;
  completedMonthActuals: Record<string, number>;
  completedMonthPredictions: Record<string, number>;
  annualSalaryEma: number;
  salaryGrowthRateEma: number;
  lastTrainedDataSignature: string;
  totalOnlineUpdates: number;
  lastUpdatedAt: string;
  halfPredictions: {
    observedMonthKey: string;
    monthElapsedFraction: number;
    partialMonthObservedSpendBase: number;
    projectedFullMonthSpendBase: number;
    projectedRemainingMonthSpendBase: number;
    nextMonthSpendEstimateBase: number;
    nextMonthNetSavingsEstimateBase: number;
    predictedCategoryBreakdown: Record<string, number>;
  };
}

export type EngagementStrategyStyle =
  | 'direct_cost_impact'
  | 'comparative_peer_table'
  | 'goal_velocity_framing'
  | 'concise_executive_brief';

export type RealityCheckDomain =
  | 'broker_fees'
  | 'spending'
  | 'earnings'
  | 'asset_allocation'
  | 'debt_strategy';

export interface BrokerCardFeeProfile {
  sourceId: string;
  sourceName: string;
  sourceKind: 'card' | 'bank';
  brokerName: string;
  sampleCount: number;
  effectiveFeePct: number;
  feeMode: 'none' | 'percent' | 'per_unit' | 'flat';
  feePct?: number;
  feePerUnitAmount?: number;
  feeUnitSize?: number;
  lastUsedDate: string;
  totalPrincipalRouted: number;
  totalFeesPaid: number;
}

export interface BrokerUsageForecast {
  hasPattern: boolean;
  sampleCount: number;
  avgIntervalDays: number;
  daysSinceLastUse: number;
  daysUntilExpectedUse: number;
  expectedNextDateStr: string;
  isUpcomingWindow: boolean; // notify-only window (e.g. within 5 days or overdue)
  typicalAmount: number;
  predictedBrokerName: string;
  habitualSourceId?: string;
  habitualSourceName?: string;
  habitualProjectedFee: number;
  recommendedCardId?: string;
  recommendedCardName?: string;
  recommendedBrokerName?: string;
  recommendedProjectedFee: number;
  potentialFeeSaved: number;
}

export interface PredictedLoanPaymentPlan {
  loanId: string;
  loanName: string;
  currency: string;
  recommendedMode: 'emi' | 'custom' | 'full';
  recommendedAmount: number; // Principal payment in loan currency
  scheduledEmiAmount: number;
  extraPrincipalSlice: number;
  recommendedMaintainTenure: boolean; // false = Cut Tenure (maximizes interest saved)
  recommendedAssetId?: string;
  recommendedAssetName?: string;
  projectedPenaltyCharge: number;
  projectedPenaltyPct: number;
  projectedGrossInterestSaved: number;
  projectedNetBenefit: number;
  projectedMonthsSaved: number;
  isLockedIn: boolean;
  remainingLockInMonths: number;
  isHigherFeeThanAlternative: boolean;
  betterAlternativeDebtId?: string;
  betterAlternativeDebtName?: string;
  betterAlternativePenaltyPct?: number;
  strategyRationale: string;
  whisperHeadline: string;
  whisperBody: string;
  ctaAnchorLabel: string;
  deviationWhisper: string;
  escalationLevel: number;
  activeStrategy: EngagementStrategyStyle;
}

export interface RealityCheckOutcomeRecord {
  id: string;
  timestamp: string;
  domain: RealityCheckDomain;
  subEventLabel?: string;
  ledgerRefId: string;
  predictedSummary: string;
  actualRealitySummary: string;
  outcome: 'success' | 'fail';
  partialSuccess?: boolean;
  microSavedBase?: number;
  avoidableCostOrDeltaBase: number;
  strategyUsed: EngagementStrategyStyle;
  nextStrategySelected: EngagementStrategyStyle;
  escalationLevelAfter?: number;
  failureAcknowledgment?: string;
}

export interface ClosedLoopMLState {
  activeStrategy: EngagementStrategyStyle;
  escalationLevel?: number; // 1 (subtle baseline) -> 4 (high-contrast executive intervention)
  microWinsCount?: number; // Counts even small partial wins (saving a few rupees, trimming debt, funding goals/assets)
  cumulativeSavedBase?: number; // Cumulative base-currency value protected/saved via aligned or partial actions
  lastWhisperSummary?: string;
  strategyScores: Record<
    EngagementStrategyStyle,
    { attempts: number; successes: number; failures: number; score: number }
  >;
  domainStats: Record<
    RealityCheckDomain,
    { successes: number; failures: number; accuracyBias: number; lastEvaluatedRef?: string }
  >;
  processedLedgerIds: string[];
  recentOutcomes: RealityCheckOutcomeRecord[];
  brokerProfiles: BrokerCardFeeProfile[];
  totalRealityAudits: number;
  lastUpdatedAt: string;
}

export interface FullMLReplicationState {
  creditModelWeights?: Record<string, any>;
  rlModelWeights?: RLModelWeights;
  careerProfile?: CareerProfile;
  careerModelWeights?: CareerModelWeights;
  investmentModelWeights?: MLInvestmentModelWeights;
  mlFeedbackLog?: MLModelFeedbackRecord[];
  onlineSpendIncomeState?: OnlineSpendIncomeModelState;
  closedLoopMLState?: ClosedLoopMLState;
  halfPredictionsSnapshot?: {
    capturedAt: string;
    creditPrediction?: CreditScorePrediction;
    careerPrediction?: CareerPredictionResult;
    predictedBills?: PredictedBillsSummary;
    rlRecommendations?: RLMovementRecommendation[];
    goalLiquidPlan?: GoalLiquidSurplusPlan;
    brokerUsageForecast?: BrokerUsageForecast;
  };
  overriddenAutoBills?: Record<string, string>;
  billOverrideHistory?: any[];
  continuousEngineAnchor?: any;
  dismissedInsights?: Record<string, boolean>;
  snoozedInsights?: Record<string, string>;
  smsRuleOverrides?: SmsRuleOverride[];
  smsStagingQueue?: StagedSmsItem[];
}

export type SmsFlagReason = 'invalid' | 'never_occurred' | 'wrong_source';

export type SmsParsedTxKind = 'spend' | 'income' | 'cardPayment' | 'emi';

export interface SmsSuggestedReason {
  reason: string;
  category: string;
  confidence: number;
  basis: string;
}

export interface SmsBalanceDiscrepancy {
  id: string;
  holdingId: string;
  holdingName: string;
  accountLastDigits?: string;
  smsAmount: number;
  direction: 'debit' | 'credit';
  previousAppBalance: number;
  expectedAppBalance: number;
  smsReportedBalance: number;
  delta: number; // smsReportedBalance - expectedAppBalance
  currency: string;
  parsedDate: string;
  rawSms: string;
  resolved?: boolean;
}

export interface SmsRuleOverride {
  id: string;
  ruleType: 'merchant_category' | 'account_mapping' | 'pattern_blacklist' | 'repayment_routing';
  patternSignature?: string;
  merchantAlias?: string; // normalized lowercase merchant key (e.g. 'hungerbox')
  rawCounterpartyKey?: string; // normalized VPA / counterparty handle (e.g. 'paytm-8774066@ptybl')
  merchantDisplayName?: string; // human display label (e.g. 'Hungerbox')
  mappedReason?: string; // learned human reason (e.g. 'Evening Tea & Snacks')
  accountLastDigits?: string; // e.g. '3986', '913', '6382'
  bankHint?: string;
  mappedSourceId?: string; // hold-* or liab-*
  mappedTargetLiabilityId?: string; // liab-* for card bill or loan-against-card repayment
  mappedTxKind?: SmsParsedTxKind;
  excludedSourceIds?: string[]; // sources explicitly invalidated via 'wrong_source'
  mappedCategory?: string; // e.g. 'Office Lunch'
  isBlacklisted: boolean;
  flagReason?: SmsFlagReason;
  confidence: number; // 0.0 to 1.0 (0 when invalidated/blacklisted, 1.0 when user-confirmed)
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

export type SmsPaymentMode =
  | 'upi'
  | 'imps'
  | 'neft'
  | 'debit_card'
  | 'credit_card'
  | 'netbanking'
  | 'atm'
  | 'other';

export interface StagedSmsItem {
  id: string;
  deviceMessageId?: string;
  rawSms: string;
  rawSmsFingerprint?: string;
  sender?: string;
  receivedAt: string; // ISO timestamp when ingested
  parsedDate: string; // YYYY-MM-DD
  parsedTimestampIso: string; // Full ISO timestamp for 5-minute deduplication window
  amount: number;
  currency: string;
  direction: 'debit' | 'credit';
  txKind?: SmsParsedTxKind;
  merchantName: string;
  rawCounterparty?: string;
  accountLastDigits?: string;
  bankHint?: string;
  paymentMode: SmsPaymentMode;
  refId?: string;
  patternSignature: string;
  matchedSourceId?: string;
  matchedTargetLiabilityId?: string;
  matchedCategory: string;
  reportedBalance?: number;
  reportedAvailableLimit?: number;
  requiresReview?: boolean;
  reviewHint?: string;
  suggestedReasons?: SmsSuggestedReason[];
  balanceDiscrepancy?: SmsBalanceDiscrepancy;
  confidence: number;
  status: 'staged' | 'committed' | 'discarded_duplicate' | 'blacklisted' | 'rolled_back' | 'rejected';
  committedTxId?: string;
  duplicateOfTxId?: string;
  dropReason?: string;
  rejectionReason?: string;
}




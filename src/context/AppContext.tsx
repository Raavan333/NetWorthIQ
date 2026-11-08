import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppSettings,
  AppTheme,
  AssetType,
  AttentionItem,
  Bill,
  CreditScorePrediction,
  CreditScoreRecord,
  Currency,
  Goal,
  GoalPaymentMode,
  GoalTransactionRecord,
  Holding,
  IncomeStream,
  ExternalInflowParams,
  InsightCardData,
  Liability,
  QuickSpendChip,
  RLMovementRecommendation,
  SaleRecord,
  ScheduledTransfer,
  Snapshot,
  SpendCategoryConfig,
  TaxRules,
  Transaction,
  CareerProfile,
  CareerPredictionResult,
  CareerModelWeights,
  CareerTransitionRecord,
  GoalLiquidSurplusPlan,
  PredictedBillsSummary,
  OnlineSpendIncomeModelState,
  FullMLReplicationState,
  Receivable,
  ReceivableRepayment,
  CashFlowForecastResult,
  DebtRepaymentStrategy,
  DebtStrategyComparison,
  ReversalAuditRecord,
  FinancialAnomaly,
  ClosedLoopMLState,
  BrokerUsageForecast,
  PredictedLoanPaymentPlan,
  RealityCheckDomain,
  FinancialNotification,
  SmsRuleOverride,
  StagedSmsItem,
  SmsFlagReason,
  SmsParsedTxKind,
  SmsBalanceDiscrepancy,
} from '../types';
import {
  RawDeviceSmsMessage,
  SmsPermissionStatus,
  checkStandaloneSmsPermission,
  requestStandaloneSmsPermission,
  readOnDeviceSmsInbox,
  subscribeToIncomingSms,
  splitManualPastedSmsBatch,
} from '../lib/smsBridge';
import {
  processIncomingSmsBatchOnDevice,
  buildLedgerTransactionFromStagedSms,
  applyTransactionBalanceMutationInMemory,
  applySmsFlagFeedback,
  learnCategoryOverrideFromMerchant,
  learnFromUserSmsReview,
  applySmsRejectionLearning,
} from '../lib/smsEngine';
import {
  filterUniqueUnsyncedMessages,
  commitSyncedSmsBatch,
  getStoredLastSmsSyncTimestamp,
} from '../lib/smsSyncRegistry';
import { generateCentralizedNotifications } from '../lib/notificationEngine';
import { executeTransactionReversal } from '../lib/reversalEngine';
import { detectFinancialAnomalies } from '../lib/anomalyDetector';
import { verifyPinAndCheckUpgrade } from '../lib/securityArgon2';
import { generateCashFlowForecast, ForecastOptions } from '../lib/cashFlowForecast';
import { evaluateDebtStrategies } from '../lib/debtEngine';
import {
  assessCardFullVsEmiByCashFlow,
  compareCreditCardEmiVsFullPayment,
} from '../lib/creditIntelligence';
import {
  getLoanLockInStatus,
  calculateLoanPrepaymentCharge,
  simulateLoanPrepayment,
} from '../lib/loanPrepaymentEngine';
import { reconcileHolding, HoldingReconciliationReport, createProvenance, safeAdd, safeSub } from '../lib/financialMath';
import {
  autoOffsetCounterpartyBalances,
  calculateAccruedInterest,
  groupReceivablesByCounterparty,
  isActiveCounterpartyRecord,
  normalizeCounterpartyName,
  reconcileDebtorPaymentOrOffset,
} from '../lib/counterpartyEngine';
import { computeNextScheduledDate, isScheduledTransferDue } from '../lib/scheduledTransfers';
import {
  BUILT_IN_ASSET_TYPES,
  DEFAULT_CURRENCIES,
  DEFAULT_QUICK_CHIPS,
  DEFAULT_SETTINGS,
  DEFAULT_SPEND_CATEGORIES,
  DEFAULT_TAX_RULES,
  THEME_PRESETS,
} from '../lib/defaults';
import { dbStorage } from '../lib/storage';
import {
  calculateFinancialEngine,
  EngineCalculationResult,
  getHoldingLocalValue,
} from '../lib/calcEngine';
import { calculateTaxEngine, TaxEngineResult } from '../lib/taxEngine';
import { generateInsightsFeed } from '../lib/insightsEngine';
import {
  predictCreditScore,
  reinforceCreditScoreModel,
  evaluateSurplusCashflowMovement,
  recordRLActionFeedback,
  getStoredCareerProfile,
  saveCareerProfile,
  getStoredCareerWeights,
  saveCareerWeights,
  resetCareerWeights,
  tuneCareerModelWeights,
  recordCareerTransitionAndTune,
  predictCareerAndSalary,
  predictPossibleBills,
  deriveSmartSpendChipsAndCategories,
  dedupeSpendCategories,
  dedupeQuickChips,
  computeGoalLiquidSurplusPlan,
  getStoredOnlineLearnerState,
  saveOnlineLearnerState,
  syncOnlineLearnerWithData,
  exportFullMLReplicationState,
  restoreFullMLReplicationState,
  DEFAULT_ONLINE_LEARNER_STATE,
  DEFAULT_CAREER_WEIGHTS,
  getStoredClosedLoopMLState,
  saveClosedLoopMLState,
  DEFAULT_CLOSED_LOOP_ML_STATE,
  syncClosedLoopRealityEngine,
  predictNextBrokerUsage,
  predictOptimalLoanPaymentPlan,
  recordBehavioralOutcomeAndRetrain,
  recordAlertDismissalSignal,
} from '../lib/mlEngine';
import { isLockedOrMarketAsset, isSpendableLiquidHolding, getSafeAssetName } from '../lib/assetRules';
import { getLastWorkingDayOfMonth, formatMoney } from '../lib/formatters';
import { verifyPin } from '../lib/crypto';

export interface ContinuousEngineStats {
  isActive: boolean;
  totalAccrued: number;
  accruedWhileClosed: number;
  closedDurationSeconds: number;
  lastActiveTimestamp: number;
}

interface AppContextType {
  // Data entities
  settings: AppSettings;
  theme: AppTheme;
  currencies: Currency[];
  assetTypes: AssetType[];
  holdings: Holding[];
  liabilities: Liability[];
  incomeStreams: IncomeStream[];
  transactions: Transaction[];
  bills: Bill[];
  rawBills: Bill[];
  goals: Goal[];
  sales: SaleRecord[];
  taxRules: TaxRules;
  snapshots: Snapshot[];
  insights: InsightCardData[];
  scheduledTransfers: ScheduledTransfer[];
  creditScores: CreditScoreRecord[];
  spendCategories: SpendCategoryConfig[];
  quickChips: QuickSpendChip[];
  receivables: Receivable[];
  smsRuleOverrides: SmsRuleOverride[];
  smsStagingQueue: StagedSmsItem[];
  smsPermissionStatus: SmsPermissionStatus;

  // Calculation results
  engineResult: EngineCalculationResult;
  taxResult: TaxEngineResult;
  tickerValue: number;
  continuousEngineStats: ContinuousEngineStats;
  attentionItems: AttentionItem[];
  dismissAttentionItem: (id: string) => void;
  creditPrediction: CreditScorePrediction;
  rlRecommendations: RLMovementRecommendation[];
  predictedBills: PredictedBillsSummary;
  goalLiquidPlan: GoalLiquidSurplusPlan;
  onlineLearnerState: OnlineSpendIncomeModelState;
  closedLoopMLState: ClosedLoopMLState;
  brokerUsageForecast: BrokerUsageForecast;
  cashFlowForecast: CashFlowForecastResult;
  notifications: FinancialNotification[];
  dismissNotification: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  readNotificationIds: Record<string, boolean>;
  debtStrategyComparison: {
    strategies: Record<DebtRepaymentStrategy, DebtStrategyComparison>;
    recommendedStrategy: DebtRepaymentStrategy;
    totalOutstandingBase: number;
    mandatoryMonthlyObligationBase: number;
    highestInterestRate: number;
  };

  // Navigation & UI
  activeTab: 'home' | 'assets' | 'liabilities' | 'spend' | 'insights';
  setActiveTab: (tab: 'home' | 'assets' | 'liabilities' | 'spend' | 'insights') => void;
  activeModal: string | null;
  setActiveModal: (modal: string | null) => void;
  isLocked: boolean;
  unlockApp: () => void;
  lockApp: () => void;
  logoutApp: () => void;

  // CRUD actions
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  updateTheme: (newTheme: AppTheme) => Promise<void>;
  updateTaxRules: (newRules: Partial<TaxRules>) => Promise<void>;

  addCurrency: (currency: Currency) => Promise<void>;
  updateCurrency: (currency: Currency) => Promise<void>;
  deleteCurrency: (code: string) => Promise<boolean>;

  addHolding: (holding: Holding) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  updateHoldingValuesBulk: (updates: { id: string; currentPrice?: number; principalOrValue?: number }[]) => Promise<void>;
  sellHolding: (sale: Omit<SaleRecord, 'id'>) => Promise<void>;
  addHoldingsBulk: (newHoldings: Holding[], mode?: 'append' | 'replace') => Promise<void>;

  addAssetType: (type: AssetType) => Promise<void>;
  updateAssetType: (type: AssetType) => Promise<void>;
  deleteAssetType: (id: string) => Promise<void>;

  addLiability: (liability: Liability) => Promise<void>;
  updateLiability: (liability: Liability) => Promise<void>;
  deleteLiability: (id: string) => Promise<void>;
  addLiabilitiesBulk: (newLiabilities: Liability[], mode?: 'append' | 'replace') => Promise<void>;
  payCard: (cardId: string, fromAccountId: string, amount: number) => Promise<void>;
  payCardWithCashback: (cardId: string, fromAccountId: string, actualPaidAmount: number, cashbackToApply?: number) => Promise<{ success: boolean; error?: string }>;
  convertCardToEmi: (
    cardId: string,
    params: {
      conversionAmount: number;
      tenureMonths: number;
      annualRatePct: number;
      processingFee: number;
      gstPct?: number;
    }
  ) => Promise<{ success: boolean; error?: string; createdLoanId?: string }>;
  logCardCashback: (cardId: string, amount: number, note?: string) => Promise<void>;
  getCardEffectiveMode: (card: Liability) => 'credit' | 'debit';
  payLoan: (
    loanId: string,
    fromAssetId: string,
    amount: number,
    options?: {
      isEmi?: boolean;
      updatedRatePct?: number;
      prepaymentPenaltyCharge?: number;
      updatedMonthlyEmi?: number;
      updatedTenureMonths?: number;
      bypassStrategyEnforcement?: boolean;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  predictLoanPayment: (loanId: string) => PredictedLoanPaymentPlan | null;
  recordStrategyOutcome: (params: {
    domain: RealityCheckDomain;
    subEventLabel: string;
    ledgerRefId: string;
    predictedSummary: string;
    actualRealitySummary: string;
    wasSuccess: boolean;
    partialSuccess?: boolean;
    microSavedBase: number;
    avoidableCostOrDeltaBase?: number;
  }) => void;
  logDebitCardAtmWithdrawal: (cardId: string, locationType: 'metro' | 'non_metro') => Promise<void>;

  addTransaction: (tx: Transaction) => Promise<void>;
  addTransactionsBulk: (txs: Transaction[]) => Promise<void>;
  updateTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (id: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  reverseTransaction: (id: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  reversalAuditLogs: ReversalAuditRecord[];
  anomalies: FinancialAnomaly[];
  dismissAnomaly: (id: string) => void;

  addBill: (bill: Bill) => Promise<void>;
  updateBill: (bill: Bill) => Promise<void>;
  deleteBill: (id: string) => Promise<void>;
  addBillsBulk: (newBills: Bill[], mode?: 'append' | 'replace') => Promise<void>;
  postBill: (
    billId: string,
    fromAccountId?: string,
    options?: {
      paymentMode?: 'upi' | 'debit_card' | 'hybrid_card' | 'neft' | 'imps' | 'cheque' | 'netbanking';
      atmZone?: 'metro' | 'non_metro';
      debitCardId?: string;
      loanSettlementOverride?: {
        principalAmount: number;
        isEmi: boolean;
        prepaymentPenaltyCharge?: number;
        updatedTenureMonths?: number;
        updatedMonthlyEmi?: number;
      };
    }
  ) => Promise<{ success: boolean; error?: string; sweepInNote?: string; cardUsageNote?: string; hybridCreditNote?: string }>;
  overrideBillPaid: (billId: string, pin: string) => Promise<{ success: boolean; error?: string; isRepeated?: boolean; repeatCount?: number }>;
  undoBillOverride: (billId: string) => Promise<void>;

  // Sweep-In & Overdraft management
  triggerSweepInAutoBreak: (bankAccountId?: string) => Promise<void>;
  getAccountLiquidityWithSweepIn: (holdingId: string) => { asset?: Holding; balance: number; sweepInFds: Holding[]; totalSweepIn: number; totalAvailable: number };
  breakSweepInForDeficit: (
    bankAccountId: string,
    deficit: number,
    purpose?: string
  ) => Promise<{
    success: boolean;
    totalDeducted: number;
    brokenFds: { fdId: string; fdName: string; amount: number; remaining: number }[];
    error?: string;
  }>;

  addIncomeStream: (inc: IncomeStream) => Promise<void>;
  updateIncomeStream: (inc: IncomeStream) => Promise<void>;
  deleteIncomeStream: (id: string) => Promise<void>;
  postSalary: (incomeId: string) => Promise<void>;
  recordExternalInflow: (
    params: ExternalInflowParams
  ) => Promise<{ success: boolean; error?: string; txId?: string; summary?: string }>;

  addGoal: (goal: Goal) => Promise<void>;
  updateGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  payGoal: (
    goalId: string,
    partialAmount?: number,
    paymentMode?: GoalPaymentMode,
    debitCardId?: string
  ) => Promise<{
    success: boolean;
    error?: string;
    txId?: string;
    isPartial?: boolean;
    paidAmount?: number;
    remaining?: number;
  }>;
  verifyGoalPaymentInLedger: (goalId: string) => Transaction | undefined;
  readyGoalNotification: Goal | null;
  clearReadyGoalNotification: () => void;

  // Scheduled Transfers
  addScheduledTransfer: (transfer: ScheduledTransfer) => Promise<void>;
  updateScheduledTransfer: (transfer: ScheduledTransfer) => Promise<void>;
  deleteScheduledTransfer: (id: string) => Promise<void>;

  // Credit Score tracking & ML training
  addCreditScore: (record: CreditScoreRecord) => Promise<void>;
  deleteCreditScore: (id: string) => Promise<void>;

  // Spend Categories & Quick Chips
  addSpendCategory: (category: SpendCategoryConfig) => Promise<void>;
  updateSpendCategory: (category: SpendCategoryConfig) => Promise<void>;
  deleteSpendCategory: (id: string) => Promise<void>;
  addQuickChip: (chip: QuickSpendChip) => Promise<void>;
  updateQuickChip: (chip: QuickSpendChip) => Promise<void>;
  deleteQuickChip: (id: string) => Promise<void>;

  // Receivables & Personal Loans (Money Lent)
  addReceivable: (receivable: Receivable) => Promise<void>;
  updateReceivable: (receivable: Receivable) => Promise<void>;
  deleteReceivable: (id: string) => Promise<void>;
  recordReceivableRepayment: (
    receivableId: string,
    amount: number,
    depositAccountId?: string,
    date?: string,
    notes?: string,
    options?: {
      mode?: 'cash_deposit' | 'expense_offset';
      expenseDescription?: string;
    }
  ) => Promise<{ success: boolean; error?: string; excessAdvanceAmount?: number; txId?: string }>;
  writeOffReceivable: (receivableId: string, reason?: string) => Promise<void>;
  payBillForCounterparty: (params: {
    debtorName: string;
    billDescription: string;
    amount: number;
    paymentSourceId: string;
    category?: string;
    interestRatePct?: number;
    expectedDate?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  counterpartyPaidMyBill: (params: {
    debtorName: string;
    billId?: string;
    billName: string;
    amount: number;
    date?: string;
    notes?: string;
  }) => Promise<{ success: boolean; error?: string; excessAdvanceAmount?: number; txId?: string }>;
  repayBorrowedCounterparty: (
    debtorName: string,
    amount: number,
    fromAccountId: string,
    notes?: string
  ) => Promise<{ success: boolean; error?: string }>;
  offsetCounterparty: (debtorName: string) => Promise<{ success: boolean; offsetAmount: number }>;

  // On-Device SMS Ingestion & Active Reinforcement Learning
  requestSmsAccessAndSync: () => Promise<{
    status: SmsPermissionStatus;
    committedCount: number;
    stagedCount: number;
    droppedNoiseCount: number;
    duplicateCount: number;
  }>;
  ingestSmsMessages: (
    rawInput: string | RawDeviceSmsMessage[],
    autoCommit?: boolean
  ) => Promise<{
    committedCount: number;
    stagedCount: number;
    droppedNoiseCount: number;
    duplicateCount: number;
    blacklistedCount: number;
  }>;
  commitStagedSmsItem: (
    stagingId: string,
    overrideSourceIdOrOptions?:
      | string
      | {
          sourceId?: string;
          targetLiabilityId?: string;
          txKind?: SmsParsedTxKind;
          reason?: string;
          category?: string;
          amount?: number;
          date?: string;
        },
    overrideCategory?: string
  ) => Promise<{ success: boolean; error?: string }>;
  discardStagedSmsItem: (stagingId: string, rejectionReason?: string) => Promise<void>;
  flagSmsTransaction: (
    txId: string,
    flagReason: SmsFlagReason,
    replacementSourceId?: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteSmsRuleOverride: (ruleId: string) => Promise<void>;
  smsBalanceAlerts: { stagingId: string; discrepancy: SmsBalanceDiscrepancy }[];
  resolveSmsBalanceAlert: (
    stagingId: string,
    action: 'sync_balance' | 'dismiss'
  ) => Promise<{ success: boolean; error?: string }>;

  // Cash-Flow & Reconciliation Tools
  generateCustomForecast: (options?: ForecastOptions) => CashFlowForecastResult;
  reconcileHoldingBalance: (holdingId: string) => HoldingReconciliationReport;

  // RL surplus cashflow movement actions
  executeRLRecommendation: (recommendationId: string) => Promise<void>;
  dismissRLRecommendation: (recommendationId: string, reason: string) => void;

  dismissInsight: (id: string) => void;
  snoozeInsight: (id: string, days: number) => void;

  // Career & Skill Asset ML Prediction
  careerProfile: CareerProfile;
  careerPrediction: CareerPredictionResult;
  careerModelWeights: CareerModelWeights;
  updateCareerProfile: (profile: CareerProfile) => void;
  tuneCareerModel: (feedback: {
    predictedSalary: number;
    userActualOrTargetSalary?: number;
    roleFeedback: 'aligned' | 'too_senior' | 'too_junior' | 'different_field' | 'management_focus' | 'technical_focus';
    salaryFeedback?: 'accurate' | 'too_high' | 'too_low';
    comments?: string;
  }) => void;
  logCareerTransition: (params: {
    transitionType: 'previous' | 'current_update' | 'next_offer';
    role: string;
    actualSalary: number;
    companyType: 'mnc' | 'startup' | 'midsize';
    year: number;
    experienceAtTransition: number;
    ageAtTransition?: number;
    applyAsActiveRole?: boolean;
    syncIncomeStream?: boolean;
  }) => Promise<CareerTransitionRecord>;
  resetCareerModelWeights: () => void;

  wipeAllData: () => Promise<void>;
  importFullBackup: (jsonString: string) => Promise<boolean>;
  exportFullBackup: () => string;
  restoreMasterEntities: (
    payload: {
      holdings?: Holding[];
      liabilities?: Liability[];
      transactions?: Transaction[];
      bills?: Bill[];
      goals?: Goal[];
      incomeStreams?: IncomeStream[];
      creditScores?: CreditScoreRecord[];
      receivables?: Receivable[];
      settingsPartial?: Partial<AppSettings>;
      careerProfile?: CareerProfile;
      mlBundle?: FullMLReplicationState;
    },
    mode?: 'append' | 'replace'
  ) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [theme, setThemeState] = useState<AppTheme>(THEME_PRESETS[0]);
  const [currencies, setCurrencies] = useState<Currency[]>(DEFAULT_CURRENCIES);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>(BUILT_IN_ASSET_TYPES);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [incomeStreams, setIncomeStreams] = useState<IncomeStream[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Live synchronous refs prevent stale React closures during multi-step async mutations (e.g. Sweep-In auto-break followed immediately by bill/spend/loan deduction)
  const holdingsRef = useRef<Holding[]>([]);
  const liabilitiesRef = useRef<Liability[]>([]);
  const transactionsRef = useRef<Transaction[]>([]);

  const commitHoldings = (next: Holding[]) => {
    holdingsRef.current = next;
    setHoldings(next);
  };

  const commitLiabilities = (next: Liability[]) => {
    liabilitiesRef.current = next;
    setLiabilities(next);
  };

  const commitTransactions = (next: Transaction[]) => {
    transactionsRef.current = next;
    setTransactions(next);
  };
  const [bills, setBills] = useState<Bill[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [taxRules, setTaxRulesState] = useState<TaxRules>(DEFAULT_TAX_RULES);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [dismissedInsights, setDismissedInsights] = useState<Record<string, boolean>>({});
  const [snoozedInsights, setSnoozedInsights] = useState<Record<string, string>>({});
  const [dismissedNotifications, setDismissedNotifications] = useState<Record<string, boolean | number>>(() => {
    try {
      const raw = localStorage.getItem('networthiq_dismissed_notifications');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  const [dismissedAttentionItems, setDismissedAttentionItems] = useState<Record<string, boolean | number>>(() => {
    try {
      const raw = localStorage.getItem('networthiq_dismissed_attention');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  const [readNotificationIds, setReadNotificationIds] = useState<Record<string, boolean>>({});

  const [scheduledTransfers, setScheduledTransfers] = useState<ScheduledTransfer[]>([]);
  const [creditScores, setCreditScores] = useState<CreditScoreRecord[]>([]);
  const [spendCategories, setSpendCategories] = useState<SpendCategoryConfig[]>(DEFAULT_SPEND_CATEGORIES);
  const [quickChips, setQuickChips] = useState<QuickSpendChip[]>(DEFAULT_QUICK_CHIPS);
  const [overriddenAutoBills, setOverriddenAutoBills] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('networthiq_auto_bill_overrides');
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  const [activeTab, setActiveTab] = useState<'home' | 'assets' | 'liabilities' | 'spend' | 'insights'>('home');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [readyGoalNotification, setReadyGoalNotification] = useState<Goal | null>(null);
  const [careerProfile, setCareerProfile] = useState<CareerProfile>(getStoredCareerProfile());
  const [careerModelWeights, setCareerModelWeights] = useState<CareerModelWeights>(getStoredCareerWeights());
  const [onlineLearnerState, setOnlineLearnerState] = useState<OnlineSpendIncomeModelState>(
    getStoredOnlineLearnerState()
  );
  const [closedLoopMLState, setClosedLoopMLState] = useState<ClosedLoopMLState>(
    getStoredClosedLoopMLState()
  );
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [smsRuleOverrides, setSmsRuleOverrides] = useState<SmsRuleOverride[]>([]);
  const [smsStagingQueue, setSmsStagingQueue] = useState<StagedSmsItem[]>([]);
  const [smsPermissionStatus, setSmsPermissionStatus] = useState<SmsPermissionStatus>('manual_fallback');
  const smsRuleOverridesRef = useRef<SmsRuleOverride[]>([]);
  const smsStagingQueueRef = useRef<StagedSmsItem[]>([]);

  const commitSmsRuleOverrides = (next: SmsRuleOverride[]) => {
    smsRuleOverridesRef.current = next;
    setSmsRuleOverrides(next);
  };

  const commitSmsStagingQueue = (next: StagedSmsItem[]) => {
    smsStagingQueueRef.current = next;
    setSmsStagingQueue(next);
  };

  const [reversalAuditLogs, setReversalAuditLogs] = useState<ReversalAuditRecord[]>([]);
  const [dismissedAnomalyIds, setDismissedAnomalyIds] = useState<Record<string, boolean>>({});

  // Load from IndexedDB on startup
  useEffect(() => {
    async function initStorage() {
      try {
        const [
          storedSettings,
          storedTheme,
          storedCurrencies,
          storedAssetTypes,
          storedHoldings,
          storedLiabilities,
          storedIncome,
          storedTxs,
          storedBills,
          storedGoals,
          storedSales,
          storedTaxRules,
          storedSnapshots,
          storedTransfers,
          storedScores,
          storedCategories,
          storedChips,
          storedReceivables,
          storedSmsOverrides,
          storedSmsStaging,
          detectedSmsPerm,
        ] = await Promise.all([
          dbStorage.getSingleton<AppSettings>('settings', 'current'),
          dbStorage.getSingleton<AppTheme>('theme', 'current'),
          dbStorage.getAll<Currency>('currencies'),
          dbStorage.getAll<AssetType>('assetTypes'),
          dbStorage.getAll<Holding>('holdings'),
          dbStorage.getAll<Liability>('liabilities'),
          dbStorage.getAll<IncomeStream>('incomeStreams'),
          dbStorage.getAll<Transaction>('transactions'),
          dbStorage.getAll<Bill>('bills'),
          dbStorage.getAll<Goal>('goals'),
          dbStorage.getAll<SaleRecord>('sales'),
          dbStorage.getSingleton<TaxRules>('taxRules', 'current'),
          dbStorage.getAll<Snapshot>('snapshots'),
          dbStorage.getAll<ScheduledTransfer>('scheduledTransfers'),
          dbStorage.getAll<CreditScoreRecord>('creditScores'),
          dbStorage.getAll<SpendCategoryConfig>('spendCategories'),
          dbStorage.getAll<QuickSpendChip>('quickChips'),
          dbStorage.getAll<Receivable>('receivables'),
          dbStorage.getAll<SmsRuleOverride>('sms_rule_overrides'),
          dbStorage.getAll<StagedSmsItem>('sms_staging_queue'),
          checkStandaloneSmsPermission(),
        ]);

        if (storedHoldings) commitHoldings(storedHoldings);
        if (storedLiabilities) commitLiabilities(storedLiabilities);
        if (storedIncome) setIncomeStreams(storedIncome);
        if (storedTxs) commitTransactions(storedTxs);
        if (storedBills) setBills(storedBills);
        if (storedGoals) setGoals(storedGoals);
        if (storedSales) setSales(storedSales);
        if (storedSnapshots) setSnapshots(storedSnapshots);
        if (storedTransfers) setScheduledTransfers(storedTransfers);
        if (storedScores) setCreditScores(storedScores);
        if (storedCategories && storedCategories.length > 0) {
          const cleaned = dedupeSpendCategories(storedCategories);
          setSpendCategories(cleaned);
          if (cleaned.length !== storedCategories.length) {
            dbStorage.setAll('spendCategories', cleaned);
          }
        }
        if (storedChips && storedChips.length > 0) {
          const cleaned = dedupeQuickChips(storedChips);
          setQuickChips(cleaned);
          if (cleaned.length !== storedChips.length) {
            dbStorage.setAll('quickChips', cleaned);
          }
        }
        if (storedReceivables) setReceivables(storedReceivables);
        if (storedSmsOverrides) commitSmsRuleOverrides(storedSmsOverrides);
        if (storedSmsStaging) commitSmsStagingQueue(storedSmsStaging);
        if (detectedSmsPerm) setSmsPermissionStatus(detectedSmsPerm);

        if (storedSettings) setSettingsState(storedSettings);
        if (storedTheme) setThemeState(storedTheme);
        if (storedCurrencies && storedCurrencies.length > 0) setCurrencies(storedCurrencies);
        if (storedAssetTypes && storedAssetTypes.length > 0) setAssetTypes(storedAssetTypes);
        if (storedTaxRules) setTaxRulesState(storedTaxRules);

        // Strict lock enforcement: ALWAYS require PIN on launch/reload unless security is explicitly disabled
        try {
          if (storedSettings?.pinLockEnabled === false) {
            setIsLocked(false);
            localStorage.setItem('networthiq_vault_locked', 'false');
          } else {
            setIsLocked(true);
            localStorage.setItem('networthiq_vault_locked', 'true');
          }
        } catch {
          setIsLocked(true);
        }
      } catch (err) {
        console.error('Storage initialization error:', err);
      } finally {
        setIsInitialized(true);
      }
    }

    initStorage();
  }, []);

  // Sync Theme CSS Variables
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    root.style.setProperty('--color-bg', theme.colors.bg);
    root.style.setProperty('--color-surface', theme.colors.surface);
    root.style.setProperty('--color-card', theme.colors.card);
    root.style.setProperty('--color-text', theme.colors.text);
    root.style.setProperty('--color-text-muted', theme.colors.textMuted);
    root.style.setProperty('--color-primary', theme.colors.primary);
    root.style.setProperty('--color-accent', theme.colors.accent);
    root.style.setProperty('--color-positive', theme.colors.positive);
    root.style.setProperty('--color-negative', theme.colors.negative);
    root.style.setProperty('--color-alert', theme.colors.alert);
    root.style.setProperty('--color-border', theme.colors.border);
  }, [theme]);

  // Tax Engine Calculation
  const taxResult = useMemo<TaxEngineResult>(() => {
    return calculateTaxEngine(sales, taxRules);
  }, [sales, taxRules]);

  // Periodic time pulse so time-based accruals (peer interest, loan days, credit card cycles) update continuously
  const [clockTick, setClockTick] = useState<number>(Date.now());

  // Financial Engine Calculation
  const engineResult = useMemo<EngineCalculationResult>(() => {
    return calculateFinancialEngine(
      holdings,
      assetTypes,
      liabilities,
      incomeStreams,
      transactions,
      currencies,
      settings,
      taxResult.totalEstimatedTaxOwedBase,
      new Date(clockTick),
      receivables
    );
  }, [holdings, assetTypes, liabilities, incomeStreams, transactions, currencies, settings, taxResult, receivables, clockTick]);

  // Credit Score Online ML Prediction
  const creditPrediction = useMemo<CreditScorePrediction>(() => {
    const totalDebt = liabilities.reduce((s, l) => s + (l.outstanding || 0), 0);
    const totalAssets = holdings.reduce((s, h) => s + (h.principalOrValue || 0), 0);

    const creditCards = liabilities.filter((l) => {
      if (l.kind !== 'card') return false;
      if (l.cardType === 'credit' || !l.cardType) return true;
      if (l.cardType === 'hybrid') {
        const linked = holdings.find((h) => h.id === l.linkedAccountId);
        const linkedBal = linked ? getHoldingLocalValue(linked) : 0;
        return linkedBal <= 0 || (l.outstanding || 0) > 0;
      }
      return false;
    });
    let totalCardOutstanding = 0;
    let totalCardLimit = 0;
    for (const card of creditCards) {
      totalCardOutstanding += card.outstanding || 0;
      const cardLim = card.creditLimit || card.limit || 0;
      if (cardLim > 0) totalCardLimit += cardLim;
    }

    const utilPct = totalCardLimit > 0 ? (totalCardOutstanding / totalCardLimit) * 100 : 0;

    return predictCreditScore({
      creditCardUtilizationPct: utilPct,
      totalDebt,
      totalAssets,
    });
  }, [holdings, liabilities]);

  // Reinforcement Learning Surplus Cashflow Movement Recommendations
  const rlRecommendations = useMemo<RLMovementRecommendation[]>(() => {
    return evaluateSurplusCashflowMovement(
      holdings,
      liabilities,
      engineResult.freeCashBase,
      settings.minCashCustom || 25000
    );
  }, [holdings, liabilities, engineResult.freeCashBase, settings.minCashCustom]);

  // Career Progression & Salary Trajectory ML Prediction
  const careerPrediction = useMemo<CareerPredictionResult>(() => {
    const mergedProfile: CareerProfile = {
      ...careerProfile,
      age: careerProfile.age ?? settings.age,
    };
    return predictCareerAndSalary(
      mergedProfile,
      engineResult.salaryYearlyIncomeBase,
      engineResult.netWorthBase,
      careerModelWeights
    );
  }, [careerProfile, settings.age, engineResult.salaryYearlyIncomeBase, engineResult.netWorthBase, careerModelWeights]);

  const updateCareerProfile = (profile: CareerProfile) => {
    setCareerProfile(profile);
    saveCareerProfile(profile);
    if (profile.age !== undefined && profile.age !== settings.age) {
      const nextSettings = { ...settings, age: profile.age };
      setSettingsState(nextSettings);
      dbStorage.setSingleton('settings', nextSettings);
    }
  };

  const tuneCareerModel = (feedback: {
    predictedSalary: number;
    userActualOrTargetSalary?: number;
    roleFeedback: 'aligned' | 'too_senior' | 'too_junior' | 'different_field' | 'management_focus' | 'technical_focus';
    salaryFeedback?: 'accurate' | 'too_high' | 'too_low';
    comments?: string;
  }) => {
    const res = tuneCareerModelWeights(feedback, careerProfile, careerModelWeights);
    setCareerProfile(res.updatedProfile);
    setCareerModelWeights(res.updatedWeights);
  };

  const logCareerTransition = async (params: {
    transitionType: 'previous' | 'current_update' | 'next_offer';
    role: string;
    actualSalary: number;
    companyType: 'mnc' | 'startup' | 'midsize';
    year: number;
    experienceAtTransition: number;
    ageAtTransition?: number;
    applyAsActiveRole?: boolean;
    syncIncomeStream?: boolean;
  }): Promise<CareerTransitionRecord> => {
    const res = recordCareerTransitionAndTune(
      params,
      { ...careerProfile, age: careerProfile.age ?? settings.age },
      engineResult.salaryYearlyIncomeBase,
      engineResult.netWorthBase,
      careerModelWeights
    );
    setCareerProfile(res.updatedProfile);
    setCareerModelWeights(res.updatedWeights);

    if (params.ageAtTransition !== undefined && params.ageAtTransition !== settings.age) {
      const nextSettings = { ...settings, age: params.ageAtTransition };
      setSettingsState(nextSettings);
      await dbStorage.setSingleton('settings', nextSettings);
    }

    if (params.syncIncomeStream && params.actualSalary > 0) {
      const monthlyAmt = Math.round(params.actualSalary / 12);
      if (incomeStreams.length > 0) {
        const primary = incomeStreams[0];
        const mult =
          primary.period === 'yearly'
            ? 1
            : primary.period === 'quarterly'
            ? 4
            : primary.period === 'biweekly'
            ? 26
            : primary.period === 'weekly'
            ? 52
            : 12;
        const updatedPrimary: IncomeStream = {
          ...primary,
          name: params.role.trim() ? `Salary (${params.role.trim()})` : primary.name,
          amountPerPeriod: Math.round(params.actualSalary / mult),
        };
        const nextStreams = incomeStreams.map((inc, idx) => (idx === 0 ? updatedPrimary : inc));
        setIncomeStreams(nextStreams);
        await dbStorage.put('incomeStreams', updatedPrimary);
      } else {
        const newInc: IncomeStream = {
          id: `inc-career-${Date.now()}`,
          name: params.role.trim() ? `Salary (${params.role.trim()})` : 'Primary Salary',
          amountPerPeriod: monthlyAmt,
          period: 'monthly',
          payDay: 1,
          payScheduleType: 'fixed_day',
          depositAccountId: holdingsRef.current.find((h) => h.typeId === 'type-bank')?.id,
          currency: settings.baseCurrency || 'INR',
          grossOrNet: 'net',
        };
        setIncomeStreams([newInc]);
        await dbStorage.put('incomeStreams', newInc);
      }
    }

    return res.transitionRecord;
  };

  const resetCareerModelWeights = () => {
    const defaults = resetCareerWeights();
    setCareerModelWeights(defaults);
  };

  // Attention Items with reliable navigation destinations
  // Notify-Only Broker & Card Fee Pattern Forecast
  const brokerUsageForecast = useMemo<BrokerUsageForecast>(() => {
    return predictNextBrokerUsage(
      transactions,
      receivables,
      liabilities,
      holdings,
      assetTypes,
      new Date()
    );
  }, [transactions, receivables, liabilities, holdings, assetTypes]);

  const rawAttentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const now = Date.now();
    const staleMs = (settings.staleRateDays || 7) * 24 * 60 * 60 * 1000;
    const baseCurr = settings.baseCurrency || 'INR';
    const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

    // 1. Stale or missing currencies
    for (const c of currencies) {
      if (c.code !== settings.baseCurrency) {
        const inUse = holdings.some((h) => h.currency === c.code) || liabilities.some((l) => l.currency === c.code);
        if (inUse) {
          const updateAge = now - new Date(c.updatedAt).getTime();
          if (isNaN(updateAge) || updateAge > staleMs) {
            items.push({
              id: `att-curr-${c.code}`,
              level: 'warning',
              requiresAction: false,
              title: `Refresh ${c.code} Exchange Rate`,
              description: `Your ${c.code} rate hasn't been updated in over ${settings.staleRateDays} days. Refresh it in Settings for exact totals.`,
              sourceType: 'currency',
              linkTab: 'settings',
              actionLabel: 'Update Rate',
            });
          }
        }
      }
    }

    // 2. Overdue or due soon credit cards
    for (const cs of engineResult.cardStates) {
      if (cs.status === 'Overdue') {
        items.push({
          id: `att-card-overdue-${cs.id}`,
          level: 'critical',
          requiresAction: true,
          title: `Action Needed: ${cs.name} Is Overdue`,
          description: `Pay ${formatMoney(cs.unpaidAmount, baseCurr, currSym)} now to stop late interest charges and protect your credit score.`,
          sourceType: 'card',
          sourceId: cs.id,
          linkTab: 'liabilities',
          actionLabel: 'Pay Card Now',
        });
      } else if (cs.status === 'DueSoon') {
        items.push({
          id: `att-card-due-${cs.id}`,
          level: cs.daysRemaining <= 3 ? 'critical' : 'warning',
          requiresAction: true,
          title: `${cs.name} Bill Due in ${cs.daysRemaining} Day${cs.daysRemaining === 1 ? '' : 's'}`,
          description: `Clear ${formatMoney(cs.unpaidAmount, baseCurr, currSym)} before ${cs.dueDate} so you pay zero interest.`,
          sourceType: 'card',
          sourceId: cs.id,
          linkTab: 'liabilities',
          actionLabel: 'Settle Card',
        });
      }
    }

    // 3. Credit & Hybrid Card 30% Utilization Check
    const threshold = settings.creditUtilizationThresholdPct || 30;
    const creditCards = liabilities.filter((l) => {
      if (l.kind !== 'card') return false;
      if (l.cardType === 'credit' || !l.cardType) return true;
      if (l.cardType === 'hybrid') {
        const linked = holdings.find((h) => h.id === l.linkedAccountId);
        const linkedBal = linked ? getHoldingLocalValue(linked) : 0;
        return linkedBal <= 0 || (l.outstanding || 0) > 0;
      }
      return false;
    });
    let totalCardDebt = 0;
    let totalCardLimit = 0;

    for (const card of creditCards) {
      totalCardDebt += card.outstanding || 0;
      const cardLim = card.creditLimit || card.limit || 0;
      if (cardLim > 0) {
        totalCardLimit += cardLim;
        const cardUtil = ((card.outstanding || 0) / cardLim) * 100;
        if (cardUtil >= threshold) {
          items.push({
            id: `att-card-util-${card.id}`,
            level: 'warning',
            requiresAction: false,
            title: `${card.name} Usage at ${cardUtil.toFixed(0)}%`,
            description: `Keeping card balances under ${threshold}% of your limit helps keep your credit score strong.`,
            sourceType: 'card',
            sourceId: card.id,
            linkTab: 'liabilities',
            actionLabel: 'Pay Down Card',
          });
        }
      }
    }

    if (totalCardLimit > 0) {
      const overallUtil = (totalCardDebt / totalCardLimit) * 100;
      if (overallUtil >= threshold) {
        items.push({
          id: 'att-overall-card-util',
          level: 'warning',
          requiresAction: true,
          title: `Overall Card Usage Above ${threshold}% (${overallUtil.toFixed(0)}%)`,
          description: `Your combined card balances are running high. Paying down part of the balance before statement day protects your score.`,
          sourceType: 'card',
          linkTab: 'liabilities',
          actionLabel: 'View Cards',
        });
      }
    }

    // 4. Debit Card Monthly ATM Free Withdrawal Quota Alert
    const currentMonthStr = new Date().toISOString().substring(0, 7);
    const debitCards = liabilities.filter((l) => l.kind === 'card' && l.cardType === 'debit');
    for (const card of debitCards) {
      const isCurrentMonth = card.lastAtmUsageMonth === currentMonthStr;
      const metroUsage = isCurrentMonth ? (card.metroAtmUsageThisMonth || 0) : 0;
      const nonMetroUsage = isCurrentMonth ? (card.nonMetroAtmUsageThisMonth || 0) : 0;
      const totalUsage = metroUsage + nonMetroUsage;
      const metroLimit = card.metroAtmFreeLimit ?? settings.debitCardMetroAtmLimit ?? 5;
      const nonMetroLimit = card.nonMetroAtmFreeLimit ?? settings.debitCardNonMetroAtmLimit ?? 3;
      const fee = card.atmExtraFeeAmount ?? settings.debitCardExtraFeePerWithdrawal ?? 21;

      if (nonMetroUsage >= nonMetroLimit) {
        items.push({
          id: `att-debit-atm-nonmetro-${card.id}`,
          level: 'warning',
          requiresAction: false,
          title: `Free Non-Metro ATM Limit Used: ${card.name}`,
          description: `You used all ${nonMetroLimit} free non-metro ATM withdrawals this month. Use UPI or card tap to avoid the ${fee} ${card.currency} ATM fee.`,
          sourceType: 'card',
          sourceId: card.id,
          linkTab: 'liabilities',
        });
      } else if (metroUsage >= metroLimit) {
        items.push({
          id: `att-debit-atm-metro-${card.id}`,
          level: 'warning',
          requiresAction: false,
          title: `Free Metro ATM Limit Used: ${card.name}`,
          description: `You used all ${metroLimit} free metro ATM withdrawals this month. Use UPI or card tap to avoid the ${fee} ${card.currency} ATM fee.`,
          sourceType: 'card',
          sourceId: card.id,
          linkTab: 'liabilities',
        });
      } else if (totalUsage >= 3) {
        items.push({
          id: `att-debit-atm-usage3-${card.id}`,
          level: 'info',
          requiresAction: false,
          title: `ATM Withdrawals Nearing Free Limit: ${card.name}`,
          description: `Used ${totalUsage} ATM withdrawals this month. Prefer UPI for small spends to save your remaining free withdrawals.`,
          sourceType: 'card',
          sourceId: card.id,
          linkTab: 'liabilities',
        });
      }
    }

    // 5. Free Cash Safety Alert
    if (engineResult.isFreeCashAlert) {
      items.push({
        id: 'att-cash-low',
        level: 'critical',
        requiresAction: true,
        title: 'Action Needed: Bank Cash Cushion Is Low',
        description: `Available cash after upcoming dues (${formatMoney(engineResult.freeCashBase, baseCurr, currSym)}) is below your ${formatMoney(engineResult.minCashThreshold, baseCurr, currSym)} safety cushion. Pause non-essential spends.`,
        sourceType: 'cash',
        linkTab: 'assets',
        actionLabel: 'Check Cash',
      });
    }

    // 6. Loan EMI & Card Shortfall Alerts
    if (engineResult.emis30dBase > 0 && engineResult.immediateCashBase < engineResult.emis30dBase) {
      items.unshift({
        id: 'att-critical-emi-risk',
        level: 'critical',
        requiresAction: true,
        title: 'Action Needed: Bank Cash Short for Loan EMIs',
        description: `Your bank cash (${formatMoney(engineResult.immediateCashBase, baseCurr, currSym)}) is short of this month's ${formatMoney(engineResult.emis30dBase, baseCurr, currSym)} loan EMIs. Add funds before due day to avoid bounce fees.`,
        sourceType: 'card',
        linkTab: 'spend',
        actionLabel: 'Protect EMI',
      });
    } else if (
      (engineResult.emis30dBase > 0 || engineResult.cardDues30dBase > 0) &&
      engineResult.immediateCashBase < (engineResult.emis30dBase + engineResult.cardDues30dBase)
    ) {
      items.unshift({
        id: 'att-warning-debt-shortfall',
        level: 'warning',
        requiresAction: true,
        title: 'Action Needed: Cash Tight for Upcoming Bills & Cards',
        description: `Your bank cash (${formatMoney(engineResult.immediateCashBase, baseCurr, currSym)}) won't cover all upcoming EMIs and card bills (${formatMoney(engineResult.emis30dBase + engineResult.cardDues30dBase, baseCurr, currSym)}) in full.`,
        sourceType: 'card',
        linkTab: 'spend',
        actionLabel: 'Review Bills',
      });
    }

    // 7. Spending Outpacing Income
    if (engineResult.emis30dBase > 0 && engineResult.averageYearlySpendBase > 0) {
      const monthlySpend = engineResult.averageYearlySpendBase / 12;
      const monthlyIncome = engineResult.salaryYearlyIncomeBase / 12;
      if (monthlyIncome > 0 && (monthlySpend + engineResult.emis30dBase) > monthlyIncome * 1.05) {
        items.push({
          id: 'att-spend-burn-emi',
          level: 'warning',
          requiresAction: true,
          title: 'Monthly Spending + EMIs Exceed Salary',
          description: `Recent monthly spends (${formatMoney(monthlySpend, baseCurr, currSym)}) plus loan EMIs (${formatMoney(engineResult.emis30dBase, baseCurr, currSym)}) are higher than your monthly pay.`,
          sourceType: 'card',
          linkTab: 'spend',
          actionLabel: 'Trim Spends',
        });
      }
    }

    // 8. Broker & Card Fee Pattern Tip
    if (brokerUsageForecast.hasPattern && brokerUsageForecast.isUpcomingWindow) {
      const typFmt = formatMoney(brokerUsageForecast.typicalAmount, baseCurr, currSym);
      const saveFmt = formatMoney(brokerUsageForecast.potentialFeeSaved, baseCurr, currSym);
      const recFeeFmt = formatMoney(brokerUsageForecast.recommendedProjectedFee, baseCurr, currSym);
      items.push({
        id: `att-broker-forecast-${brokerUsageForecast.expectedNextDateStr}`,
        level: 'info',
        requiresAction: false,
        title: `Fee Tip for Upcoming ${brokerUsageForecast.predictedBrokerName || 'Transfer'}`,
        description:
          brokerUsageForecast.recommendedCardName && brokerUsageForecast.potentialFeeSaved > 0
            ? `If you route ~${typFmt} soon, ${brokerUsageForecast.recommendedCardName} costs about ${recFeeFmt} and saves ${saveFmt} compared to ${brokerUsageForecast.habitualSourceName || 'your usual card'}.`
            : `You usually route ~${typFmt} around ${brokerUsageForecast.expectedNextDateStr}. Check card fees first so you keep more of your money.`,
        sourceType: 'card',
        linkTab: 'insights',
        actionLabel: 'Compare Fees',
      });
    }

    // 9. Positive Reinforcement — Tell the user clearly when they are doing something good!
    const hasOverdueCard = engineResult.cardStates.some((c) => c.status === 'Overdue');
    if (!engineResult.isFreeCashAlert && !hasOverdueCard && holdings.length > 0) {
      if (engineResult.finalRateAmountPerYear > 0) {
        items.push({
          id: 'att-good-compounding',
          level: 'positive',
          requiresAction: false,
          title: `Good Work: Your Money Is Growing (+${engineResult.finalRatePct.toFixed(2)}%/yr)`,
          description: `Your investments earn ${formatMoney(engineResult.assetsYearlyReturnBase, baseCurr, currSym)}/yr — ahead of your loan interest costs.`,
          sourceType: 'cash',
          linkTab: 'insights',
          actionLabel: 'View Growth',
        });
      }
      if (totalCardLimit > 0 && (totalCardDebt / totalCardLimit) * 100 < threshold) {
        items.push({
          id: 'att-good-card-health',
          level: 'positive',
          requiresAction: false,
          title: 'Nice Move: Credit Cards Under Safe Limit',
          description: `Card usage is ${((totalCardDebt / totalCardLimit) * 100).toFixed(0)}% with zero overdue bills, keeping your credit score strong.`,
          sourceType: 'card',
          linkTab: 'liabilities',
        });
      }
    }

    // 10. SMS Bank Balance Mismatch Alerts (e.g. App Balance + Credit != SMS Reported Balance)
    for (const staged of smsStagingQueue) {
      const disc = staged.balanceDiscrepancy;
      if (!disc || disc.resolved || staged.status === 'blacklisted' || staged.status === 'rolled_back') {
        continue;
      }
      const dCurr = disc.currency || baseCurr;
      const dSym = currencies.find((c) => c.code === dCurr)?.symbol || currSym;
      items.unshift({
        id: `att-sms-bal-${staged.id}`,
        level: 'warning',
        requiresAction: true,
        title: `Investigate Balance Mismatch: ${disc.holdingName}${disc.accountLastDigits ? ` (··${disc.accountLastDigits})` : ''}`,
        description: `After ${disc.direction === 'credit' ? '+' : '-'}${formatMoney(disc.smsAmount, dCurr, dSym)}, app expected ${formatMoney(disc.expectedAppBalance, dCurr, dSym)} but SMS reported ${formatMoney(disc.smsReportedBalance, dCurr, dSym)} (diff ${disc.delta >= 0 ? '+' : ''}${formatMoney(disc.delta, dCurr, dSym)}).`,
        sourceType: 'cash',
        sourceId: disc.holdingId,
        linkTab: 'spend',
        actionLabel: 'Investigate',
      });
    }

    return items;
  }, [currencies, holdings, liabilities, engineResult, settings, brokerUsageForecast, smsStagingQueue]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const now = Date.now();
    return rawAttentionItems.filter((item) => {
      const entry = dismissedAttentionItems[item.id];
      if (!entry) return true;
      if (typeof entry === 'number') {
        return now > entry;
      }
      return false;
    });
  }, [rawAttentionItems, dismissedAttentionItems]);

  const dismissAttentionItem = (id: string) => {
    const target = rawAttentionItems.find((x) => x.id === id);
    const requiresAction = Boolean(target?.requiresAction || target?.level === 'critical');
    const wasPositive = target?.level === 'positive';

    const nextMl = recordAlertDismissalSignal({
      alertId: id,
      title: target?.title || id,
      requiresAction,
      wasPositiveMilestone: wasPositive,
    });
    setClosedLoopMLState(nextMl);

    // If action is genuinely required, resurface after 24 hours if still unresolved; otherwise discard permanently
    const nextVal: boolean | number = requiresAction ? Date.now() + 24 * 60 * 60 * 1000 : true;
    setDismissedAttentionItems((prev) => {
      const updated = { ...prev, [id]: nextVal };
      try {
        localStorage.setItem('networthiq_dismissed_attention', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const CONTINUOUS_ENGINE_KEY = 'networthiq_calc_engine_anchor';

  // Live Real-Time Compounding Ticker Value with Continuous 24/7 Engine
  const [tickerValue, setTickerValue] = useState<number>(0);
  const [continuousEngineStats, setContinuousEngineStats] = useState<ContinuousEngineStats>({
    isActive: true,
    totalAccrued: 0,
    accruedWhileClosed: 0,
    closedDurationSeconds: 0,
    lastActiveTimestamp: Date.now(),
  });

  const baselineRef = useRef<{ baseNetWorth: number; perSecond: number; timestamp: number }>({
    baseNetWorth: 0,
    perSecond: 0,
    timestamp: Date.now(),
  });

  useEffect(() => {
    const perSec = engineResult.finalRateAmountPerYear / 31536000;
    const now = Date.now();

    let storedAnchor: {
      anchorTimestamp: number;
      lastActiveTimestamp: number;
      baseNetWorth: number;
      ratePerSecond: number;
    } | null = null;

    try {
      const raw = localStorage.getItem(CONTINUOUS_ENGINE_KEY);
      if (raw) storedAnchor = JSON.parse(raw);
    } catch {}

    // Check if stored anchor base matches current calculated portfolio base
    const isSameBase = storedAnchor && Math.abs(storedAnchor.baseNetWorth - engineResult.netWorthBase) < 0.05;

    if (isSameBase && storedAnchor) {
      const totalElapsedSeconds = Math.max(0, (now - storedAnchor.anchorTimestamp) / 1000);
      const closedSeconds = Math.max(0, (now - storedAnchor.lastActiveTimestamp) / 1000);
      const accruedClosed = perSec * closedSeconds;
      const totalAccrued = perSec * totalElapsedSeconds;
      const currentCompounded = storedAnchor.baseNetWorth + totalAccrued;

      baselineRef.current = {
        baseNetWorth: storedAnchor.baseNetWorth,
        perSecond: perSec,
        timestamp: storedAnchor.anchorTimestamp,
      };
      setTickerValue(currentCompounded);

      setContinuousEngineStats({
        isActive: true,
        totalAccrued,
        accruedWhileClosed: accruedClosed,
        closedDurationSeconds: closedSeconds,
        lastActiveTimestamp: storedAnchor.lastActiveTimestamp,
      });

      // Update anchor with latest active timestamp and rate
      try {
        localStorage.setItem(
          CONTINUOUS_ENGINE_KEY,
          JSON.stringify({
            ...storedAnchor,
            lastActiveTimestamp: now,
            ratePerSecond: perSec,
          })
        );
      } catch {}
    } else {
      // Re-anchor when user edits holdings/debts or first loads
      baselineRef.current = {
        baseNetWorth: engineResult.netWorthBase,
        perSecond: perSec,
        timestamp: now,
      };
      setTickerValue(engineResult.netWorthBase);

      const newAnchor = {
        anchorTimestamp: now,
        lastActiveTimestamp: now,
        baseNetWorth: engineResult.netWorthBase,
        ratePerSecond: perSec,
      };

      try {
        localStorage.setItem(CONTINUOUS_ENGINE_KEY, JSON.stringify(newAnchor));
      } catch {}

      setContinuousEngineStats({
        isActive: true,
        totalAccrued: 0,
        accruedWhileClosed: 0,
        closedDurationSeconds: 0,
        lastActiveTimestamp: now,
      });
    }
  }, [engineResult.netWorthBase, engineResult.finalRateAmountPerYear]);

  // Track exact timestamp when the user leaves the foreground
  const backgroundEnteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    // 1. Inline Web Worker for continuous 24/7 background timer heartbeat
    // Dedicated Web Workers continue executing periodic ticks even when backgrounded.
    let worker: Worker | null = null;
    try {
      const workerBlobCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage({ type: 'tick', timestamp: Date.now() });
              }, 50);
            }
          } else if (e.data === 'stop') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([workerBlobCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);
      worker.onmessage = (e) => {
        if (e.data && e.data.type === 'tick') {
          handleTick(e.data.timestamp);
        }
      };
      worker.postMessage('start');
    } catch {
      // Fallback if Web Workers are restricted in security context
    }

    // 2. High-precision calculation ticker updater (updates every 50ms)
    const handleTick = (now: number = Date.now()) => {
      if (settings.reduceMotion) {
        setTickerValue(baselineRef.current.baseNetWorth);
        return;
      }
      const secondsElapsed = Math.max(0, (now - baselineRef.current.timestamp) / 1000);
      const current = baselineRef.current.baseNetWorth + baselineRef.current.perSecond * secondsElapsed;
      setTickerValue(current);
    };

    const mainInterval = setInterval(() => {
      handleTick(Date.now());
    }, 50);

    // 3. Heartbeat storage sync: persists lastActiveTimestamp so closing app preserves exact state
    const persistInterval = setInterval(() => {
      const now = Date.now();
      try {
        const raw = localStorage.getItem(CONTINUOUS_ENGINE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.lastActiveTimestamp = now;
          parsed.ratePerSecond = baselineRef.current.perSecond;
          localStorage.setItem(CONTINUOUS_ENGINE_KEY, JSON.stringify(parsed));
        }
      } catch {}
    }, 1000);

    // 4. Minute-level financial engine pulse for time-based advances (peer interest, loan days, credit card cycles)
    const clockInterval = setInterval(() => {
      setClockTick(Date.now());
    }, 30000);

    // 5. Seamless Background & Foreground Synchronization
    const handleVisibilityOrResume = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        // App is entering background, screen turning off, or tab switching
        backgroundEnteredAtRef.current = now;
        try {
          const raw = localStorage.getItem(CONTINUOUS_ENGINE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            parsed.lastActiveTimestamp = now;
            parsed.ratePerSecond = baselineRef.current.perSecond;
            localStorage.setItem(CONTINUOUS_ENGINE_KEY, JSON.stringify(parsed));
          }
        } catch {}
      } else {
        // App restored to foreground: calculate exact elapsed time & accrued wealth
        let lastKnownActive = backgroundEnteredAtRef.current;
        if (!lastKnownActive) {
          try {
            const raw = localStorage.getItem(CONTINUOUS_ENGINE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed.lastActiveTimestamp) {
                lastKnownActive = parsed.lastActiveTimestamp;
              }
            }
          } catch {}
        }
        const effectiveLastActive = lastKnownActive || now;
        const closedSeconds = Math.max(0, (now - effectiveLastActive) / 1000);
        const accruedClosed = baselineRef.current.perSecond * closedSeconds;
        const totalElapsed = Math.max(0, (now - baselineRef.current.timestamp) / 1000);
        const totalAccrued = baselineRef.current.perSecond * totalElapsed;
        const currentCompounded = baselineRef.current.baseNetWorth + totalAccrued;

        setTickerValue(currentCompounded);
        setContinuousEngineStats({
          isActive: true,
          totalAccrued,
          accruedWhileClosed: accruedClosed,
          closedDurationSeconds: closedSeconds,
          lastActiveTimestamp: effectiveLastActive,
        });

        // Reset background ref & trigger fresh engine calculation pulse
        backgroundEnteredAtRef.current = null;
        setClockTick(now);

        try {
          const raw = localStorage.getItem(CONTINUOUS_ENGINE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            parsed.lastActiveTimestamp = now;
            parsed.ratePerSecond = baselineRef.current.perSecond;
            localStorage.setItem(CONTINUOUS_ENGINE_KEY, JSON.stringify(parsed));
          }
        } catch {}
      }
    };

    window.addEventListener('beforeunload', handleVisibilityOrResume);
    document.addEventListener('visibilitychange', handleVisibilityOrResume);
    window.addEventListener('focus', handleVisibilityOrResume);
    window.addEventListener('pageshow', handleVisibilityOrResume);
    window.addEventListener('resume', handleVisibilityOrResume);

    return () => {
      if (worker) {
        worker.postMessage('stop');
        worker.terminate();
      }
      clearInterval(mainInterval);
      clearInterval(persistInterval);
      clearInterval(clockInterval);
      window.removeEventListener('beforeunload', handleVisibilityOrResume);
      document.removeEventListener('visibilitychange', handleVisibilityOrResume);
      window.removeEventListener('focus', handleVisibilityOrResume);
      window.removeEventListener('pageshow', handleVisibilityOrResume);
      window.removeEventListener('resume', handleVisibilityOrResume);
    };
  }, [settings.reduceMotion]);

  // Automatic Scheduled Transfers Trigger
  // Strictly waits for target calendar date (e.g. 5th of month) before executing
  useEffect(() => {
    if (!isInitialized || scheduledTransfers.length === 0) return;

    const todayDate = new Date();
    const currentYearMonth = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`;
    const todayStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;

    let hasChanges = false;
    const updatedList = [...scheduledTransfers];

    const runScheduledTransfers = async () => {
      for (let i = 0; i < updatedList.length; i++) {
        const st = updatedList[i];
        if (!st.isActive) continue;

        // Ensure nextExecutionDate is populated
        const nextDue = st.nextExecutionDate || computeNextScheduledDate(
          st.dayOfMonth,
          st.frequency,
          st.createdAt ? new Date(st.createdAt) : todayDate,
          st.lastExecutedMonth
        );

        // Strictly check if scheduled date has arrived. If not yet due, DO NOT transfer!
        const isDue = isScheduledTransferDue(st, todayDate);
        if (!isDue) {
          if (!st.nextExecutionDate || st.nextExecutionDate !== nextDue) {
            updatedList[i] = { ...st, nextExecutionDate: nextDue };
            hasChanges = true;
          }
          continue;
        }

        // Target date reached: execute transfer cleanly and professionally with ZERO tags
        const autoTx: Transaction = {
          id: `tx-sched-${Date.now()}-${i}`,
          date: todayStr,
          kind: 'transfer',
          amount: st.amount,
          currency: st.currency,
          fromId: st.fromId,
          toId: st.toId,
          reason: st.name.trim() || 'Scheduled Transfer',
          category: 'Transfer',
          fxRateUsed: 1.0,
        };

        await addTransaction(autoTx);

        // Advance to next cycle (e.g. next month or quarter)
        const nextCycleDate = computeNextScheduledDate(
          st.dayOfMonth,
          st.frequency,
          new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1),
          currentYearMonth
        );

        updatedList[i] = {
          ...st,
          lastExecutedMonth: currentYearMonth,
          lastExecutedDate: todayStr,
          nextExecutionDate: st.frequency === 'once' ? undefined : nextCycleDate,
          isActive: st.frequency === 'once' ? false : true,
        };
        hasChanges = true;
      }

      if (hasChanges) {
        setScheduledTransfers(updatedList);
        await dbStorage.setAll('scheduledTransfers', updatedList);
      }
    };

    runScheduledTransfers();
  }, [isInitialized, scheduledTransfers.length]);

  // Background On-Device SMS listener: automatically parses incoming device SMS messages
  useEffect(() => {
    if (!isInitialized) return;
    let unsubscribe: (() => void) | undefined;
    subscribeToIncomingSms((msg) => {
      if (msg && msg.body && msg.body.trim()) {
        ingestSmsMessages([msg], true);
      }
    }).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isInitialized]);

  // Snapshot Recording Engine
  const takeDailySnapshot = async () => {
    const today = new Date().toISOString().split('T')[0];
    const newSnapshot: Snapshot = {
      id: `snap-${today}`,
      date: today,
      assets: engineResult.totalAssetsBase,
      liabilities: engineResult.totalLiabilitiesBase,
      netWorth: engineResult.netWorthBase,
      finalRatePct: engineResult.finalRatePct,
      finalRateAmount: engineResult.finalRateAmountPerYear,
    };

    const updated = snapshots.filter((s) => s.date !== today).concat(newSnapshot);
    setSnapshots(updated);
    await dbStorage.setAll('snapshots', updated);
  };

  useEffect(() => {
    if (isInitialized && (holdings.length > 0 || liabilities.length > 0)) {
      takeDailySnapshot();
    }
  }, [isInitialized, engineResult.netWorthBase]);

  // CRUD Implementations
  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettingsState(updated);
    await dbStorage.setSingleton('settings', updated);
    if (newSettings.age !== undefined && newSettings.age !== careerProfile.age) {
      const nextCareer = { ...careerProfile, age: newSettings.age };
      setCareerProfile(nextCareer);
      saveCareerProfile(nextCareer);
    }
  };

  const updateTheme = async (newTheme: AppTheme) => {
    setThemeState(newTheme);
    await dbStorage.setSingleton('theme', newTheme);
  };

  const updateTaxRules = async (newRules: Partial<TaxRules>) => {
    const updated = { ...taxRules, ...newRules };
    setTaxRulesState(updated);
    await dbStorage.setSingleton('taxRules', updated);
  };

  const addCurrency = async (curr: Currency) => {
    const updated = [...currencies.filter((c) => c.code !== curr.code), curr];
    setCurrencies(updated);
    await dbStorage.put('currencies', curr);
  };

  const updateCurrency = async (curr: Currency) => {
    const updated = currencies.map((c) => (c.code === curr.code ? curr : c));
    setCurrencies(updated);
    await dbStorage.put('currencies', curr);
  };

  const deleteCurrency = async (code: string): Promise<boolean> => {
    if (code === settings.baseCurrency) return false;
    const inUse = holdings.some((h) => h.currency === code) || liabilities.some((l) => l.currency === code);
    if (inUse) return false;

    const updated = currencies.filter((c) => c.code !== code);
    setCurrencies(updated);
    await dbStorage.delete('currencies', code);
    return true;
  };

  const addHolding = async (holding: Holding) => {
    const updated = [...holdingsRef.current, holding];
    commitHoldings(updated);
    await dbStorage.put('holdings', holding);
  };

  const addHoldingsBulk = async (newHoldings: Holding[], mode: 'append' | 'replace' = 'append') => {
    const updated = mode === 'replace' ? newHoldings : [...holdingsRef.current, ...newHoldings];
    commitHoldings(updated);
    await dbStorage.setAll('holdings', updated);
  };

  const updateHolding = async (holding: Holding) => {
    const updated = holdingsRef.current.map((h) => (h.id === holding.id ? holding : h));
    commitHoldings(updated);
    await dbStorage.put('holdings', holding);
  };

  const deleteHolding = async (id: string) => {
    const updated = holdingsRef.current.filter((h) => h.id !== id);
    commitHoldings(updated);
    await dbStorage.delete('holdings', id);
  };

  const updateHoldingValuesBulk = async (
    updates: { id: string; currentPrice?: number; principalOrValue?: number }[]
  ) => {
    const map = new Map(updates.map((u) => [u.id, u]));
    const updated = holdingsRef.current.map((h) => {
      const u = map.get(h.id);
      if (!u) return h;
      return {
        ...h,
        currentPrice: u.currentPrice !== undefined ? u.currentPrice : h.currentPrice,
        principalOrValue: u.principalOrValue !== undefined ? u.principalOrValue : h.principalOrValue,
      };
    });
    commitHoldings(updated);
    await dbStorage.setAll('holdings', updated);
  };

  const sellHolding = async (saleData: Omit<SaleRecord, 'id'>) => {
    const saleRecord: SaleRecord = {
      ...saleData,
      id: `sale-${Date.now()}`,
    };
    const updatedSales = [...sales, saleRecord];
    setSales(updatedSales);
    await dbStorage.put('sales', saleRecord);

    if (saleData.assetId) {
      const h = holdingsRef.current.find((x) => x.id === saleData.assetId);
      if (h) {
        if (h.units && h.units > saleData.unitsSold) {
          const remainingUnits = h.units - saleData.unitsSold;
          const updatedH: Holding = {
            ...h,
            units: remainingUnits,
            principalOrValue: remainingUnits * (h.currentPrice || h.avgBuyPrice || 0),
          };
          await updateHolding(updatedH);
        } else {
          await deleteHolding(h.id);
        }
      }
    }

    if (saleData.depositAccountId) {
      const depAcc = holdingsRef.current.find((x) => x.id === saleData.depositAccountId);
      if (depAcc) {
        const netCashReceived = saleData.sellPrice * saleData.unitsSold - saleData.brokerageSell;
        await updateHolding({
          ...depAcc,
          principalOrValue: (depAcc.principalOrValue || 0) + netCashReceived,
        });
      }
    }

    const netCash = saleData.sellPrice * saleData.unitsSold - saleData.brokerageSell;
    const tx: Transaction = {
      id: `tx-sale-${Date.now()}`,
      date: saleData.sellDate,
      kind: 'saleProceeds',
      amount: netCash,
      currency: saleData.currency,
      toId: saleData.depositAccountId,
      reason: `Sale proceeds: ${saleData.assetName} (${saleData.unitsSold} units)`,
      category: 'Investments',
      fxRateUsed: saleData.fxRate,
    };
    await addTransaction(tx);
  };

  const addAssetType = async (type: AssetType) => {
    const updated = [...assetTypes, type];
    setAssetTypes(updated);
    await dbStorage.put('assetTypes', type);
  };

  const updateAssetType = async (type: AssetType) => {
    const updated = assetTypes.map((t) => (t.id === type.id ? type : t));
    setAssetTypes(updated);
    await dbStorage.put('assetTypes', type);
  };

  const deleteAssetType = async (id: string) => {
    const updated = assetTypes.filter((t) => t.id !== id);
    setAssetTypes(updated);
    await dbStorage.delete('assetTypes', id);
  };

  const addLiability = async (liability: Liability) => {
    const updated = [...liabilitiesRef.current, liability];
    commitLiabilities(updated);
    await dbStorage.put('liabilities', liability);

    // Synchronize linked debt payoff goals to keep loan goal and loan EMI identical
    if (liability.kind === 'loan' && liability.monthlyEmi) {
      const linkedGoals = goals.filter(
        (g) =>
          g.targetLiabilityId === liability.id ||
          (g.goalType === 'debt_payoff' && g.name.toLowerCase().includes(liability.name.toLowerCase()))
      );
      for (const g of linkedGoals) {
        if (g.monthlyContribution !== liability.monthlyEmi || g.cost !== liability.outstanding) {
          const syncGoal: Goal = {
            ...g,
            targetLiabilityId: liability.id,
            cost: liability.outstanding,
            monthlyContribution: liability.monthlyEmi,
          };
          setGoals((prev) => prev.map((item) => (item.id === syncGoal.id ? syncGoal : item)));
          await dbStorage.put('goals', syncGoal);
        }
      }
    }
  };

  const addLiabilitiesBulk = async (newLiabilities: Liability[], mode: 'append' | 'replace' = 'append') => {
    const updated = mode === 'replace' ? newLiabilities : [...liabilitiesRef.current, ...newLiabilities];
    commitLiabilities(updated);
    await dbStorage.setAll('liabilities', updated);
  };

  const updateLiability = async (liability: Liability) => {
    const updated = liabilitiesRef.current.map((l) => (l.id === liability.id ? liability : l));
    commitLiabilities(updated);
    await dbStorage.put('liabilities', liability);

    // Synchronize linked debt payoff goals to keep loan goal and loan EMI identical
    if (liability.kind === 'loan') {
      const linkedGoals = goals.filter(
        (g) =>
          g.targetLiabilityId === liability.id ||
          (g.goalType === 'debt_payoff' && g.name.toLowerCase().includes(liability.name.toLowerCase()))
      );
      for (const g of linkedGoals) {
        const targetMonthly = liability.monthlyEmi || g.monthlyContribution;
        if (g.monthlyContribution !== targetMonthly || g.cost !== liability.outstanding) {
          const syncGoal: Goal = {
            ...g,
            targetLiabilityId: liability.id,
            cost: liability.outstanding,
            monthlyContribution: targetMonthly,
          };
          setGoals((prev) => prev.map((item) => (item.id === syncGoal.id ? syncGoal : item)));
          await dbStorage.put('goals', syncGoal);
        }
      }
    }
  };

  const deleteLiability = async (id: string) => {
    const updated = liabilitiesRef.current.filter((l) => l.id !== id);
    commitLiabilities(updated);
    await dbStorage.delete('liabilities', id);
  };

  const recordTransactionOnly = async (tx: Transaction) => {
    const stampedTx: Transaction = {
      ...tx,
      createdAt: tx.createdAt || new Date().toISOString(),
    };
    const updated = [stampedTx, ...transactionsRef.current];
    commitTransactions(updated);
    await dbStorage.put('transactions', stampedTx);
  };

  const payCard = async (cardId: string, fromAccountId: string, amount: number) => {
    await payCardWithCashback(cardId, fromAccountId, amount, 0);
  };

  // Determines dynamic mode for Hybrid Cards based on linked bank balance:
  // Positive (> 0) linked bank account balance => Debit Card mode.
  // Zero or non-positive (<= 0) linked bank account balance => Credit Card mode.
  const getCardEffectiveMode = (card: Liability): 'credit' | 'debit' => {
    if (card.cardType === 'debit') return 'debit';
    if (card.cardType === 'hybrid') {
      const list = holdingsRef.current.length > 0 ? holdingsRef.current : holdings;
      const linked = list.find((h) => h.id === card.linkedAccountId);
      const linkedBal = linked ? getHoldingLocalValue(linked) : 0;
      return linkedBal > 0 ? 'debit' : 'credit';
    }
    return 'credit';
  };

  const logCardCashback = async (cardId: string, amount: number, note?: string) => {
    const card = liabilitiesRef.current.find((l) => l.id === cardId);
    if (!card || amount <= 0) return;
    const newCashback = (card.accumulatedCashback || 0) + amount;
    const updatedCard: Liability = {
      ...card,
      accumulatedCashback: newCashback,
    };
    await updateLiability(updatedCard);

    const tx: Transaction = {
      id: `tx-cashback-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      kind: 'income',
      amount,
      currency: card.currency,
      toId: card.id,
      reason: `Cashback Earned on ${card.name}${note ? `: ${note}` : ''}`,
      category: 'Rewards & Cashback',
      tags: ['Cashback'],
      fxRateUsed: 1.0,
      notes: `Logged +${amount} ${card.currency} cashback on ${card.name}. Total accumulated cashback to reduce next bill: ${newCashback} ${card.currency}.`,
    };
    await recordTransactionOnly(tx);
  };

  const payCardWithCashback = async (
    cardId: string,
    fromAccountId: string,
    actualPaidAmount: number,
    cashbackToApply: number = 0
  ): Promise<{ success: boolean; error?: string }> => {
    const card = liabilitiesRef.current.find((l) => l.id === cardId);
    if (!card) return { success: false, error: 'Card liability not found.' };

    if (liabilitiesRef.current.some((l) => l.id === fromAccountId)) {
      return {
        success: false,
        error: 'Credit card bills cannot be paid using another card or credit limit. Select a positive liquid bank or cash account.',
      };
    }

    const bank = holdingsRef.current.find((h) => h.id === fromAccountId);
    if (!bank) return { success: false, error: 'Source bank account not found.' };

    if (isLockedOrMarketAsset(bank, assetTypes)) {
      return {
        success: false,
        error: `Locked or market-linked holdings ("${getSafeAssetName(bank, assetTypes)}") cannot be used to pay card bills. Select a positive liquid cash or bank account.`,
      };
    }

    const bankBal = bank.principalOrValue || 0;
    const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(bank.id, holdingsRef.current);

    if (actualPaidAmount > 0 && bankBal <= 0 && totalSweepIn <= 0) {
      return {
        success: false,
        error: `Source account "${getSafeAssetName(bank, assetTypes)}" has a non-positive balance (${bankBal.toLocaleString()}). Card bills can only be settled from positive liquid cash or linked Sweep-In FDs.`,
      };
    }

    if (totalAvailable < actualPaidAmount) {
      return {
        success: false,
        error: `Insufficient liquid funds in ${getSafeAssetName(bank, assetTypes)}. Available: ${bankBal.toLocaleString()} (+ ${totalSweepIn.toLocaleString()} in Sweep-in FDs = ${totalAvailable.toLocaleString()} total), but actual payment requires: ${actualPaidAmount.toLocaleString()}.`,
      };
    }

    if (bankBal < actualPaidAmount) {
      const deficit = actualPaidAmount - Math.max(0, bankBal);
      const sweepRes = await breakSweepInForDeficit(bank.id, deficit, `Credit Card Statement: ${card.name}`);
      if (!sweepRes.success) return { success: false, error: sweepRes.error };
    }

    // Deduct actual paid amount from live bank account balance (which now includes any swept-in deficit)
    const curBank = holdingsRef.current.find((h) => h.id === fromAccountId) || bank;
    const newBankBal = Math.max(0, (curBank.principalOrValue || 0) - actualPaidAmount);
    await updateHolding({ ...curBank, principalOrValue: newBankBal });

    // Reduce card outstanding by total relief (cash paid + cashback applied)
    const liveCard = liabilitiesRef.current.find((l) => l.id === cardId) || card;
    const totalCreditRelief = actualPaidAmount + cashbackToApply;
    const newOutstanding = Math.max(0, (liveCard.outstanding || 0) - totalCreditRelief);
    const newCashback = Math.max(0, (liveCard.accumulatedCashback || 0) - cashbackToApply);

    let updatedStatements = liveCard.statements;
    if (updatedStatements && updatedStatements.length > 0) {
      updatedStatements = updatedStatements.map((s, idx) => {
        if (idx === 0) {
          return {
            ...s,
            paidAmount: s.amount,
            actualPaidInLedger: actualPaidAmount,
            cashbackApplied: cashbackToApply,
            netPayableAmount: Math.max(0, s.amount - cashbackToApply),
          };
        }
        return s;
      });
    }

    const updatedCard: Liability = {
      ...liveCard,
      outstanding: newOutstanding,
      accumulatedCashback: newCashback,
      statements: updatedStatements,
    };
    await updateLiability(updatedCard);

    // Record in transaction ledger without re-mutating balances
    const txId = `tx-stmtpay-${Date.now()}`;
    const billedAmt = liveCard.outstanding || actualPaidAmount;
    const tx: Transaction = {
      id: txId,
      date: new Date().toISOString().split('T')[0],
      kind: 'cardPayment',
      amount: actualPaidAmount,
      currency: liveCard.currency,
      fromId: fromAccountId,
      toId: liveCard.id,
      reason: `Credit Card Bill Paid: ${liveCard.name} (Paid: ${actualPaidAmount}${cashbackToApply > 0 ? `, Cashback: -${cashbackToApply}` : ''})`,
      category: 'Bills',
      tags: ['Statement Paid', ...(cashbackToApply > 0 ? ['Cashback Applied'] : [])],
      fxRateUsed: 1.0,
      notes: `Original Billed: ${billedAmt}. Reduced Statement Payable: ${Math.max(0, billedAmt - cashbackToApply)}. Actual Paid: ${actualPaidAmount}. Cashback Applied: ${cashbackToApply}. Remaining Card Outstanding: ${newOutstanding}.`,
    };
    await recordTransactionOnly(tx);

    // Tune ML model based on user payment fidelity & cashback yield
    try {
      const mlKey = 'networthiq_ml_investment_weights';
      const stored = localStorage.getItem(mlKey);
      const currentWeights = stored ? JSON.parse(stored) : { debtPayoffWeight: 40, iteration: 1 };
      const paymentRatio = billedAmt > 0 ? actualPaidAmount / Math.max(1, billedAmt - cashbackToApply) : 1.0;

      const newDebtWeight = Math.min(85, Math.max(20, (currentWeights.debtPayoffWeight || 40) + (paymentRatio >= 0.99 ? 2 : -2)));
      const newWeights = {
        ...currentWeights,
        debtPayoffWeight: newDebtWeight,
        iteration: (currentWeights.iteration || 1) + 1,
        lastTunedDate: new Date().toISOString(),
      };
      localStorage.setItem(mlKey, JSON.stringify(newWeights));
    } catch (e) {
      console.warn('ML statement update error:', e);
    }

    // Closed-loop ML reality check on Card Full vs Partial/Revolving settlement
    const preAssessment = assessCardFullVsEmiByCashFlow({
      card: liveCard,
      holdings: holdingsRef.current,
      assetTypes,
      currencies,
      settings,
      cashFlowForecast,
      goals,
      closedLoopState: closedLoopMLState,
    });
    const fxToBase = currencies.find((c) => c.code === liveCard.currency)?.rateToBase || 1;
    const reducedTarget = Math.max(0, billedAmt - cashbackToApply);
    const settledInFull = actualPaidAmount >= reducedTarget - 1;

    if (settledInFull) {
      const nextMl = recordBehavioralOutcomeAndRetrain({
        domain: 'debt_strategy',
        subEventLabel: `Full Card Settlement: ${liveCard.name}`,
        ledgerRefId: `cardpay-ml-${txId}`,
        predictedSummary: `Pay ${reducedTarget.toLocaleString()} ${liveCard.currency} in full (0 interest/fee)`,
        actualRealitySummary: `Settled ${actualPaidAmount.toLocaleString()} ${liveCard.currency}${cashbackToApply > 0 ? ` + ${cashbackToApply.toLocaleString()} cashback` : ''} in full`,
        wasSuccess: true,
        partialSuccess: false,
        microSavedBase: Math.max(10, (preAssessment.avoidableEmiLoss + cashbackToApply) * fxToBase),
        isDebtPrepaySignal: true,
      });
      setClosedLoopMLState(nextMl);
    } else if (preAssessment.canAffordFullWithoutDeficit) {
      const unpaidRemainder = Math.max(0, reducedTarget - actualPaidAmount);
      const monthlyRate = (liveCard.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5) / 100;
      const monthlyInterestLeak = Math.round(unpaidRemainder * monthlyRate);
      const nextMl = recordBehavioralOutcomeAndRetrain({
        domain: 'debt_strategy',
        subEventLabel: `Partial Card Payment Despite Sufficient Cash: ${liveCard.name}`,
        ledgerRefId: `cardpay-ml-${txId}`,
        predictedSummary: `Cash flow covered full ${reducedTarget.toLocaleString()} ${liveCard.currency} at 0 fee`,
        actualRealitySummary: `Paid ${actualPaidAmount.toLocaleString()} ${liveCard.currency}; left ${unpaidRemainder.toLocaleString()} revolving (~${monthlyInterestLeak.toLocaleString()}/mo interest)`,
        wasSuccess: false,
        microSavedBase: 0,
        avoidableCostOrDeltaBase: Math.max(monthlyInterestLeak, preAssessment.avoidableEmiLoss) * fxToBase,
        isDebtPrepaySignal: false,
      });
      setClosedLoopMLState(nextMl);
    }

    return { success: true };
  };

  const convertCardToEmi = async (
    cardId: string,
    params: {
      conversionAmount: number;
      tenureMonths: number;
      annualRatePct: number;
      processingFee: number;
      gstPct?: number;
    }
  ): Promise<{ success: boolean; error?: string; createdLoanId?: string }> => {
    const card = liabilitiesRef.current.find((l) => l.id === cardId && l.kind === 'card');
    if (!card) return { success: false, error: 'Card not found.' };

    const convAmt = Math.min(card.outstanding || 0, Math.max(0, params.conversionAmount));
    if (convAmt <= 0) {
      return { success: false, error: 'Conversion amount must be greater than zero.' };
    }

    // Assess cash flow BEFORE mutating balances so closed-loop retraining knows if EMI was avoidable
    const preAssessment = assessCardFullVsEmiByCashFlow({
      card,
      holdings: holdingsRef.current,
      assetTypes,
      currencies,
      settings,
      cashFlowForecast,
      goals,
      closedLoopState: closedLoopMLState,
      overrideConversionAmount: convAmt,
      emiOptions: {
        tenureMonths: params.tenureMonths,
        customAnnualRatePct: params.annualRatePct,
        customProcessingFee: params.processingFee,
        applicableGstPct: params.gstPct ?? 18,
      },
    });

    const comp = compareCreditCardEmiVsFullPayment(card, convAmt, {
      tenureMonths: params.tenureMonths,
      customAnnualRatePct: params.annualRatePct,
      customProcessingFee: params.processingFee,
      applicableGstPct: params.gstPct ?? 18,
    });

    const upfrontFeeWithTax = Math.round((comp.processingFee + comp.processingFeeGst) * 100) / 100;
    const remainingCardOut = Math.max(0, safeSub(card.outstanding || 0, convAmt)) + upfrontFeeWithTax;

    await updateLiability({
      ...card,
      outstanding: remainingCardOut,
    });

    const newLoanId = `loan-cc-emi-${Date.now()}`;
    const todayStr = new Date().toISOString().split('T')[0];
    const newInstallmentLoan: Liability = {
      id: newLoanId,
      name: `${card.name} EMI (${params.tenureMonths}m)`,
      kind: 'loan',
      currency: card.currency,
      outstanding: convAmt,
      ratePct: params.annualRatePct,
      monthlyEmi: comp.monthlyEmi,
      tenureMonths: params.tenureMonths,
      startDate: todayStr,
      emiDay: card.statementDay || 10,
      linkedAccountId: card.linkedAccountId,
      prepaymentPenaltyPct: 3,
      prepaymentPolicy: {
        mode: 'flat_rate',
        lockInMonths: 0,
        feeBasis: 'existing_principal',
        flatPenaltyPct: 3,
        applicableTaxPct: params.gstPct ?? 18,
        isConfigured: true,
      },
    };
    await addLiability(newInstallmentLoan);

    const txId = `tx-cc-emiconv-${Date.now()}`;
    if (upfrontFeeWithTax > 0) {
      await recordTransactionOnly({
        id: txId,
        date: todayStr,
        createdAt: new Date().toISOString(),
        kind: 'spend',
        amount: upfrontFeeWithTax,
        currency: card.currency,
        fromId: card.id,
        reason: `Card EMI Conversion Fee + GST: ${card.name} (${params.tenureMonths}m)`,
        category: 'Bills',
        tags: ['EMI Conversion Fee'],
        fxRateUsed: 1.0,
      });
    }

    const fxToBase = currencies.find((c) => c.code === card.currency)?.rateToBase || 1;
    if (preAssessment.canAffordFullWithoutDeficit) {
      // System failed to persuade user to pay in full despite sufficient cash flow -> escalate to try even harder!
      const nextMl = recordBehavioralOutcomeAndRetrain({
        domain: 'debt_strategy',
        subEventLabel: `Converted Card to EMI Despite Sufficient Cash: ${card.name}`,
        ledgerRefId: `cc-emi-fail-${txId}`,
        predictedSummary: `Cash flow supported full ${convAmt.toLocaleString()} ${card.currency} settlement (save ${comp.additionalCostOfEmi.toLocaleString()} ${card.currency})`,
        actualRealitySummary: `Converted ${convAmt.toLocaleString()} ${card.currency} to ${params.tenureMonths}m EMI at ${params.annualRatePct}% (+${comp.additionalCostOfEmi.toLocaleString()} ${card.currency} fee & interest cost)`,
        wasSuccess: false,
        microSavedBase: 0,
        avoidableCostOrDeltaBase: comp.additionalCostOfEmi * fxToBase,
        isDebtPrepaySignal: false,
      });
      setClosedLoopMLState(nextMl);
    } else {
      // Cash flow was genuinely constrained -> structured EMI protected against ~42% revolving penalty
      const avoidedRevolvingLocal = Math.max(0, preAssessment.monthlyRevolvingLoss * Math.min(3, params.tenureMonths) - comp.additionalCostOfEmi);
      const nextMl = recordBehavioralOutcomeAndRetrain({
        domain: 'debt_strategy',
        subEventLabel: `Cash-Constrained Structured EMI Shield: ${card.name}`,
        ledgerRefId: `cc-emi-shield-${txId}`,
        predictedSummary: `Protect tight 30-day cash flow from revolving overdue penalties`,
        actualRealitySummary: `Structured ${convAmt.toLocaleString()} ${card.currency} into ${params.tenureMonths}m EMI`,
        wasSuccess: true,
        partialSuccess: true,
        microSavedBase: Math.max(10, avoidedRevolvingLocal * fxToBase),
        isDebtPrepaySignal: true,
      });
      setClosedLoopMLState(nextMl);
    }

    return { success: true, createdLoanId: newLoanId };
  };

  // Helper to compute available liquidity for an asset including strictly linked Sweep-In FDs (always reads live ref by default)
  const getAccountLiquidityWithSweepIn = (holdingId: string, currentHoldings?: Holding[]) => {
    const list = currentHoldings || holdingsRef.current;
    const targetAsset = list.find((h) => h.id === holdingId);
    if (!targetAsset) return { asset: undefined, balance: 0, sweepInFds: [], totalSweepIn: 0, totalAvailable: 0 };
    const balance = targetAsset.principalOrValue || 0;
    const bankCountInCurrency = list.filter(
      (h) => (h.typeId === 'type-bank' || h.typeId === 'type-cash') && h.currency === targetAsset.currency
    ).length;

    const sweepInFds = list
      .filter(
        (h) =>
          Boolean(h.isSweepIn) &&
          (h.sweepInTargetAccountId
            ? h.sweepInTargetAccountId === targetAsset.id
            : bankCountInCurrency <= 1 && h.currency === targetAsset.currency) &&
          (h.principalOrValue || 0) > 0 &&
          h.id !== targetAsset.id
      )
      .sort((a, b) => {
        // LIFO Order: Latest created FD broken first
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : a.startDate ? new Date(a.startDate).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : b.startDate ? new Date(b.startDate).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return b.id.localeCompare(a.id);
      });

    const totalSweepIn = sweepInFds.reduce((sum, fd) => sum + (fd.principalOrValue || 0), 0);
    const totalAvailable = Math.max(0, balance) + totalSweepIn;
    return { asset: targetAsset, balance, sweepInFds, totalSweepIn, totalAvailable };
  };

  // Deducts extra amount from sweep-in FDs in strict LIFO order (latest created FD first) and credits the linked bank account synchronously
  const breakSweepInForDeficit = async (
    bankAccountId: string,
    deficit: number,
    purpose: string = 'Bill Payment'
  ): Promise<{
    success: boolean;
    totalDeducted: number;
    brokenFds: { fdId: string; fdName: string; amount: number; remaining: number }[];
    error?: string;
  }> => {
    if (deficit <= 0) {
      return { success: true, totalDeducted: 0, brokenFds: [] };
    }

    const liveHoldings = holdingsRef.current;
    const targetAccount = liveHoldings.find((h) => h.id === bankAccountId);
    if (!targetAccount) {
      return { success: false, totalDeducted: 0, brokenFds: [], error: 'Bank account not found' };
    }

    const { sweepInFds, totalSweepIn } = getAccountLiquidityWithSweepIn(targetAccount.id, liveHoldings);
    if (totalSweepIn < deficit) {
      return {
        success: false,
        totalDeducted: 0,
        brokenFds: [],
        error: `Insufficient sweep-in funds. Required deficit: ${deficit.toLocaleString()}, but total available in sweep-in FDs is: ${totalSweepIn.toLocaleString()}`,
      };
    }

    let remainingDeficit = deficit;
    const brokenFds: { fdId: string; fdName: string; amount: number; remaining: number }[] = [];
    const updatedHoldingsMap = new Map(liveHoldings.map((h) => [h.id, h]));
    const todayStr = new Date().toISOString().split('T')[0];
    const newTxs: Transaction[] = [];

    // sweepInFds is sorted in LIFO order (latest created FD first)
    for (const fd of sweepInFds) {
      if (remainingDeficit <= 0) break;
      const currentFd = updatedHoldingsMap.get(fd.id) || fd;
      const fdBal = currentFd.principalOrValue || 0;
      if (fdBal <= 0) continue;

      const breakAmt = Math.min(remainingDeficit, fdBal);
      const remainingFdBal = fdBal - breakAmt;
      const isMatured = remainingFdBal <= 0;

      const updatedFd: Holding = {
        ...currentFd,
        principalOrValue: remainingFdBal,
        isMatured: isMatured ? true : currentFd.isMatured,
      };
      updatedHoldingsMap.set(fd.id, updatedFd);

      brokenFds.push({
        fdId: fd.id,
        fdName: fd.name,
        amount: breakAmt,
        remaining: remainingFdBal,
      });

      const sweepTx: Transaction = {
        id: `tx-sweep-break-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        date: todayStr,
        kind: 'transfer',
        amount: breakAmt,
        currency: targetAccount.currency,
        fromId: fd.id,
        toId: targetAccount.id,
        reason: `Sweep-in Auto-Break (${purpose}): ${fd.name} to ${targetAccount.name}`,
        category: 'Transfer',
        tags: ['Sweep-in'],
        fxRateUsed: 1.0,
        notes: `Auto-deducted ${breakAmt.toLocaleString()} ${targetAccount.currency} from Sweep-In FD "${fd.name}" to cover deficit for ${purpose}. Remaining FD balance: ${remainingFdBal.toLocaleString()} ${fd.currency}.`,
      };
      newTxs.push(sweepTx);

      remainingDeficit -= breakAmt;
    }

    // Credit the target bank account with the broken sweep-in cash
    const totalRecovered = deficit - remainingDeficit;
    const curTarget = updatedHoldingsMap.get(targetAccount.id) || targetAccount;
    const newTargetBal = (curTarget.principalOrValue || 0) + totalRecovered;
    const updatedTarget: Holding = {
      ...curTarget,
      principalOrValue: newTargetBal,
      isOverdraftActive: newTargetBal < 0,
      overdraftAmount: newTargetBal < 0 ? Math.abs(newTargetBal) : 0,
      overdraftAt: newTargetBal < 0 ? curTarget.overdraftAt : undefined,
    };
    updatedHoldingsMap.set(targetAccount.id, updatedTarget);

    // Commit synchronously BEFORE awaiting IndexedDB so any subsequent caller in the same tick sees the exact updated balances
    const allUpdatedHoldings = Array.from(updatedHoldingsMap.values());
    commitHoldings(allUpdatedHoldings);
    commitTransactions([...newTxs, ...transactionsRef.current]);

    for (const bfd of brokenFds) {
      const hObj = updatedHoldingsMap.get(bfd.fdId);
      if (hObj) await dbStorage.put('holdings', hObj);
    }
    await dbStorage.put('holdings', updatedTarget);
    for (const stx of newTxs) {
      await dbStorage.put('transactions', stx);
    }

    return {
      success: true,
      totalDeducted: totalRecovered,
      brokenFds,
    };
  };

  // Breaks sweep-in FDs in LIFO order to offset deficit on a negative bank account holding
  const autoBreakSweepInForAccount = async (bankAccountId: string) => {
    const liveHoldings = holdingsRef.current;
    const target = liveHoldings.find((h) => h.id === bankAccountId);
    if (!target || (target.principalOrValue || 0) >= 0) return;

    let deficit = Math.abs(target.principalOrValue || 0);
    const { sweepInFds } = getAccountLiquidityWithSweepIn(target.id, liveHoldings);
    if (sweepInFds.length === 0 || deficit <= 0) return;

    const updatedHoldingsMap = new Map(liveHoldings.map((h) => [h.id, h]));
    let recoveredTotal = 0;
    const todayStr = new Date().toISOString().split('T')[0];
    const newTxs: Transaction[] = [];

    for (const fd of sweepInFds) {
      if (deficit <= 0) break;
      const currentFd = updatedHoldingsMap.get(fd.id) || fd;
      const fdBal = currentFd.principalOrValue || 0;
      if (fdBal <= 0) continue;

      const breakAmt = Math.min(deficit, fdBal);
      const remainingFdBal = fdBal - breakAmt;
      const updatedFd: Holding = {
        ...currentFd,
        principalOrValue: remainingFdBal,
        isMatured: remainingFdBal <= 0 ? true : currentFd.isMatured,
      };
      updatedHoldingsMap.set(fd.id, updatedFd);

      deficit -= breakAmt;
      recoveredTotal += breakAmt;

      const tx: Transaction = {
        id: `tx-sweep-break-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        date: todayStr,
        kind: 'transfer',
        amount: breakAmt,
        currency: target.currency,
        fromId: fd.id,
        toId: target.id,
        reason: `Sweep-in Settlement: ${fd.name} to ${target.name}`,
        category: 'Transfer',
        tags: ['Sweep-in'],
        fxRateUsed: 1.0,
        notes: `Auto-broken from sweep-in FD "${fd.name}" to offset negative balance on "${target.name}". Remaining FD balance: ${remainingFdBal.toLocaleString()} ${fd.currency}.`,
      };
      newTxs.push(tx);
    }

    const currentTarget = updatedHoldingsMap.get(target.id) || target;
    const finalBal = (currentTarget.principalOrValue || 0) + recoveredTotal;
    const updatedTarget: Holding = {
      ...currentTarget,
      principalOrValue: finalBal,
      isOverdraftActive: finalBal < 0,
      overdraftAmount: finalBal < 0 ? Math.abs(finalBal) : 0,
      overdraftAt: finalBal < 0 ? currentTarget.overdraftAt : undefined,
    };
    updatedHoldingsMap.set(target.id, updatedTarget);

    const allUpdated = Array.from(updatedHoldingsMap.values());
    commitHoldings(allUpdated);
    commitTransactions([...newTxs, ...transactionsRef.current]);

    await dbStorage.setAll('holdings', allUpdated);
    for (const tx of newTxs) {
      await dbStorage.put('transactions', tx);
    }
  };

  const triggerSweepInAutoBreak = async (bankAccountId?: string) => {
    if (bankAccountId) {
      await autoBreakSweepInForAccount(bankAccountId);
    } else {
      const negativeAccounts = holdingsRef.current.filter((h) => (h.principalOrValue || 0) < 0);
      for (const acc of negativeAccounts) {
        await autoBreakSweepInForAccount(acc.id);
      }
    }
  };

  // Auto-offset any negative bank account that has active sweep-in FDs available
  useEffect(() => {
    const checkNegativeOverdraftAccounts = () => {
      const negativeAccounts = holdingsRef.current.filter((h) => (h.principalOrValue || 0) < 0);
      for (const acc of negativeAccounts) {
        const { totalSweepIn } = getAccountLiquidityWithSweepIn(acc.id, holdingsRef.current);
        if (totalSweepIn > 0) {
          autoBreakSweepInForAccount(acc.id);
        }
      }
    };

    checkNegativeOverdraftAccounts();

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    const msUntilMidnight = Math.max(1000, nextMidnight.getTime() - now.getTime());

    const midnightTimer = setTimeout(() => {
      checkNegativeOverdraftAccounts();
    }, msUntilMidnight);

    return () => {
      clearTimeout(midnightTimer);
    };
  }, [holdings]);

  const predictLoanPayment = (loanId: string): PredictedLoanPaymentPlan | null => {
    const targetLoan = liabilitiesRef.current.find((l) => l.id === loanId && l.kind === 'loan');
    if (!targetLoan) return null;
    return predictOptimalLoanPaymentPlan({
      loan: targetLoan,
      liabilities: liabilitiesRef.current,
      holdings: holdingsRef.current,
      assetTypes,
      goals,
      currencies,
      settings,
      freeCashBase: engineResult.freeCashBase,
      transactions: transactionsRef.current,
      closedLoopState: closedLoopMLState,
    });
  };

  const recordStrategyOutcome = (params: {
    domain: RealityCheckDomain;
    subEventLabel: string;
    ledgerRefId: string;
    predictedSummary: string;
    actualRealitySummary: string;
    wasSuccess: boolean;
    partialSuccess?: boolean;
    microSavedBase: number;
    avoidableCostOrDeltaBase?: number;
  }) => {
    const nextMl = recordBehavioralOutcomeAndRetrain(params);
    setClosedLoopMLState(nextMl);
  };

  const payLoan = async (
    loanId: string,
    fromAssetId: string,
    amount: number,
    options?: {
      isEmi?: boolean;
      updatedRatePct?: number;
      prepaymentPenaltyCharge?: number;
      updatedMonthlyEmi?: number;
      updatedTenureMonths?: number;
      bypassStrategyEnforcement?: boolean;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    const loan = liabilitiesRef.current.find((l) => l.id === loanId);
    if (!loan) return { success: false, error: 'Target loan liability not found.' };

    if (liabilitiesRef.current.some((l) => l.id === fromAssetId)) {
      return {
        success: false,
        error: 'Loan EMIs and debt obligations cannot be paid with a credit card or credit limit. Select a positive liquid cash or bank account.',
      };
    }

    const asset = holdingsRef.current.find((h) => h.id === fromAssetId);
    if (!asset) return { success: false, error: 'Source asset holding not found.' };

    if (isLockedOrMarketAsset(asset, assetTypes)) {
      return {
        success: false,
        error: `Locked or market-linked holdings ("${getSafeAssetName(asset, assetTypes)}") cannot be used to pay loan EMIs or debt obligations. Select a positive liquid cash or bank account.`,
      };
    }

    const availableBalance = asset.principalOrValue || 0;
    if (amount <= 0) {
      return { success: false, error: 'Payment amount must be greater than zero.' };
    }

    // Capture ML-predicted optimal plan BEFORE mutating balances so reality audit is exact
    const predictedPlan = predictOptimalLoanPaymentPlan({
      loan,
      liabilities: liabilitiesRef.current,
      holdings: holdingsRef.current,
      assetTypes,
      goals,
      currencies,
      settings,
      freeCashBase: engineResult.freeCashBase,
      transactions: transactionsRef.current,
      closedLoopState: closedLoopMLState,
    });

    // Check if scheduled EMI was already settled this month
    const curMonthStr = new Date().toISOString().substring(0, 7);
    const wasAlreadyPaidThisMonth = transactionsRef.current.some(
      (t) =>
        !t.isReversed &&
        t.toId === loan.id &&
        (t.kind === 'emi' || t.kind === 'transfer') &&
        t.date.startsWith(curMonthStr)
    );

    // Enforce loan prepayment lock-in & compute prepayment penalty for non-EMI principal prepayments.
    // If the loan was already paid for the month, ANY further payment is an extra prepayment subject to charges!
    const isExtraPrepayment = !options?.isEmi || wasAlreadyPaidThisMonth;
    if (isExtraPrepayment) {
      const lockStatus = getLoanLockInStatus(loan);
      if (lockStatus.isLockedIn) {
        return {
          success: false,
          error: `Loan "${loan.name}" is in its ${lockStatus.lockInMonths}-month prepayment lock-in period (${lockStatus.monthsRemaining} month(s) remaining${lockStatus.unlockDateStr ? ` until ${lockStatus.unlockDateStr}` : ''}).${
            wasAlreadyPaidThisMonth
              ? " This month's scheduled EMI is already settled, and early prepayment is locked."
              : ' Only regular scheduled EMI payments are permitted right now.'
          }`,
        };
      }
    }

    const penaltyCharge = isExtraPrepayment
      ? Math.max(
          0,
          options?.prepaymentPenaltyCharge !== undefined
            ? options.prepaymentPenaltyCharge
            : calculateLoanPrepaymentCharge(loan, amount).totalPenaltyWithTax
        )
      : 0;

    // Enforce Prepayment Charge Strategy if user enabled `enforcePrepaymentStrategy`
    const actualSim = isExtraPrepayment
      ? simulateLoanPrepayment(loan, amount, {
          maintainTenureReduceEmi: Boolean(options?.updatedMonthlyEmi && options.updatedMonthlyEmi > 0),
        })
      : null;

    if (
      isExtraPrepayment &&
      settings.enforcePrepaymentStrategy &&
      !options?.bypassStrategyEnforcement &&
      penaltyCharge > 0
    ) {
      if (wasAlreadyPaidThisMonth) {
        return {
          success: false,
          error: `Strategy Guard Active: "${loan.name}" EMI was already settled this month. Paying again now incurs an avoidable ${penaltyCharge.toLocaleString()} ${loan.currency} prepayment fee. Settle next month or disable Strategy Guard to override.`,
        };
      }
      if (predictedPlan.isHigherFeeThanAlternative && predictedPlan.betterAlternativeDebtName) {
        return {
          success: false,
          error: `Strategy Enforcement Active: Prepaying "${loan.name}" incurs ${penaltyCharge.toLocaleString()} ${loan.currency} in policy charges while "${predictedPlan.betterAlternativeDebtName}" carries a lower charge (${predictedPlan.betterAlternativePenaltyPct ?? 0}%). Settle scheduled Monthly EMI here (0 fee) or disable Strategy Enforcement to override.`,
        };
      }
      if (actualSim && !actualSim.isFinanciallyBeneficial) {
        return {
          success: false,
          error: `Strategy Enforcement Active: Prepayment charge (${penaltyCharge.toLocaleString()} ${loan.currency}) exceeds gross interest saved (${actualSim.grossInterestSaved.toLocaleString()} ${loan.currency}). Settle scheduled Monthly EMI (0 fee) or disable Strategy Enforcement to override.`,
        };
      }
    }

    const totalCashRequired = safeAdd(amount, penaltyCharge);

    const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(asset.id, holdingsRef.current);
    if (availableBalance <= 0 && totalSweepIn <= 0) {
      return {
        success: false,
        error: `Account "${getSafeAssetName(asset, assetTypes)}" has a non-positive balance (${availableBalance.toLocaleString()}). Loan obligations require positive liquid cash or active Sweep-In FDs.`,
      };
    }
    if (totalAvailable < totalCashRequired) {
      return {
        success: false,
        error: `Insufficient balance in ${getSafeAssetName(asset, assetTypes)}. Available: ${availableBalance.toLocaleString()} (+ ${totalSweepIn.toLocaleString()} in Sweep-in FDs = ${totalAvailable.toLocaleString()} total), but payment${penaltyCharge > 0 ? ` + prepayment charge (${penaltyCharge.toLocaleString()})` : ''} requires: ${totalCashRequired.toLocaleString()}`,
      };
    }

    // If bank account has insufficient balance, auto-deduct deficit from latest created Sweep-In FD into the bank account
    if (availableBalance < totalCashRequired) {
      const deficit = totalCashRequired - Math.max(0, availableBalance);
      const sweepRes = await breakSweepInForDeficit(
        asset.id,
        deficit,
        options?.isEmi ? `Loan EMI: ${loan.name}` : `Loan Prepayment: ${loan.name}`
      );
      if (!sweepRes.success) return { success: false, error: sweepRes.error };
    }

    // 1. Deduct full cash outflow (principal + prepayment charge) once from the live source asset
    const currentAsset = holdingsRef.current.find((h) => h.id === fromAssetId) || asset;
    const remainingAssetVal = Math.max(0, safeSub(currentAsset.principalOrValue || 0, totalCashRequired));
    const updatedHolding: Holding = {
      ...currentAsset,
      principalOrValue: remainingAssetVal,
      isOverdraftActive: false,
      overdraftAmount: 0,
      overdraftAt: undefined,
    };
    await updateHolding(updatedHolding);

    // 2. Reduce loan outstanding principal by principal amount ONLY (prepayment charge does not reduce principal)
    const liveLoan = liabilitiesRef.current.find((l) => l.id === loanId) || loan;
    const remainingLoanVal = Math.max(0, safeSub(liveLoan.outstanding || 0, amount));
    const nextTenure =
      remainingLoanVal <= 0
        ? 0
        : options?.updatedTenureMonths !== undefined && options.updatedTenureMonths > 0
        ? Math.round(options.updatedTenureMonths)
        : options?.isEmi && liveLoan.tenureMonths && liveLoan.tenureMonths > 1
        ? liveLoan.tenureMonths - 1
        : liveLoan.tenureMonths;
    const nextRate =
      options?.updatedRatePct !== undefined && !isNaN(options.updatedRatePct)
        ? options.updatedRatePct
        : liveLoan.ratePct;
    const nextLoanDraft: Liability = {
      ...liveLoan,
      outstanding: remainingLoanVal,
      ratePct: nextRate,
      tenureMonths: nextTenure,
      ...(options?.updatedMonthlyEmi !== undefined && options.updatedMonthlyEmi > 0
        ? { monthlyEmi: options.updatedMonthlyEmi }
        : {}),
    };
    const nextPolicyEval = calculateLoanPrepaymentCharge(nextLoanDraft, remainingLoanVal);
    const updatedLoan: Liability = {
      ...nextLoanDraft,
      // Sync derived current-tenure rate ONLY if policy is tenure-tiered; never alter user's defined policy or basis
      ...(liveLoan.prepaymentPolicy?.mode === 'tenure_tiered'
        ? { prepaymentPenaltyPct: nextPolicyEval.penaltyPct }
        : {}),
    };
    await updateLiability(updatedLoan);

    // 3. Record transaction in ledger without re-mutating balances
    const txId = `tx-loanpay-${Date.now()}`;
    const tx: Transaction = {
      id: txId,
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      kind: options?.isEmi ? 'emi' : 'transfer',
      amount: totalCashRequired,
      toAmount: amount,
      currency: liveLoan.currency,
      fromId: fromAssetId,
      toId: loanId,
      reason: options?.isEmi
        ? `EMI payment for ${liveLoan.name} from ${asset.name}`
        : penaltyCharge > 0
        ? `Loan prepayment for ${liveLoan.name} (Principal ${amount.toLocaleString()} + Prepayment Charge ${penaltyCharge.toLocaleString()})`
        : `Debt payoff for ${liveLoan.name} from ${asset.name}`,
      category: 'Bills',
      fxRateUsed: 1.0,
      ...(penaltyCharge > 0 ? { prepaymentPenaltyPaid: penaltyCharge } : {}),
    };
    await recordTransactionOnly(tx);

    // 4. Closed-Loop ML Retraining on what the user ACTUALLY paid vs predicted optimal manner
    const fxToBase = currencies.find((c) => c.code === liveLoan.currency)?.rateToBase || 1;
    const extraPaidAboveEmi = Math.max(0, amount - predictedPlan.scheduledEmiAmount);
    const netInterestSavedLocal = actualSim ? actualSim.netFinancialBenefit : 0;

    let wasSuccess = false;
    let partialSuccess = false;
    let microSavedBase = 0;
    let avoidableCostBase = 0;

    if (predictedPlan.extraPrincipalSlice > 0) {
      // Model predicted extra principal prepayment was optimal
      if (extraPaidAboveEmi > 0 && netInterestSavedLocal > 0) {
        wasSuccess = true;
        partialSuccess = amount < predictedPlan.recommendedAmount * 0.9;
        microSavedBase = netInterestSavedLocal * fxToBase;
      } else {
        // User paid bare minimum (or incurred net loss) despite safe surplus & positive net benefit
        wasSuccess = false;
        avoidableCostBase = Math.max(0, predictedPlan.projectedNetBenefit * fxToBase);
      }
    } else {
      // Model predicted exact Monthly EMI was optimal (e.g. high fee, lock-in, or buffer protection)
      if (!isExtraPrepayment || penaltyCharge === 0) {
        wasSuccess = true;
        partialSuccess = false;
        const avoidedFee = calculateLoanPrepaymentCharge(liveLoan, liveLoan.outstanding || amount).totalPenaltyWithTax;
        microSavedBase = Math.max(10, avoidedFee * fxToBase);
      } else {
        // User overrode warning and paid avoidable prepayment charge
        wasSuccess = false;
        avoidableCostBase = penaltyCharge * fxToBase;
      }
    }

    const nextMlState = recordBehavioralOutcomeAndRetrain({
      domain: 'debt_strategy',
      subEventLabel: partialSuccess ? 'Loan Micro-Win' : 'Loan Settlement',
      ledgerRefId: `loan-reality-${txId}`,
      predictedSummary: `Predicted ${predictedPlan.recommendedMode === 'emi' ? 'exact EMI' : 'precision payoff'} of ${predictedPlan.recommendedAmount.toLocaleString()} ${liveLoan.currency}`,
      actualRealitySummary: `Paid ${amount.toLocaleString()} ${liveLoan.currency} principal${penaltyCharge > 0 ? ` (+${penaltyCharge.toLocaleString()} fee)` : ''}`,
      wasSuccess,
      partialSuccess,
      microSavedBase,
      avoidableCostOrDeltaBase: avoidableCostBase,
      isDebtPrepaySignal: extraPaidAboveEmi > 0,
    });
    setClosedLoopMLState(nextMlState);

    return { success: true };
  };

  const logDebitCardAtmWithdrawal = async (cardId: string, locationType: 'metro' | 'non_metro') => {
    const card = liabilitiesRef.current.find((l) => l.id === cardId);
    if (!card) return;

    const currentMonth = new Date().toISOString().substring(0, 7);
    const isNewMonth = card.lastAtmUsageMonth !== currentMonth;
    const curMetro = isNewMonth ? 0 : (card.metroAtmUsageThisMonth || 0);
    const curNonMetro = isNewMonth ? 0 : (card.nonMetroAtmUsageThisMonth || 0);

    const updatedCard: Liability = {
      ...card,
      lastAtmUsageMonth: currentMonth,
      metroAtmUsageThisMonth: locationType === 'metro' ? curMetro + 1 : curMetro,
      nonMetroAtmUsageThisMonth: locationType === 'non_metro' ? curNonMetro + 1 : curNonMetro,
    };

    await updateLiability(updatedCard);
  };

  const addTransaction = async (tx: Transaction) => {
    await recordTransactionOnly(tx);

    // Dynamic ledger adjustment for sources and targets using live synchronous refs
    if (tx.kind === 'spend') {
      if (tx.fromId) {
        let hold = holdingsRef.current.find((h) => h.id === tx.fromId);
        if (hold) {
          // Check if the user paid from this Bank Account using a linked Hybrid Card
          const selectedCard = tx.debitCardId
            ? liabilitiesRef.current.find((l) => l.id === tx.debitCardId && l.kind === 'card')
            : undefined;
          const fallbackHybrid =
            tx.paymentMode === 'hybrid_card'
              ? liabilitiesRef.current.find(
                  (l) => l.kind === 'card' && l.cardType === 'hybrid' && l.linkedAccountId === hold!.id
                )
              : undefined;
          const activeHybrid =
            selectedCard && selectedCard.cardType === 'hybrid' ? selectedCard : fallbackHybrid;

          if (activeHybrid) {
            // Unified 3-Tier Cascade:
            // 1. Positive Bank Cash -> 2. Sweep-In FDs strictly linked to this Bank -> 3. Hybrid Card Credit Limit (once Bank + Sweep-In == 0)
            const curBal = hold.principalOrValue || 0;
            const cashTake = Math.min(Math.max(0, curBal), tx.amount);
            let remaining = tx.amount - cashTake;
            let sweepTake = 0;

            const { totalSweepIn } = getAccountLiquidityWithSweepIn(hold.id, holdingsRef.current);
            if (remaining > 0 && totalSweepIn > 0) {
              sweepTake = Math.min(totalSweepIn, remaining);
              const sweepRes = await breakSweepInForDeficit(
                hold.id,
                sweepTake,
                tx.reason || `Hybrid Spend: ${activeHybrid.name}`
              );
              if (sweepRes.success) {
                remaining -= sweepTake;
              } else {
                sweepTake = 0;
              }
            }

            const totalCashPortion = cashTake + sweepTake;
            if (totalCashPortion > 0) {
              const liveBank = holdingsRef.current.find((h) => h.id === hold!.id) || hold;
              await updateHolding({
                ...liveBank,
                principalOrValue: Math.max(0, (liveBank.principalOrValue || 0) - totalCashPortion),
                isOverdraftActive: false,
                overdraftAmount: 0,
                overdraftAt: undefined,
              });
            }

            const liveCard = liabilitiesRef.current.find((l) => l.id === activeHybrid.id) || activeHybrid;
            await updateLiability({
              ...liveCard,
              outstanding: (liveCard.outstanding || 0) + remaining,
              debitUsageCount: (liveCard.debitUsageCount || 0) + (totalCashPortion > 0 ? 1 : 0),
            });
          } else {
            // Regular Bank Spend (UPI or Standard Debit Card)
            const curBal = hold.principalOrValue || 0;
            if (curBal < tx.amount) {
              const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(hold.id, holdingsRef.current);
              if (totalSweepIn > 0 && totalAvailable >= tx.amount) {
                const deficit = tx.amount - Math.max(0, curBal);
                await breakSweepInForDeficit(hold.id, deficit, tx.reason || 'Spend');
                hold = holdingsRef.current.find((h) => h.id === tx.fromId) || hold;
              }
            }
            await updateHolding({ ...hold, principalOrValue: (hold.principalOrValue || 0) - tx.amount });

            if (selectedCard && selectedCard.cardType === 'debit') {
              await updateLiability({
                ...selectedCard,
                debitUsageCount: (selectedCard.debitUsageCount || 0) + 1,
              });
            }
          }
        } else {
          const card = liabilitiesRef.current.find((l) => l.id === tx.fromId && l.kind === 'card');
          if (card) {
            if (card.cardType === 'hybrid') {
              // Hybrid Card selected directly:
              // 1. Positive Linked Bank Cash -> 2. Sweep-In FDs strictly linked to that Bank -> 3. Hybrid Card Credit Limit
              const linkedBank = holdingsRef.current.find((h) => h.id === card.linkedAccountId);
              if (linkedBank) {
                const linkedBal = linkedBank.principalOrValue || 0;
                const cashTake = Math.min(Math.max(0, linkedBal), tx.amount);
                let remaining = tx.amount - cashTake;
                let sweepTake = 0;

                const { totalSweepIn } = getAccountLiquidityWithSweepIn(linkedBank.id, holdingsRef.current);
                if (remaining > 0 && totalSweepIn > 0) {
                  sweepTake = Math.min(totalSweepIn, remaining);
                  const sweepRes = await breakSweepInForDeficit(
                    linkedBank.id,
                    sweepTake,
                    tx.reason || `Hybrid Spend: ${card.name}`
                  );
                  if (sweepRes.success) {
                    remaining -= sweepTake;
                  } else {
                    sweepTake = 0;
                  }
                }

                const totalCashPortion = cashTake + sweepTake;
                if (totalCashPortion > 0) {
                  const liveBank = holdingsRef.current.find((h) => h.id === linkedBank.id) || linkedBank;
                  await updateHolding({
                    ...liveBank,
                    principalOrValue: Math.max(0, (liveBank.principalOrValue || 0) - totalCashPortion),
                    isOverdraftActive: false,
                    overdraftAmount: 0,
                    overdraftAt: undefined,
                  });
                }

                const liveCard = liabilitiesRef.current.find((l) => l.id === card.id) || card;
                await updateLiability({
                  ...liveCard,
                  outstanding: (liveCard.outstanding || 0) + remaining,
                  debitUsageCount: (liveCard.debitUsageCount || 0) + (totalCashPortion > 0 ? 1 : 0),
                });
              } else {
                // No linked bank account -> strictly Credit Card mode
                await updateLiability({
                  ...card,
                  outstanding: (card.outstanding || 0) + tx.amount,
                });
              }
            } else if (card.cardType === 'debit') {
              const linkedBank = holdingsRef.current.find((h) => h.id === card.linkedAccountId);
              if (linkedBank) {
                const curBal = linkedBank.principalOrValue || 0;
                if (curBal < tx.amount) {
                  const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(
                    linkedBank.id,
                    holdingsRef.current
                  );
                  if (totalSweepIn > 0 && totalAvailable >= tx.amount) {
                    await breakSweepInForDeficit(
                      linkedBank.id,
                      tx.amount - Math.max(0, curBal),
                      tx.reason || `Debit Spend: ${card.name}`
                    );
                  }
                }
                const liveBank = holdingsRef.current.find((h) => h.id === linkedBank.id) || linkedBank;
                await updateHolding({
                  ...liveBank,
                  principalOrValue: (liveBank.principalOrValue || 0) - tx.amount,
                });
              }
              await updateLiability({
                ...card,
                debitUsageCount: (card.debitUsageCount || 0) + 1,
              });
            } else {
              // Standard Credit Card
              await updateLiability({ ...card, outstanding: (card.outstanding || 0) + tx.amount });
            }
          }
        }
      }
    } else if (tx.kind === 'income') {
      if (tx.toId) {
        const hold = holdingsRef.current.find((h) => h.id === tx.toId);
        if (hold) {
          await updateHolding({ ...hold, principalOrValue: (hold.principalOrValue || 0) + tx.amount });
        }
      }
    } else if (tx.kind === 'transfer' || tx.kind === 'cardPayment' || tx.kind === 'emi') {
      // Deduct from source
      if (tx.fromId) {
        let fromHold = holdingsRef.current.find((h) => h.id === tx.fromId);
        if (fromHold) {
          const isDepositSource =
            Boolean(fromHold.isSweepIn) ||
            fromHold.typeId === 'type-fd' ||
            Boolean(fromHold.fixedRatePct && fromHold.maturityDate);
          if (!isDepositSource && (fromHold.principalOrValue || 0) < tx.amount) {
            const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(fromHold.id, holdingsRef.current);
            if (totalSweepIn > 0 && totalAvailable >= tx.amount) {
              const deficit = tx.amount - Math.max(0, fromHold.principalOrValue || 0);
              await breakSweepInForDeficit(fromHold.id, deficit, tx.reason || 'Transfer');
              fromHold = holdingsRef.current.find((h) => h.id === tx.fromId) || fromHold;
            }
          }
          const nextBal = (fromHold.principalOrValue || 0) - tx.amount;
          await updateHolding({
            ...fromHold,
            principalOrValue: isDepositSource ? Math.max(0, nextBal) : nextBal,
            isMatured: isDepositSource && nextBal <= 0 ? true : fromHold.isMatured,
          });
        } else {
          const fromCard = liabilitiesRef.current.find((l) => l.id === tx.fromId && l.kind === 'card');
          if (fromCard) {
            await updateLiability({ ...fromCard, outstanding: (fromCard.outstanding || 0) + tx.amount });
          }
        }
      }
      // Add or pay down destination
      if (tx.toId) {
        const toHold = holdingsRef.current.find((h) => h.id === tx.toId);
        if (toHold) {
          const addAmount = tx.toAmount !== undefined ? tx.toAmount : tx.amount;
          await updateHolding({ ...toHold, principalOrValue: (toHold.principalOrValue || 0) + addAmount });
        } else {
          const toLiab = liabilitiesRef.current.find((l) => l.id === tx.toId);
          if (toLiab) {
            await updateLiability({ ...toLiab, outstanding: Math.max(0, (toLiab.outstanding || 0) - tx.amount) });
          }
        }
      }
    }
  };

  const addTransactionsBulk = async (txs: Transaction[]) => {
    for (const t of txs) {
      await addTransaction(t);
    }
  };

  const updateTransaction = async (tx: Transaction) => {
    const prevTx = transactionsRef.current.find((t) => t.id === tx.id);
    const updated = transactionsRef.current.map((t) => (t.id === tx.id ? tx : t));

    const categoryChanged =
      Boolean(prevTx) &&
      Boolean(tx.category) &&
      prevTx!.category.trim().toLowerCase() !== tx.category.trim().toLowerCase();

    const reasonChanged =
      Boolean(prevTx) &&
      Boolean(tx.reason) &&
      prevTx!.reason.trim().toLowerCase() !== tx.reason.trim().toLowerCase();

    const shouldLearnSmsRule = categoryChanged || reasonChanged;

    let nextOverrides = smsRuleOverridesRef.current;
    let nextCategories = spendCategories;

    if (shouldLearnSmsRule) {
      const merchantKey = tx.smsMetadata?.merchantName || prevTx?.reason || tx.reason;
      nextOverrides = learnCategoryOverrideFromMerchant(
        merchantKey,
        tx.category || prevTx?.category || 'General',
        smsRuleOverridesRef.current,
        {
          rawCounterparty: tx.smsMetadata?.rawCounterparty,
          mappedReason: tx.reason,
        }
      );
      if (
        tx.category &&
        !spendCategories.some(
          (c) => c.name.trim().toLowerCase() === tx.category.trim().toLowerCase()
        )
      ) {
        const newCat: SpendCategoryConfig = {
          id: `cat-learned-${Date.now()}`,
          name: tx.category.trim(),
          isMlGenerated: true,
          usageCount: 1,
        };
        nextCategories = dedupeSpendCategories([...spendCategories, newCat]);
      }
    }

    await dbStorage.runAcidTransaction([
      { storeName: 'transactions', mode: 'put', item: tx },
      ...(shouldLearnSmsRule
        ? [
            { storeName: 'sms_rule_overrides' as const, mode: 'setAll' as const, items: nextOverrides },
            { storeName: 'spendCategories' as const, mode: 'setAll' as const, items: nextCategories },
          ]
        : []),
    ]);

    commitTransactions(updated);
    if (shouldLearnSmsRule) {
      commitSmsRuleOverrides(nextOverrides);
      if (nextCategories !== spendCategories) {
        setSpendCategories(nextCategories);
      }
    }
  };

  const ingestSmsMessages = async (
    rawInput: string | RawDeviceSmsMessage[],
    autoCommit: boolean = true
  ): Promise<{
    committedCount: number;
    stagedCount: number;
    droppedNoiseCount: number;
    duplicateCount: number;
    blacklistedCount: number;
  }> => {
    const messages: RawDeviceSmsMessage[] =
      typeof rawInput === 'string' ? splitManualPastedSmsBatch(rawInput) : rawInput;

    if (messages.length === 0) {
      return {
        committedCount: 0,
        stagedCount: 0,
        droppedNoiseCount: 0,
        duplicateCount: 0,
        blacklistedCount: 0,
      };
    }

    // Filter out messages that were already extracted/synced in any previous sync
    const { uniqueMessages, alreadySyncedCount } = filterUniqueUnsyncedMessages(
      messages,
      transactionsRef.current,
      smsStagingQueueRef.current
    );

    if (uniqueMessages.length === 0) {
      return {
        committedCount: 0,
        stagedCount: 0,
        droppedNoiseCount: 0,
        duplicateCount: alreadySyncedCount,
        blacklistedCount: 0,
      };
    }

    const batchRes = processIncomingSmsBatchOnDevice({
      messages: uniqueMessages,
      holdings: holdingsRef.current,
      liabilities: liabilitiesRef.current,
      transactions: transactionsRef.current,
      spendCategories,
      ruleOverrides: smsRuleOverridesRef.current,
      stagingQueue: smsStagingQueueRef.current,
      defaultCurrency: settings.baseCurrency || 'INR',
      autoCommit,
    });

    // Atomically commit the newly extracted messages into the persistent on-device sync registry
    commitSyncedSmsBatch(uniqueMessages);

    await dbStorage.runAcidTransaction([
      { storeName: 'holdings', mode: 'setAll', items: batchRes.updatedHoldings },
      { storeName: 'liabilities', mode: 'setAll', items: batchRes.updatedLiabilities },
      { storeName: 'transactions', mode: 'setAll', items: batchRes.updatedTransactions },
      { storeName: 'sms_staging_queue', mode: 'setAll', items: batchRes.updatedStagingQueue },
    ]);

    commitHoldings(batchRes.updatedHoldings);
    commitLiabilities(batchRes.updatedLiabilities);
    commitTransactions(batchRes.updatedTransactions);
    commitSmsStagingQueue(batchRes.updatedStagingQueue);

    return {
      committedCount: batchRes.newlyCommittedTransactions.length,
      stagedCount: batchRes.newlyStagedItems.length,
      droppedNoiseCount: batchRes.droppedNoiseCount,
      duplicateCount: batchRes.discardedDuplicateCount + alreadySyncedCount,
      blacklistedCount: batchRes.blacklistedCount,
    };
  };

  const requestSmsAccessAndSync = async (): Promise<{
    status: SmsPermissionStatus;
    committedCount: number;
    stagedCount: number;
    droppedNoiseCount: number;
    duplicateCount: number;
  }> => {
    const perm = await requestStandaloneSmsPermission();
    setSmsPermissionStatus(perm);
    if (perm !== 'granted') {
      return {
        status: perm,
        committedCount: 0,
        stagedCount: 0,
        droppedNoiseCount: 0,
        duplicateCount: 0,
      };
    }

    const lastSyncedMs = getStoredLastSmsSyncTimestamp();
    // High-water mark cursor: query strictly from lastSyncedMs + 1 (or 30-day fallback on initial sync)
    const sinceMs = lastSyncedMs > 0 ? Math.max(0, lastSyncedMs + 1) : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const inbox = await readOnDeviceSmsInbox({ limit: 150, sinceTimestampMs: sinceMs });
    setSmsPermissionStatus(inbox.status);

    if (inbox.messages.length === 0) {
      return {
        status: inbox.status,
        committedCount: 0,
        stagedCount: 0,
        droppedNoiseCount: 0,
        duplicateCount: 0,
      };
    }

    const res = await ingestSmsMessages(inbox.messages, true);
    return {
      status: inbox.status,
      committedCount: res.committedCount,
      stagedCount: res.stagedCount,
      droppedNoiseCount: res.droppedNoiseCount,
      duplicateCount: res.duplicateCount,
    };
  };

  const commitStagedSmsItem = async (
    stagingId: string,
    overrideSourceIdOrOptions?:
      | string
      | {
          sourceId?: string;
          targetLiabilityId?: string;
          txKind?: SmsParsedTxKind;
          reason?: string;
          category?: string;
          amount?: number;
          date?: string;
        },
    overrideCategory?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const target = smsStagingQueueRef.current.find((s) => s.id === stagingId);
    if (!target) return { success: false, error: 'Staged SMS item not found.' };
    if (target.status === 'committed') {
      return { success: false, error: 'Staged SMS item is already committed.' };
    }

    const opts: {
      sourceId?: string;
      targetLiabilityId?: string;
      txKind?: SmsParsedTxKind;
      reason?: string;
      category?: string;
      amount?: number;
      date?: string;
    } =
      typeof overrideSourceIdOrOptions === 'object' && overrideSourceIdOrOptions !== null
        ? (overrideSourceIdOrOptions as any)
        : {
            sourceId: typeof overrideSourceIdOrOptions === 'string' ? overrideSourceIdOrOptions : undefined,
            category: overrideCategory,
          };

    const finalTxKind: SmsParsedTxKind =
      opts.txKind ||
      target.txKind ||
      (target.direction === 'debit' ? 'spend' : 'income');

    const finalSourceId = opts.sourceId || target.matchedSourceId;
    const finalTargetLiabilityId = opts.targetLiabilityId || target.matchedTargetLiabilityId;

    if (finalTxKind === 'cardPayment' || finalTxKind === 'emi') {
      if (!finalTargetLiabilityId) {
        return {
          success: false,
          error: 'Select the Credit Card or Loan (e.g. Loan Against Card) being paid before posting.',
        };
      }
      if (!finalSourceId) {
        return {
          success: false,
          error: 'Select the paying Bank Account before posting this card/loan payment.',
        };
      }
    } else if (!finalSourceId) {
      return { success: false, error: 'Select a bank account or card source before committing.' };
    }

    const finalReason = (opts.reason || target.merchantName || 'SMS Transaction').trim();
    const finalCategory = (
      opts.category ||
      target.matchedCategory ||
      (finalTxKind === 'emi'
        ? 'Loans & EMI'
        : finalTxKind === 'cardPayment'
        ? 'Credit Cards'
        : finalTxKind === 'income'
        ? 'Income'
        : 'General')
    ).trim();
    const finalAmount =
      opts.amount !== undefined && opts.amount > 0 ? opts.amount : target.amount;
    const finalDate = opts.date && opts.date.trim() ? opts.date.trim() : target.parsedDate;

    const enrichedStaged: StagedSmsItem = {
      ...target,
      txKind: finalTxKind,
      direction: finalTxKind === 'income' ? 'credit' : 'debit',
      merchantName: finalReason,
      amount: finalAmount,
      parsedDate: finalDate,
      matchedSourceId: finalSourceId,
      matchedTargetLiabilityId: finalTargetLiabilityId,
      matchedCategory: finalCategory,
      requiresReview: false,
    };

    const fxRate = currencies.find((c) => c.code === enrichedStaged.currency)?.rateToBase || 1.0;
    const newTx = buildLedgerTransactionFromStagedSms(enrichedStaged, fxRate);

    const nextHoldings = holdingsRef.current.map((h) => ({ ...h }));
    const nextLiabilities = liabilitiesRef.current.map((l) => ({ ...l }));
    applyTransactionBalanceMutationInMemory(newTx, nextHoldings, nextLiabilities);

    const nextTransactions = [newTx, ...transactionsRef.current];
    const nextStaging = smsStagingQueueRef.current.map((item) =>
      item.id === stagingId
        ? {
            ...enrichedStaged,
            status: 'committed' as const,
            committedTxId: newTx.id,
          }
        : item
    );

    const nextOverrides = learnFromUserSmsReview({
      stagedItem: target,
      finalSourceId,
      finalTargetLiabilityId,
      finalTxKind,
      finalReason,
      finalCategory,
      existingOverrides: smsRuleOverridesRef.current,
    });

    let nextCategories = spendCategories;
    if (
      finalCategory &&
      !spendCategories.some(
        (c) => c.name.trim().toLowerCase() === finalCategory.toLowerCase()
      )
    ) {
      nextCategories = dedupeSpendCategories([
        ...spendCategories,
        {
          id: `cat-sms-${Date.now()}`,
          name: finalCategory,
          isMlGenerated: true,
          usageCount: 1,
        },
      ]);
    }

    try {
      await dbStorage.runAcidTransaction([
        { storeName: 'holdings', mode: 'setAll', items: nextHoldings },
        { storeName: 'liabilities', mode: 'setAll', items: nextLiabilities },
        { storeName: 'transactions', mode: 'setAll', items: nextTransactions },
        { storeName: 'sms_staging_queue', mode: 'setAll', items: nextStaging },
        { storeName: 'sms_rule_overrides', mode: 'setAll', items: nextOverrides },
        ...(nextCategories !== spendCategories
          ? [{ storeName: 'spendCategories' as const, mode: 'setAll' as const, items: nextCategories }]
          : []),
      ]);

      commitHoldings(nextHoldings);
      commitLiabilities(nextLiabilities);
      commitTransactions(nextTransactions);
      commitSmsStagingQueue(nextStaging);
      commitSmsRuleOverrides(nextOverrides);
      if (nextCategories !== spendCategories) {
        setSpendCategories(nextCategories);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Atomic SMS commit failed.' };
    }
  };

  const smsBalanceAlerts = useMemo(() => {
    return smsStagingQueue
      .filter(
        (s) =>
          Boolean(s.balanceDiscrepancy) &&
          !s.balanceDiscrepancy?.resolved &&
          s.status !== 'blacklisted' &&
          s.status !== 'rolled_back'
      )
      .map((s) => ({
        stagingId: s.id,
        discrepancy: s.balanceDiscrepancy!,
      }));
  }, [smsStagingQueue]);

  const resolveSmsBalanceAlert = async (
    stagingId: string,
    action: 'sync_balance' | 'dismiss'
  ): Promise<{ success: boolean; error?: string }> => {
    const staged = smsStagingQueueRef.current.find((s) => s.id === stagingId);
    if (!staged || !staged.balanceDiscrepancy) {
      return { success: false, error: 'Balance alert not found.' };
    }

    const disc = staged.balanceDiscrepancy;
    const nextStaging = smsStagingQueueRef.current.map((s) =>
      s.id === stagingId && s.balanceDiscrepancy
        ? {
            ...s,
            balanceDiscrepancy: {
              ...s.balanceDiscrepancy,
              resolved: true,
            },
          }
        : s
    );

    if (action === 'dismiss') {
      commitSmsStagingQueue(nextStaging);
      await dbStorage.setAll('sms_staging_queue', nextStaging);
      return { success: true };
    }

    // action === 'sync_balance': reconcile holding balance to SMS reported balance and record an auditable adjustment entry
    const targetHolding = holdingsRef.current.find((h) => h.id === disc.holdingId);
    if (!targetHolding) {
      return { success: false, error: 'Bank account not found.' };
    }

    const currentBal = targetHolding.principalOrValue || 0;
    const diffNeeded = Math.round((disc.smsReportedBalance - currentBal) * 100) / 100;
    const nextHoldings = holdingsRef.current.map((h) =>
      h.id === targetHolding.id ? { ...h, principalOrValue: disc.smsReportedBalance } : h
    );

    const fxRate = currencies.find((c) => c.code === targetHolding.currency)?.rateToBase || 1.0;
    const adjTx: Transaction | null =
      Math.abs(diffNeeded) >= 0.01
        ? {
            id: `tx-sms-balsync-${Date.now()}`,
            date: disc.parsedDate || new Date().toISOString().slice(0, 10),
            createdAt: new Date().toISOString(),
            kind: 'adjustment',
            amount: Math.abs(diffNeeded),
            currency: targetHolding.currency,
            ...(diffNeeded >= 0
              ? { toId: targetHolding.id }
              : { fromId: targetHolding.id, sourceId: targetHolding.id }),
            reason: `SMS Balance Reconciliation (${targetHolding.name})`,
            category: 'Reconciliation',
            fxRateUsed: fxRate,
            reconciled: true,
            notes: `Synced balance from ${currentBal} to SMS reported balance ${disc.smsReportedBalance}`,
            provenance: createProvenance('user_entered', 'Reconciled against bank SMS closing balance'),
          }
        : null;

    const nextTransactions = adjTx
      ? [adjTx, ...transactionsRef.current]
      : transactionsRef.current;

    await dbStorage.runAcidTransaction([
      { storeName: 'holdings', mode: 'setAll', items: nextHoldings },
      { storeName: 'transactions', mode: 'setAll', items: nextTransactions },
      { storeName: 'sms_staging_queue', mode: 'setAll', items: nextStaging },
    ]);

    commitHoldings(nextHoldings);
    if (adjTx) commitTransactions(nextTransactions);
    commitSmsStagingQueue(nextStaging);
    return { success: true };
  };

  const discardStagedSmsItem = async (stagingId: string, rejectionReason?: string) => {
    const target = smsStagingQueueRef.current.find((s) => s.id === stagingId);
    let nextOverrides = smsRuleOverridesRef.current;

    if (target && rejectionReason && rejectionReason.trim()) {
      nextOverrides = applySmsRejectionLearning({
        stagedItem: target,
        rejectionReason: rejectionReason.trim(),
        existingOverrides: smsRuleOverridesRef.current,
      });
    }

    const nextStaging = smsStagingQueueRef.current.filter((s) => s.id !== stagingId);

    await dbStorage.runAcidTransaction([
      { storeName: 'sms_staging_queue', mode: 'setAll', items: nextStaging },
      ...(nextOverrides !== smsRuleOverridesRef.current
        ? [{ storeName: 'sms_rule_overrides' as const, mode: 'setAll' as const, items: nextOverrides }]
        : []),
    ]);

    commitSmsStagingQueue(nextStaging);
    if (nextOverrides !== smsRuleOverridesRef.current) {
      commitSmsRuleOverrides(nextOverrides);
    }
  };

  const flagSmsTransaction = async (
    txId: string,
    flagReason: SmsFlagReason,
    replacementSourceId?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const tx = transactionsRef.current.find((t) => t.id === txId);
    if (!tx) return { success: false, error: 'Transaction not found in ledger.' };
    if (tx.isReversed) return { success: false, error: 'Transaction was already reversed.' };

    try {
      const feedback = applySmsFlagFeedback({
        transaction: tx,
        flagReason,
        replacementSourceId,
        holdings: holdingsRef.current,
        liabilities: liabilitiesRef.current,
        transactions: transactionsRef.current,
        ruleOverrides: smsRuleOverridesRef.current,
        stagingQueue: smsStagingQueueRef.current,
      });

      const finalTransactions = [
        ...(feedback.repostedTransaction ? [feedback.repostedTransaction] : []),
        ...feedback.reversalResult.updatedTransactions,
        feedback.reversalResult.reversalTx,
      ];

      await dbStorage.runAcidTransaction([
        { storeName: 'holdings', mode: 'setAll', items: feedback.reversalResult.updatedHoldings },
        { storeName: 'liabilities', mode: 'setAll', items: feedback.reversalResult.updatedLiabilities },
        { storeName: 'transactions', mode: 'setAll', items: finalTransactions },
        { storeName: 'sms_rule_overrides', mode: 'setAll', items: feedback.updatedRuleOverrides },
        { storeName: 'sms_staging_queue', mode: 'setAll', items: feedback.updatedStagingQueue },
      ]);

      commitHoldings(feedback.reversalResult.updatedHoldings);
      commitLiabilities(feedback.reversalResult.updatedLiabilities);
      commitTransactions(finalTransactions);
      commitSmsRuleOverrides(feedback.updatedRuleOverrides);
      commitSmsStagingQueue(feedback.updatedStagingQueue);
      setReversalAuditLogs((prev) => [feedback.reversalResult.auditRecord, ...prev]);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to roll back and blacklist SMS transaction.' };
    }
  };

  const deleteSmsRuleOverride = async (ruleId: string) => {
    const next = smsRuleOverridesRef.current.filter((r) => r.id !== ruleId);
    commitSmsRuleOverrides(next);
    await dbStorage.delete('sms_rule_overrides', ruleId);
  };


  const reverseTransaction = async (
    id: string,
    reason: string = 'User requested deletion'
  ): Promise<{ success: boolean; error?: string }> => {
    const tx = transactionsRef.current.find((t) => t.id === id);
    if (!tx) {
      return { success: false, error: 'Transaction not found in ledger' };
    }
    if (tx.isReversed) {
      return { success: false, error: 'Transaction is already reversed (idempotent protection)' };
    }

    try {
      const result = executeTransactionReversal(
        tx,
        holdingsRef.current,
        liabilitiesRef.current,
        transactionsRef.current,
        reason
      );

      const finalTxs = [...result.updatedTransactions, result.reversalTx];

      // Persist atomically across all stores in a single ACID transaction
      await dbStorage.runAcidTransaction([
        { storeName: 'holdings', mode: 'setAll', items: result.updatedHoldings },
        { storeName: 'liabilities', mode: 'setAll', items: result.updatedLiabilities },
        { storeName: 'transactions', mode: 'setAll', items: finalTxs },
      ]);

      commitHoldings(result.updatedHoldings);
      commitLiabilities(result.updatedLiabilities);
      commitTransactions(finalTxs);

      setReversalAuditLogs((prev) => [result.auditRecord, ...prev]);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to reverse transaction' };
    }
  };

  const deleteTransaction = async (
    id: string,
    reason: string = 'User requested deletion'
  ): Promise<{ success: boolean; error?: string }> => {
    return reverseTransaction(id, reason);
  };

  // Financial Anomaly Detection (Part 9) — uses user-configured minimum duplicate window & 4-factor signature
  const anomalies = useMemo<FinancialAnomaly[]>(() => {
    const rawAnomalies = detectFinancialAnomalies(transactions, holdings, liabilities, {
      duplicateWindowMinutes: settings.duplicateDetectionWindowMinutes ?? 60,
      quickChips,
    });
    return rawAnomalies.filter((a) => !dismissedAnomalyIds[a.id]);
  }, [transactions, holdings, liabilities, dismissedAnomalyIds, settings.duplicateDetectionWindowMinutes, quickChips]);

  const dismissAnomaly = (id: string) => {
    setDismissedAnomalyIds((prev) => ({ ...prev, [id]: true }));
  };

  // Synchronized unified bills: merges user-defined manual bills with auto-reflected Loan EMIs, Credit Card Dues, and Goal Contributions
  const allBills = useMemo<Bill[]>(() => {
    const list: Bill[] = [];
    const currentMonthStr = new Date().toISOString().substring(0, 7);

    // Filter and update manual bills: exclude settled/archived bills and bills tied to completed goals or 0-balance loans
    const manualBills = bills
      .filter((b) => {
        if (b.isArchived) return false;
        if (b.isAutoLiabilityBill || b.isGoalContributionBill || b.id.startsWith('bill-auto-')) return false;
        if (b.goalId) {
          const linkedG = goals.find((g) => g.id === b.goalId);
          if (linkedG?.isCompleted) return false;
        }
        if (b.liabilityId) {
          const linkedL = liabilities.find((l) => l.id === b.liabilityId);
          if (linkedL && linkedL.kind === 'loan' && (linkedL.outstanding || 0) <= 0) return false;
        }
        return true;
      })
      .map((b) => {
        const isOverriddenThisMonth = b.lastOverriddenMonth === currentMonthStr;
        return {
          ...b,
          repaymentPriority: b.repaymentPriority || 3,
          isOverriddenPaid: isOverriddenThisMonth || Boolean(b.isOverriddenPaid && b.lastPostedDate?.startsWith(currentMonthStr)),
        };
      });
    list.push(...manualBills);

    // Default payment source (first unlocked positive liquid holding)
    const defaultSource =
      holdings.find((h) => isSpendableLiquidHolding(h, assetTypes) && getHoldingLocalValue(h) > 0)?.id ||
      holdings.find((h) => isSpendableLiquidHolding(h, assetTypes))?.id ||
      '';

    // 1. Auto-reflect Active Loan EMIs (Mandatory & Priority 1 in Repayment Line)
    // Synchronize loan goals and loan EMI so they are identical and not double-counted!
    for (const loan of liabilities) {
      if (loan.kind === 'loan' && (loan.outstanding || 0) > 0) {
        // Link to matching debt payoff goal if user configured one
        const linkedGoal = goals.find(
          (g) => g.targetLiabilityId === loan.id || (g.goalType === 'debt_payoff' && g.name.toLowerCase().includes(loan.name.toLowerCase()))
        );
        const emiAmt = loan.monthlyEmi || (linkedGoal?.monthlyContribution) || (loan.tenureMonths ? Math.round(loan.outstanding / loan.tenureMonths) : 0);
        if (emiAmt > 0) {
          const autoId = `bill-auto-loan-${loan.id}`;
          const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;
          const paidLoanTxThisMonth = transactions.find(
            (t) =>
              !t.isReversed &&
              t.toId === loan.id &&
              (t.kind === 'emi' || t.kind === 'transfer') &&
              t.date.startsWith(currentMonthStr)
          );
          list.push({
            id: autoId,
            name: linkedGoal ? `${loan.name} (EMI & Loan Goal)` : `${loan.name} (EMI)`,
            amount: emiAmt,
            currency: loan.currency,
            frequency: 'monthly',
            dueDay: loan.dueDay || loan.emiDay || 5,
            sourceId: loan.linkedAccountId || defaultSource,
            category: 'Loans & EMI',
            autoPostPrompt: true,
            lastPostedDate: paidLoanTxThisMonth?.date,
            isAutoLiabilityBill: true,
            liabilityId: loan.id,
            liabilityKind: 'loan',
            goalId: linkedGoal?.id,
            isOverriddenPaid: isOverridden,
            lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
            repaymentPriority: 1, // Priority 1 in Repayment Line
          });
        }
      }
    }

    // 2. Auto-reflect Credit Card Outstandings (Priority 2 in Repayment Line)
    // Supports credit cards and hybrid cards (when carrying credit outstanding), with automatic cashback statement reduction
    for (const card of liabilities) {
      const isCardDebt =
        card.kind === 'card' &&
        (card.outstanding || 0) > 0 &&
        (card.cardType === 'credit' || card.cardType === 'hybrid' || !card.cardType);

      if (isCardDebt) {
        const autoId = `bill-auto-card-${card.id}`;
        const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;

        const statementDay = card.statementDay || 20;
        const coolOffDays = card.coolOffDays ?? card.interestFreeDays ?? settings.defaultCardInterestFreeDays ?? 20;

        const now = new Date();
        let stmtDate: Date;
        if (card.nextStatementDate && card.nextStatementDate.trim() !== '') {
          stmtDate = new Date(card.nextStatementDate);
        } else {
          stmtDate = new Date(now.getFullYear(), now.getMonth(), statementDay);
        }

        const isStatementGenerated = now.getTime() >= stmtDate.getTime();
        const computedDueDate = new Date(stmtDate);
        computedDueDate.setDate(computedDueDate.getDate() + coolOffDays);

        // Cashback deduction on next statement (Per User Specification)
        // "and there are some special cards which provide cash backs upon next credit card bill that amount will be reduced"
        const cardCashback = card.accumulatedCashback || 0;
        const cashbackToDeduct = Math.min(card.outstanding, cardCashback);
        const payableBillAmount = Math.max(0, card.outstanding - cashbackToDeduct);

        list.push({
          id: autoId,
          name: cashbackToDeduct > 0 ? `${card.name} (Card Bill - Cashback Applied)` : `${card.name} (Card Bill)`,
          amount: payableBillAmount > 0 ? payableBillAmount : card.outstanding,
          currency: card.currency,
          frequency: 'monthly',
          dueDay: computedDueDate.getDate(),
          dueDateStr: computedDueDate.toISOString().split('T')[0],
          statementDateStr: stmtDate.toISOString().split('T')[0],
          isStatementGenerated,
          coolOffDays,
          sourceId: card.linkedAccountId || defaultSource,
          category: 'Credit Cards',
          autoPostPrompt: isStatementGenerated,
          isAutoLiabilityBill: true,
          liabilityId: card.id,
          liabilityKind: 'card',
          cashbackApplied: cashbackToDeduct > 0 ? cashbackToDeduct : undefined,
          originalStatementAmount: card.outstanding,
          isOverriddenPaid: isOverridden,
          lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
          repaymentPriority: 2, // Priority 2 in Repayment Line
        });
      }
    }

    // 3. Auto-reflect Goals that reached 100% accumulated total
    for (const goal of goals) {
      if (goal.isCompleted) {
        // Goal is complete and verified in ledger -> permanently removed from bills!
        continue;
      }

      const isDebt = goal.goalType === 'debt_payoff';
      const matchedLiab = isDebt && goal.targetLiabilityId ? liabilities.find((l) => l.id === goal.targetLiabilityId) : undefined;
      const targetAmt = isDebt ? (goal.startingDebtAmount || goal.cost) : goal.cost;
      const accum = goal.accumulatedTotal || 0;
      const is100Pct = isDebt
        ? (matchedLiab ? (matchedLiab.outstanding || 0) <= 0 : false)
        : (targetAmt > 0 && accum >= targetAmt);

      if (is100Pct) {
        const autoId = `bill-auto-goal-fulfillment-${goal.id}`;
        const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;
        const primarySource = goal.sources?.[0]?.sourceId || goal.contributionSourceId || defaultSource;
        list.push({
          id: autoId,
          name: `Goal Payment: ${goal.name} (100% Complete)`,
          amount: goal.cost,
          currency: goal.currency,
          frequency: 'monthly',
          dueDay: 1,
          sourceId: primarySource,
          category: 'Savings & Goals',
          autoPostPrompt: true,
          isCompletedGoalBill: true,
          goalId: goal.id,
          isOverriddenPaid: isOverridden,
          lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
          repaymentPriority: 3,
        });
      }
    }

    // 4. Auto-reflect Recurring Goal Contributions (for Active Goals in monthly increments)
    for (const goal of goals) {
      if (goal.isCompleted) {
        continue;
      }
      if (goal.targetLiabilityId && liabilities.some((l) => l.id === goal.targetLiabilityId && l.kind === 'loan')) {
        continue;
      }
      const accum = goal.accumulatedTotal || 0;
      if (goal.cost > 0 && accum >= goal.cost) {
        continue;
      }

      // Respect user's choice: only generate recurring monthly goal bills when monthly accumulation is enabled
      if (goal.accumulateMonthly !== false && goal.syncToBills !== false) {
        const remainingCost = Math.max(0, goal.cost - accum);
        if (remainingCost <= 0) continue;

        // Multi-source monthly accumulation increments
        const sourcesWithIncrement = (goal.sources || []).filter(
          (s) => (s.monthlyIncrement && s.monthlyIncrement > 0) || (s.allocationMode === 'fixed_amount' && s.allocationAmount && s.allocationAmount > 0)
        );

        if (sourcesWithIncrement.length > 0) {
          for (const src of sourcesWithIncrement) {
            const srcHolding = holdings.find((h) => h.id === src.sourceId);
            const rawIncAmount = src.monthlyIncrement || src.allocationAmount || 0;
            const incAmount = Math.min(rawIncAmount, remainingCost);
            if (incAmount <= 0) continue;

            const autoId = `bill-auto-goal-${goal.id}-${src.sourceId}`;
            const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;

            list.push({
              id: autoId,
              name: `Goal: ${goal.name} (${srcHolding?.name || 'Asset'})`,
              amount: incAmount,
              currency: goal.currency,
              frequency: goal.contributionFrequency || 'monthly',
              dueDay: 1,
              sourceId: src.sourceId,
              category: 'Savings & Goals',
              autoPostPrompt: true,
              isGoalContributionBill: true,
              goalId: goal.id,
              goalSourceId: src.sourceId,
              isOverriddenPaid: isOverridden,
              lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
              repaymentPriority: 4,
            });
          }
        } else if (goal.monthlyContribution && goal.monthlyContribution > 0) {
          const incAmount = Math.min(goal.monthlyContribution, remainingCost);
          if (incAmount > 0) {
            const autoId = `bill-auto-goal-${goal.id}`;
            const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;
            list.push({
              id: autoId,
              name: `Goal: ${goal.name}`,
              amount: incAmount,
              currency: goal.currency,
              frequency: goal.contributionFrequency || 'monthly',
              dueDay: 1,
              sourceId: goal.contributionSourceId || defaultSource,
              category: 'Savings & Goals',
              autoPostPrompt: true,
              isGoalContributionBill: true,
              goalId: goal.id,
              isOverriddenPaid: isOverridden,
              lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
              repaymentPriority: 4, // Priority 4 in Repayment Line
            });
          }
        } else if (goal.sources && goal.sources.length > 0) {
          // If user defined allocation percentages (e.g. 30% per month)
          for (const src of goal.sources) {
            const srcHolding = holdings.find((h) => h.id === src.sourceId);
            const portionOfCost = Math.round(goal.cost * ((src.allocationPct || 0) / 100));
            const incAmount = Math.min(portionOfCost, remainingCost);
            if (incAmount <= 0) continue;

            const autoId = `bill-auto-goal-${goal.id}-${src.sourceId}`;
            const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;
            list.push({
              id: autoId,
              name: `Goal: ${goal.name} (${srcHolding?.name || 'Asset'})`,
              amount: incAmount,
              currency: goal.currency,
              frequency: 'monthly',
              dueDay: 1,
              sourceId: src.sourceId,
              category: 'Savings & Goals',
              autoPostPrompt: true,
              isGoalContributionBill: true,
              goalId: goal.id,
              goalSourceId: src.sourceId,
              isOverriddenPaid: isOverridden,
              lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
              repaymentPriority: 4,
            });
          }
        }
      }
    }

    // 5. Auto-reflect Active Net Borrowed Peer Balances (when someone paid a bill for user or lent user money)
    // Automatically disappears and archives the moment net balance reaches 0!
    const peerGroups = groupReceivablesByCounterparty(receivables);
    for (const pg of peerGroups) {
      if (pg.status === 'active' && pg.netBalance < -0.01) {
        const slug = normalizeCounterpartyName(pg.name).replace(/[^a-z0-9]+/g, '-');
        const autoId = `bill-auto-peer-${slug}`;
        const isOverridden = overriddenAutoBills[autoId] === currentMonthStr;
        const earliestExpected = pg.records
          .filter((r) => r.direction === 'borrowed' && isActiveCounterpartyRecord(r) && r.expectedDate)
          .map((r) => r.expectedDate!)
          .sort()[0];
        const dueDay = earliestExpected ? new Date(earliestExpected).getDate() || 15 : 15;

        list.push({
          id: autoId,
          name: `Pay Back ${pg.name} (Net Balance)`,
          amount: Math.abs(pg.netBalance),
          currency: settings.baseCurrency || 'INR',
          frequency: 'monthly',
          dueDay,
          dueDateStr: earliestExpected,
          sourceId: defaultSource,
          category: 'Shared Bills & Peers',
          autoPostPrompt: true,
          isPeerBorrowBill: true,
          peerName: pg.name,
          isOverriddenPaid: isOverridden,
          lastOverriddenMonth: isOverridden ? currentMonthStr : undefined,
          repaymentPriority: 3,
        });
      }
    }

    // Strictly sort list by repayment priority: Loan EMIs (1) on top, then Cards (2), then Custom/Peer Bills & Goal Payments (3), then Goal Contributions (4)
    list.sort((a, b) => (a.repaymentPriority || 3) - (b.repaymentPriority || 3));

    return list;
  }, [bills, liabilities, goals, holdings, overriddenAutoBills, transactions, receivables, settings.baseCurrency, assetTypes]);

  const addBill = async (bill: Bill) => {
    const updated = [...bills, bill];
    setBills(updated);
    await dbStorage.put('bills', bill);
  };

  const addBillsBulk = async (newBills: Bill[], mode: 'append' | 'replace' = 'append') => {
    const updated = mode === 'replace' ? newBills : [...bills, ...newBills];
    setBills(updated);
    await dbStorage.setAll('bills', updated);
  };

  const updateBill = async (bill: Bill) => {
    if (bill.id.startsWith('bill-auto-')) {
      return;
    }
    const updated = bills.map((b) => (b.id === bill.id ? bill : b));
    setBills(updated);
    await dbStorage.put('bills', bill);
  };

  const deleteBill = async (id: string) => {
    if (id.startsWith('bill-auto-')) {
      return;
    }
    const updated = bills.filter((b) => b.id !== id);
    setBills(updated);
    await dbStorage.delete('bills', id);
  };

  const postBill = async (
    billId: string,
    fromAccountId?: string,
    options?: {
      paymentMode?: 'upi' | 'debit_card' | 'hybrid_card' | 'neft' | 'imps' | 'cheque' | 'netbanking';
      atmZone?: 'metro' | 'non_metro';
      debitCardId?: string;
      loanSettlementOverride?: {
        principalAmount: number;
        isEmi: boolean;
        prepaymentPenaltyCharge?: number;
        updatedTenureMonths?: number;
        updatedMonthlyEmi?: number;
      };
    }
  ): Promise<{
    success: boolean;
    error?: string;
    sweepInNote?: string;
    cardUsageNote?: string;
    hybridCreditNote?: string;
  }> => {
    const b = allBills.find((x) => x.id === billId);
    if (!b) return { success: false, error: 'Target bill not found.' };

    // If this is a 100% completed goal bill, route through payGoal with asset deduction & ledger verification
    if (b.isCompletedGoalBill && b.goalId) {
      const goalRes = await payGoal(b.goalId);
      return goalRes;
    }

    // If this is a net borrowed peer balance bill, settle & archive the peer obligation cleanly
    if (b.isPeerBorrowBill && b.peerName) {
      const peerSource = fromAccountId || b.sourceId;
      const peerRes = await repayBorrowedCounterparty(
        b.peerName,
        b.amount,
        peerSource,
        `Settled net balance owed to ${b.peerName}`
      );
      return peerRes;
    }

    const rawSource = fromAccountId || b.sourceId;
    const rawMode = options?.paymentMode || 'upi';
    let paymentMode = rawMode === 'netbanking' ? 'neft' : rawMode;
    let effectiveDebitCardId = options?.debitCardId;

    // 1. Check if the chosen source is a Card Liability (Credit Card, Hybrid Card, or Debit Card)
    const directCardSource = liabilitiesRef.current.find((l) => l.id === rawSource && l.kind === 'card');
    let resolvedHoldingId = rawSource;

    if (directCardSource) {
      if (directCardSource.cardType === 'debit') {
        if (!directCardSource.linkedAccountId) {
          return { success: false, error: `Debit card "${directCardSource.name}" is not linked to a bank account.` };
        }
        resolvedHoldingId = directCardSource.linkedAccountId;
        paymentMode = 'debit_card';
        effectiveDebitCardId = directCardSource.id;
      } else if (directCardSource.cardType === 'credit' || !directCardSource.cardType) {
        // Pure Credit Card: Allowed for regular bills, strictly blocked for debt/liability bills & goal contributions
        if (b.isAutoLiabilityBill) {
          return {
            success: false,
            error: `Cannot pay "${b.name}" with credit card "${directCardSource.name}": Loan EMIs and Credit Card bills must be paid from positive liquid cash — you cannot settle a debt bill with another bill.`,
          };
        }
        if (b.isGoalContributionBill) {
          return {
            success: false,
            error: `Goal contributions cannot be funded using credit cards or credit limits. Please select a positive liquid bank or cash account.`,
          };
        }

        const creditLimit = directCardSource.creditLimit || directCardSource.limit || 100000;
        const availableCredit = Math.max(0, creditLimit - (directCardSource.outstanding || 0));
        if (b.amount > availableCredit) {
          return {
            success: false,
            error: `Insufficient available credit limit on "${directCardSource.name}". Available credit: ${availableCredit.toLocaleString()} ${directCardSource.currency}, required: ${b.amount.toLocaleString()} ${b.currency}.`,
          };
        }

        await updateLiability({
          ...directCardSource,
          outstanding: (directCardSource.outstanding || 0) + b.amount,
        });

        await recordTransactionOnly({
          id: `tx-bill-cc-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          kind: 'spend',
          amount: b.amount,
          currency: b.currency,
          fromId: directCardSource.id,
          reason: `Bill: ${b.name}`,
          category: b.category || 'Bills',
          tags: ['Bill Payment', 'Credit Card'],
          fxRateUsed: 1.0,
          notes: `Bill "${b.name}" (${b.amount.toLocaleString()} ${b.currency}) charged to credit card "${directCardSource.name}".`,
        });

        const manualBill = bills.find((x) => x.id === billId);
        if (manualBill) {
          await updateBill({ ...manualBill, lastPostedDate: new Date().toISOString().split('T')[0] });
        }

        return {
          success: true,
          cardUsageNote: `Charged ${b.amount.toLocaleString()} ${b.currency} to Credit Card (${directCardSource.name})`,
        };
      } else if (directCardSource.cardType === 'hybrid') {
        // Hybrid Card selected directly:
        // Route through linked bank account whenever linkedBank exists so the 3-tier cascade
        // (1. Positive Bank Cash -> 2. Strictly Linked Sweep-In FDs -> 3. Hybrid Card Credit Limit)
        // executes cleanly even when initial bank cash is 0 while linked Sweep-In FDs > 0.
        const linkedBank = holdingsRef.current.find((h) => h.id === directCardSource.linkedAccountId);
        if (linkedBank) {
          resolvedHoldingId = linkedBank.id;
          paymentMode = 'hybrid_card';
          effectiveDebitCardId = directCardSource.id;
        } else {
          // No linked bank account configured: Hybrid Card operates strictly in Credit Card mode
          if (b.isAutoLiabilityBill) {
            return {
              success: false,
              error: `"${directCardSource.name}" has no linked bank account and is operating in Credit Card mode. Loan EMIs and Card bills cannot be settled using credit limits.`,
            };
          }
          if (b.isGoalContributionBill) {
            return {
              success: false,
              error: `"${directCardSource.name}" has no linked bank account and is operating in Credit Card mode. Goal contributions cannot be funded using credit limits.`,
            };
          }

          const creditLimit = directCardSource.creditLimit || directCardSource.limit || 50000;
          const availableCredit = Math.max(0, creditLimit - (directCardSource.outstanding || 0));
          if (b.amount > availableCredit) {
            return {
              success: false,
              error: `Insufficient available credit limit on Hybrid Card "${directCardSource.name}" (Credit Mode). Available credit: ${availableCredit.toLocaleString()} ${directCardSource.currency}, required: ${b.amount.toLocaleString()} ${b.currency}.`,
            };
          }

          await updateLiability({
            ...directCardSource,
            outstanding: (directCardSource.outstanding || 0) + b.amount,
          });

          await recordTransactionOnly({
            id: `tx-bill-hybrid-cc-${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            kind: 'spend',
            amount: b.amount,
            currency: b.currency,
            fromId: directCardSource.id,
            reason: `Bill (Hybrid Credit Mode): ${b.name}`,
            category: b.category || 'Bills',
            tags: ['Bill Payment', 'Hybrid Card'],
            fxRateUsed: 1.0,
            notes: `Charged "${b.name}" (${b.amount.toLocaleString()} ${b.currency}) to "${directCardSource.name}" credit limit.`,
          });

          const manualBill = bills.find((x) => x.id === billId);
          if (manualBill) {
            await updateBill({ ...manualBill, lastPostedDate: new Date().toISOString().split('T')[0] });
          }

          return {
            success: true,
            hybridCreditNote: `Charged ${b.amount.toLocaleString()} ${b.currency} to ${directCardSource.name} credit limit`,
          };
        }
      }
    }

    const source = resolvedHoldingId;
    const asset = holdingsRef.current.find((h) => h.id === source);
    if (!asset) {
      return { success: false, error: 'Payment account not found. Please select a valid liquid account or card.' };
    }

    // Strictly block locked & market-linked assets (FD, RD, Stocks, Bonds, Mutual Funds, P2P) from paying bills directly
    if (isLockedOrMarketAsset(asset, assetTypes)) {
      return {
        success: false,
        error: `Locked or market-linked holdings ("${getSafeAssetName(asset, assetTypes)}") cannot be used directly to pay bills. Bills can only be paid using positive liquid cash/bank accounts (or eligible credit cards for non-debt bills).`,
      };
    }

    const availableCash = asset.principalOrValue || 0;
    const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(asset.id, holdingsRef.current);

    // Detect if payment is being made using a Hybrid Card
    const selectedCard = effectiveDebitCardId
      ? liabilitiesRef.current.find((l) => l.id === effectiveDebitCardId)
      : undefined;

    const linkedHybridCard = liabilitiesRef.current.find(
      (l) => l.kind === 'card' && l.cardType === 'hybrid' && l.linkedAccountId === asset.id
    );

    const isUsingHybridCard =
      paymentMode === 'hybrid_card' ||
      (selectedCard && selectedCard.cardType === 'hybrid') ||
      (paymentMode === 'debit_card' && linkedHybridCard && (!effectiveDebitCardId || effectiveDebitCardId === linkedHybridCard.id));

    const activeHybridCard =
      selectedCard && selectedCard.cardType === 'hybrid' ? selectedCard : linkedHybridCard;

    // Block non-positive liquid account when neither Sweep-In nor eligible Hybrid Credit applies
    if (availableCash <= 0 && totalSweepIn <= 0 && !isUsingHybridCard) {
      return {
        success: false,
        error: `Account "${getSafeAssetName(asset, assetTypes)}" has a non-positive balance (${availableCash.toLocaleString()} ${b.currency}). Bills can only be settled from positive liquid balances, linked Sweep-In FDs, or an eligible credit card for regular bills.`,
      };
    }

    const loanOverride =
      b.isAutoLiabilityBill && b.liabilityKind === 'loan' ? options?.loanSettlementOverride : undefined;
    const effectiveBillCashAmount = loanOverride
      ? safeAdd(loanOverride.principalAmount, loanOverride.prepaymentPenaltyCharge || 0)
      : b.amount;

    const isAccountDeficit = availableCash < effectiveBillCashAmount;

    let sweepInSummary = '';
    let hybridCreditNote = '';
    let cardUsageNote = '';
    let bankDeductAmt = Math.min(Math.max(0, availableCash), effectiveBillCashAmount);
    let sweepInDeductAmt = 0;
    let hybridCreditChargeAmt = 0;

    if (isAccountDeficit) {
      if (!isUsingHybridCard || b.isAutoLiabilityBill || b.isGoalContributionBill) {
        // Non-hybrid payment mode OR Debt/Goal bill (which strictly prohibits credit line usage)
        if (totalAvailable < effectiveBillCashAmount) {
          return {
            success: false,
            error: b.isAutoLiabilityBill
              ? `Cannot pay debt bill "${b.name}": Positive liquid balance in "${getSafeAssetName(asset, assetTypes)}" (${Math.max(0, availableCash).toLocaleString()}) plus linked Sweep-In FDs (${totalSweepIn.toLocaleString()}) is less than ${effectiveBillCashAmount.toLocaleString()} ${b.currency}. Debt obligations cannot use credit limits.`
              : b.isGoalContributionBill
              ? `Cannot fund goal "${b.name}": Positive liquid balance in "${getSafeAssetName(asset, assetTypes)}" (${Math.max(0, availableCash).toLocaleString()}) plus linked Sweep-In FDs (${totalSweepIn.toLocaleString()}) is less than ${effectiveBillCashAmount.toLocaleString()} ${b.currency}. Goals cannot use credit limits.`
              : `Insufficient liquid funds in "${getSafeAssetName(asset, assetTypes)}" (${Math.max(0, availableCash).toLocaleString()} + ${totalSweepIn.toLocaleString()} Sweep-In = ${totalAvailable.toLocaleString()} ${b.currency}) for bill of ${effectiveBillCashAmount.toLocaleString()} ${b.currency}.`,
          };
        }

        // Break Sweep-in FDs in LIFO order (credits +deficit into asset so asset now holds effectiveBillCashAmount)
        const deficit = effectiveBillCashAmount - Math.max(0, availableCash);
        sweepInDeductAmt = deficit;
        const sweepRes = await breakSweepInForDeficit(asset.id, deficit, `Bill: ${b.name}`);
        if (!sweepRes.success) {
          return { success: false, error: sweepRes.error };
        }
        bankDeductAmt = effectiveBillCashAmount;
        sweepInSummary = `Sweep-in used: ${sweepRes.brokenFds.map((f) => `${f.fdName} (-${f.amount.toLocaleString()})`).join(', ')}`;

        if (paymentMode === 'debit_card' && effectiveDebitCardId) {
          await logDebitCardAtmWithdrawal(effectiveDebitCardId, options?.atmZone || 'non_metro');
          const card = liabilitiesRef.current.find((l) => l.id === effectiveDebitCardId);
          cardUsageNote = `Debit Card (${card?.name || 'Card'}) usage logged (+1 transaction)`;
        }
      } else {
        // Eligible non-debt, non-goal bill using Hybrid Card:
        // 3-Tier Cascade: 1. Positive Bank Cash -> 2. Strictly Linked Sweep-In FDs (LIFO) -> 3. Hybrid Card Credit Limit (once Bank + Linked Sweep-In == 0)
        if (!activeHybridCard) {
          return {
            success: false,
            error: `Cannot pay bill: No active Hybrid Card linked to "${getSafeAssetName(asset, assetTypes)}".`,
          };
        }

        bankDeductAmt = Math.min(Math.max(0, availableCash), b.amount);
        let remainingDeficit = b.amount - bankDeductAmt;

        if (totalSweepIn > 0 && remainingDeficit > 0) {
          sweepInDeductAmt = Math.min(totalSweepIn, remainingDeficit);
          remainingDeficit -= sweepInDeductAmt;
        }

        hybridCreditChargeAmt = remainingDeficit;
        const creditLimit = activeHybridCard.creditLimit || activeHybridCard.limit || 50000;
        const currentOutstanding = activeHybridCard.outstanding || 0;
        const availableCredit = Math.max(0, creditLimit - currentOutstanding);

        if (hybridCreditChargeAmt > availableCredit) {
          return {
            success: false,
            error: `Cannot pay bill: Combined capacity across Bank Account (${bankDeductAmt.toLocaleString()}), Linked Sweep-In FDs (${sweepInDeductAmt.toLocaleString()}), and Hybrid Card Credit Limit (${availableCredit.toLocaleString()}) is ${(bankDeductAmt + sweepInDeductAmt + availableCredit).toLocaleString()} ${b.currency}, which is less than required ${b.amount.toLocaleString()} ${b.currency}.`,
          };
        }

        if (sweepInDeductAmt > 0) {
          const sweepRes = await breakSweepInForDeficit(asset.id, sweepInDeductAmt, `Bill: ${b.name} (Hybrid Split)`);
          if (!sweepRes.success) {
            return { success: false, error: sweepRes.error };
          }
          sweepInSummary = `Sweep-in FDs broken: ${sweepRes.brokenFds.map((f) => `${f.fdName} (-${f.amount.toLocaleString()})`).join(', ')}`;
        }

        const totalCashPortion = bankDeductAmt + sweepInDeductAmt;
        if (totalCashPortion > 0) {
          const curAsset = holdingsRef.current.find((h) => h.id === asset.id) || asset;
          const updatedBankBal = Math.max(0, (curAsset.principalOrValue || 0) - totalCashPortion);
          await updateHolding({
            ...curAsset,
            principalOrValue: updatedBankBal,
            isOverdraftActive: false,
            overdraftAmount: 0,
            overdraftAt: undefined,
          });
        }

        if (hybridCreditChargeAmt > 0) {
          const liveHybrid = liabilitiesRef.current.find((l) => l.id === activeHybridCard.id) || activeHybridCard;
          const newCardOutstanding = (liveHybrid.outstanding || 0) + hybridCreditChargeAmt;
          await updateLiability({
            ...liveHybrid,
            outstanding: newCardOutstanding,
            debitUsageCount: (liveHybrid.debitUsageCount || 0) + (totalCashPortion > 0 ? 1 : 0),
          });

          hybridCreditNote = `Charged ${hybridCreditChargeAmt.toLocaleString()} ${liveHybrid.currency} to ${liveHybrid.name} credit limit`;

          const creditTx: Transaction = {
            id: `tx-hybrid-credit-${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            kind: 'spend',
            amount: hybridCreditChargeAmt,
            currency: liveHybrid.currency,
            fromId: liveHybrid.id,
            reason: `Bill Payment (Hybrid Credit): ${b.name}`,
            category: b.category || 'Bills',
            tags: ['Bill Payment', 'Hybrid Card'],
            fxRateUsed: 1.0,
            notes: `Source bank & linked sweep-in reached 0; remaining deficit of ${hybridCreditChargeAmt.toLocaleString()} ${liveHybrid.currency} for "${b.name}" charged to ${liveHybrid.name} credit limit.`,
          };
          await recordTransactionOnly(creditTx);
        }

        if (totalCashPortion > 0) {
          await logDebitCardAtmWithdrawal(activeHybridCard.id, options?.atmZone || 'non_metro');
          cardUsageNote = `Hybrid Card (${activeHybridCard.name}) debit leg logged (+1 transaction)`;
        } else {
          cardUsageNote = `Hybrid Card (${activeHybridCard.name}) operated in Credit mode`;
        }
      }
    } else {
      // Account balance is SUFFICIENT (availableCash >= effectiveBillCashAmount)
      bankDeductAmt = effectiveBillCashAmount;
      if (paymentMode === 'debit_card' && effectiveDebitCardId) {
        await logDebitCardAtmWithdrawal(effectiveDebitCardId, options?.atmZone || 'non_metro');
        const card = liabilitiesRef.current.find((l) => l.id === effectiveDebitCardId);
        cardUsageNote = `Debit Card (${card?.name || 'Card'}) usage logged (+1 transaction)`;
      } else if (isUsingHybridCard && activeHybridCard) {
        await logDebitCardAtmWithdrawal(activeHybridCard.id, options?.atmZone || 'non_metro');
        cardUsageNote = `Hybrid Card (${activeHybridCard.name}) operated in Debit mode (+1 transaction)`;
      }
    }

    if (b.isAutoLiabilityBill && b.liabilityId) {
      if (b.liabilityKind === 'loan') {
        const res = loanOverride
          ? await payLoan(b.liabilityId, source, loanOverride.principalAmount, {
              isEmi: loanOverride.isEmi,
              prepaymentPenaltyCharge: loanOverride.prepaymentPenaltyCharge,
              updatedTenureMonths: loanOverride.updatedTenureMonths,
              updatedMonthlyEmi: loanOverride.updatedMonthlyEmi,
            })
          : await payLoan(b.liabilityId, source, b.amount, { isEmi: true });
        if (!res.success) return res;
      } else if (b.liabilityKind === 'card') {
        const res = await payCardWithCashback(b.liabilityId, source, b.amount, b.cashbackApplied || 0);
        if (!res.success) return res;
      }
    } else if (b.isGoalContributionBill && b.goalId) {
      const goal = goals.find((g) => g.id === b.goalId);
      if (!goal) return { success: false, error: 'Target goal not found.' };

      if (!isAccountDeficit || !isUsingHybridCard) {
        const currentAsset = holdingsRef.current.find((h) => h.id === source) || asset;
        const newBalance = Math.max(0, (currentAsset.principalOrValue || 0) - bankDeductAmt);
        await updateHolding({
          ...currentAsset,
          principalOrValue: newBalance,
          isOverdraftActive: false,
          overdraftAmount: 0,
          overdraftAt: undefined,
        });
      }

      const txId = `tx-goal-accum-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const todayStr = new Date().toISOString().split('T')[0];
      const modeLabel = isUsingHybridCard
        ? 'Hybrid Card'
        : paymentMode === 'debit_card'
        ? 'Debit Card'
        : paymentMode === 'cheque'
        ? 'Cheque'
        : paymentMode === 'imps'
        ? 'IMPS'
        : paymentMode === 'neft'
        ? 'NEFT'
        : 'UPI';

      const combinedNotes = [
        sweepInSummary,
        hybridCreditNote,
        `Goal contribution of ${b.amount.toLocaleString()} ${b.currency} from ${asset.name} towards "${goal.name}" (${modeLabel}). Goal ID: ${goal.id}.`,
      ].filter(Boolean).join(' | ');

      const recordedCashAmt = isAccountDeficit && isUsingHybridCard ? bankDeductAmt + sweepInDeductAmt : b.amount;
      const tx: Transaction = {
        id: txId,
        date: todayStr,
        kind: 'spend',
        amount: recordedCashAmt,
        currency: b.currency,
        fromId: source,
        reason: `Goal Contribution: ${goal.name}`,
        category: 'Savings & Goals',
        tags: ['Goal Contribution'],
        fxRateUsed: 1.0,
        notes: combinedNotes,
      };
      if (recordedCashAmt > 0 || !isUsingHybridCard) {
        await recordTransactionOnly(tx);
      }

      const newTxRecord: GoalTransactionRecord = {
        id: txId,
        date: todayStr,
        amount: b.amount,
        sourceAssetId: source,
        sourceAssetName: asset.name,
        ledgerTxId: txId,
        billId: b.id,
        notes: `Contribution from ${asset.name} via ${modeLabel}${sweepInSummary ? ` (${sweepInSummary})` : ''}`,
      };

      const updatedTransactions = [...(goal.transactions || []), newTxRecord];
      const newAccumulatedTotal = (goal.accumulatedTotal || 0) + b.amount;

      const updatedSources = (goal.sources || []).map((src) => {
        if (src.sourceId === source) {
          return {
            ...src,
            accumulatedAmount: (src.accumulatedAmount || 0) + b.amount,
          };
        }
        return src;
      });

      const isComplete = goal.cost > 0 && newAccumulatedTotal >= goal.cost;

      const updatedGoal: Goal = {
        ...goal,
        sources: updatedSources,
        accumulatedTotal: newAccumulatedTotal,
        transactions: updatedTransactions,
        isCompleted: isComplete ? true : false,
        paymentVerified: isComplete ? true : false,
        paymentTxId: isComplete ? txId : undefined,
        completedAt: isComplete ? (goal.completedAt || new Date().toISOString()) : undefined,
      };

      if (isComplete && !goal.isCompleted) {
        setReadyGoalNotification(updatedGoal);
      }

      setGoals((prev) => prev.map((g) => (g.id === goal.id ? updatedGoal : g)));
      await dbStorage.put('goals', updatedGoal);
    } else {
      // Regular manual or subscription bill
      if (!isAccountDeficit || !isUsingHybridCard) {
        const currentAsset = holdingsRef.current.find((h) => h.id === source) || asset;
        const newBalance = Math.max(0, (currentAsset.principalOrValue || 0) - bankDeductAmt);
        await updateHolding({
          ...currentAsset,
          principalOrValue: newBalance,
          isOverdraftActive: false,
          overdraftAmount: 0,
          overdraftAt: undefined,
        });
      }

      const modeLabel = isUsingHybridCard
        ? 'Hybrid Card'
        : paymentMode === 'debit_card'
        ? 'Debit Card'
        : paymentMode === 'cheque'
        ? 'Cheque'
        : paymentMode === 'imps'
        ? 'IMPS'
        : paymentMode === 'neft'
        ? 'NEFT'
        : 'UPI';

      const combinedNotes = [
        sweepInSummary,
        hybridCreditNote,
        `Payment of ${b.amount.toLocaleString()} ${b.currency} for "${b.name}" via ${modeLabel}.`,
      ].filter(Boolean).join(' | ');

      const recordedCashAmt = isAccountDeficit && isUsingHybridCard ? bankDeductAmt + sweepInDeductAmt : b.amount;
      if (recordedCashAmt > 0 || !isUsingHybridCard) {
        const tx: Transaction = {
          id: `tx-bill-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          kind: 'spend',
          amount: recordedCashAmt,
          currency: b.currency,
          fromId: source,
          reason: `Bill: ${b.name}`,
          category: b.category,
          tags: ['Bill Payment'],
          fxRateUsed: 1.0,
          notes: combinedNotes,
        };
        await recordTransactionOnly(tx);
      }
    }

    const manualBill = bills.find((x) => x.id === billId);
    if (manualBill) {
      await updateBill({ ...manualBill, lastPostedDate: new Date().toISOString().split('T')[0] });
    }

    return {
      success: true,
      sweepInNote: sweepInSummary,
      cardUsageNote,
      hybridCreditNote,
    };
  };

  const overrideBillPaid = async (
    billId: string,
    pin: string
  ): Promise<{ success: boolean; error?: string; isRepeated?: boolean; repeatCount?: number }> => {
    // 1. Authenticate with PIN
    const isPinConfigured = Boolean(settings.pinHash && settings.pinHash.trim() !== '' && settings.pinSalt);
    if (!isPinConfigured) {
      return { success: false, error: 'Vault PIN is not configured yet. Please configure your PIN first.' };
    }
    const isValid = await verifyPin(pin, settings.pinSalt, settings.pinHash);
    if (!isValid) {
      return { success: false, error: 'Incorrect Security PIN. Authorization denied.' };
    }

    const b = allBills.find((x) => x.id === billId);
    if (!b) return { success: false, error: 'Target bill not found.' };

    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthStr = todayStr.substring(0, 7);

    // 2. Track override history in localStorage to detect repeated overrides
    const OVERRIDES_STORAGE_KEY = 'networthiq_bill_overrides';
    interface BillOverrideHistoryItem {
      billId: string;
      billName: string;
      date: string;
      timestamp: number;
    }
    let overrideHistory: BillOverrideHistoryItem[] = [];
    try {
      const stored = localStorage.getItem(OVERRIDES_STORAGE_KEY);
      if (stored) overrideHistory = JSON.parse(stored);
    } catch {}

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recentOverridesForBill = overrideHistory.filter(
      (h) => h.billId === billId && h.timestamp >= thirtyDaysAgo
    );
    const repeatCount = recentOverridesForBill.length + 1;
    const isRepeated = recentOverridesForBill.length >= 1;

    // Append new override
    overrideHistory.push({
      billId,
      billName: b.name,
      date: todayStr,
      timestamp: now,
    });
    try {
      localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrideHistory));
    } catch {}

    // 3. Mark the bill as overridden in state and storage
    setOverriddenAutoBills((prev) => ({
      ...prev,
      [billId]: currentMonthStr,
    }));
    try {
      const autoOverridesKey = 'networthiq_auto_bill_overrides';
      const storedMap = JSON.parse(localStorage.getItem(autoOverridesKey) || '{}');
      storedMap[billId] = currentMonthStr;
      localStorage.setItem(autoOverridesKey, JSON.stringify(storedMap));
    } catch {}

    const manualBill = bills.find((x) => x.id === billId);
    if (manualBill) {
      await updateBill({
        ...manualBill,
        lastPostedDate: todayStr,
        lastOverriddenMonth: currentMonthStr,
        isOverriddenPaid: true,
        overrideCount: (manualBill.overrideCount || 0) + 1,
      });
    }

    // 4. Record explicit ledger adjustment transaction (Decoupled from artificial ML risk penalty buffers)
    const overrideTxId = `tx-override-${billId}-${Date.now()}`;
    const adjustmentTx: Transaction = {
      id: overrideTxId,
      date: todayStr,
      createdAt: new Date().toISOString(),
      kind: 'adjustment',
      amount: b.amount,
      currency: b.currency,
      toId: b.id,
      reason: `External Settlement: "${b.name}" cleared without bank debit (Virtual Override)`,
      category: 'Reversals & Corrections',
      tags: ['Virtual Override', 'External Settlement', 'Adjustment'],
      fxRateUsed: 1.0,
      notes: `Bill "${b.name}" (${b.amount.toLocaleString()} ${b.currency}) cleared externally without debiting user bank accounts. Explicit adjustment recorded.`,
      provenance: {
        source: 'verified',
        timestamp: new Date().toISOString(),
        notes: `Virtual bill override authorized for ${b.name}`,
        version: 1,
      },
    };
    await recordTransactionOnly(adjustmentTx);

    // 5. Clean behavioral feedback audit log (without distorting artificial weights or buffers)
    try {
      const ML_FEEDBACK_KEY = 'networthiq_ml_feedback_log';
      let feedbackLog: any[] = [];
      try {
        const storedLog = localStorage.getItem(ML_FEEDBACK_KEY);
        if (storedLog) feedbackLog = JSON.parse(storedLog);
      } catch {}
      feedbackLog.push({
        id: `ml-fb-override-${Date.now()}`,
        timestamp: new Date().toISOString(),
        feedbackType: 'external_settlement',
        note: `Bill "${b.name}" (${b.amount} ${b.currency}) settled externally. Recorded explicit adjustment in ledger under Reversals & Corrections without artificial risk penalty injection.`,
      });
      localStorage.setItem(ML_FEEDBACK_KEY, JSON.stringify(feedbackLog));
    } catch (e) {
      console.warn('ML feedback logging error on bill override:', e);
    }

    return {
      success: true,
      isRepeated,
      repeatCount,
    };
  };

  const undoBillOverride = async (billId: string) => {
    setOverriddenAutoBills((prev) => {
      const copy = { ...prev };
      delete copy[billId];
      return copy;
    });
    try {
      const autoOverridesKey = 'networthiq_auto_bill_overrides';
      const storedMap = JSON.parse(localStorage.getItem(autoOverridesKey) || '{}');
      delete storedMap[billId];
      localStorage.setItem(autoOverridesKey, JSON.stringify(storedMap));
    } catch {}

    const manualBill = bills.find((x) => x.id === billId);
    if (manualBill) {
      await updateBill({
        ...manualBill,
        isOverriddenPaid: false,
        lastOverriddenMonth: undefined,
      });
    }

    // Cleanly remove any adjustment transactions created for this bill override
    const matchingOverrideTxs = transactionsRef.current.filter(
      (t) =>
        t.kind === 'adjustment' &&
        (t.id.startsWith(`tx-override-${billId}`) ||
          (t.category === 'Reversals & Corrections' && t.toId === billId))
    );
    if (matchingOverrideTxs.length > 0) {
      const remainingTxs = transactionsRef.current.filter(
        (t) => !matchingOverrideTxs.some((m) => m.id === t.id)
      );
      commitTransactions(remainingTxs);
      for (const m of matchingOverrideTxs) {
        await dbStorage.delete('transactions', m.id);
      }
    }
  };

  const addIncomeStream = async (inc: IncomeStream) => {
    const updated = [...incomeStreams, inc];
    setIncomeStreams(updated);
    await dbStorage.put('incomeStreams', inc);
  };

  const updateIncomeStream = async (inc: IncomeStream) => {
    const updated = incomeStreams.map((i) => (i.id === inc.id ? inc : i));
    setIncomeStreams(updated);
    await dbStorage.put('incomeStreams', inc);
  };

  const deleteIncomeStream = async (id: string) => {
    const updated = incomeStreams.filter((i) => i.id !== id);
    setIncomeStreams(updated);
    await dbStorage.delete('incomeStreams', id);
  };

  const postSalary = async (incomeId: string) => {
    const inc = incomeStreams.find((i) => i.id === incomeId);
    if (!inc) return;

    const now = new Date();
    let effectiveDate = now.toISOString().split('T')[0];

    // If schedule is 'last_working_day', compute the exact last Monday-Friday
    if (inc.payScheduleType === 'last_working_day') {
      const lastWorkDay = getLastWorkingDayOfMonth(now.getFullYear(), now.getMonth());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(lastWorkDay).padStart(2, '0');
      effectiveDate = `${now.getFullYear()}-${mm}-${dd}`;
    }

    const tx: Transaction = {
      id: `tx-sal-${Date.now()}`,
      date: effectiveDate,
      kind: 'income',
      amount: inc.amountPerPeriod,
      currency: inc.currency,
      toId: inc.depositAccountId,
      reason: `Salary Credit: ${inc.name}`,
      category: 'Salary',
      fxRateUsed: 1.0,
    };
    await addTransaction(tx);
  };

  const recordExternalInflow = async (
    params: ExternalInflowParams
  ): Promise<{ success: boolean; error?: string; txId?: string; summary?: string }> => {
    const {
      sourceName,
      category,
      amount,
      currency,
      destinationType,
      targetAccountId,
      targetBillId,
      targetLiabilityId,
      earmarkedGoalId,
      date,
      notes,
    } = params;

    if (!amount || isNaN(amount) || amount <= 0) {
      return { success: false, error: 'Please specify a positive monetary inflow amount.' };
    }

    const txDate = date || new Date().toISOString().split('T')[0];
    const curr = currencies.find((c) => c.code === currency) || currencies.find((c) => c.code === settings.baseCurrency);
    const fxRate = curr?.rateToBase || 1.0;
    const txId = `tx-inflow-${Date.now()}`;

    // Scenario 1: Deposit into Bank Account or Cash Holding
    if (destinationType === 'account') {
      if (!targetAccountId) {
        return { success: false, error: 'Please select a destination account or holding.' };
      }
      const holding = holdingsRef.current.find((h) => h.id === targetAccountId);
      if (!holding) {
        return { success: false, error: 'Selected destination holding was not found.' };
      }

      // Update holding balance with safe arithmetic
      const newBal = safeAdd(holding.principalOrValue || 0, amount);
      await updateHolding({
        ...holding,
        principalOrValue: newBal,
        isOverdraftActive: newBal >= 0 ? false : holding.isOverdraftActive,
        overdraftAmount: newBal >= 0 ? 0 : holding.overdraftAmount,
      });

      // Record transaction
      const tx: Transaction = {
        id: txId,
        date: txDate,
        createdAt: new Date().toISOString(),
        kind: 'income',
        amount,
        currency,
        toId: holding.id,
        reason: `External Inflow: ${sourceName} (${category})`,
        category,
        tags: [
          'External Inflow',
          category,
          ...(earmarkedGoalId ? ['Goal Earmarked'] : []),
        ],
        fxRateUsed: fxRate,
        notes: notes || `One-time cash inflow from ${sourceName} credited to ${holding.name}.`,
      };
      await recordTransactionOnly(tx);

      // If earmarked for a goal, boost goal funding progress
      if (earmarkedGoalId) {
        const goal = goals.find((g) => g.id === earmarkedGoalId);
        if (goal) {
          const newAccum = safeAdd(goal.accumulatedTotal || 0, amount);
          const goalTx: GoalTransactionRecord = {
            id: `gtx-${Date.now()}`,
            date: txDate,
            amount,
            sourceAssetId: holding.id,
            sourceAssetName: holding.name,
            ledgerTxId: txId,
            notes: `External gift from ${sourceName}`,
          };
          const isNowCompleted = goal.cost > 0 && newAccum >= goal.cost;
          await updateGoal({
            ...goal,
            accumulatedTotal: newAccum,
            transactions: [...(goal.transactions || []), goalTx],
            isCompleted: isNowCompleted ? true : goal.isCompleted,
            completionNotified: isNowCompleted ? true : goal.completionNotified,
            completedAt: isNowCompleted ? goal.completedAt || txDate : goal.completedAt,
          });
        }
      }

      const summary = `Successfully recorded ${amount.toLocaleString()} ${currency} received from ${sourceName} into ${holding.name}.`;
      return { success: true, txId, summary };
    }

    // Scenario 2: Direct Third-Party Bill Payment (Outside Settlement)
    if (destinationType === 'direct_bill') {
      if (!targetBillId) {
        return { success: false, error: 'Please select a bill for direct settlement.' };
      }
      const b = bills.find((x) => x.id === targetBillId);
      if (!b) {
        return { success: false, error: 'Selected bill commitment was not found.' };
      }

      const billCost = b.amount || 0;
      const appliedToBill = Math.min(billCost, amount);
      const excessAfterBill = safeSub(amount, appliedToBill);

      // If it's a debt/loan liability bill, also reduce the actual liability balance!
      if (b.isAutoLiabilityBill && b.liabilityId) {
        const liveLiability = liabilitiesRef.current.find((l) => l.id === b.liabilityId);
        if (liveLiability) {
          const newOutstanding = Math.max(0, safeSub(liveLiability.outstanding || 0, appliedToBill));
          await updateLiability({
            ...liveLiability,
            outstanding: newOutstanding,
          });
        }
      }

      // Update the manual or recurring bill's lastPostedDate
      const manualBill = bills.find((x) => x.id === targetBillId);
      if (manualBill) {
        await updateBill({
          ...manualBill,
          lastPostedDate: txDate,
        });
      }

      // Record transaction ledger entry for the settled bill slice
      const tx: Transaction = {
        id: txId,
        date: txDate,
        createdAt: new Date().toISOString(),
        kind: 'income',
        amount: appliedToBill,
        currency,
        toId: b.id,
        reason: `External Settlement: Bill "${b.name}" paid by ${sourceName}`,
        category: 'External Settlement',
        tags: ['Direct Settlement', 'Paid by Loved One', category],
        fxRateUsed: fxRate,
        notes: notes || `Direct bill settlement paid outside the user accounts by ${sourceName}. User liquid accounts were not debited. Bill cleared.`,
      };
      await recordTransactionOnly(tx);

      // If earmarked for a goal linked to this bill
      if (b.isGoalContributionBill && b.goalId) {
        const goal = goals.find((g) => g.id === b.goalId);
        if (goal) {
          const newAccum = safeAdd(goal.accumulatedTotal || 0, appliedToBill);
          await updateGoal({
            ...goal,
            accumulatedTotal: newAccum,
            isCompleted: newAccum >= goal.cost ? true : goal.isCompleted,
          });
        }
      }

      // If excess was paid beyond the bill amount, deposit the remainder into primary bank account
      if (excessAfterBill > 0.005) {
        const primaryHolding = holdingsRef.current.find(
          (h) => h.liquidityClass === 'Immediate' || h.typeId === 'type-bank'
        );
        if (primaryHolding) {
          const newBal = safeAdd(primaryHolding.principalOrValue || 0, excessAfterBill);
          await updateHolding({
            ...primaryHolding,
            principalOrValue: newBal,
          });
        }

        const surplusTx: Transaction = {
          id: `tx-inflow-surplus-${Date.now()}`,
          date: txDate,
          createdAt: new Date().toISOString(),
          kind: 'income',
          amount: excessAfterBill,
          currency,
          toId: primaryHolding?.id,
          reason: `Excess Funds from ${sourceName} (Bill "${b.name}" settled): Deposited to ${primaryHolding?.name || 'Primary Account'}`,
          category: 'External Inflow',
          tags: ['Surplus Credited', 'Bill Settled Extra', category],
          fxRateUsed: fxRate,
          notes: `Bill "${b.name}" was fully cleared with ${appliedToBill} ${currency}. Remaining extra ${excessAfterBill} ${currency} credited to ${primaryHolding?.name || 'primary bank account'}.`,
        };
        await recordTransactionOnly(surplusTx);
      }

      const summary = excessAfterBill > 0.005
        ? `Bill "${b.name}" of ${appliedToBill.toLocaleString()} ${currency} cleared by ${sourceName}. Extra ${excessAfterBill.toLocaleString()} ${currency} added to your account.`
        : `Bill "${b.name}" of ${amount.toLocaleString()} ${currency} marked settled directly by ${sourceName} without debiting your accounts.`;
      return { success: true, txId, summary };
    }

    // Scenario 3: Direct Liability Paydown (Outside Debt Payoff)
    if (destinationType === 'direct_liability') {
      if (!targetLiabilityId) {
        return { success: false, error: 'Please select a loan or card liability to pay down.' };
      }
      const primaryLiability = liabilitiesRef.current.find((l) => l.id === targetLiabilityId);
      if (!primaryLiability) {
        return { success: false, error: 'Selected liability not found.' };
      }

      // Order liabilities: targeted first, then any other active debts with outstanding balances
      const otherDebts = liabilitiesRef.current
        .filter((l) => l.id !== targetLiabilityId && (l.outstanding || 0) > 0)
        .sort((a, b) => (b.ratePct || 0) - (a.ratePct || 0));

      const debtTargets = [primaryLiability, ...otherDebts];
      let remainingMoney = amount;
      let totalReduced = 0;
      let loanIdx = 0;

      for (const currentLiab of debtTargets) {
        if (remainingMoney <= 0.005) break;
        const currentBal = currentLiab.outstanding || 0;
        if (currentBal <= 0) continue;

        loanIdx++;
        const paySlice = Math.min(currentBal, remainingMoney);
        const newBal = Math.max(0, safeSub(currentBal, paySlice));

        let updatedStatements = currentLiab.statements;
        if (currentLiab.kind === 'card' && updatedStatements && updatedStatements.length > 0) {
          updatedStatements = updatedStatements.map((s, idx) => {
            if (idx === 0) {
              return {
                ...s,
                paidAmount: Math.min(s.amount, safeAdd(s.paidAmount || 0, paySlice)),
                actualPaidInLedger: safeAdd(s.actualPaidInLedger || 0, paySlice),
              };
            }
            return s;
          });
        }

        await updateLiability({
          ...currentLiab,
          outstanding: newBal,
          statements: updatedStatements,
        });

        const sliceTxId = `tx-debtpay-${currentLiab.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        const sliceTx: Transaction = {
          id: sliceTxId,
          date: txDate,
          createdAt: new Date().toISOString(),
          kind: currentLiab.kind === 'card' ? 'cardPayment' : 'emi',
          amount: paySlice,
          currency: currentLiab.currency,
          toId: currentLiab.id,
          reason: `Direct Debt Payoff: ${currentLiab.name} (Loan ${loanIdx}) paid by ${sourceName}`,
          category: 'Debt Payoff',
          tags: ['External Payoff', 'Direct Debt Relief', category],
          fxRateUsed: fxRate,
          notes: notes || `Direct liability reduction: ${sourceName} paid ${paySlice} ${currentLiab.currency} toward ${currentLiab.name}. Remaining debt on this loan: ${newBal}.`,
        };
        await recordTransactionOnly(sliceTx);

        totalReduced = safeAdd(totalReduced, paySlice);
        remainingMoney = safeSub(remainingMoney, paySlice);
      }

      // If all active debts are settled and excess funds remain, deposit surplus into primary bank account!
      if (remainingMoney > 0.005) {
        const primaryHolding = holdingsRef.current.find(
          (h) => h.liquidityClass === 'Immediate' || h.typeId === 'type-bank'
        );
        if (primaryHolding) {
          const newBal = safeAdd(primaryHolding.principalOrValue || 0, remainingMoney);
          await updateHolding({
            ...primaryHolding,
            principalOrValue: newBal,
          });
        }

        const surplusTx: Transaction = {
          id: `tx-debt-surplus-${Date.now()}`,
          date: txDate,
          createdAt: new Date().toISOString(),
          kind: 'income',
          amount: remainingMoney,
          currency,
          toId: primaryHolding?.id,
          reason: `Extra Funds from ${sourceName} (All Debts Cleared): Credited to ${primaryHolding?.name || 'Primary Bank Account'}`,
          category: 'External Inflow',
          tags: ['Surplus Credited', 'All Loans Settled', category],
          fxRateUsed: fxRate,
          notes: `Debts fully paid down with ${totalReduced} ${currency}. Remaining ${remainingMoney} ${currency} received from ${sourceName} deposited to ${primaryHolding?.name || 'primary bank account'}.`,
        };
        await recordTransactionOnly(surplusTx);
      }

      if (earmarkedGoalId) {
        const goal = goals.find((g) => g.id === earmarkedGoalId);
        if (goal) {
          const newAccum = safeAdd(goal.accumulatedTotal || 0, totalReduced);
          await updateGoal({
            ...goal,
            accumulatedTotal: newAccum,
            isCompleted: newAccum >= goal.cost,
          });
        }
      }

      const summary = remainingMoney > 0.005
        ? `Paid down ${totalReduced.toLocaleString()} ${currency} across debts directly by ${sourceName}. All debts settled! Extra ${remainingMoney.toLocaleString()} ${currency} credited to your account.`
        : `Paid down ${totalReduced.toLocaleString()} ${currency} on debts directly by ${sourceName}.`;
      return { success: true, txId, summary };
    }

    return { success: false, error: 'Invalid destination type specified.' };
  };

  const addGoal = async (goal: Goal) => {
    const updated = [...goals, goal];
    setGoals(updated);
    await dbStorage.put('goals', goal);

    // Synchronize target loan EMI if goal specifies monthly contribution
    if (goal.goalType === 'debt_payoff' && goal.targetLiabilityId && goal.monthlyContribution) {
      const targetLoan = liabilities.find((l) => l.id === goal.targetLiabilityId && l.kind === 'loan');
      if (targetLoan && targetLoan.monthlyEmi !== goal.monthlyContribution) {
        const updatedLoan: Liability = {
          ...targetLoan,
          monthlyEmi: goal.monthlyContribution,
        };
        setLiabilities((prev) => prev.map((l) => (l.id === updatedLoan.id ? updatedLoan : l)));
        await dbStorage.put('liabilities', updatedLoan);
      }
    }
  };

  const updateGoal = async (goal: Goal) => {
    const updated = goals.map((g) => (g.id === goal.id ? goal : g));
    setGoals(updated);
    await dbStorage.put('goals', goal);

    // Synchronize target loan EMI to keep loan goal and loan EMI identical
    if (goal.goalType === 'debt_payoff' && goal.targetLiabilityId && goal.monthlyContribution) {
      const targetLoan = liabilities.find((l) => l.id === goal.targetLiabilityId && l.kind === 'loan');
      if (targetLoan && targetLoan.monthlyEmi !== goal.monthlyContribution) {
        const updatedLoan: Liability = {
          ...targetLoan,
          monthlyEmi: goal.monthlyContribution,
        };
        setLiabilities((prev) => prev.map((l) => (l.id === updatedLoan.id ? updatedLoan : l)));
        await dbStorage.put('liabilities', updatedLoan);
      }
    }
  };

  const deleteGoal = async (id: string) => {
    const updated = goals.filter((g) => g.id !== id);
    setGoals(updated);
    await dbStorage.delete('goals', id);
  };

  const verifyGoalPaymentInLedger = (goalId: string): Transaction | undefined => {
    const goal = goals.find((g) => g.id === goalId);
    return transactions.find((t) =>
      t.tags?.includes(goalId) ||
      (t.tags?.includes('goal-fulfillment') && goal && t.reason?.toLowerCase().includes(goal.name.toLowerCase())) ||
      (goal && t.reason?.startsWith('[Goal Payment Confirmed]') && t.reason?.includes(goal.name))
    );
  };

  const payGoal = async (
    goalId: string,
    partialAmount?: number,
    paymentMode: GoalPaymentMode = 'upi',
    debitCardId?: string
  ): Promise<{
    success: boolean;
    error?: string;
    txId?: string;
    isPartial?: boolean;
    paidAmount?: number;
    remaining?: number;
  }> => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return { success: false, error: 'Target goal not found.' };

    const currentAccumulated = goal.accumulatedTotal || 0;
    const remainingToFull = Math.max(0, goal.cost - currentAccumulated);

    if (remainingToFull <= 0) {
      return { success: false, error: 'This goal is already 100% funded and completed.' };
    }

    // Determine if paying full remaining or partial increment per user rules:
    // "For a goal paying a partial money doesn't mean it's achieved and should be closed it's just that user decided to pay 30% each month so 30% is paid for now and next 30% will be due next month and a 30% in 3rd month and in 4th the last remaining is 10% so, 10% it is. Or if user decides to pay entirely then only it's completely completed if not it is not completed until it's paid in increments set by user"
    const isFullPay = !partialAmount || partialAmount >= remainingToFull;
    const amtToPay = isFullPay ? remainingToFull : Math.max(0, partialAmount);

    if (amtToPay <= 0) {
      return { success: false, error: 'Payment amount must be greater than zero.' };
    }

    // 1. Calculate deductions across linked assets proportionally
    const deductions: { holding: Holding; deductAmount: number }[] = [];
    let totalDeduction = 0;

    const liveHoldings = holdingsRef.current;
    if (goal.sources && goal.sources.length > 0) {
      for (const src of goal.sources) {
        // Strictly ignore any legacy credit card sources — goals can never draw on credit limits
        if (src.sourceType === 'credit_card' || liabilitiesRef.current.some((l) => l.id === src.sourceId)) {
          continue;
        }
        const h = liveHoldings.find((x) => x.id === src.sourceId);
        if (!h || isLockedOrMarketAsset(h, assetTypes)) continue;
        const { totalAvailable } = getAccountLiquidityWithSweepIn(h.id, liveHoldings);
        const assetVal = totalAvailable;
        let deductAmt = 0;
        if (src.allocationMode === 'fixed_amount' && src.allocationAmount && src.allocationAmount > 0) {
          const ratio = isFullPay ? 1 : amtToPay / remainingToFull;
          deductAmt = Math.min(assetVal, src.allocationAmount * ratio);
        } else {
          const pct = (src.allocationPct || 0) / 100;
          deductAmt = Math.min(assetVal, amtToPay * pct);
        }

        if (deductAmt > 0) {
          deductions.push({ holding: h, deductAmount: deductAmt });
          totalDeduction += deductAmt;
        }
      }
    }

    if (totalDeduction < amtToPay) {
      const remainder = amtToPay - totalDeduction;
      const fallbackHolding =
        liveHoldings.find((h) => h.id === goal.contributionSourceId && isSpendableLiquidHolding(h, assetTypes)) ||
        liveHoldings.find((h) => isSpendableLiquidHolding(h, assetTypes) && (h.principalOrValue || 0) > 0) ||
        liveHoldings.find((h) => isSpendableLiquidHolding(h, assetTypes));

      if (!fallbackHolding) {
        return {
          success: false,
          error: 'Goal payments require a positive unlocked liquid cash or bank account. Locked assets and credit cards cannot be used.',
        };
      }

      const existingIdx = deductions.findIndex((d) => d.holding.id === fallbackHolding.id);
      if (existingIdx >= 0) {
        deductions[existingIdx].deductAmount += remainder;
      } else {
        deductions.push({ holding: fallbackHolding, deductAmount: remainder });
      }
      totalDeduction += remainder;
    }

    // 2. Validate non-credit asset balances + Sweep-in rule
    for (const d of deductions) {
      const liveH = holdingsRef.current.find((h) => h.id === d.holding.id) || d.holding;
      const currentVal = liveH.units && liveH.currentPrice
        ? liveH.units * liveH.currentPrice
        : (liveH.principalOrValue || 0);

      const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(liveH.id, holdingsRef.current);

      if (currentVal < d.deductAmount) {
        if (totalSweepIn <= 0) {
          return {
            success: false,
            error: `Payment cannot go through: Insufficient liquid balance in "${liveH.name}" (${currentVal.toLocaleString()} ${liveH.currency}) and Sweep-In is NOT enabled. Required: ${d.deductAmount.toLocaleString()} ${liveH.currency}.`,
          };
        }
        if (totalAvailable < d.deductAmount) {
          return {
            success: false,
            error: `Payment cannot go through: Total balance across "${liveH.name}" and linked Sweep-In FDs (${totalAvailable.toLocaleString()} ${liveH.currency}) is less than required deduction (${d.deductAmount.toLocaleString()} ${liveH.currency}).`,
          };
        }
        const deficit = d.deductAmount - Math.max(0, currentVal);
        const sweepRes = await breakSweepInForDeficit(liveH.id, deficit, `Goal Payment: ${goal.name}`);
        if (!sweepRes.success) return { success: false, error: sweepRes.error };
      }
    }

    if (paymentMode === 'debit_card' && debitCardId) {
      await logDebitCardAtmWithdrawal(debitCardId, 'non_metro');
    }

    // 3. Deduct linked assets using live holdingsRef (which already reflects broken Sweep-In FDs)
    const updatedHoldingsMap = new Map(holdingsRef.current.map((h) => [h.id, h]));
    for (const d of deductions) {
      const current = updatedHoldingsMap.get(d.holding.id) || d.holding;
      const newBalance = Math.max(0, (current.principalOrValue || 0) - d.deductAmount);
      const updatedHolding: Holding = {
        ...current,
        principalOrValue: newBalance,
        isOverdraftActive: false,
        overdraftAmount: 0,
        overdraftAt: undefined,
      };
      updatedHoldingsMap.set(d.holding.id, updatedHolding);
    }
    const finalHoldingsList = Array.from(updatedHoldingsMap.values());
    commitHoldings(finalHoldingsList);
    for (const d of deductions) {
      const hObj = updatedHoldingsMap.get(d.holding.id);
      if (hObj) await dbStorage.put('holdings', hObj);
    }

    // 4. Create and record payment transaction in ledger WITHOUT double-deducting
    const txId = `tx-goal-${isFullPay ? 'fulfill' : 'partial'}-${Date.now()}`;
    const todayStr = new Date().toISOString().split('T')[0];
    const modeLabel = paymentMode === 'debit_card' ? 'Debit Card' : paymentMode === 'imps' ? 'IMPS' : paymentMode === 'neft' ? 'NEFT' : 'UPI';
    const pctOfGoal = Math.round((amtToPay / goal.cost) * 100);

    const paymentTx: Transaction = {
      id: txId,
      date: todayStr,
      kind: 'spend',
      amount: amtToPay,
      currency: goal.currency,
      fromId: deductions[0]?.holding.id,
      reason: isFullPay
        ? `Goal Completed: ${goal.name}`
        : `Goal Installment (${pctOfGoal}%): ${goal.name}`,
      category: 'Savings & Goals',
      tags: isFullPay ? ['Goal Fulfilled'] : ['Goal Contribution'],
      fxRateUsed: 1.0,
      notes: isFullPay
        ? `Full completion payment of ${amtToPay} ${goal.currency} for "${goal.name}" from ${deductions.map(d => `${d.holding.name} (-${d.deductAmount})`).join(', ')}. Goal ID: ${goal.id}.`
        : `Installment payment of ${amtToPay} ${goal.currency} (${pctOfGoal}%) for "${goal.name}". Remaining ${remainingToFull - amtToPay} ${goal.currency} due next month. Mode: ${modeLabel}. Goal ID: ${goal.id}.`,
    };
    await recordTransactionOnly(paymentTx);

    const txRecords: GoalTransactionRecord[] = deductions.map((d) => ({
      id: `${txId}-${d.holding.id}`,
      date: todayStr,
      amount: d.deductAmount,
      sourceAssetId: d.holding.id,
      sourceAssetName: d.holding.name,
      ledgerTxId: txId,
      notes: `User authorized payment from ${d.holding.name} via ${modeLabel}`,
    }));

    // Next installment due date calculation
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextDueMonth = nextDate.toISOString().substring(0, 7);

    const newAccumulatedTotal = currentAccumulated + amtToPay;
    const isNowFullyCompleted = newAccumulatedTotal >= goal.cost;

    const newHistoryItem = {
      id: `part-${Date.now()}`,
      date: todayStr,
      amount: amtToPay,
      percentage: pctOfGoal,
      txId,
      sourceName: deductions.map((d) => d.holding.name).join(', '),
      paymentMode,
      nextDueMonth: isNowFullyCompleted ? undefined : nextDueMonth,
    };

    const updatedGoal: Goal = {
      ...goal,
      accumulatedTotal: newAccumulatedTotal,
      transactions: [...(goal.transactions || []), ...txRecords],
      isCompleted: isNowFullyCompleted,
      paymentVerified: isNowFullyCompleted,
      paymentTxId: isNowFullyCompleted ? txId : goal.paymentTxId,
      completedAt: isNowFullyCompleted ? new Date().toISOString() : goal.completedAt,
      nextInstallmentDueMonth: isNowFullyCompleted ? undefined : nextDueMonth,
      partialPaymentsHistory: [...(goal.partialPaymentsHistory || []), newHistoryItem],
    };

    setGoals((prev) => prev.map((g) => (g.id === goal.id ? updatedGoal : g)));
    await dbStorage.put('goals', updatedGoal);

    const goalFx = currencies.find((c) => c.code === goal.currency)?.rateToBase || 1;
    const nextMlGoal = recordBehavioralOutcomeAndRetrain({
      domain: 'asset_allocation',
      subEventLabel: isNowFullyCompleted ? 'Goal Completed' : 'Goal Micro-Progress',
      ledgerRefId: `goal-pay-${txId}`,
      predictedSummary: `Advance goal "${goal.name}" using positive liquid surplus`,
      actualRealitySummary: `${isNowFullyCompleted ? 'Completed' : 'Funded'} ${amtToPay.toLocaleString()} ${goal.currency} toward "${goal.name}"`,
      wasSuccess: true,
      partialSuccess: !isNowFullyCompleted,
      microSavedBase: amtToPay * goalFx,
      isAssetGrowthSignal: true,
    });
    setClosedLoopMLState(nextMlGoal);

    return {
      success: true,
      txId,
      isPartial: !isNowFullyCompleted,
      paidAmount: amtToPay,
      remaining: Math.max(0, goal.cost - newAccumulatedTotal),
    };
  };

  // Verify confirmation of payment from ledger for any completed goals, silently marking them complete
  useEffect(() => {
    if (goals.length === 0 || transactions.length === 0) return;
    let hasChanges = false;
    const verifiedGoals = goals.map((g) => {
      if (g.isCompleted && g.paymentVerified) return g;
      const ledgerTx = transactions.find((t) =>
        t.tags?.includes(g.id) ||
        t.notes?.includes(g.id) ||
        (t.tags?.includes('Goal Fulfilled') && t.reason?.toLowerCase().includes(g.name.toLowerCase())) ||
        (t.reason?.toLowerCase().includes(g.name.toLowerCase()) && t.tags?.includes('Ledger Verified'))
      );
      if (ledgerTx) {
        hasChanges = true;
        return {
          ...g,
          isCompleted: true,
          paymentVerified: true,
          paymentTxId: ledgerTx.id,
          completedAt: g.completedAt || ledgerTx.date,
        };
      }
      // Check total accumulated from transactions if accumulatedTotal reaches or exceeds goal cost
      const goalTxs = transactions.filter((t) =>
        t.notes?.includes(g.id) ||
        t.tags?.includes(g.id) ||
        t.tags?.includes(`goal-${g.id}`) ||
        (t.reason?.toLowerCase().includes(g.name.toLowerCase()) && (t.tags?.includes('Goal Contribution') || t.tags?.includes('goal-accumulation')))
      );
      const totalAccum = goalTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
      if (g.cost > 0 && totalAccum >= g.cost) {
        hasChanges = true;
        const completeGoal: Goal = {
          ...g,
          accumulatedTotal: totalAccum,
          isCompleted: true,
          paymentVerified: true,
          completedAt: g.completedAt || goalTxs[goalTxs.length - 1]?.date || new Date().toISOString(),
        };
        if (!g.isCompleted) {
          setReadyGoalNotification(completeGoal);
        }
        return completeGoal;
      }
      return g;
    });

    if (hasChanges) {
      setGoals(verifiedGoals);
      for (const vg of verifiedGoals) {
        if (vg.isCompleted && vg.paymentVerified) {
          dbStorage.put('goals', vg);
        }
      }
    }
  }, [transactions, goals]);

  const clearReadyGoalNotification = () => {
    setReadyGoalNotification(null);
  };

  // Scheduled Transfers CRUD
  const addScheduledTransfer = async (transfer: ScheduledTransfer) => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const nextDate = transfer.nextExecutionDate || computeNextScheduledDate(transfer.dayOfMonth, transfer.frequency, today);
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const sanitized: ScheduledTransfer = {
      ...transfer,
      createdAt: transfer.createdAt || todayStr,
      nextExecutionDate: nextDate,
      lastExecutedMonth: transfer.lastExecutedMonth || (today.getDate() > transfer.dayOfMonth ? currentYearMonth : undefined),
    };
    const updated = [...scheduledTransfers, sanitized];
    setScheduledTransfers(updated);
    await dbStorage.put('scheduledTransfers', sanitized);
  };

  const updateScheduledTransfer = async (transfer: ScheduledTransfer) => {
    const today = new Date();
    const nextDate = transfer.nextExecutionDate || computeNextScheduledDate(transfer.dayOfMonth, transfer.frequency, today, transfer.lastExecutedMonth);
    const sanitized: ScheduledTransfer = {
      ...transfer,
      nextExecutionDate: nextDate,
    };
    const updated = scheduledTransfers.map((s) => (s.id === sanitized.id ? sanitized : s));
    setScheduledTransfers(updated);
    await dbStorage.put('scheduledTransfers', sanitized);
  };

  const deleteScheduledTransfer = async (id: string) => {
    const updated = scheduledTransfers.filter((s) => s.id !== id);
    setScheduledTransfers(updated);
    await dbStorage.delete('scheduledTransfers', id);
  };

  // Credit Score Tracking & Online RL Training
  const addCreditScore = async (record: CreditScoreRecord) => {
    const updated = [record, ...creditScores];
    setCreditScores(updated);
    await dbStorage.put('creditScores', record);

    // Online Reinforcement Learning Step
    const totalDebt = liabilities.reduce((s, l) => s + (l.outstanding || 0), 0);
    const totalAssets = holdings.reduce((s, h) => s + (h.principalOrValue || 0), 0);
    const creditCards = liabilities.filter((l) => l.kind === 'card' && (l.cardType === 'credit' || !l.cardType));
    let totalCardDebt = 0;
    let totalCardLimit = 0;
    for (const card of creditCards) {
      totalCardDebt += (card.outstanding || 0);
      if (card.limit) totalCardLimit += card.limit;
    }
    const utilPct = totalCardLimit > 0 ? (totalCardDebt / totalCardLimit) * 100 : 0;

    reinforceCreditScoreModel({
      actualScore: record.score,
      predictedScore: creditPrediction.predictedScore,
      creditCardUtilizationPct: utilPct,
      totalDebt,
      totalAssets,
    });
  };

  const deleteCreditScore = async (id: string) => {
    const updated = creditScores.filter((c) => c.id !== id);
    setCreditScores(updated);
    await dbStorage.delete('creditScores', id);
  };

  // Spend Categories CRUD
  const addSpendCategory = async (category: SpendCategoryConfig) => {
    const updated = dedupeSpendCategories([...spendCategories, category]);
    setSpendCategories(updated);
    await dbStorage.put('spendCategories', category);
  };

  const updateSpendCategory = async (category: SpendCategoryConfig) => {
    const updated = spendCategories.map((c) => (c.id === category.id ? category : c));
    setSpendCategories(updated);
    await dbStorage.put('spendCategories', category);
  };

  const deleteSpendCategory = async (id: string) => {
    const updated = spendCategories.filter((c) => c.id !== id);
    setSpendCategories(updated);
    await dbStorage.delete('spendCategories', id);
  };

  // Quick Chips CRUD
  const addQuickChip = async (chip: QuickSpendChip) => {
    const updated = dedupeQuickChips([...quickChips, chip]);
    setQuickChips(updated);
    await dbStorage.put('quickChips', chip);
  };

  const updateQuickChip = async (chip: QuickSpendChip) => {
    const updated = quickChips.map((c) => (c.id === chip.id ? chip : c));
    setQuickChips(updated);
    await dbStorage.put('quickChips', chip);
  };

  const deleteQuickChip = async (id: string) => {
    const updated = quickChips.filter((c) => c.id !== id);
    setQuickChips(updated);
    await dbStorage.delete('quickChips', id);
  };

  // Receivables CRUD & Collection
  const addReceivable = async (rec: Receivable) => {
    // Automatically net opposing balances for the same person on entry so reciprocal entries offset immediately
    const norm = normalizeCounterpartyName(rec.debtorName);
    const combined = [rec, ...receivables];
    const related = combined.filter((r) => normalizeCounterpartyName(r.debtorName) === norm);
    const { updatedRecords, totalOffsetAmount } = autoOffsetCounterpartyBalances(related);

    if (totalOffsetAmount > 0) {
      const map = new Map(updatedRecords.map((r) => [r.id, r]));
      const nextAll = combined.map((r) => map.get(r.id) || r);
      setReceivables(nextAll);
      await dbStorage.setAll('receivables', nextAll);
      return;
    }

    setReceivables(combined);
    await dbStorage.put('receivables', rec);
  };

  const updateReceivable = async (rec: Receivable) => {
    const updated = receivables.map((r) => (r.id === rec.id ? rec : r));
    setReceivables(updated);
    await dbStorage.put('receivables', rec);
  };

  const deleteReceivable = async (id: string) => {
    const updated = receivables.filter((r) => r.id !== id);
    setReceivables(updated);
    await dbStorage.delete('receivables', id);
  };

  const recordReceivableRepayment = async (
    receivableId: string,
    amount: number,
    depositAccountId?: string,
    date?: string,
    notes?: string,
    options?: {
      mode?: 'cash_deposit' | 'expense_offset';
      expenseDescription?: string;
    }
  ): Promise<{ success: boolean; error?: string; excessAdvanceAmount?: number; txId?: string }> => {
    const rec = receivables.find((r) => r.id === receivableId);
    if (!rec) return { success: false, error: 'Record not found' };
    if (amount <= 0) return { success: false, error: 'Repayment amount must be positive' };

    const effectiveMode: 'cash_deposit' | 'expense_offset' =
      options?.mode || (depositAccountId ? 'cash_deposit' : 'expense_offset');

    const recon = reconcileDebtorPaymentOrOffset({
      receivables,
      holdings: holdingsRef.current,
      transactions: transactionsRef.current,
      receivableId,
      debtorName: rec.debtorName,
      paidAmount: amount,
      mode: effectiveMode,
      depositAccountId: effectiveMode === 'cash_deposit' ? depositAccountId : undefined,
      expenseDescription: options?.expenseDescription,
      date,
      currency: rec.currency,
      notes,
    });

    if (!recon.success || !recon.newLedgerTransaction) {
      return { success: false, error: recon.error || 'Failed to reconcile repayment.' };
    }

    try {
      await dbStorage.runAcidTransaction([
        { storeName: 'receivables', mode: 'setAll', items: recon.updatedReceivables },
        { storeName: 'holdings', mode: 'setAll', items: recon.updatedHoldings },
        { storeName: 'transactions', mode: 'setAll', items: recon.updatedTransactions },
      ]);

      setReceivables(recon.updatedReceivables);
      commitHoldings(recon.updatedHoldings);
      commitTransactions(recon.updatedTransactions);

      if (recon.settledReceivableIds.length > 0) {
        await archiveSettledPeerLinks(
          new Set(recon.settledReceivableIds),
          rec.debtorName,
          date || new Date().toISOString().split('T')[0]
        );
      }

      return {
        success: true,
        excessAdvanceAmount: recon.excessAdvanceAmount,
        txId: recon.newLedgerTransaction.id,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Atomic repayment reconciliation failed and rolled back.',
      };
    }
  };

  const writeOffReceivable = async (id: string, reason?: string) => {
    const rec = receivables.find((r) => r.id === id);
    if (!rec) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const updatedRec: Receivable = {
      ...rec,
      outstandingAmount: 0,
      status: 'written_off',
      isArchived: true,
      archivedAt: todayStr,
      notes: reason ? `${rec.notes || ''} [Written Off: ${reason}]`.trim() : rec.notes,
    };
    await updateReceivable(updatedRec);
  };

  const archiveSettledPeerLinks = async (
    settledRecIds: Set<string>,
    peerName: string,
    payDate: string
  ) => {
    if (settledRecIds.size === 0 && !peerName) return;
    const normPeer = normalizeCounterpartyName(peerName);

    // Archive any manual bills linked to settled peer obligations
    let billsModified = false;
    const nextBills = bills.map((b) => {
      const matchesPeer =
        (b.peerName && normalizeCounterpartyName(b.peerName) === normPeer) ||
        settledRecIds.has(b.id);
      if (matchesPeer && !b.isArchived) {
        billsModified = true;
        return { ...b, isArchived: true, archivedAt: payDate };
      }
      return b;
    });
    if (billsModified) {
      setBills(nextBills);
      await dbStorage.setAll('bills', nextBills);
    }

    // Complete/archive any goals linked to settled peer records
    const linkedGoalIds = new Set(
      receivables
        .filter((r) => settledRecIds.has(r.id) && r.linkedGoalId)
        .map((r) => r.linkedGoalId!)
    );
    if (linkedGoalIds.size > 0) {
      const nextGoals = goals.map((g) =>
        linkedGoalIds.has(g.id) && !g.isCompleted
          ? { ...g, isCompleted: true, completedAt: payDate, completionNotified: true }
          : g
      );
      setGoals(nextGoals);
      await dbStorage.setAll('goals', nextGoals);
    }
  };

  const offsetCounterparty = async (debtorName: string): Promise<{ success: boolean; offsetAmount: number }> => {
    const norm = normalizeCounterpartyName(debtorName);
    const related = receivables.filter((r) => normalizeCounterpartyName(r.debtorName) === norm);
    if (related.length === 0) return { success: false, offsetAmount: 0 };

    const { updatedRecords, totalOffsetAmount } = autoOffsetCounterpartyBalances(related);
    if (totalOffsetAmount > 0) {
      const updatedMap = new Map(updatedRecords.map((r) => [r.id, r]));
      const nextRecs = receivables.map((r) => updatedMap.get(r.id) || r);
      setReceivables(nextRecs);
      await dbStorage.setAll('receivables', nextRecs);

      const settledIds = new Set(
        updatedRecords.filter((r) => r.status === 'collected').map((r) => r.id)
      );
      await archiveSettledPeerLinks(settledIds, debtorName, new Date().toISOString().split('T')[0]);
    }
    return { success: true, offsetAmount: totalOffsetAmount };
  };

  const repayBorrowedCounterparty = async (
    debtorName: string,
    amount: number,
    fromAccountId: string,
    notes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!debtorName.trim()) return { success: false, error: 'Name is required' };
    if (amount <= 0) return { success: false, error: 'Amount must be greater than 0' };
    if (!fromAccountId) return { success: false, error: 'Select a payment account' };

    const srcHolding = holdingsRef.current.find((h) => h.id === fromAccountId);
    if (srcHolding) {
      const { totalAvailable } = getAccountLiquidityWithSweepIn(fromAccountId);
      if (totalAvailable < amount) {
        return {
          success: false,
          error: `Insufficient bank cash (${formatMoney(totalAvailable, srcHolding.currency)}) to pay ${formatMoney(amount, srcHolding.currency)}.`,
        };
      }
      const posBal = Math.max(0, getHoldingLocalValue(srcHolding));
      if (amount > posBal) {
        await breakSweepInForDeficit(fromAccountId, amount - posBal, `Repay ${debtorName}`);
      }
    }

    const payDate = new Date().toISOString().split('T')[0];
    const txId = `tx-peer-repay-${Date.now()}`;

    await addTransaction({
      id: txId,
      date: payDate,
      kind: 'spend',
      amount,
      currency: settings.baseCurrency,
      fromId: fromAccountId,
      reason: `Paid Back ${debtorName.trim()}`,
      category: 'Shared Bills & Peers',
      tags: ['Peer Settlement', debtorName.trim()],
      fxRateUsed: 1.0,
      notes: notes || `Settled balance owed to ${debtorName.trim()}`,
      reconciled: true,
      provenance: createProvenance('user_entered', 'Repaid borrowed counterparty balance'),
    });

    const norm = normalizeCounterpartyName(debtorName);
    const activeBorrowed = receivables
      .filter((r) => normalizeCounterpartyName(r.debtorName) === norm && r.direction === 'borrowed' && isActiveCounterpartyRecord(r))
      .sort((a, b) => (b.interestRatePct || 0) - (a.interestRatePct || 0));

    let remainingAmt = amount;
    const modifiedRecs = [...receivables];
    const settledIds = new Set<string>();

    for (const b of activeBorrowed) {
      if (remainingAmt <= 0.005) break;
      const effectiveOwed = safeAdd(b.outstandingAmount, calculateAccruedInterest(b));
      const offsetChunk = Math.min(effectiveOwed, remainingAmt);
      const newOut = Math.max(0, safeSub(effectiveOwed, offsetChunk));
      const isSettled = newOut <= 0.01;
      if (isSettled) settledIds.add(b.id);

      const idx = modifiedRecs.findIndex((r) => r.id === b.id);
      if (idx !== -1) {
        modifiedRecs[idx] = {
          ...b,
          outstandingAmount: isSettled ? 0 : newOut,
          issueDate: !isSettled && (b.interestRatePct || 0) > 0 ? payDate : b.issueDate,
          status: isSettled ? 'collected' : 'partially_collected',
          isArchived: isSettled,
          archivedAt: isSettled ? payDate : b.archivedAt,
          actualDate: isSettled ? payDate : b.actualDate,
          repayments: [
            ...(b.repayments || []),
            {
              id: `rep-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              date: payDate,
              amount: offsetChunk,
              txId,
              notes: notes || `Paid back ${debtorName.trim()}`,
            },
          ],
        };
      }
      remainingAmt = safeSub(remainingAmt, offsetChunk);
    }

    if (remainingAmt > 0.01) {
      modifiedRecs.unshift({
        id: `rec-excess-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        debtorName: debtorName.trim(),
        currency: settings.baseCurrency,
        principalAmount: remainingAmt,
        outstandingAmount: remainingAmt,
        interestRatePct: 0,
        issueDate: payDate,
        confidencePct: 95,
        direction: 'lent',
        status: 'active',
        isArchived: false,
        fundingSourceId: fromAccountId,
        notes: `Overpayment / advance to ${debtorName.trim()}`,
        repayments: [],
        provenance: createProvenance('user_entered', 'Excess peer repayment recorded as receivable'),
      });
    }

    setReceivables(modifiedRecs);
    await dbStorage.setAll('receivables', modifiedRecs);
    await archiveSettledPeerLinks(settledIds, debtorName, payDate);
    return { success: true };
  };

  const payBillForCounterparty = async (params: {
    debtorName: string;
    billDescription: string;
    amount: number;
    paymentSourceId: string;
    category?: string;
    interestRatePct?: number;
    expectedDate?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const { debtorName, billDescription, amount, paymentSourceId, category, interestRatePct, expectedDate } = params;
    if (!debtorName.trim()) return { success: false, error: 'Counterparty name is required' };
    if (amount <= 0) return { success: false, error: 'Amount must be greater than 0' };

    const srcHolding = holdingsRef.current.find((h) => h.id === paymentSourceId);
    if (srcHolding) {
      const { totalAvailable } = getAccountLiquidityWithSweepIn(paymentSourceId);
      if (totalAvailable < amount) {
        return {
          success: false,
          error: `Insufficient funds in ${srcHolding.name} (${formatMoney(totalAvailable, srcHolding.currency)} available).`,
        };
      }
      const posBal = Math.max(0, getHoldingLocalValue(srcHolding));
      if (amount > posBal) {
        await breakSweepInForDeficit(paymentSourceId, amount - posBal, `Pay bill for ${debtorName}`);
      }
    }

    const payDate = new Date().toISOString().split('T')[0];
    const txId = `tx-counterparty-bill-${Date.now()}`;

    // 1. Debit payment source via a Spend transaction
    await addTransaction({
      id: txId,
      date: payDate,
      kind: 'spend',
      amount,
      currency: settings.baseCurrency,
      fromId: paymentSourceId,
      reason: `Paid Bill for ${debtorName.trim()}: ${billDescription}`,
      category: category || 'Bills & Utilities',
      tags: ['Counterparty Payment', 'Shared Bill', debtorName.trim()],
      fxRateUsed: 1.0,
      notes: `Paid ${billDescription} on behalf of ${debtorName.trim()}.`,
      reconciled: true,
      provenance: createProvenance('user_entered', 'Paid bill for counterparty'),
    });

    // 2. Offset borrowed obligations owed to this person first (highest interest rate first)
    const norm = normalizeCounterpartyName(debtorName);
    const activeBorrowed = receivables
      .filter(
        (r) =>
          normalizeCounterpartyName(r.debtorName) === norm &&
          r.direction === 'borrowed' &&
          isActiveCounterpartyRecord(r)
      )
      .sort((a, b) => (b.interestRatePct || 0) - (a.interestRatePct || 0));

    let remainingAmt = amount;
    const modifiedRecs = [...receivables];
    const settledIds = new Set<string>();

    for (const b of activeBorrowed) {
      if (remainingAmt <= 0.005) break;
      const effectiveOwed = safeAdd(b.outstandingAmount, calculateAccruedInterest(b));
      const offsetChunk = Math.min(effectiveOwed, remainingAmt);
      const newOut = Math.max(0, safeSub(effectiveOwed, offsetChunk));
      const isSettled = newOut <= 0.01;
      if (isSettled) settledIds.add(b.id);

      const idx = modifiedRecs.findIndex((r) => r.id === b.id);
      if (idx !== -1) {
        modifiedRecs[idx] = {
          ...b,
          outstandingAmount: isSettled ? 0 : newOut,
          issueDate: !isSettled && (b.interestRatePct || 0) > 0 ? payDate : b.issueDate,
          status: isSettled ? 'collected' : 'partially_collected',
          isArchived: isSettled,
          archivedAt: isSettled ? payDate : b.archivedAt,
          actualDate: isSettled ? payDate : b.actualDate,
          repayments: [
            ...(b.repayments || []),
            {
              id: `rep-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              date: payDate,
              amount: offsetChunk,
              txId,
              notes: `Offset by paying ${debtorName.trim()}'s bill: ${billDescription}`,
            },
          ],
        };
      }
      remainingAmt = safeSub(remainingAmt, offsetChunk);
    }

    // 3. Add any remaining excess to what they owe user (lent), grouped cleanly by interest rate
    if (remainingAmt > 0.01) {
      const rate = interestRatePct || 0;
      const newRec: Receivable = {
        id: `rec-bill-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        debtorName: debtorName.trim(),
        currency: settings.baseCurrency,
        principalAmount: remainingAmt,
        outstandingAmount: remainingAmt,
        interestRatePct: rate,
        issueDate: payDate,
        expectedDate,
        confidencePct: 90,
        direction: 'lent',
        status: 'active',
        isArchived: false,
        fundingSourceId: paymentSourceId,
        notes: `Paid ${billDescription} for ${debtorName.trim()}`,
        repayments: [],
        provenance: createProvenance('user_entered', 'Paid bill for counterparty'),
      };
      modifiedRecs.unshift(newRec);
    }

    setReceivables(modifiedRecs);
    await dbStorage.setAll('receivables', modifiedRecs);
    await archiveSettledPeerLinks(settledIds, debtorName, payDate);
    return { success: true };
  };

  const counterpartyPaidMyBill = async (params: {
    debtorName: string;
    billId?: string;
    billName: string;
    amount: number;
    date?: string;
    notes?: string;
  }): Promise<{ success: boolean; error?: string; excessAdvanceAmount?: number; txId?: string }> => {
    const { debtorName, billId, billName, amount, date, notes } = params;
    if (!debtorName.trim()) return { success: false, error: 'Counterparty name is required' };
    if (amount <= 0) return { success: false, error: 'Amount must be greater than 0' };

    const payDate = date || new Date().toISOString().split('T')[0];
    const currentMonth = payDate.slice(0, 7);

    // Prepare bill / liability / goal updates in memory first so everything commits in ONE atomic ACID transaction
    let nextBills = [...bills];
    let billsChanged = false;
    let nextLiabilities = liabilitiesRef.current.map((l) => ({ ...l }));
    let liabilitiesChanged = false;
    let nextGoals = [...goals];
    let goalsChanged = false;
    let nextOverriddenAutoBills: Record<string, string> | null = null;

    if (billId) {
      const matchedAutoOrManual = allBills.find((b) => b.id === billId);
      const manualBillIdx = nextBills.findIndex((b) => b.id === billId);

      if (manualBillIdx >= 0) {
        const manualBill = nextBills[manualBillIdx];
        nextBills[manualBillIdx] = {
          ...manualBill,
          isOverriddenPaid: true,
          lastOverriddenMonth: currentMonth,
          lastPostedDate: payDate,
          overrideCount: (manualBill.overrideCount || 0) + 1,
        };
        billsChanged = true;
      } else if (matchedAutoOrManual) {
        nextOverriddenAutoBills = { ...overriddenAutoBills, [billId]: currentMonth };

        if (matchedAutoOrManual.isAutoLiabilityBill && matchedAutoOrManual.liabilityId) {
          const liabIdx = nextLiabilities.findIndex((l) => l.id === matchedAutoOrManual.liabilityId);
          if (liabIdx >= 0) {
            const targetLiab = nextLiabilities[liabIdx];
            const cashbackUsed = matchedAutoOrManual.cashbackApplied || 0;
            const newOutstanding = Math.max(
              0,
              safeSub(targetLiab.outstanding || 0, safeAdd(amount, cashbackUsed))
            );
            nextLiabilities[liabIdx] = {
              ...targetLiab,
              outstanding: newOutstanding,
              accumulatedCashback:
                cashbackUsed > 0
                  ? Math.max(0, safeSub(targetLiab.accumulatedCashback || 0, cashbackUsed))
                  : targetLiab.accumulatedCashback,
            };
            liabilitiesChanged = true;

            if (targetLiab.kind === 'loan' && newOutstanding <= 0.01) {
              nextGoals = nextGoals.map((g) => {
                if (
                  (g.targetLiabilityId === targetLiab.id ||
                    (g.goalType === 'debt_payoff' &&
                      g.name.toLowerCase().includes(targetLiab.name.toLowerCase()))) &&
                  !g.isCompleted
                ) {
                  goalsChanged = true;
                  return {
                    ...g,
                    accumulatedTotal: g.cost,
                    isCompleted: true,
                    paymentVerified: true,
                    completedAt: payDate,
                    completionNotified: true,
                  };
                }
                return g;
              });
            }
          }
        }

        if (matchedAutoOrManual.goalId && !matchedAutoOrManual.isAutoLiabilityBill) {
          const gIdx = nextGoals.findIndex((x) => x.id === matchedAutoOrManual.goalId);
          if (gIdx >= 0) {
            const g = nextGoals[gIdx];
            const nextAccum = matchedAutoOrManual.isCompletedGoalBill
              ? Math.max(g.cost, g.accumulatedTotal || 0)
              : safeAdd(g.accumulatedTotal || 0, amount);
            const reachedFull =
              matchedAutoOrManual.isCompletedGoalBill || nextAccum >= g.cost - 0.01;
            nextGoals[gIdx] = {
              ...g,
              accumulatedTotal: nextAccum,
              isCompleted: reachedFull ? true : g.isCompleted,
              paymentVerified: reachedFull ? true : g.paymentVerified,
              completedAt: reachedFull ? payDate : g.completedAt,
              completionNotified: reachedFull ? true : g.completionNotified,
              transactions: [
                ...(g.transactions || []),
                {
                  id: `gtx-peer-${Date.now()}`,
                  date: payDate,
                  amount,
                  sourceAssetId: 'peer-offset',
                  sourceAssetName: `${debtorName.trim()} (Peer Settlement)`,
                  billId,
                  notes: notes || `Paid directly by ${debtorName.trim()}`,
                },
              ],
            };
            goalsChanged = true;
          }
        }
      }
    }

    // Execute Module 3 Principal Reconciliation + Main Ledger Cash Flow + Over-repayment Protection
    const recon = reconcileDebtorPaymentOrOffset({
      receivables,
      holdings: holdingsRef.current,
      transactions: transactionsRef.current,
      debtorName: debtorName.trim(),
      paidAmount: amount,
      mode: 'expense_offset',
      expenseDescription: billName,
      linkedBillId: billId,
      date: payDate,
      currency: settings.baseCurrency || 'INR',
      notes,
    });

    if (!recon.success || !recon.newLedgerTransaction) {
      return { success: false, error: recon.error || 'Failed to reconcile debt offset.' };
    }

    try {
      await dbStorage.runAcidTransaction([
        { storeName: 'receivables', mode: 'setAll', items: recon.updatedReceivables },
        { storeName: 'transactions', mode: 'setAll', items: recon.updatedTransactions },
        ...(billsChanged ? [{ storeName: 'bills' as const, mode: 'setAll' as const, items: nextBills }] : []),
        ...(liabilitiesChanged
          ? [{ storeName: 'liabilities' as const, mode: 'setAll' as const, items: nextLiabilities }]
          : []),
        ...(goalsChanged ? [{ storeName: 'goals' as const, mode: 'setAll' as const, items: nextGoals }] : []),
      ]);

      setReceivables(recon.updatedReceivables);
      commitTransactions(recon.updatedTransactions);
      if (billsChanged) setBills(nextBills);
      if (liabilitiesChanged) commitLiabilities(nextLiabilities);
      if (goalsChanged) setGoals(nextGoals);
      if (nextOverriddenAutoBills) {
        setOverriddenAutoBills(nextOverriddenAutoBills);
        try {
          localStorage.setItem(
            'networthiq_auto_bill_overrides',
            JSON.stringify(nextOverriddenAutoBills)
          );
        } catch {}
      }

      if (recon.settledReceivableIds.length > 0) {
        await archiveSettledPeerLinks(new Set(recon.settledReceivableIds), debtorName, payDate);
      }

      return {
        success: true,
        excessAdvanceAmount: recon.excessAdvanceAmount,
        txId: recon.newLedgerTransaction.id,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Atomic debt offset reconciliation failed and rolled back.',
      };
    }
  };

  const reconcileHoldingBalance = (holdingId: string): HoldingReconciliationReport => {
    const holding = holdingsRef.current.find((h) => h.id === holdingId);
    if (!holding) {
      return {
        holdingId,
        holdingName: 'Unknown',
        currentBalance: 0,
        recordedInflows: 0,
        recordedOutflows: 0,
        netLedgerFlow: 0,
        discrepancy: 0,
        isReconciled: true,
        status: 'exact',
        message: 'Account not found',
      };
    }
    return reconcileHolding(holding, transactionsRef.current);
  };

  // Currencies lookup map
  const currenciesMap = useMemo(() => {
    return currencies.reduce((acc, c) => ({ ...acc, [c.code]: c }), {} as Record<string, Currency>);
  }, [currencies]);

  // Cash Flow Forecast Engine
  const cashFlowForecast = useMemo<CashFlowForecastResult>(() => {
    return generateCashFlowForecast(
      holdings,
      liabilities,
      allBills,
      incomeStreams,
      receivables,
      currenciesMap,
      settings,
      { windowDays: 30, scenario: 'normal' }
    );
  }, [holdings, liabilities, allBills, incomeStreams, receivables, currenciesMap, settings]);

  const generateCustomForecast = (options?: ForecastOptions): CashFlowForecastResult => {
    return generateCashFlowForecast(
      holdingsRef.current,
      liabilitiesRef.current,
      allBills,
      incomeStreams,
      receivables,
      currenciesMap,
      settings,
      options
    );
  };

  // Centralized Proactive Notification & Obligation Conflict Engine
  const rawNotifications = useMemo<FinancialNotification[]>(() => {
    const list = generateCentralizedNotifications(
      cashFlowForecast,
      holdings,
      liabilities,
      allBills,
      incomeStreams,
      receivables,
      scheduledTransfers,
      rlRecommendations,
      goals,
      currenciesMap,
      settings
    );

    const smsAlerts: FinancialNotification[] = smsBalanceAlerts.map(({ stagingId, discrepancy }) => {
      const sym = currenciesMap[discrepancy.currency]?.symbol || '₹';
      return {
        id: `notif-sms-bal-${stagingId}`,
        type: 'balance_mismatch',
        severity: 'warning',
        title: `Balance Mismatch: ${discrepancy.holdingName}${discrepancy.accountLastDigits ? ` (··${discrepancy.accountLastDigits})` : ''}`,
        message: `Expected ${formatMoney(discrepancy.expectedAppBalance, discrepancy.currency, sym)} after ${discrepancy.direction === 'credit' ? '+' : '-'}${formatMoney(discrepancy.smsAmount, discrepancy.currency, sym)}, but SMS reports ${formatMoney(discrepancy.smsReportedBalance, discrepancy.currency, sym)} (${discrepancy.delta >= 0 ? '+' : ''}${formatMoney(discrepancy.delta, discrepancy.currency, sym)}).`,
        actionLabel: 'Investigate SMS',
        actionModal: 'sms_capture',
        actionTab: 'spend',
        timestamp: new Date().toISOString(),
        requiresAction: true,
      };
    });

    return [...smsAlerts, ...list];
  }, [
    cashFlowForecast,
    holdings,
    liabilities,
    allBills,
    incomeStreams,
    receivables,
    scheduledTransfers,
    rlRecommendations,
    goals,
    currenciesMap,
    settings,
    smsBalanceAlerts,
  ]);

  const notifications = useMemo(() => {
    const now = Date.now();
    return rawNotifications.filter((n) => {
      const entry = dismissedNotifications[n.id];
      if (!entry) return true;
      if (typeof entry === 'number') {
        return now > entry; // Show again if snooze duration has passed
      }
      return false; // Permanently dismissed
    });
  }, [rawNotifications, dismissedNotifications]);

  const dismissNotification = (id: string) => {
    const target = rawNotifications.find((n) => n.id === id);
    const requiresAction = Boolean(
      target?.requiresAction ||
        target?.severity === 'critical' ||
        id.startsWith('conflict-') ||
        id.startsWith('alert-cash-deficit') ||
        id.startsWith('overdue-rec-')
    );
    const wasPositive = target?.type === 'positive_milestone' || target?.type === 'goal_ready';

    const nextMl = recordAlertDismissalSignal({
      alertId: id,
      title: target?.title || id,
      requiresAction,
      wasPositiveMilestone: wasPositive,
    });
    setClosedLoopMLState(nextMl);

    // If action is genuinely required, snooze for 24h so it resurfaces if still unresolved; otherwise discard permanently
    const nextVal: boolean | number = requiresAction ? Date.now() + 24 * 60 * 60 * 1000 : true;
    setDismissedNotifications((prev) => {
      const updated = { ...prev, [id]: nextVal };
      try {
        localStorage.setItem('networthiq_dismissed_notifications', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const markAllNotificationsAsRead = () => {
    const updated: Record<string, boolean> = { ...readNotificationIds };
    for (const n of notifications) {
      updated[n.id] = true;
    }
    setReadNotificationIds(updated);
  };

  // Debt Intelligence Strategy Comparison
  const debtStrategyComparison = useMemo(() => {
    return evaluateDebtStrategies(
      liabilities,
      engineResult.freeCashBase,
      currenciesMap,
      settings
    );
  }, [liabilities, engineResult.freeCashBase, currenciesMap, settings]);

  // RL Recommendation Action Handlers
  const executeRLRecommendation = async (recId: string) => {
    const rec = rlRecommendations.find((r) => r.id === recId);
    if (!rec) return;

    // Execute internal transfer from bank to asset/debt
    const tx: Transaction = {
      id: `tx-rl-exec-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      kind: 'transfer',
      amount: rec.suggestedAmount,
      currency: settings.baseCurrency,
      fromId: rec.fromSourceId,
      toId: rec.toAssetId,
      reason: `[Smart Allocation] Transfer surplus from ${rec.fromSourceName} to ${rec.toAssetName}`,
      category: 'Investments',
      fxRateUsed: 1.0,
    };
    await addTransaction(tx);

    recordRLActionFeedback({
      recommendationId: recId,
      action: 'followed',
      isDebtPrepay: recId.includes('debt'),
    });
  };

  const dismissRLRecommendation = (recId: string, reason: string) => {
    recordRLActionFeedback({
      recommendationId: recId,
      action: 'dismissed',
      reason,
      isDebtPrepay: recId.includes('debt'),
    });
    setDismissedInsights((prev) => ({ ...prev, [recId]: true }));
  };

  // Insights Feed
  const rawInsights = useMemo(() => {
    return generateInsightsFeed(
      engineResult,
      taxResult,
      transactions,
      holdings,
      liabilities,
      goals,
      currencies,
      settings,
      new Date(),
      {
        receivables,
        closedLoopMLState,
        brokerUsageForecast,
      }
    );
  }, [
    engineResult,
    taxResult,
    transactions,
    holdings,
    liabilities,
    goals,
    currencies,
    settings,
    receivables,
    closedLoopMLState,
    brokerUsageForecast,
  ]);

  const insights = useMemo(() => {
    const now = Date.now();
    return rawInsights.filter((item) => {
      if (dismissedInsights[item.id]) return false;
      const snoozeUntil = snoozedInsights[item.id];
      if (snoozeUntil && new Date(snoozeUntil).getTime() > now) return false;
      return true;
    });
  }, [rawInsights, dismissedInsights, snoozedInsights]);

  const dismissInsight = (id: string) => {
    const target = rawInsights.find((x) => x.id === id);
    const isActionRequired =
      id === 'ins-critical-emi-risk' ||
      id === 'ins-freecash-low' ||
      id.startsWith('ins-card-overdue-');

    const nextMl = recordAlertDismissalSignal({
      alertId: id,
      title: target?.headline || id,
      requiresAction: isActionRequired,
      wasPositiveMilestone: target?.type === 'positive',
    });
    setClosedLoopMLState(nextMl);

    if (isActionRequired) {
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      setSnoozedInsights((prev) => ({ ...prev, [id]: until }));
    } else {
      setDismissedInsights((prev) => ({ ...prev, [id]: true }));
    }
  };

  // ML-Predicted Possible Bills from historical spending signatures + learned online bias
  const predictedBills = useMemo<PredictedBillsSummary>(() => {
    return predictPossibleBills(
      transactions,
      allBills,
      currencies,
      settings.baseCurrency || 'INR',
      new Date()
    );
  }, [transactions, allBills, currencies, settings.baseCurrency, onlineLearnerState.totalOnlineUpdates]);

  // Net Liquid Surplus & Per-Goal ML Contributor Plan (Strictly Positive Liquid Cash Only — Zero Credit Limits / Locked Assets)
  const goalLiquidPlan = useMemo<GoalLiquidSurplusPlan>(() => {
    return computeGoalLiquidSurplusPlan({
      goals,
      holdings,
      assetTypes,
      liabilities,
      allBills,
      incomeStreams,
      transactions,
      predictedBills,
      currenciesList: currencies,
      settings,
      minCashThresholdBase: engineResult.minCashThreshold,
      referenceDate: new Date(),
    });
  }, [
    goals,
    holdings,
    assetTypes,
    liabilities,
    allBills,
    incomeStreams,
    transactions,
    predictedBills,
    currencies,
    settings,
    engineResult.minCashThreshold,
  ]);

  // Continuous Online ML Learning on User's Live Spends, Categories, Salary Streams, and Partial-Month ("Half-Prediction") Trajectory
  useEffect(() => {
    if (!isInitialized) return;
    const res = syncOnlineLearnerWithData({
      transactions,
      incomeStreams,
      currenciesList: currencies,
      baseCurrency: settings.baseCurrency || 'INR',
      careerProfile: { ...careerProfile, age: careerProfile.age ?? settings.age },
      careerWeights: careerModelWeights,
      netWorthBase: engineResult.netWorthBase,
      referenceDate: new Date(),
    });
    if (res.didTrain) {
      setOnlineLearnerState(res.onlineState);
      if (res.careerWeightsUpdated) {
        setCareerModelWeights(res.careerWeightsUpdated);
      }
    }
  }, [isInitialized, transactions, incomeStreams, currencies, settings.baseCurrency, engineResult.netWorthBase]);

  // Closed-Loop Reality vs. Prediction Engine across all 5 domains (broker_fees, spending, earnings, asset_allocation, debt_strategy)
  useEffect(() => {
    if (!isInitialized) return;
    const baseCurr = settings.baseCurrency || 'INR';
    const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';
    const res = syncClosedLoopRealityEngine({
      transactions,
      receivables,
      holdings,
      liabilities,
      incomeStreams,
      assetTypes,
      currencies,
      baseCurrency: baseCurr,
      currSymbol: currSym,
      onlineState: onlineLearnerState,
      careerPrediction,
    });
    if (res.didUpdate) {
      setClosedLoopMLState(res.state);
    }
  }, [
    isInitialized,
    transactions,
    receivables,
    holdings,
    liabilities,
    incomeStreams,
    assetTypes,
    currencies,
    settings.baseCurrency,
    onlineLearnerState,
    careerPrediction,
  ]);

  // Regularly auto-update One-Tap Spend Chips & Spending Categories from ML spend frequency/recency patterns
  useEffect(() => {
    if (!isInitialized || transactions.length < 2) return;

    const validIds = new Set<string>();
    for (const h of holdings) {
      if (isSpendableLiquidHolding(h, assetTypes)) validIds.add(h.id);
    }
    for (const l of liabilities) {
      if (l.kind === 'card') validIds.add(l.id);
    }
    const fallbackId =
      holdings.find((h) => isSpendableLiquidHolding(h, assetTypes) && getHoldingLocalValue(h) > 0)?.id ||
      holdings.find((h) => isSpendableLiquidHolding(h, assetTypes))?.id;

    const { updatedChips, updatedCategories, chipsChanged, categoriesChanged } =
      deriveSmartSpendChipsAndCategories(transactions, quickChips, spendCategories, validIds, fallbackId);

    const safeChips = dedupeQuickChips(updatedChips);
    const safeCategories = dedupeSpendCategories(updatedCategories);

    if (chipsChanged || safeChips.length !== quickChips.length) {
      setQuickChips(safeChips);
      dbStorage.setAll('quickChips', safeChips);
    }
    if (categoriesChanged || safeCategories.length !== spendCategories.length) {
      setSpendCategories(safeCategories);
      dbStorage.setAll('spendCategories', safeCategories);
    }
  }, [isInitialized, transactions, holdings.length, liabilities.length]);

  const snoozeInsight = (id: string, days: number) => {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    setSnoozedInsights((prev) => ({ ...prev, [id]: until }));
  };

  const wipeAllData = async () => {
    await dbStorage.clearAll();
    localStorage.clear();
    commitHoldings([]);
    commitLiabilities([]);
    setIncomeStreams([]);
    commitTransactions([]);
    setBills([]);
    setGoals([]);
    setSales([]);
    setSnapshots([]);
    setScheduledTransfers([]);
    setCreditScores([]);
    setSpendCategories(DEFAULT_SPEND_CATEGORIES);
    setQuickChips(DEFAULT_QUICK_CHIPS);
    setReceivables([]);
    commitSmsRuleOverrides([]);
    commitSmsStagingQueue([]);
    setSettingsState(DEFAULT_SETTINGS);
    setThemeState(THEME_PRESETS[0]);
    setCurrencies(DEFAULT_CURRENCIES);
    setAssetTypes(BUILT_IN_ASSET_TYPES);
    setTaxRulesState(DEFAULT_TAX_RULES);
    setOverriddenAutoBills({});
    setDismissedInsights({});
    setSnoozedInsights({});
    setDismissedNotifications({});
    setDismissedAttentionItems({});
    setCareerProfile({
      currentRole: '',
      yearsOfExperience: 0,
      education: 'bachelors_tech',
      industry: '',
      targetCompanyType: 'all',
      previousSalaries: [],
      careerTransitions: [],
    });
    setCareerModelWeights(DEFAULT_CAREER_WEIGHTS);
    setOnlineLearnerState(DEFAULT_ONLINE_LEARNER_STATE);
    saveOnlineLearnerState(DEFAULT_ONLINE_LEARNER_STATE);
    setClosedLoopMLState(DEFAULT_CLOSED_LOOP_ML_STATE);
    saveClosedLoopMLState(DEFAULT_CLOSED_LOOP_ML_STATE);
    setIsLocked(true);
    try {
      localStorage.setItem('networthiq_vault_locked', 'true');
    } catch {}
  };

  const exportFullBackup = (): string => {
    const mlReplicationState: FullMLReplicationState = {
      ...exportFullMLReplicationState({
        creditPrediction,
        careerPrediction,
        predictedBills,
        rlRecommendations,
        goalLiquidPlan,
        brokerUsageForecast,
        overriddenAutoBills,
        dismissedInsights,
        snoozedInsights,
      }),
      smsRuleOverrides: smsRuleOverridesRef.current,
      smsStagingQueue: smsStagingQueueRef.current,
    };

    const payload = {
      version: 4,
      exportedAt: new Date().toISOString(),
      appName: 'NetWorthIQ',
      settings: {
        ...settings,
        age: settings.age ?? careerProfile.age,
      },
      theme,
      currencies,
      assetTypes,
      holdings,
      liabilities,
      incomeStreams,
      transactions,
      bills,
      goals,
      sales,
      taxRules,
      snapshots,
      scheduledTransfers,
      creditScores,
      spendCategories,
      quickChips,
      receivables,
      smsRuleOverrides: smsRuleOverridesRef.current,
      smsStagingQueue: smsStagingQueueRef.current,
      careerProfile: {
        ...careerProfile,
        age: careerProfile.age ?? settings.age,
      },
      careerModelWeights,
      onlineLearnerState,
      mlReplicationState,
    };
    return JSON.stringify(payload, null, 2);
  };

  const restoreMasterEntities = async (
    payload: {
      holdings?: Holding[];
      liabilities?: Liability[];
      transactions?: Transaction[];
      bills?: Bill[];
      goals?: Goal[];
      incomeStreams?: IncomeStream[];
      creditScores?: CreditScoreRecord[];
      receivables?: Receivable[];
      settingsPartial?: Partial<AppSettings>;
      careerProfile?: CareerProfile;
      mlBundle?: FullMLReplicationState;
    },
    mode: 'append' | 'replace' = 'replace'
  ) => {
    if (payload.settingsPartial && Object.keys(payload.settingsPartial).length > 0) {
      const nextSettings = { ...settings, ...payload.settingsPartial };
      setSettingsState(nextSettings);
      await dbStorage.setSingleton('settings', nextSettings);
    }

    if (payload.holdings && payload.holdings.length > 0) {
      const nextHoldings = mode === 'replace' ? payload.holdings : [...holdingsRef.current, ...payload.holdings];
      commitHoldings(nextHoldings);
      await dbStorage.setAll('holdings', nextHoldings);
    }

    if (payload.liabilities && payload.liabilities.length > 0) {
      const nextLiabs = mode === 'replace' ? payload.liabilities : [...liabilitiesRef.current, ...payload.liabilities];
      commitLiabilities(nextLiabs);
      await dbStorage.setAll('liabilities', nextLiabs);
    }

    if (payload.transactions && payload.transactions.length > 0) {
      const nextTxs = mode === 'replace' ? payload.transactions : [...payload.transactions, ...transactionsRef.current];
      commitTransactions(nextTxs);
      await dbStorage.setAll('transactions', nextTxs);
    }

    if (payload.bills && payload.bills.length > 0) {
      const nextBills = mode === 'replace' ? payload.bills : [...bills, ...payload.bills];
      setBills(nextBills);
      await dbStorage.setAll('bills', nextBills);
    }

    if (payload.goals && payload.goals.length > 0) {
      const nextGoals = mode === 'replace' ? payload.goals : [...goals, ...payload.goals];
      setGoals(nextGoals);
      await dbStorage.setAll('goals', nextGoals);
    }

    if (payload.incomeStreams && payload.incomeStreams.length > 0) {
      const nextIncome = mode === 'replace' ? payload.incomeStreams : [...incomeStreams, ...payload.incomeStreams];
      setIncomeStreams(nextIncome);
      await dbStorage.setAll('incomeStreams', nextIncome);
    }

    if (payload.creditScores && payload.creditScores.length > 0) {
      const nextScores = mode === 'replace' ? payload.creditScores : [...creditScores, ...payload.creditScores];
      setCreditScores(nextScores);
      await dbStorage.setAll('creditScores', nextScores);
    }

    if (payload.receivables && payload.receivables.length > 0) {
      const nextRecs = mode === 'replace' ? payload.receivables : [...receivables, ...payload.receivables];
      setReceivables(nextRecs);
      await dbStorage.setAll('receivables', nextRecs);
    }

    if (payload.careerProfile) {
      const mergedProfile: CareerProfile = {
        ...careerProfile,
        ...payload.careerProfile,
      };
      setCareerProfile(mergedProfile);
      saveCareerProfile(mergedProfile);
    }

    if (payload.mlBundle) {
      const restored = restoreFullMLReplicationState(payload.mlBundle);
      if (restored.careerProfile) setCareerProfile(restored.careerProfile);
      if (restored.careerModelWeights) setCareerModelWeights(restored.careerModelWeights);
      if (restored.onlineSpendIncomeState) setOnlineLearnerState(restored.onlineSpendIncomeState);
      if (restored.closedLoopMLState) setClosedLoopMLState(restored.closedLoopMLState);
      if (restored.overriddenAutoBills) setOverriddenAutoBills(restored.overriddenAutoBills);
      if (restored.dismissedInsights) setDismissedInsights(restored.dismissedInsights);
      if (restored.snoozedInsights) setSnoozedInsights(restored.snoozedInsights);
    }
  };

  const importFullBackup = async (jsonString: string): Promise<boolean> => {
    try {
      const data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object') return false;

      if (data.settings) {
        setSettingsState(data.settings);
        await dbStorage.setSingleton('settings', data.settings);
      }
      if (data.theme) {
        setThemeState(data.theme);
        await dbStorage.setSingleton('theme', data.theme);
      }
      if (data.currencies) {
        setCurrencies(data.currencies);
        await dbStorage.setAll('currencies', data.currencies);
      }
      if (data.assetTypes) {
        setAssetTypes(data.assetTypes);
        await dbStorage.setAll('assetTypes', data.assetTypes);
      }
      if (data.holdings) {
        commitHoldings(data.holdings);
        await dbStorage.setAll('holdings', data.holdings);
      }
      if (data.liabilities) {
        commitLiabilities(data.liabilities);
        await dbStorage.setAll('liabilities', data.liabilities);
      }
      if (data.transactions) {
        commitTransactions(data.transactions);
        await dbStorage.setAll('transactions', data.transactions);
      }
      if (data.incomeStreams) {
        setIncomeStreams(data.incomeStreams);
        await dbStorage.setAll('incomeStreams', data.incomeStreams);
      }
      if (data.bills) {
        setBills(data.bills);
        await dbStorage.setAll('bills', data.bills);
      }
      if (data.goals) {
        setGoals(data.goals);
        await dbStorage.setAll('goals', data.goals);
      }
      if (data.sales) {
        setSales(data.sales);
        await dbStorage.setAll('sales', data.sales);
      }
      if (data.taxRules) {
        setTaxRulesState(data.taxRules);
        await dbStorage.setSingleton('taxRules', data.taxRules);
      }
      if (data.snapshots) {
        setSnapshots(data.snapshots);
        await dbStorage.setAll('snapshots', data.snapshots);
      }
      if (data.scheduledTransfers) {
        setScheduledTransfers(data.scheduledTransfers);
        await dbStorage.setAll('scheduledTransfers', data.scheduledTransfers);
      }
      if (data.creditScores) {
        setCreditScores(data.creditScores);
        await dbStorage.setAll('creditScores', data.creditScores);
      }
      if (data.spendCategories) {
        const cleaned = dedupeSpendCategories(data.spendCategories);
        setSpendCategories(cleaned);
        await dbStorage.setAll('spendCategories', cleaned);
      }
      if (data.quickChips) {
        const cleaned = dedupeQuickChips(data.quickChips);
        setQuickChips(cleaned);
        await dbStorage.setAll('quickChips', cleaned);
      }
      if (data.receivables) {
        setReceivables(data.receivables);
        await dbStorage.setAll('receivables', data.receivables);
      }

      // Backward-compatible Schema v4 restore (supports v1, v2, v3, and v4 archives; defaults SMS stores to [] if absent)
      const incomingOverrides: SmsRuleOverride[] =
        data.sms_rule_overrides ||
        data.smsRuleOverrides ||
        data.mlReplicationState?.smsRuleOverrides ||
        [];
      commitSmsRuleOverrides(incomingOverrides);
      await dbStorage.setAll('sms_rule_overrides', incomingOverrides);

      const incomingStaging: StagedSmsItem[] =
        data.sms_staging_queue ||
        data.smsStagingQueue ||
        data.mlReplicationState?.smsStagingQueue ||
        [];
      commitSmsStagingQueue(incomingStaging);
      await dbStorage.setAll('sms_staging_queue', incomingStaging);

      // Restore full ML weights, career profile, half-predictions, and online learner state
      const mlBundle: FullMLReplicationState = {
        ...(data.mlReplicationState || {}),
        careerProfile: data.careerProfile || data.mlReplicationState?.careerProfile,
        careerModelWeights: data.careerModelWeights || data.mlReplicationState?.careerModelWeights,
        onlineSpendIncomeState: data.onlineLearnerState || data.mlReplicationState?.onlineSpendIncomeState,
        closedLoopMLState: data.closedLoopMLState || data.mlReplicationState?.closedLoopMLState,
      };
      const restored = restoreFullMLReplicationState(mlBundle);
      if (restored.careerProfile) setCareerProfile(restored.careerProfile);
      if (restored.careerModelWeights) setCareerModelWeights(restored.careerModelWeights);
      if (restored.onlineSpendIncomeState) setOnlineLearnerState(restored.onlineSpendIncomeState);
      if (restored.closedLoopMLState) setClosedLoopMLState(restored.closedLoopMLState);
      if (restored.overriddenAutoBills) setOverriddenAutoBills(restored.overriddenAutoBills);
      if (restored.dismissedInsights) setDismissedInsights(restored.dismissedInsights);
      if (restored.snoozedInsights) setSnoozedInsights(restored.snoozedInsights);

      return true;
    } catch (e) {
      console.error('Failed to import backup:', e);
      return false;
    }
  };

  const unlockApp = () => {
    try {
      localStorage.setItem('networthiq_vault_locked', 'false');
    } catch {}
    setIsLocked(false);
  };

  const lockApp = () => {
    try {
      localStorage.setItem('networthiq_vault_locked', 'true');
    } catch {}
    setActiveModal(null);
    setIsLocked(true);
  };

  const logoutApp = () => {
    try {
      localStorage.setItem('networthiq_vault_locked', 'true');
    } catch {}
    setActiveModal(null);
    setIsLocked(true);
  };

  return (
    <AppContext.Provider
      value={{
        settings,
        theme,
        currencies,
        assetTypes,
        holdings,
        liabilities,
        incomeStreams,
        transactions,
        bills: allBills,
        rawBills: bills,
        goals,
        sales,
        taxRules,
        snapshots,
        insights,
        scheduledTransfers,
        creditScores,
        spendCategories,
        quickChips,
        receivables,
        smsRuleOverrides,
        smsStagingQueue,
        smsPermissionStatus,

        engineResult,
        taxResult,
        tickerValue,
        continuousEngineStats,
        attentionItems,
        dismissAttentionItem,
        creditPrediction,
        rlRecommendations,
        predictedBills,
        goalLiquidPlan,
        onlineLearnerState,
        closedLoopMLState,
        brokerUsageForecast,
        cashFlowForecast,
        debtStrategyComparison,
        notifications,
        dismissNotification,
        markAllNotificationsAsRead,
        readNotificationIds,

        activeTab,
        setActiveTab,
        activeModal,
        setActiveModal,
        isLocked,
        unlockApp,
        lockApp,
        logoutApp,

        updateSettings,
        updateTheme,
        updateTaxRules,

        addCurrency,
        updateCurrency,
        deleteCurrency,

        addHolding,
        updateHolding,
        deleteHolding,
        updateHoldingValuesBulk,
        sellHolding,
        addHoldingsBulk,

        addAssetType,
        updateAssetType,
        deleteAssetType,

        addLiability,
        updateLiability,
        deleteLiability,
        addLiabilitiesBulk,
        payCard,
        payCardWithCashback,
        convertCardToEmi,
        logCardCashback,
        getCardEffectiveMode,
        payLoan,
        predictLoanPayment,
        recordStrategyOutcome,
        logDebitCardAtmWithdrawal,

        addTransaction,
        addTransactionsBulk,
        updateTransaction,
        deleteTransaction,
        reverseTransaction,
        reversalAuditLogs,
        anomalies,
        dismissAnomaly,

        addBill,
        updateBill,
        deleteBill,
        addBillsBulk,
        postBill,
        overrideBillPaid,
        undoBillOverride,

        triggerSweepInAutoBreak,
        getAccountLiquidityWithSweepIn,
        breakSweepInForDeficit,

        addIncomeStream,
        updateIncomeStream,
        deleteIncomeStream,
        postSalary,
        recordExternalInflow,

        addGoal,
        updateGoal,
        deleteGoal,
        payGoal,
        verifyGoalPaymentInLedger,
        readyGoalNotification,
        clearReadyGoalNotification,

        addScheduledTransfer,
        updateScheduledTransfer,
        deleteScheduledTransfer,

        addCreditScore,
        deleteCreditScore,

        addSpendCategory,
        updateSpendCategory,
        deleteSpendCategory,
        addQuickChip,
        updateQuickChip,
        deleteQuickChip,

        addReceivable,
        updateReceivable,
        deleteReceivable,
        recordReceivableRepayment,
        writeOffReceivable,
        payBillForCounterparty,
        counterpartyPaidMyBill,
        repayBorrowedCounterparty,
        offsetCounterparty,

        requestSmsAccessAndSync,
        ingestSmsMessages,
        commitStagedSmsItem,
        discardStagedSmsItem,
        flagSmsTransaction,
        deleteSmsRuleOverride,
        smsBalanceAlerts,
        resolveSmsBalanceAlert,

        generateCustomForecast,
        reconcileHoldingBalance,

        executeRLRecommendation,
        dismissRLRecommendation,

        dismissInsight,
        snoozeInsight,

        careerProfile,
        careerPrediction,
        careerModelWeights,
        updateCareerProfile,
        tuneCareerModel,
        logCareerTransition,
        resetCareerModelWeights,

        wipeAllData,
        importFullBackup,
        exportFullBackup,
        restoreMasterEntities,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

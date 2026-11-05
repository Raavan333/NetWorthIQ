/**
 * Reinforcement Learning & Predictive ML Engine for NetWorthIQ
 *
 * Implements:
 * 1. Credit Score Online Predictive Model with Gradient-based Reinforcement Learning
 * 2. Cashflow Surplus & Asset Movement Reinforcement Learning Policy Optimizer
 * 3. Confidence score estimation & feedback-driven weight updates
 */

import {
  AppSettings,
  AssetType,
  Bill,
  CreditScorePrediction,
  Currency,
  Goal,
  GoalContributorSuggestion,
  GoalLiquidSurplusPlan,
  GoalMLAssessment,
  Holding,
  IncomeStream,
  Liability,
  PredictedBillItem,
  PredictedBillsSummary,
  QuickSpendChip,
  RLModelWeights,
  RLMovementRecommendation,
  SpendCategoryConfig,
  Transaction,
  CareerProfile,
  CareerPredictionResult,
  CareerModelWeights,
  CareerFeedbackRecord,
  CareerTransitionRecord,
  EducationLevel,
  PreviousSalaryRecord,
  OnlineSpendIncomeModelState,
  FullMLReplicationState,
  MLInvestmentModelWeights,
  MLModelFeedbackRecord,
  Receivable,
  EngagementStrategyStyle,
  RealityCheckDomain,
  BrokerCardFeeProfile,
  BrokerUsageForecast,
  PredictedLoanPaymentPlan,
  RealityCheckOutcomeRecord,
  ClosedLoopMLState,
} from '../types';
import { convertToBase, getHoldingLocalValue } from './calcEngine';
import { getSafeAssetName, getSafeLiabilityName, isPositiveLiquidHolding, isSpendableLiquidHolding } from './assetRules';
import { formatMoney } from './formatters';
import { calculateContractualEmi, evaluateDebtStrategies } from './debtEngine';
import {
  getLoanLockInStatus,
  calculateLoanPrepaymentCharge,
  resolveRemainingTenureMonths,
  simulateLoanPrepayment,
} from './loanPrepaymentEngine';

const CREDIT_MODEL_STORAGE_KEY = 'networthiq_ml_credit_weights';
const RL_POLICY_STORAGE_KEY = 'networthiq_ml_rl_policy';

export interface CreditModelWeights {
  utilizationWeight: number; // impact of credit card utilization
  debtRatioWeight: number;   // impact of debt to assets
  paymentHistoryWeight: number; // consistency of on-time payments
  tenureWeight: number;      // credit age / loan tenure stability
  debitAtmLeakageWeight: number; // impact of debit card ATM fee leakage (>3 monthly uses / quota exceeded)
  debitLiquidityWeight: number;  // positive reinforcement for healthy debit card liquidity buffer
  bias: number;
  confidenceScore: number;   // 0 - 100%
  updateCount: number;
  lastUpdated: string;
}

const DEFAULT_CREDIT_WEIGHTS: CreditModelWeights = {
  utilizationWeight: -2.8,   // sharp drop as card utilization rises >30%
  debtRatioWeight: -0.6,
  paymentHistoryWeight: 1.8,
  tenureWeight: 0.4,
  debitAtmLeakageWeight: -1.2, // penalty for avoidable ATM surcharge bleed
  debitLiquidityWeight: 1.5,   // bonus for disciplined debit spend avoiding debt
  bias: 760,                 // baseline prime credit score
  confidenceScore: 82,
  updateCount: 0,
  lastUpdated: new Date().toISOString(),
};

const DEFAULT_RL_WEIGHTS: RLModelWeights = {
  policyWeights: {
    highYieldSweep: 1.2,
    debtPrepay: 1.5,
    liquiditySafety: 1.0,
  },
  explorationRate: 0.15,     // epsilon
  learningRate: 0.1,        // alpha
  confidenceScore: 74,
  totalDecisions: 0,
  successfulTransfers: 0,
};

export function getStoredCreditWeights(): CreditModelWeights {
  try {
    const raw = localStorage.getItem(CREDIT_MODEL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // fallback
  }
  return { ...DEFAULT_CREDIT_WEIGHTS };
}

export function saveCreditWeights(weights: CreditModelWeights): void {
  try {
    localStorage.setItem(CREDIT_MODEL_STORAGE_KEY, JSON.stringify(weights));
  } catch (e) {
    console.error('Failed to persist credit ML weights', e);
  }
}

export function getStoredRLWeights(): RLModelWeights {
  try {
    const raw = localStorage.getItem(RL_POLICY_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // fallback
  }
  return { ...DEFAULT_RL_WEIGHTS };
}

export function saveRLWeights(weights: RLModelWeights): void {
  try {
    localStorage.setItem(RL_POLICY_STORAGE_KEY, JSON.stringify(weights));
  } catch (e) {
    console.error('Failed to persist RL weights', e);
  }
}

/**
 * Predicts Credit Score (300 - 900) based on financial attributes & trained weights
 */
export function predictCreditScore(params: {
  creditCardUtilizationPct: number;
  totalDebt: number;
  totalAssets: number;
  onTimePaymentRatio?: number; // 0.0 to 1.0
  activeTenureMonths?: number;
  debitCardAtmOverages?: number; // count of ATM withdrawals beyond free quota
  debitToCreditSpendRatio?: number; // balance of cashflow through debit vs credit
}): CreditScorePrediction {
  const weights = getStoredCreditWeights();
  const util = Math.max(0, params.creditCardUtilizationPct);
  const debtToAsset = params.totalAssets > 0 ? Math.min(params.totalDebt / params.totalAssets, 3) : 1;
  const paymentRatio = params.onTimePaymentRatio ?? 0.98;
  const tenure = Math.min((params.activeTenureMonths ?? 24) / 12, 10); // normalized years
  const atmOverages = Math.max(0, params.debitCardAtmOverages || 0);
  const debitRatio = Math.min(2, Math.max(0, params.debitToCreditSpendRatio || 0.5));

  // Nonlinear penalty if utilization crosses 30%
  const utilPenaltyFactor = util > 30 ? Math.pow((util - 30) / 10, 1.4) * 1.5 : 0;

  // Debit card ATM leakage penalty (repeated high usage triggers bank fee erosion)
  const debitFeePenalty = atmOverages * (weights.debitAtmLeakageWeight || -1.2) * 5;

  // Healthy debit card liquidity backing reward (disciplined debit usage avoiding high-APR credit debt)
  const debitLiquidityReward = debitRatio * (weights.debitLiquidityWeight || 1.5) * 4;

  const rawScore =
    weights.bias +
    weights.utilizationWeight * (util * 0.4 + utilPenaltyFactor * 10) +
    weights.debtRatioWeight * (debtToAsset * 50) +
    weights.paymentHistoryWeight * ((paymentRatio - 0.5) * 100) +
    weights.tenureWeight * (tenure * 10) +
    debitFeePenalty +
    debitLiquidityReward;

  const predictedScore = Math.round(Math.min(900, Math.max(300, rawScore)));
  const isHighUtilization = util > 30;

  const isBaseline = (weights.updateCount || 0) === 0;
  let evidenceStatus: 'sufficient' | 'sparse' | 'insufficient' = 'sufficient';
  let missingEvidenceReason: string | undefined = undefined;

  if (params.totalAssets <= 0 && params.totalDebt <= 0) {
    evidenceStatus = 'insufficient';
    missingEvidenceReason = 'No active assets or liabilities logged yet to establish credit baseline.';
  } else if (isBaseline) {
    evidenceStatus = 'sparse';
    missingEvidenceReason = 'Cold start heuristic baseline. Needs 1+ verified bureau score updates to train weights.';
  }

  return {
    predictedScore,
    confidenceScore: isBaseline ? Math.min(65, weights.confidenceScore) : weights.confidenceScore,
    creditUtilizationPct: Math.round(util * 10) / 10,
    isHighUtilization,
    weights: {
      utilization: weights.utilizationWeight,
      paymentHistory: weights.paymentHistoryWeight,
      debtRatio: weights.debtRatioWeight,
      bias: weights.bias,
    },
    lastModelUpdate: weights.lastUpdated,
    isBaselineHeuristic: isBaseline,
    sampleCount: weights.updateCount || 0,
    evidenceStatus,
    missingEvidenceReason,
  };
}

/**
 * Performs Reinforcement / Online Learning on the Credit Score model
 * when the user inputs an authentic credit score update (e.g. from CIBIL or Experian)
 */
export function reinforceCreditScoreModel(params: {
  actualScore: number;
  predictedScore: number;
  creditCardUtilizationPct: number;
  totalDebt: number;
  totalAssets: number;
}): CreditModelWeights {
  const weights = getStoredCreditWeights();
  const error = params.actualScore - params.predictedScore;
  const learningRate = 0.05;

  const util = Math.max(0, params.creditCardUtilizationPct) / 100;
  const debtToAsset = params.totalAssets > 0 ? Math.min(params.totalDebt / params.totalAssets, 2) : 1;

  // Gradient descent weight adjustments
  weights.bias += Math.round(learningRate * error * 0.5 * 10) / 10;
  weights.utilizationWeight += (learningRate * error * -util * 0.1);
  weights.debtRatioWeight += (learningRate * error * -debtToAsset * 0.05);

  // Keep weights within plausible boundaries
  weights.utilizationWeight = Math.min(-0.5, Math.max(-6.0, weights.utilizationWeight));
  weights.debtRatioWeight = Math.min(-0.1, Math.max(-2.5, weights.debtRatioWeight));
  weights.bias = Math.min(840, Math.max(620, weights.bias));

  // Increase confidence as prediction error converges
  const absError = Math.abs(error);
  if (absError <= 15) {
    weights.confidenceScore = Math.min(96, weights.confidenceScore + 3);
  } else if (absError <= 35) {
    weights.confidenceScore = Math.min(90, weights.confidenceScore + 1);
  } else {
    weights.confidenceScore = Math.max(65, weights.confidenceScore - 2);
  }

  weights.updateCount += 1;
  weights.lastUpdated = new Date().toISOString();
  saveCreditWeights(weights);

  return weights;
}

/**
 * Evaluates bank balances vs higher-yielding assets to generate
 * smart cashflow movement recommendations powered by Reinforcement Learning
 */
export function evaluateSurplusCashflowMovement(
  holdings: Holding[],
  liabilities: Liability[],
  freeCash: number,
  safetyBuffer: number = 25000
): RLMovementRecommendation[] {
  const recommendations: RLMovementRecommendation[] = [];
  const rlState = getStoredRLWeights();

  // Find bank accounts with significant balance yielding <= 3%
  const bankHoldings = holdings.filter(
    (h) => h.typeId === 'type-bank' && (h.fixedRatePct || 2.5) <= 3.5 && h.principalOrValue > safetyBuffer * 1.5
  );

  if (bankHoldings.length === 0) return recommendations;

  // Find high-yielding investment assets (Mutual funds, Stocks, FDs yielding > 6%)
  const investmentAssets = holdings.filter(
    (h) => (h.typeId === 'type-mf' || h.typeId === 'type-stock-in' || h.typeId === 'type-stock-us' || h.typeId === 'type-fd') &&
      ((h.expectedRatePct || h.fixedRatePct || 10) > 6)
  );

  // Check high-interest liabilities first (e.g. credit cards or loans > 10%)
  const highInterestDebts = liabilities.filter((l) => l.outstanding > 0 && l.ratePct >= 10);

  for (const bank of bankHoldings) {
    const surplus = bank.principalOrValue - safetyBuffer;
    if (surplus <= 5000) continue;

    const suggestedAmount = Math.round(surplus * 0.6); // suggest moving 60% of surplus
    const bankYield = bank.fixedRatePct || 2.5;

    if (highInterestDebts.length > 0 && rlState.policyWeights.debtPrepay >= rlState.policyWeights.highYieldSweep) {
      const topDebt = [...highInterestDebts].sort((a, b) => b.ratePct - a.ratePct)[0];
      if (!topDebt) continue;
      // Strictly hard-cap debt recommendation to outstanding balance (never exceed liability outstanding)
      const debtCappedAmount = Math.min(suggestedAmount, Math.max(0, Math.round(topDebt.outstanding)));
      if (debtCappedAmount <= 0) continue;
      const annualInterestSaved = Math.round(debtCappedAmount * ((topDebt.ratePct - bankYield) / 100));

      recommendations.push({
        id: `rl-rec-debt-${bank.id}-${topDebt.id}`,
        fromSourceId: bank.id,
        fromSourceName: bank.name,
        fromYieldPct: bankYield,
        toAssetId: topDebt.id,
        toAssetName: topDebt.name,
        toYieldPct: topDebt.ratePct,
        suggestedAmount: debtCappedAmount,
        annualPotentialGain: annualInterestSaved,
        status: 'pending',
        createdDate: new Date().toISOString(),
        confidencePct: Math.round(rlState.confidenceScore),
      });
      continue;
    }

    // Prioritize investments based on:
    // "Primarily goal: maximize the earnings in a highly secure way so prioritize large cap over small cap,
    // bank account and fds over stocks and stocks over p2p lendings and so on."
    if (investmentAssets.length > 0) {
      const topAsset = [...investmentAssets].sort(
        (a, b) => computeRiskAdjustedSecurityScore(b) - computeRiskAdjustedSecurityScore(a)
      )[0];
      const targetYield = topAsset.expectedRatePct || topAsset.fixedRatePct || 11.5;
      const annualGain = Math.round(suggestedAmount * ((targetYield - bankYield) / 100));

      const isHighRisk = topAsset.riskLevel === 'high_risk' || topAsset.riskLevel === 'speculative' || topAsset.typeId.includes('p2p') || topAsset.marketCapCategory === 'small_cap';

      recommendations.push({
        id: `rl-rec-asset-${bank.id}-${topAsset.id}`,
        fromSourceId: bank.id,
        fromSourceName: bank.name,
        fromYieldPct: bankYield,
        toAssetId: topAsset.id,
        toAssetName: topAsset.name,
        toYieldPct: targetYield,
        suggestedAmount,
        annualPotentialGain: annualGain,
        status: 'pending',
        createdDate: new Date().toISOString(),
        confidencePct: Math.round(rlState.confidenceScore),
        riskWarning: isHighRisk
          ? 'Risk Warning: This asset carries higher market/default risk. Consider Bank FDs and Large Cap equities first for capital preservation.'
          : undefined,
      });
    }
  }

  return recommendations;
}

/**
 * Computes risk-adjusted security score for assets to maximize earnings in a secure way.
 * Hierarchy: Bank Accounts & FDs > Large Cap Stocks > Mid Cap > Small Cap > P2P Lending
 */
export function computeRiskAdjustedSecurityScore(asset: Holding): number {
  const yieldPct = asset.expectedRatePct || asset.fixedRatePct || 7.0;

  let securityMultiplier = 1.0;
  let riskPenalty = 0;

  const isBankOrFd = asset.typeId === 'type-bank' || asset.typeId === 'type-fd' || Boolean(asset.isSweepIn);
  const isP2P = asset.typeId.includes('p2p') || asset.name.toLowerCase().includes('p2p');
  const isLargeCap = asset.marketCapCategory === 'mega_cap' || asset.marketCapCategory === 'large_cap';
  const isSmallCap = asset.marketCapCategory === 'small_cap';

  if (asset.riskLevel === 'ultra_safe' || isBankOrFd) {
    securityMultiplier = 1.5; // Highest priority for capital preservation
    riskPenalty = 0;
  } else if (asset.riskLevel === 'low_risk' || isLargeCap) {
    securityMultiplier = 1.35; // Large cap prioritized over small cap
    riskPenalty = 0.5;
  } else if (asset.riskLevel === 'moderate_risk') {
    securityMultiplier = 1.1;
    riskPenalty = 1.5;
  } else if (asset.riskLevel === 'high_risk' || isSmallCap) {
    securityMultiplier = 0.8;
    riskPenalty = 3.5;
  } else if (asset.riskLevel === 'speculative' || isP2P) {
    securityMultiplier = 0.45; // Speculative / P2P severely penalized
    riskPenalty = 6.0;
  }

  return (yieldPct * securityMultiplier) - riskPenalty;
}

/**
 * ML Training on Quick Chips:
 * Normalizes user-defined arbitrary text (e.g. 'buying shoes', 'sneakers')
 * into canonical ML features ('Goals' or 'Debt Payoff') so the ML model
 * trains on fundamental financial concepts rather than transient purchase labels.
 */
export function canonicalizeChipCategory(chipText: string, category: string): string {
  const lower = (chipText + ' ' + category).toLowerCase();
  if (lower.includes('debt') || lower.includes('loan') || lower.includes('emi') || lower.includes('kill')) {
    return 'Debt Payoff';
  }
  if (lower.includes('goal') || lower.includes('save') || lower.includes('accumulate') || lower.includes('shoe') || lower.includes('vacation') || lower.includes('fund')) {
    return 'Goals';
  }
  return category || 'Discretionary';
}

/**
 * Retrains ML model when user fails to stop and spends anyway on a second goal when cash flow is low.
 */
export function recordLedgerGoalOverspendFeedback(actualSpendConfirmed: boolean, amountSpent: number): RLModelWeights {
  const rl = getStoredRLWeights();
  const lr = rl.learningRate || 0.1;

  if (actualSpendConfirmed) {
    // User failed to stop and actually spent that amount despite low cash flow warning
    // Tighten policy: increase liquidity safety buffer, decrease speculative sweeps
    rl.policyWeights.liquiditySafety += lr * 2.2;
    rl.policyWeights.highYieldSweep = Math.max(0.4, rl.policyWeights.highYieldSweep - lr * 1.5);
    rl.policyWeights.debtPrepay += lr * 1.0;
    rl.confidenceScore = Math.max(50, rl.confidenceScore - 2);
    rl.totalDecisions += 1;
  } else {
    // User was disciplined
    rl.policyWeights.liquiditySafety += lr * 0.5;
    rl.confidenceScore = Math.min(95, rl.confidenceScore + 1);
  }

  saveRLWeights(rl);
  return rl;
}

/**
 * Reinforcement Learning Policy Update when user interacts with cashflow recommendation
 */
export function recordRLActionFeedback(params: {
  recommendationId: string;
  action: 'followed' | 'dismissed' | 'expired';
  reason?: string;
  isDebtPrepay?: boolean;
}): RLModelWeights {
  const rl = getStoredRLWeights();
  const lr = rl.learningRate || 0.1;

  if (params.action === 'followed') {
    // Positive reinforcement reward
    const reward = 2.0;
    if (params.isDebtPrepay) {
      rl.policyWeights.debtPrepay += lr * reward;
    } else {
      rl.policyWeights.highYieldSweep += lr * reward;
    }
    rl.successfulTransfers += 1;
    rl.confidenceScore = Math.min(95, rl.confidenceScore + 2);
  } else if (params.action === 'dismissed' || params.action === 'expired') {
    // Negative feedback with contextual policy tuning based on reason
    if (params.reason === 'liquidity' || params.reason?.toLowerCase().includes('liquid')) {
      rl.policyWeights.liquiditySafety += lr * 1.5;
      rl.policyWeights.highYieldSweep = Math.max(0.5, rl.policyWeights.highYieldSweep - lr * 1.0);
    } else if (params.reason === 'market' || params.reason?.toLowerCase().includes('risk')) {
      rl.policyWeights.highYieldSweep = Math.max(0.5, rl.policyWeights.highYieldSweep - lr * 0.8);
      rl.policyWeights.debtPrepay += lr * 0.8;
    } else {
      rl.confidenceScore = Math.max(60, rl.confidenceScore - 1);
    }
  }

  rl.totalDecisions += 1;
  saveRLWeights(rl);
  return rl;
}

const CAREER_PROFILE_STORAGE_KEY = 'networthiq_ml_career_profile';
const CAREER_WEIGHTS_STORAGE_KEY = 'networthiq_ml_career_weights';
const ONLINE_LEARNER_STORAGE_KEY = 'networthiq_ml_online_learner';
const INVESTMENT_WEIGHTS_STORAGE_KEY = 'networthiq_ml_investment_weights';
const INVESTMENT_FEEDBACK_STORAGE_KEY = 'networthiq_ml_feedback_log';

export const DEFAULT_CAREER_WEIGHTS: CareerModelWeights = {
  baseIntercept: 1.0,
  experienceCoeff: 1.25,
  educationCoeff: 0.70,
  technicalSkillCoeff: 0.08,
  behavioralStrengthCoeff: 0.05,
  weaknessPenaltyCoeff: 0.04,
  mncIncrementBias: 0,
  startupIncrementBias: 0,
  learningRate: 0.08,
  tuneIterations: 0,
};

export const DEFAULT_CAREER_PROFILE: CareerProfile = {
  age: undefined,
  currentRole: '',
  yearsOfExperience: 0,
  education: 'bachelors_tech',
  educationalMajor: '',
  industry: '',
  targetCompanyType: 'all',
  careerGoals: '',
  salaryExpectation: undefined,
  technicalSkills: [],
  behavioralStrengths: [],
  weaknessesOrGrowthAreas: [],
  previousSalaries: [],
  careerTransitions: [],
  feedbackLog: [],
};

export function getStoredCareerWeights(): CareerModelWeights {
  try {
    const raw = localStorage.getItem(CAREER_WEIGHTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CAREER_WEIGHTS, ...parsed };
    }
  } catch (e) {
    // fallback
  }
  return { ...DEFAULT_CAREER_WEIGHTS };
}

export function saveCareerWeights(weights: CareerModelWeights): void {
  try {
    weights.lastTunedAt = new Date().toISOString();
    localStorage.setItem(CAREER_WEIGHTS_STORAGE_KEY, JSON.stringify(weights));
  } catch (e) {
    console.error('Failed to persist career weights', e);
  }
}

export function resetCareerWeights(): CareerModelWeights {
  try {
    localStorage.removeItem(CAREER_WEIGHTS_STORAGE_KEY);
  } catch {}
  return { ...DEFAULT_CAREER_WEIGHTS };
}

export function getStoredCareerProfile(): CareerProfile {
  try {
    const raw = localStorage.getItem(CAREER_PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        (parsed.currentRole === 'Senior Software Engineer' && (parsed.yearsOfExperience === 5 || parsed.yearsOfExperience === '5')) ||
        (Array.isArray(parsed.previousSalaries) &&
          parsed.previousSalaries.some(
            (p: { salary?: number; year?: number }) => p.salary === 900000 && p.year === 2022
          ))
      ) {
        localStorage.removeItem(CAREER_PROFILE_STORAGE_KEY);
        return { ...DEFAULT_CAREER_PROFILE };
      }
      return {
        ...DEFAULT_CAREER_PROFILE,
        ...parsed,
        age: parsed.age !== undefined && parsed.age !== null && !isNaN(Number(parsed.age)) ? Number(parsed.age) : undefined,
        yearsOfExperience: Math.max(0, Number(parsed.yearsOfExperience) || 0),
        technicalSkills: Array.isArray(parsed.technicalSkills) ? parsed.technicalSkills : [],
        behavioralStrengths: Array.isArray(parsed.behavioralStrengths) ? parsed.behavioralStrengths : [],
        weaknessesOrGrowthAreas: Array.isArray(parsed.weaknessesOrGrowthAreas) ? parsed.weaknessesOrGrowthAreas : [],
        previousSalaries: Array.isArray(parsed.previousSalaries) ? parsed.previousSalaries : [],
        careerTransitions: Array.isArray(parsed.careerTransitions) ? parsed.careerTransitions : [],
        feedbackLog: Array.isArray(parsed.feedbackLog) ? parsed.feedbackLog : [],
      };
    }
  } catch (e) {
    // fallback
  }
  return { ...DEFAULT_CAREER_PROFILE };
}

export function saveCareerProfile(profile: CareerProfile): void {
  try {
    profile.updatedAt = new Date().toISOString();
    localStorage.setItem(CAREER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('Failed to persist career profile', e);
  }
}

/**
 * Shifts ML Model weights & biases based on explicit user feedback and retunes prediction
 */
export function tuneCareerModelWeights(
  feedback: {
    predictedSalary: number;
    userActualOrTargetSalary?: number;
    roleFeedback: 'aligned' | 'too_senior' | 'too_junior' | 'different_field' | 'management_focus' | 'technical_focus';
    salaryFeedback?: 'accurate' | 'too_high' | 'too_low';
    comments?: string;
  },
  currentProfile: CareerProfile,
  currentWeights?: CareerModelWeights
): { updatedProfile: CareerProfile; updatedWeights: CareerModelWeights } {
  const weights = currentWeights ? { ...currentWeights } : getStoredCareerWeights();
  const lr = weights.learningRate || 0.08;
  let delta = 0;

  // 1. Shift Base Intercept based on Salary Feedback
  if (feedback.salaryFeedback === 'too_low') {
    delta = lr * 1.5;
    weights.baseIntercept = Math.min(2.5, +(weights.baseIntercept + delta).toFixed(4));
  } else if (feedback.salaryFeedback === 'too_high') {
    delta = -lr * 1.5;
    weights.baseIntercept = Math.max(0.5, +(weights.baseIntercept + delta).toFixed(4));
  } else if (feedback.userActualOrTargetSalary && feedback.predictedSalary > 0) {
    const ratio = feedback.userActualOrTargetSalary / feedback.predictedSalary;
    delta = Math.max(-0.35, Math.min(0.35, (ratio - 1) * lr));
    weights.baseIntercept = Math.max(0.5, Math.min(2.5, +(weights.baseIntercept + delta).toFixed(4)));
  }

  // 2. Shift Experience & Skill Coeff based on Role Feedback
  if (feedback.roleFeedback === 'too_senior') {
    weights.experienceCoeff = Math.max(0.7, +(weights.experienceCoeff - lr * 1.4).toFixed(4));
    weights.weaknessPenaltyCoeff = Math.min(0.12, +(weights.weaknessPenaltyCoeff + lr * 0.5).toFixed(4));
  } else if (feedback.roleFeedback === 'too_junior') {
    weights.experienceCoeff = Math.min(2.2, +(weights.experienceCoeff + lr * 1.4).toFixed(4));
    weights.technicalSkillCoeff = Math.min(0.20, +(weights.technicalSkillCoeff + lr * 0.6).toFixed(4));
  } else if (feedback.roleFeedback === 'different_field') {
    weights.technicalSkillCoeff = Math.min(0.22, +(weights.technicalSkillCoeff + lr * 1.0).toFixed(4));
    weights.educationCoeff = Math.max(0.4, +(weights.educationCoeff - lr * 0.5).toFixed(4));
  } else if (feedback.roleFeedback === 'management_focus') {
    weights.behavioralStrengthCoeff = Math.min(0.18, +(weights.behavioralStrengthCoeff + lr * 1.2).toFixed(4));
  } else if (feedback.roleFeedback === 'technical_focus') {
    weights.technicalSkillCoeff = Math.min(0.22, +(weights.technicalSkillCoeff + lr * 1.2).toFixed(4));
  }

  weights.tuneIterations = (weights.tuneIterations || 0) + 1;
  saveCareerWeights(weights);

  const feedbackRecord: CareerFeedbackRecord = {
    id: `fb-${Date.now()}`,
    timestamp: new Date().toISOString(),
    predictedSalary: feedback.predictedSalary,
    userActualOrTargetSalary: feedback.userActualOrTargetSalary,
    roleFeedback: feedback.roleFeedback,
    salaryFeedback: feedback.salaryFeedback,
    comments: feedback.comments,
    weightsAdjustmentDelta: delta,
  };

  const updatedProfile: CareerProfile = {
    ...currentProfile,
    feedbackLog: [feedbackRecord, ...(currentProfile.feedbackLog || [])].slice(0, 20),
  };
  saveCareerProfile(updatedProfile);

  return { updatedProfile, updatedWeights: weights };
}

/**
 * Compares user-entered Reality (previous role/salary, current role/salary update, or next actual offer)
 * against the ML Model's prediction for that exact experience & company track, shifting weights & biases
 * via gradient delta updates.
 */
export function recordCareerTransitionAndTune(
  params: {
    transitionType: 'previous' | 'current_update' | 'next_offer';
    role: string;
    actualSalary: number;
    companyType: 'mnc' | 'startup' | 'midsize';
    year: number;
    experienceAtTransition: number;
    ageAtTransition?: number;
    applyAsActiveRole?: boolean;
  },
  currentProfile: CareerProfile,
  activeSalaryYearly: number,
  netWorthBase: number,
  currentWeights?: CareerModelWeights
): {
  updatedProfile: CareerProfile;
  updatedWeights: CareerModelWeights;
  transitionRecord: CareerTransitionRecord;
} {
  const weights = currentWeights ? { ...currentWeights } : getStoredCareerWeights();
  const yoeAtEvent = Math.max(0, Number(params.experienceAtTransition) || 0);

  // Evaluate what the model predicted BEFORE shifting weights
  const evalProfile: CareerProfile = {
    ...currentProfile,
    yearsOfExperience:
      params.transitionType === 'next_offer'
        ? Math.max(0, Number(currentProfile.yearsOfExperience) || 0)
        : yoeAtEvent,
    age: params.ageAtTransition ?? currentProfile.age,
  };
  const priorPred = predictCareerAndSalary(
    evalProfile,
    params.transitionType === 'next_offer' ? activeSalaryYearly : 0,
    netWorthBase,
    weights
  );

  let modelPredictedSalary = priorPred.predictedCurrentMarketMedian;
  let modelPredictedRole = currentProfile.currentRole || priorPred.mncPrediction.nextRole;

  if (params.transitionType === 'next_offer') {
    if (params.companyType === 'mnc') {
      modelPredictedSalary = priorPred.mncPrediction.expectedSalary || priorPred.predictedCurrentMarketMedian;
      modelPredictedRole = priorPred.mncPrediction.nextRole;
    } else if (params.companyType === 'startup') {
      modelPredictedSalary = priorPred.startupPrediction.expectedSalary || priorPred.predictedCurrentMarketMedian;
      modelPredictedRole = priorPred.startupPrediction.nextRole;
    } else {
      modelPredictedSalary = Math.round(
        ((priorPred.mncPrediction.expectedSalary || 0) + (priorPred.startupPrediction.expectedSalary || 0)) / 2
      ) || priorPred.predictedCurrentMarketMedian;
      modelPredictedRole = priorPred.mncPrediction.nextRole;
    }
  } else {
    modelPredictedRole =
      yoeAtEvent <= 0.5
        ? 'Entry / Associate Track'
        : yoeAtEvent < 4
        ? priorPred.mncPrediction.nextRole
        : priorPred.mncPrediction.nextRole;
  }

  const safePredSalary = modelPredictedSalary > 0 ? modelPredictedSalary : params.actualSalary;
  const errorAmount = Math.round(params.actualSalary - safePredSalary);
  const relError = safePredSalary > 0 ? (params.actualSalary - safePredSalary) / safePredSalary : 0;
  const errorPct = Math.round(relError * 1000) / 10;

  const lr = weights.learningRate || 0.08;
  // Bounded gradient step on intercept & experience slope
  const clampedRel = Math.max(-0.6, Math.min(0.8, relError));
  const baseInterceptDelta = +(clampedRel * lr * 1.35).toFixed(4);
  const expFactor = Math.min(1.5, Math.max(0.25, yoeAtEvent / 5));
  const experienceCoeffDelta = +(clampedRel * lr * 0.65 * expFactor).toFixed(4);

  weights.baseIntercept = Math.max(0.45, Math.min(2.8, +(weights.baseIntercept + baseInterceptDelta).toFixed(4)));
  weights.experienceCoeff = Math.max(0.65, Math.min(2.4, +(weights.experienceCoeff + experienceCoeffDelta).toFixed(4)));

  // Role seniority / track comparison shift
  const actualRoleLower = params.role.toLowerCase();
  const isSeniorOrLeadActual =
    actualRoleLower.includes('senior') ||
    actualRoleLower.includes('lead') ||
    actualRoleLower.includes('staff') ||
    actualRoleLower.includes('principal') ||
    actualRoleLower.includes('director') ||
    actualRoleLower.includes('head') ||
    actualRoleLower.includes('vp') ||
    actualRoleLower.includes('chief') ||
    actualRoleLower.includes('manager');

  const isManagerialActual =
    actualRoleLower.includes('manager') ||
    actualRoleLower.includes('director') ||
    actualRoleLower.includes('head') ||
    actualRoleLower.includes('vp') ||
    actualRoleLower.includes('chief');

  if (isManagerialActual) {
    weights.behavioralStrengthCoeff = Math.min(0.22, +(weights.behavioralStrengthCoeff + lr * 0.35).toFixed(4));
  } else if (isSeniorOrLeadActual) {
    weights.technicalSkillCoeff = Math.min(0.24, +(weights.technicalSkillCoeff + lr * 0.30).toFixed(4));
  }

  // Company-track increment bias shift
  let companyBiasDelta = 0;
  if (params.companyType === 'mnc') {
    companyBiasDelta = Math.round(clampedRel * 12 * 10) / 10;
    weights.mncIncrementBias = Math.max(-20, Math.min(25, +((weights.mncIncrementBias || 0) + companyBiasDelta).toFixed(2)));
  } else if (params.companyType === 'startup') {
    companyBiasDelta = Math.round(clampedRel * 14 * 10) / 10;
    weights.startupIncrementBias = Math.max(-20, Math.min(30, +((weights.startupIncrementBias || 0) + companyBiasDelta).toFixed(2)));
  }

  weights.tuneIterations = (weights.tuneIterations || 0) + 1;
  saveCareerWeights(weights);

  const transitionRecord: CareerTransitionRecord = {
    id: `tr-${Date.now()}`,
    recordedAt: new Date().toISOString(),
    year: params.year,
    transitionType: params.transitionType,
    role: params.role.trim(),
    actualSalary: params.actualSalary,
    companyType: params.companyType,
    experienceAtTransition: yoeAtEvent,
    ageAtTransition: params.ageAtTransition,
    modelPredictedSalary: safePredSalary,
    modelPredictedRole,
    predictionErrorAmount: errorAmount,
    predictionErrorPct: errorPct,
    weightShifts: {
      baseInterceptDelta,
      experienceCoeffDelta,
      companyBiasDelta,
    },
  };

  // Merge into previousSalaries milestone history (deduplicating same year+role)
  const filteredPrev = (currentProfile.previousSalaries || []).filter(
    (p) => !(p.year === params.year && p.role.trim().toLowerCase() === params.role.trim().toLowerCase())
  );
  const updatedPrevSalaries: PreviousSalaryRecord[] = [
    ...filteredPrev,
    {
      year: params.year,
      role: params.role.trim(),
      salary: params.actualSalary,
      companyType: params.companyType,
    },
  ].sort((a, b) => a.year - b.year);

  const shouldUpdateCurrent =
    params.applyAsActiveRole ??
    (params.transitionType === 'current_update' || params.transitionType === 'next_offer');

  const feedbackEntry: CareerFeedbackRecord = {
    id: `fb-real-${Date.now()}`,
    timestamp: transitionRecord.recordedAt,
    predictedSalary: safePredSalary,
    userActualOrTargetSalary: params.actualSalary,
    roleFeedback: isManagerialActual ? 'management_focus' : 'aligned',
    salaryFeedback: errorPct > 5 ? 'too_low' : errorPct < -5 ? 'too_high' : 'accurate',
    comments: `Reality vs Prediction (${params.transitionType}): ${params.role} @ ${params.actualSalary.toLocaleString()} (${errorPct >= 0 ? '+' : ''}${errorPct}% vs predicted ${safePredSalary.toLocaleString()})`,
    weightsAdjustmentDelta: baseInterceptDelta,
  };

  const updatedProfile: CareerProfile = {
    ...currentProfile,
    currentRole: shouldUpdateCurrent ? params.role.trim() : currentProfile.currentRole,
    yearsOfExperience: shouldUpdateCurrent ? yoeAtEvent : currentProfile.yearsOfExperience,
    age: params.ageAtTransition !== undefined ? params.ageAtTransition : currentProfile.age,
    previousSalaries: updatedPrevSalaries,
    careerTransitions: [transitionRecord, ...(currentProfile.careerTransitions || [])].slice(0, 30),
    feedbackLog: [feedbackEntry, ...(currentProfile.feedbackLog || [])].slice(0, 30),
  };
  saveCareerProfile(updatedProfile);

  return { updatedProfile, updatedWeights: weights, transitionRecord };
}

/**
 * Predicts Career Progression, Next Role, Salary Bands (MNC vs Startup),
 * and Human Capital NPV based on experience, education, historical CAGR, skills,
 * career goals, strengths, and weaknesses with dynamic weights.
 */
export function predictCareerAndSalary(
  profile: CareerProfile,
  activeSalaryYearly: number,
  netWorthBase: number,
  customWeights?: CareerModelWeights
): CareerPredictionResult {
  const weights = customWeights || getStoredCareerWeights();
  const yoe = Math.max(0, Number(profile.yearsOfExperience) || 0);
  const rawRole = (profile.currentRole || '').trim();
  const roleLower = rawRole.toLowerCase();
  const major = (profile.educationalMajor || '').trim().toLowerCase();
  const industry = (profile.industry || '').trim().toLowerCase();
  const goals = (profile.careerGoals || '').trim().toLowerCase();
  const techSkills = (profile.technicalSkills || []).map((s) => s.trim().toLowerCase());
  const strengths = (profile.behavioralStrengths || []).map((s) => s.trim().toLowerCase());
  const weaknesses = (profile.weaknessesOrGrowthAreas || []).map((s) => s.trim().toLowerCase());

  // Determine actual current salary
  let currentSalary = activeSalaryYearly > 0 ? activeSalaryYearly : 0;
  if (currentSalary === 0 && profile.previousSalaries && profile.previousSalaries.length > 0) {
    const sorted = [...profile.previousSalaries].sort((a, b) => b.year - a.year);
    currentSalary = sorted[0].salary || 0;
  }
  if (currentSalary === 0 && profile.salaryExpectation && profile.salaryExpectation > 0 && yoe === 0) {
    // If student/fresher specified expectation
    currentSalary = Math.round(profile.salaryExpectation * 0.85);
  }

  // Clean slate check: if user has literally 0 input anywhere
  const hasAnyInput = Boolean(
    rawRole ||
    yoe > 0 ||
    currentSalary > 0 ||
    techSkills.length > 0 ||
    strengths.length > 0 ||
    major ||
    goals ||
    profile.salaryExpectation
  );

  if (!hasAnyInput) {
    return {
      currentAnnualSalary: 0,
      predictedCurrentMarketMedian: 0,
      predictedRange: [0, 0],
      marketPosition: 'fair',
      personalizedAdvice: 'Add your skills, goals, education, or experience to train your predictive career model.',
      skillGaps: ['Provide technical skills', 'Add career goals', 'Specify educational background'],
      tuningIteration: weights.tuneIterations || 0,
      activeWeights: weights,
      mncPrediction: {
        nextRole: 'Awaiting Profile Input',
        expectedSalary: 0,
        expectedIncrementPct: 0,
        annualRsuBonus: 0,
        stabilityScore: 0,
        skillsInDemand: ['Set skills in career profile to calculate demand'],
        timelineMonths: 0,
      },
      startupPrediction: {
        nextRole: 'Awaiting Profile Input',
        expectedSalary: 0,
        expectedIncrementPct: 0,
        equityUpsidePct: 0,
        upsidePotentialScore: 0,
        skillsInDemand: ['Set skills in career profile to calculate demand'],
        timelineMonths: 0,
      },
      humanCapitalNpv5Yr: 0,
      humanCapitalNpv10Yr: 0,
      confidenceScore: 0,
      historicalGrowthCagr: 0,
      netRateContributionPct: 0,
    };
  }

  // 1. DYNAMIC DOMAIN INFERENCE
  // Combine all signals: role, major, skills, industry, goals
  const textCorpus = `${roleLower} ${major} ${industry} ${goals} ${techSkills.join(' ')} ${strengths.join(' ')}`;
  
  let domain: 'data_ai' | 'software' | 'finance' | 'product' | 'design' | 'growth' | 'operations' | 'general' = 'general';

  if (
    textCorpus.includes('data') ||
    textCorpus.includes('ml') ||
    textCorpus.includes('ai') ||
    textCorpus.includes('machine learning') ||
    textCorpus.includes('deep learning') ||
    textCorpus.includes('llm') ||
    textCorpus.includes('python') ||
    textCorpus.includes('analytics') ||
    textCorpus.includes('statistics')
  ) {
    domain = 'data_ai';
  } else if (
    textCorpus.includes('finance') ||
    textCorpus.includes('accounting') ||
    textCorpus.includes('investment') ||
    textCorpus.includes('cfa') ||
    textCorpus.includes('banking') ||
    textCorpus.includes('equity') ||
    textCorpus.includes('fp&a') ||
    textCorpus.includes('valuation') ||
    textCorpus.includes('fintech')
  ) {
    domain = 'finance';
  } else if (
    textCorpus.includes('product') ||
    textCorpus.includes('pm') ||
    textCorpus.includes('agile') ||
    textCorpus.includes('scrum') ||
    textCorpus.includes('roadmap')
  ) {
    domain = 'product';
  } else if (
    textCorpus.includes('design') ||
    textCorpus.includes('ui') ||
    textCorpus.includes('ux') ||
    textCorpus.includes('figma') ||
    textCorpus.includes('creative')
  ) {
    domain = 'design';
  } else if (
    textCorpus.includes('growth') ||
    textCorpus.includes('marketing') ||
    textCorpus.includes('sales') ||
    textCorpus.includes('seo') ||
    textCorpus.includes('content') ||
    textCorpus.includes('b2b')
  ) {
    domain = 'growth';
  } else if (
    textCorpus.includes('software') ||
    textCorpus.includes('developer') ||
    textCorpus.includes('engineering') ||
    textCorpus.includes('frontend') ||
    textCorpus.includes('backend') ||
    textCorpus.includes('full stack') ||
    textCorpus.includes('react') ||
    textCorpus.includes('cloud') ||
    textCorpus.includes('devops') ||
    textCorpus.includes('java') ||
    textCorpus.includes('typescript')
  ) {
    domain = 'software';
  } else if (
    textCorpus.includes('operations') ||
    textCorpus.includes('supply chain') ||
    textCorpus.includes('consulting') ||
    textCorpus.includes('management')
  ) {
    domain = 'operations';
  }

  // 2. Education Tier Multiplier
  let eduMultiplier = 1.0;
  switch (profile.education) {
    case 'tier1_tech':
      eduMultiplier = 1.30;
      break;
    case 'tier1_mba':
      eduMultiplier = 1.35;
      break;
    case 'masters':
      eduMultiplier = 1.15;
      break;
    case 'doctorate':
      eduMultiplier = 1.38;
      break;
    case 'bachelors_tech':
      eduMultiplier = 1.05;
      break;
    case 'bachelors_other':
      eduMultiplier = 0.95;
      break;
    case 'bootcamp_selftaught':
      eduMultiplier = 1.02;
      break;
    default:
      eduMultiplier = 1.0;
  }

  // 3. Historical Growth Rate
  let historicalGrowthCagr = 0.14;
  if (profile.previousSalaries && profile.previousSalaries.length >= 2) {
    const sorted = [...profile.previousSalaries].sort((a, b) => a.year - b.year);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const yearsDiff = Math.max(1, last.year - first.year);
    if (first.salary > 0 && last.salary > first.salary) {
      const calculatedCagr = Math.pow(last.salary / first.salary, 1 / yearsDiff) - 1;
      historicalGrowthCagr = Math.max(0.05, Math.min(0.55, calculatedCagr));
    }
  }

  // 4. Multi-Feature Regression for Market Median Salary
  // Incorporates weights & biases: experienceCoeff, educationCoeff, technicalSkillCoeff, etc.
  const expTerm = Math.pow(1 + yoe, 0.48) * (weights.experienceCoeff || 1.25);
  const eduTerm = eduMultiplier * (weights.educationCoeff || 0.70) + 0.30;
  const skillBonus = 1 + (techSkills.length * (weights.technicalSkillCoeff || 0.08) * 0.04);
  const strengthBonus = 1 + (strengths.length * (weights.behavioralStrengthCoeff || 0.05) * 0.03);
  const weaknessPenalty = Math.max(0.85, 1 - (weaknesses.length * (weights.weaknessPenaltyCoeff || 0.04) * 0.03));
  const baseSalaryScale = domain === 'finance' || domain === 'data_ai' ? 1250000 : domain === 'product' ? 1300000 : 1100000;

  let predictedCurrentMarketMedian = Math.round(
    baseSalaryScale * expTerm * eduTerm * skillBonus * strengthBonus * weaknessPenalty * (weights.baseIntercept || 1.0)
  );

  // If user has 0 experience, calibrate to standard fresher/entry salary baseline
  if (yoe === 0) {
    const fresherBaseline = domain === 'finance' || domain === 'data_ai' ? 650000 : 550000;
    predictedCurrentMarketMedian = Math.round(
      fresherBaseline * eduTerm * skillBonus * strengthBonus * (weights.baseIntercept || 1.0)
    );
  }

  // If user provided salary expectation and has 0 salary, factor expectation into median
  if (currentSalary === 0 && profile.salaryExpectation && profile.salaryExpectation > 0) {
    predictedCurrentMarketMedian = Math.round(
      (predictedCurrentMarketMedian + profile.salaryExpectation) / 2
    );
    currentSalary = Math.round(profile.salaryExpectation * 0.9);
  }

  if (currentSalary === 0) {
    currentSalary = Math.round(predictedCurrentMarketMedian * 0.9);
  }

  const rangeSpread = 0.18;
  const predictedRange: [number, number] = [
    Math.round(predictedCurrentMarketMedian * (1 - rangeSpread)),
    Math.round(predictedCurrentMarketMedian * (1 + rangeSpread * 1.35)),
  ];

  let marketPosition: 'underpaid' | 'fair' | 'top_percentile' = 'fair';
  if (currentSalary < predictedRange[0]) {
    marketPosition = 'underpaid';
  } else if (currentSalary > predictedRange[1]) {
    marketPosition = 'top_percentile';
  }

  // 5. Dynamic Role Progression Engine (No static hardcoded Software Engineer for everyone!)
  let mncNextRole = '';
  let startupNextRole = '';
  let mncSkills: string[] = [];
  let startupSkills: string[] = [];

  const wantsLeadership =
    goals.includes('lead') ||
    goals.includes('management') ||
    goals.includes('director') ||
    goals.includes('vp') ||
    goals.includes('head') ||
    goals.includes('founder') ||
    strengths.includes('leadership') ||
    strengths.includes('team leadership');

  if (yoe === 0) {
    // FRESH GRADUATE / ZERO EXPERIENCE / CAREER STARTER
    if (domain === 'data_ai') {
      mncNextRole = 'Associate Data Scientist / Junior ML Analyst';
      startupNextRole = 'Founding Data & AI Engineer / Early ML Generalist';
      mncSkills = ['Python & Pandas', 'SQL Database Queries', 'Statistical Modeling', 'Git & Docker'];
      startupSkills = ['Rapid Prototyping', 'FastAPI & Vector DBs', 'LLM Prompt Engineering', 'Full Data Ownership'];
    } else if (domain === 'finance') {
      mncNextRole = 'Financial Analyst / Risk Operations Associate';
      startupNextRole = 'Growth Finance & FP&A Associate';
      mncSkills = ['Financial Modeling', 'Excel & SQL', 'Regulatory Compliance', 'Cash Flow Analysis'];
      startupSkills = ['Unit Economics', 'Investor Reporting', 'Runway Modeling', 'Automation Tooling'];
    } else if (domain === 'product') {
      mncNextRole = 'Associate Product Manager (APM)';
      startupNextRole = '0-to-1 Product Associate / Junior Builder';
      mncSkills = ['User Research', 'Agile Story Mapping', 'Data-Driven Specs', 'Stakeholder Sync'];
      startupSkills = ['Customer Discovery', 'No-code Prototyping', 'Sprint Velocity', 'Product Analytics'];
    } else if (domain === 'design') {
      mncNextRole = 'Associate Product Designer';
      startupNextRole = 'Founding UI/UX Designer';
      mncSkills = ['Figma Prototyping', 'Design Systems', 'Usability Testing', 'Accessibility'];
      startupSkills = ['Brand Identity', '0-to-1 Wireframing', 'Motion Design', 'High Agency Design'];
    } else if (domain === 'growth') {
      mncNextRole = 'Associate Marketing & Growth Analyst';
      startupNextRole = 'Growth Specialist & Performance Marketer';
      mncSkills = ['Performance Marketing', 'SEO & Analytics', 'Content Funnels', 'A/B Testing'];
      startupSkills = ['Organic Acquisition', 'Viral Loops', 'Conversion Rate Optimization', 'Scrappy GTM'];
    } else if (domain === 'operations') {
      mncNextRole = 'Operations Analyst / Management Trainee';
      startupNextRole = 'Business Operations & Strategy Associate';
      mncSkills = ['Process Optimization', 'Cross-Functional Reporting', 'Project Management', 'SLA Tracking'];
      startupSkills = ['Vendor Negotiation', 'Workflow Automation', 'Resource Scrappy Allocation', 'Rapid Problem Solving'];
    } else {
      mncNextRole = 'Graduate Software Development Engineer (SDE-I)';
      startupNextRole = 'Junior Full-Stack Product Engineer';
      mncSkills = ['Data Structures & Algorithms', 'Modern Frameworks (React/Node)', 'System Fundamentals', 'CI/CD'];
      startupSkills = ['Rapid Feature Delivery', 'Full-Stack Ownership', 'Autonomous Debugging', 'User Empathy'];
    }
  } else if (yoe < 4) {
    // MID-LEVEL (1 - 4 YOE)
    if (domain === 'data_ai') {
      mncNextRole = wantsLeadership ? 'Lead Applied ML Engineer' : 'Senior Data Scientist / AI Specialist';
      startupNextRole = 'Senior AI Engineer & Tech Lead';
      mncSkills = ['Distributed Training', 'Feature Store Architecture', 'MLOps & CI/CD', 'Model Monitoring'];
      startupSkills = ['LLM Agent Pipelines', 'High-Scale Retrieval (RAG)', 'Real-Time Inference', 'Fast Deployment'];
    } else if (domain === 'finance') {
      mncNextRole = wantsLeadership ? 'Finance Manager / Senior FP&A Lead' : 'Senior Investment Analyst';
      startupNextRole = 'Head of Finance & Operations';
      mncSkills = ['Advanced DCF & LBO Modeling', 'Corporate Treasury', 'Audit Readiness', 'Capital Allocation'];
      startupSkills = ['Fundraising Decks', 'Burn Rate Optimization', 'Equity & Cap Table Management', 'Strategic FP&A'];
    } else if (domain === 'product') {
      mncNextRole = 'Product Manager II / Senior PM';
      startupNextRole = 'Head of Product / Lead PM';
      mncSkills = ['Roadmap Prioritization', 'Enterprise SLA Metrics', 'Cross-Functional Governance', 'GTM Execution'];
      startupSkills = ['0-to-1 Product-Market Fit', 'Rapid Experimentation', 'Customer Retention', 'Feature Ownership'];
    } else if (domain === 'design') {
      mncNextRole = 'Senior Product Designer';
      startupNextRole = 'Lead Product Designer / Head of Design';
      mncSkills = ['Enterprise Design Systems', 'Complex Multi-User Workflows', 'Design Ops', 'User Testing'];
      startupSkills = ['Complete Product UX', 'Design-to-Code Velocity', 'Micro-Interactions', 'Creative Direction'];
    } else {
      mncNextRole = wantsLeadership ? 'Tech Lead / Associate Engineering Manager' : 'Senior Software Engineer (SDE-II)';
      startupNextRole = wantsLeadership ? 'Engineering Lead / Founding Engineer' : 'Lead Full-Stack Engineer';
      mncSkills = ['Microservices Architecture', 'Distributed Systems', 'Code Review & SLAs', 'Cloud Governance'];
      startupSkills = ['End-to-End System Ownership', 'Zero-to-One Velocity', 'High Agency Architecture', 'Fast Shipping'];
    }
  } else {
    // SENIOR / LEAD / EXECUTIVE (4+ YOE)
    if (domain === 'data_ai') {
      mncNextRole = wantsLeadership ? 'Director of AI / Head of Machine Learning' : 'Staff / Principal AI Research Engineer';
      startupNextRole = 'Chief AI Officer (CAIO) / Technical Co-founder';
      mncSkills = ['Multi-Year AI Strategy', 'Large Model Foundation Tuning', 'Compute Optimization', 'P&L Governance'];
      startupSkills = ['AI Moat Engineering', 'Autonomous System Architecture', 'Talent Hiring', 'Executive Pitching'];
    } else if (domain === 'finance') {
      mncNextRole = wantsLeadership ? 'Director of Corporate Finance / VP Finance' : 'Principal Financial Strategist';
      startupNextRole = 'Chief Financial Officer (CFO) / VP Finance';
      mncSkills = ['M&A Due Diligence', 'Global Tax Structuring', 'Board Reporting', 'Balance Sheet Optimization'];
      startupSkills = ['Series A-C Fundraising', 'Venture Debt Negotiation', 'Investor Relations', 'Lean Cash Preservation'];
    } else if (domain === 'product') {
      mncNextRole = wantsLeadership ? 'Group Product Manager (GPM) / VP Product' : 'Principal Product Architect';
      startupNextRole = 'Chief Product Officer (CPO) / Co-founder';
      mncSkills = ['Multi-Product Portfolio Strategy', 'Global Market Expansion', 'Executive Stakeholder Management', 'P&L Ownership'];
      startupSkills = ['Category Creation', 'High-Speed Iteration', 'Product Vision', 'Investor Pitching'];
    } else {
      mncNextRole = wantsLeadership ? 'Director of Engineering / Engineering Manager' : 'Staff / Principal Software Architect';
      startupNextRole = wantsLeadership ? 'Chief Technology Officer (CTO) / VP Engineering' : 'Principal Founding Engineer';
      mncSkills = ['Multi-Year Technical Roadmap', 'Enterprise SLA Reliability', 'Cloud Cost Optimization', 'Mentorship & Culture'];
      startupSkills = ['Company Building', 'Strategic Architecture', 'Hiring Top 1% Engineers', 'Rapid Execution'];
    }
  }

  // 6. Next Salary Projection for MNC vs Startup (incorporates learned mncIncrementBias & startupIncrementBias)
  const mncIncrementPct = Math.round(
    Math.min(
      65,
      Math.max(
        15,
        25 + historicalGrowthCagr * 28 + (eduMultiplier - 1) * 20 + (weights.mncIncrementBias || 0)
      )
    )
  );
  const mncExpectedSalary = Math.round(currentSalary * (1 + mncIncrementPct / 100));
  const annualRsuBonus = Math.round(mncExpectedSalary * 0.28);

  const startupIncrementPct = Math.round(
    Math.min(
      80,
      Math.max(
        20,
        32 + historicalGrowthCagr * 36 + (yoe <= 4 ? 10 : 4) + (weights.startupIncrementBias || 0)
      )
    )
  );
  const startupExpectedSalary = Math.round(currentSalary * (1 + startupIncrementPct / 100));
  const equityUpsidePct = yoe >= 6 ? 0.75 : yoe >= 3 ? 0.40 : 0.20;

  // 7. Human Capital Net Present Value (NPV) — adjusts compounding horizon modestly when user age is provided
  const discountRate = 0.08;
  const ageFactor = profile.age && profile.age > 0 ? Math.max(0.06, Math.min(0.13, 0.12 - Math.max(0, profile.age - 26) * 0.0015)) : 0.10;
  const growthRate = ageFactor;
  let npv5 = 0;
  let npv10 = 0;

  for (let year = 1; year <= 10; year++) {
    const discountedYearEarning =
      (currentSalary * Math.pow(1 + growthRate, year)) / Math.pow(1 + discountRate, year);
    if (year <= 5) npv5 += discountedYearEarning;
    npv10 += discountedYearEarning;
  }

  // 8. Net Rate Contribution
  const effectiveDenom = Math.abs(netWorthBase) > 0 ? Math.abs(netWorthBase) : currentSalary;
  const netRateContributionPct = (currentSalary / effectiveDenom) * 100;

  // 9. Skill Gaps Identification
  // Check which in-demand skills user hasn't explicitly listed in technicalSkills
  const userSkillSet = new Set(techSkills);
  const allTargetSkills = [...mncSkills, ...startupSkills];
  const skillGaps = allTargetSkills
    .filter((s) => !userSkillSet.has(s.toLowerCase()))
    .slice(0, 4);

  // 10. Personalized Advice
  let personalizedAdvice = '';
  if (yoe === 0) {
    personalizedAdvice = `As an early-career starter in ${domain.replace('_', ' ').toUpperCase()}, prioritize shipping end-to-end projects with high agency. Target entry roles in ${mncNextRole} or ${startupNextRole} while mastering ${skillGaps[0] || 'core tools'}.`;
  } else if (marketPosition === 'underpaid') {
    personalizedAdvice = `Your current package is below the estimated market range (${Math.round(predictedRange[0] / 100000)}L - ${Math.round(predictedRange[1] / 100000)}L). You have strong leverage to negotiate a ${mncIncrementPct}% jump towards ${mncNextRole}.`;
  } else if (wantsLeadership) {
    personalizedAdvice = `Leverage your leadership strengths to transition into managerial roles (${mncNextRole}). Bridge the remaining gap in ${skillGaps[0] || 'executive strategy'}.`;
  } else {
    personalizedAdvice = `Solid trajectory in ${domain.replace('_', ' ').toUpperCase()}. Adding ${skillGaps.slice(0, 2).join(' and ')} will position you in the top 10% compensation bracket.`;
  }

  // Statistically Calibrated Evidence-Based Confidence Score (Part 20)
  // A model must not appear more certain than its underlying verified evidence.
  let confidenceScore = 0;
  const verifiedSalaryPoints = profile.previousSalaries?.length || 0;
  const verifiedTransitions = profile.careerTransitions?.length || 0;

  if (verifiedSalaryPoints === 0 && verifiedTransitions === 0) {
    // Zero historical salary points: benchmark estimate only, 0% personalized certainty
    confidenceScore = 0;
  } else if (verifiedSalaryPoints === 1) {
    confidenceScore = 35;
    if (techSkills.length >= 3) confidenceScore += 5;
  } else if (verifiedSalaryPoints === 2) {
    confidenceScore = 55;
    if (techSkills.length >= 3) confidenceScore += 5;
    if (verifiedTransitions >= 1) confidenceScore += 5;
  } else {
    // 3+ verified data points
    confidenceScore = Math.min(85, 60 + verifiedSalaryPoints * 4 + verifiedTransitions * 5);
  }

  return {
    currentAnnualSalary: currentSalary,
    predictedCurrentMarketMedian,
    predictedRange,
    marketPosition,
    personalizedAdvice,
    skillGaps,
    tuningIteration: weights.tuneIterations || 0,
    activeWeights: weights,
    mncPrediction: {
      nextRole: mncNextRole,
      expectedSalary: mncExpectedSalary,
      expectedIncrementPct: mncIncrementPct,
      annualRsuBonus,
      stabilityScore: 92,
      skillsInDemand: mncSkills,
      timelineMonths: yoe === 0 ? 6 : 12,
    },
    startupPrediction: {
      nextRole: startupNextRole,
      expectedSalary: startupExpectedSalary,
      expectedIncrementPct: startupIncrementPct,
      equityUpsidePct,
      upsidePotentialScore: 95,
      skillsInDemand: startupSkills,
      timelineMonths: yoe === 0 ? 4 : 9,
    },
    humanCapitalNpv5Yr: Math.round(npv5),
    humanCapitalNpv10Yr: Math.round(npv10),
    confidenceScore,
    historicalGrowthCagr: Math.round(historicalGrowthCagr * 100),
    netRateContributionPct,
  };
}

function computeMedianValue(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeSpendSignature(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(bill|payment|paid|via|upi|neft|imps|debit|credit|card|auto|month|monthly)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCaseLabel(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Predicts upcoming / possible unscheduled bills from user spending patterns:
 * - Detects recurring spend signatures (2+ occurrences across distinct dates/months)
 *   not already represented in active recurring `existingBills`
 * - Estimates remaining monthly essential spend baseline (utilities, rent, telecom, insurance, groceries, fuel)
 *   based on historical monthly velocity minus current-month spend already posted.
 */
export function predictPossibleBills(
  transactions: Transaction[],
  existingBills: Bill[],
  currenciesList: Currency[],
  baseCurrency: string,
  referenceDate: Date = new Date()
): PredictedBillsSummary {
  const currMap: Record<string, Currency> = {};
  for (const c of currenciesList) {
    currMap[c.code.toUpperCase()] = c;
  }

  const spendTxs = transactions.filter(
    (t) =>
      t.kind === 'spend' &&
      !t.tags?.includes('Goal Contribution') &&
      !t.tags?.includes('Goal Fulfilled') &&
      !t.tags?.includes('Bill Payment')
  );

  if (spendTxs.length === 0) {
    return {
      items: [],
      totalPredictedAmountBase: 0,
      monthlyEssentialBaselineBase: 0,
      confidencePct: 0,
    };
  }

  const currentMonthPrefix = referenceDate.toISOString().substring(0, 7);
  const sixMonthsAgo = new Date(referenceDate);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const recentSpends = spendTxs.filter((t) => new Date(t.date) >= sixMonthsAgo);
  const activeSpends = recentSpends.length > 0 ? recentSpends : spendTxs;

  const existingBillSignatures = new Set(
    existingBills.map((b) => normalizeSpendSignature(b.name)).filter((s) => s.length >= 2)
  );

  // Group spends by normalized merchant/reason signature
  const groups = new Map<
    string,
    {
      displayLabel: string;
      category: string;
      amountsBase: number[];
      dates: string[];
      months: Set<string>;
      daysOfMonth: number[];
      paidInCurrentMonth: boolean;
    }
  >();

  const essentialKeywords = [
    'utility',
    'utilities',
    'electric',
    'power',
    'water',
    'gas',
    'broadband',
    'wifi',
    'internet',
    'mobile',
    'recharge',
    'telecom',
    'rent',
    'maintenance',
    'society',
    'insurance',
    'premium',
    'subscription',
    'fuel',
    'petrol',
    'grocer',
    'medical',
    'tuition',
    'school',
  ];

  for (const tx of activeSpends) {
    const sig = normalizeSpendSignature(tx.reason || tx.category || 'Expense');
    if (!sig || sig.length < 2) continue;

    // Skip if already tracked as an explicit recurring bill
    let matchesExistingBill = false;
    for (const eb of existingBillSignatures) {
      if (eb && (sig.includes(eb) || eb.includes(sig))) {
        matchesExistingBill = true;
        break;
      }
    }
    if (matchesExistingBill) continue;

    const amtBase =
      tx.currency.toUpperCase() === baseCurrency.toUpperCase()
        ? tx.amount
        : tx.fxRateUsed && tx.fxRateUsed !== 1
        ? tx.amount * tx.fxRateUsed
        : convertToBase(tx.amount, tx.currency, currMap);

    const monthKey = (tx.date || '').substring(0, 7);
    const dayNum = Number((tx.date || '').split('-')[2]) || 15;

    const existing = groups.get(sig);
    if (existing) {
      existing.amountsBase.push(amtBase);
      existing.dates.push(tx.date);
      if (monthKey) existing.months.add(monthKey);
      existing.daysOfMonth.push(dayNum);
      if (monthKey === currentMonthPrefix) existing.paidInCurrentMonth = true;
    } else {
      groups.set(sig, {
        displayLabel: (tx.reason || tx.category || 'Recurring Expense').trim(),
        category: tx.category || 'Bills',
        amountsBase: [amtBase],
        dates: [tx.date],
        months: new Set(monthKey ? [monthKey] : []),
        daysOfMonth: [dayNum],
        paidInCurrentMonth: monthKey === currentMonthPrefix,
      });
    }
  }

  const items: PredictedBillItem[] = [];

  for (const [sig, g] of groups.entries()) {
    const corpus = `${sig} ${g.category.toLowerCase()}`;
    const isEssentialLike = essentialKeywords.some((kw) => corpus.includes(kw));
    const isRecurringPattern = g.months.size >= 2 || (g.amountsBase.length >= 2 && isEssentialLike);

    if (!isRecurringPattern && !(isEssentialLike && g.amountsBase.length >= 1 && !g.paidInCurrentMonth)) {
      continue;
    }

    // If it typically happens once per month and was already paid this month, skip reserving for it again this cycle
    if (g.paidInCurrentMonth && g.amountsBase.length <= g.months.size + 1) {
      continue;
    }

    const medianAmt = Math.round(computeMedianValue(g.amountsBase));
    if (medianAmt <= 0) continue;

    const typicalDay = Math.round(computeMedianValue(g.daysOfMonth));
    const conf = Math.min(94, 58 + g.months.size * 10 + (isEssentialLike ? 8 : 0));

    items.push({
      id: `pred-bill-${sig.replace(/\s+/g, '-').slice(0, 24)}`,
      label: toTitleCaseLabel(g.displayLabel),
      category: g.category,
      estimatedAmountBase: medianAmt,
      confidencePct: conf,
      occurrences: g.amountsBase.length,
      typicalDayOfMonth: typicalDay,
      rationale:
        g.months.size >= 2
          ? `Observed across ${g.months.size} billing cycles (~day ${typicalDay})`
          : `Essential ${g.category} outlay inferred from ledger history`,
    });
  }

  // Also estimate remaining monthly essential variable reserve (e.g. groceries/utilities/transport) not captured above
  const monthlyEssentialTotals = new Map<string, number>();
  let currentMonthEssentialSpent = 0;

  for (const tx of activeSpends) {
    const corpus = `${(tx.reason || '').toLowerCase()} ${(tx.category || '').toLowerCase()}`;
    const isEssential =
      essentialKeywords.some((kw) => corpus.includes(kw)) ||
      ['bills', 'groceries', 'food & dining', 'transport', 'health'].includes((tx.category || '').toLowerCase());
    if (!isEssential) continue;

    const amtBase =
      tx.currency.toUpperCase() === baseCurrency.toUpperCase()
        ? tx.amount
        : tx.fxRateUsed && tx.fxRateUsed !== 1
        ? tx.amount * tx.fxRateUsed
        : convertToBase(tx.amount, tx.currency, currMap);

    const mKey = (tx.date || '').substring(0, 7);
    if (!mKey) continue;
    if (mKey === currentMonthPrefix) {
      currentMonthEssentialSpent += amtBase;
    } else {
      monthlyEssentialTotals.set(mKey, (monthlyEssentialTotals.get(mKey) || 0) + amtBase);
    }
  }

  const onlineState = getStoredOnlineLearnerState();
  const learnedBias = Math.max(0.65, Math.min(1.45, onlineState.spendForecastBias || 1.0));

  const pastMonthlyValues = Array.from(monthlyEssentialTotals.values());
  const rawEssentialBaseline =
    pastMonthlyValues.length > 0
      ? computeMedianValue(pastMonthlyValues)
      : onlineState.essentialSpendEma > 0
      ? onlineState.essentialSpendEma
      : currentMonthEssentialSpent * 0.5;
  const monthlyEssentialBaselineBase = Math.round(rawEssentialBaseline * learnedBias);

  items.sort((a, b) => b.estimatedAmountBase - a.estimatedAmountBase);
  const topItems = items.slice(0, 6).map((it) => ({
    ...it,
    estimatedAmountBase: Math.round(it.estimatedAmountBase * learnedBias),
  }));
  const explicitPredictedSum = topItems.reduce((s, x) => s + x.estimatedAmountBase, 0);

  const unspentEssentialDelta = Math.max(0, monthlyEssentialBaselineBase - currentMonthEssentialSpent - explicitPredictedSum);
  if (unspentEssentialDelta >= 250 && (pastMonthlyValues.length >= 1 || onlineState.totalOnlineUpdates > 0)) {
    topItems.push({
      id: 'pred-bill-essential-baseline',
      label: 'Projected Monthly Essential Outlays',
      category: 'Essential Living',
      estimatedAmountBase: Math.round(unspentEssentialDelta),
      confidencePct: Math.min(90, 65 + pastMonthlyValues.length * 6),
      occurrences: activeSpends.length,
      rationale: `Remaining monthly essential spend projected via online learner (bias ${learnedBias.toFixed(2)}x)`,
    });
  }

  const totalPredictedAmountBase = Math.round(topItems.reduce((s, x) => s + x.estimatedAmountBase, 0));
  const avgConf =
    topItems.length > 0
      ? Math.round(topItems.reduce((s, x) => s + x.confidencePct, 0) / topItems.length)
      : spendTxs.length >= 5
      ? 72
      : 50;

  return {
    items: topItems,
    totalPredictedAmountBase,
    monthlyEssentialBaselineBase,
    confidencePct: avgConf,
  };
}

/**
 * Deduplicates spend categories by ID and normalized category name.
 */
export function dedupeSpendCategories(categories: SpendCategoryConfig[]): SpendCategoryConfig[] {
  if (!categories || !Array.isArray(categories)) return [];
  const seenIds = new Set<string>();
  const seenNormNames = new Set<string>();
  const result: SpendCategoryConfig[] = [];

  for (const cat of categories) {
    if (!cat || !cat.id) continue;
    const cleanId = String(cat.id).trim();
    const cleanName = (cat.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ');

    if (!cleanId || seenIds.has(cleanId)) continue;
    if (cleanName && seenNormNames.has(cleanName)) continue;

    seenIds.add(cleanId);
    if (cleanName) seenNormNames.add(cleanName);
    result.push(cat);
  }

  return result;
}

/**
 * Deduplicates quick spend chips by ID and normalized reason/label.
 */
export function dedupeQuickChips(chips: QuickSpendChip[]): QuickSpendChip[] {
  if (!chips || !Array.isArray(chips)) return [];
  const seenIds = new Set<string>();
  const seenNormReasons = new Set<string>();
  const result: QuickSpendChip[] = [];

  for (const chip of chips) {
    if (!chip || !chip.id) continue;
    const cleanId = String(chip.id).trim();
    const cleanReason = (chip.reason || chip.label || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ');

    if (!cleanId || seenIds.has(cleanId)) continue;
    if (cleanReason && seenNormReasons.has(cleanReason)) continue;

    seenIds.add(cleanId);
    if (cleanReason) seenNormReasons.add(cleanReason);
    result.push(chip);
  }

  return result;
}

/**
 * Automatically updates Quick-Tap Spend Chips and Spending Categories from user spend history
 * using recency-weighted frequency and robust median amounts while preserving custom user entries.
 */
export function deriveSmartSpendChipsAndCategories(
  transactions: Transaction[],
  currentChips: QuickSpendChip[],
  currentCategories: SpendCategoryConfig[],
  validSourceIds: Set<string>,
  fallbackSourceId?: string
): {
  updatedChips: QuickSpendChip[];
  updatedCategories: SpendCategoryConfig[];
  chipsChanged: boolean;
  categoriesChanged: boolean;
} {
  const sanitizedChips = dedupeQuickChips(currentChips);
  const sanitizedCategories = dedupeSpendCategories(currentCategories);

  const spendTxs = transactions.filter(
    (t) =>
      t.kind === 'spend' &&
      !t.tags?.includes('Goal Contribution') &&
      !t.tags?.includes('Goal Fulfilled') &&
      !t.tags?.includes('Bill Payment')
  );

  if (spendTxs.length < 2) {
    const chipsChanged = sanitizedChips.length !== currentChips.length;
    const categoriesChanged = sanitizedCategories.length !== currentCategories.length;
    return {
      updatedChips: sanitizedChips,
      updatedCategories: sanitizedCategories,
      chipsChanged,
      categoriesChanged,
    };
  }

  const normalizeCatKey = (str: string) =>
    str
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ');

  const slugifyKey = (text: string, maxLen = 20) => {
    const slug = text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen);
    return slug || 'misc';
  };

  // 1. Auto-discover and rank Spending Categories
  const categoryStats = new Map<string, { displayName: string; count: number; latestMs: number }>();
  for (const tx of spendTxs) {
    const rawCat = (tx.category || '').trim();
    if (!rawCat || rawCat.toLowerCase() === 'savings & goals' || rawCat.toLowerCase() === 'transfers') continue;
    const key = normalizeCatKey(rawCat);
    if (!key) continue;
    const ms = new Date(tx.date).getTime() || 0;
    const prev = categoryStats.get(key);
    if (prev) {
      prev.count += 1;
      if (ms > prev.latestMs) prev.latestMs = ms;
    } else {
      categoryStats.set(key, { displayName: rawCat, count: 1, latestMs: ms });
    }
  }

  const palette = ['#10B981', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4', '#14B8A6', '#F97316'];
  const existingCatByNorm = new Map<string, SpendCategoryConfig>();
  const seenCatIds = new Set<string>();

  for (const c of sanitizedCategories) {
    seenCatIds.add(c.id);
    existingCatByNorm.set(normalizeCatKey(c.name), c);
  }

  const nextCategories: SpendCategoryConfig[] = sanitizedCategories.map((c) => {
    const norm = normalizeCatKey(c.name);
    const st = categoryStats.get(norm);
    return st ? { ...c, usageCount: st.count } : c;
  });

  let catAddedOrUpdated = sanitizedCategories.length !== currentCategories.length;
  let colorIdx = nextCategories.length;
  for (const [normKey, st] of categoryStats.entries()) {
    if (!existingCatByNorm.has(normKey)) {
      const baseSlug = slugifyKey(st.displayName, 20);
      let candidateId = `cat-ml-${baseSlug}`;
      let suffix = 2;
      while (seenCatIds.has(candidateId)) {
        candidateId = `cat-ml-${baseSlug.slice(0, 16)}-${suffix}`;
        suffix += 1;
      }
      seenCatIds.add(candidateId);
      const newCat: SpendCategoryConfig = {
        id: candidateId,
        name: toTitleCaseLabel(st.displayName),
        color: palette[colorIdx % palette.length],
        isDefault: false,
        isMlGenerated: true,
        usageCount: st.count,
      };
      existingCatByNorm.set(normKey, newCat);
      nextCategories.push(newCat);
      colorIdx += 1;
      catAddedOrUpdated = true;
    }
  }

  // Sort categories so frequently used ones surface first while keeping stable tie-breaking
  nextCategories.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

  const prevCatSig = currentCategories.map((c) => `${c.id}:${c.name}:${c.usageCount || 0}`).join('|');
  const nextCatSig = nextCategories.map((c) => `${c.id}:${c.name}:${c.usageCount || 0}`).join('|');
  const categoriesChanged = catAddedOrUpdated || prevCatSig !== nextCatSig;

  // 2. Auto-derive One-Tap Quick Spend Chips from recurring merchant/reason patterns
  const nowMs = Date.now();
  const reasonClusters = new Map<
    string,
    {
      rawReason: string;
      category: string;
      amounts: number[];
      sourceCounts: Map<string, number>;
      score: number;
      count: number;
    }
  >();

  for (const tx of spendTxs) {
    const rawReason = (tx.reason || '').trim();
    if (!rawReason || rawReason.startsWith('Bill:') || rawReason.startsWith('Goal')) continue;
    const key = rawReason.toLowerCase().replace(/\s+/g, ' ');
    const ageDays = Math.max(0, (nowMs - (new Date(tx.date).getTime() || nowMs)) / 86400000);
    // Exponential recency decay (30-day half-life)
    const recencyWeight = Math.exp(-ageDays / 45) + 0.35;

    const srcId = tx.fromId || tx.sourceId || '';
    const existing = reasonClusters.get(key);
    if (existing) {
      existing.amounts.push(tx.amount);
      existing.score += recencyWeight;
      existing.count += 1;
      existing.category = tx.category || existing.category;
      if (srcId && validSourceIds.has(srcId)) {
        existing.sourceCounts.set(srcId, (existing.sourceCounts.get(srcId) || 0) + 1);
      }
    } else {
      const sc = new Map<string, number>();
      if (srcId && validSourceIds.has(srcId)) sc.set(srcId, 1);
      reasonClusters.set(key, {
        rawReason,
        category: tx.category || 'Food & Dining',
        amounts: [tx.amount],
        sourceCounts: sc,
        score: recencyWeight,
        count: 1,
      });
    }
  }

  const rankedClusters = Array.from(reasonClusters.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 6);

  // Preserve custom user-added chips (non-default, non-ML)
  const seenChipIds = new Set<string>();
  const seenChipReasons = new Set<string>();
  const userCustomChips: QuickSpendChip[] = [];

  for (const c of sanitizedChips) {
    if (!c || !c.id) continue;
    if (c.isMlGenerated || c.id.startsWith('chip-') || c.id.startsWith('ml-chip-')) continue;
    const normR = normalizeCatKey(c.reason || c.label);
    if (seenChipIds.has(c.id) || (normR && seenChipReasons.has(normR))) continue;
    seenChipIds.add(c.id);
    if (normR) seenChipReasons.add(normR);
    userCustomChips.push(c);
  }

  const mlChips: QuickSpendChip[] = [];
  for (const [, cluster] of rankedClusters) {
    const cleanReason = toTitleCaseLabel(cluster.rawReason);
    const normR = normalizeCatKey(cleanReason);
    if (seenChipReasons.has(normR)) continue;
    seenChipReasons.add(normR);

    let bestSource: string | undefined = fallbackSourceId;
    let bestCount = 0;
    for (const [sid, cnt] of cluster.sourceCounts.entries()) {
      if (cnt > bestCount && validSourceIds.has(sid)) {
        bestCount = cnt;
        bestSource = sid;
      }
    }

    const medianAmt = Math.round(computeMedianValue(cluster.amounts));
    const baseSlug = slugifyKey(cleanReason, 20);
    let chipId = `ml-chip-${baseSlug}`;
    let suffix = 2;
    while (seenChipIds.has(chipId)) {
      chipId = `ml-chip-${baseSlug.slice(0, 16)}-${suffix}`;
      suffix += 1;
    }
    seenChipIds.add(chipId);

    mlChips.push({
      id: chipId,
      label: cleanReason.length > 20 ? `${cleanReason.slice(0, 18)}…` : cleanReason,
      reason: cleanReason,
      category: cluster.category,
      amount: medianAmt > 0 ? medianAmt : undefined,
      sourceId: bestSource,
      isMlGenerated: true,
      usageCount: cluster.count,
    });
  }

  // Keep user custom chips + ML learned chips; fall back to unobtrusive defaults if fewer than 4 total
  const combinedChips: QuickSpendChip[] = [...userCustomChips, ...mlChips];
  if (combinedChips.length < 4) {
    const fillerDefaults = sanitizedChips.filter(
      (c) =>
        c &&
        c.id &&
        !c.isMlGenerated &&
        !seenChipIds.has(c.id) &&
        !seenChipReasons.has(normalizeCatKey(c.reason || c.label))
    );
    for (const fd of fillerDefaults) {
      if (combinedChips.length >= 6) break;
      seenChipIds.add(fd.id);
      seenChipReasons.add(normalizeCatKey(fd.reason || fd.label));
      combinedChips.push(fd);
    }
  }

  const finalChips = combinedChips.slice(0, 8);
  const prevChipSig = currentChips
    .map((c) => `${c.id}:${c.label}:${c.amount || 0}:${c.category}:${c.sourceId || ''}`)
    .join('|');
  const nextChipSig = finalChips
    .map((c) => `${c.id}:${c.label}:${c.amount || 0}:${c.category}:${c.sourceId || ''}`)
    .join('|');

  return {
    updatedChips: finalChips,
    updatedCategories: nextCategories,
    chipsChanged: prevChipSig !== nextChipSig || sanitizedChips.length !== currentChips.length,
    categoriesChanged,
  };
}

/**
 * Computes Net Allocatable Liquid Surplus and Per-Goal ML Assessments & Contributor Suggestions.
 *
 * Strict Financial Rules Enforced:
 * 1. ONLY positive (> 0) unlocked liquid cash/bank holdings are eligible (`isPositiveLiquidHolding`).
 * 2. Credit Limits, Credit Card balances, Hybrid Credit lines, and Locked/Market Assets
 *    (FD, Sweep-In FD, RD, Stocks, Bonds, Mutual Funds, P2P) are STRICTLY EXCLUDED (0 contribution).
 * 3. Deducts:
 *    - Safety Buffer (`settings.cashFlowBufferAmount ?? minCashThreshold`)
 *    - Unpaid Recurring Bills (Loan EMIs + Card Statements + Subscriptions + Active Monthly Goal Bills)
 *    - ML Predicted Possible Bills (`predictedBills.totalPredictedAmountBase`)
 * 4. Produces suggestion-only liquid asset contributors (exact currency amount from Asset A, % from Asset B)
 *    and serious, mature, professional ML proximity guidance.
 */
export function computeGoalLiquidSurplusPlan(params: {
  goals: Goal[];
  holdings: Holding[];
  assetTypes: AssetType[];
  liabilities: Liability[];
  allBills: Bill[];
  incomeStreams: IncomeStream[];
  transactions: Transaction[];
  predictedBills: PredictedBillsSummary;
  currenciesList: Currency[];
  settings: AppSettings;
  minCashThresholdBase: number;
  referenceDate?: Date;
}): GoalLiquidSurplusPlan {
  const {
    goals,
    holdings,
    assetTypes,
    liabilities,
    allBills,
    incomeStreams,
    transactions,
    predictedBills,
    currenciesList,
    settings,
    minCashThresholdBase,
    referenceDate = new Date(),
  } = params;

  const currMap: Record<string, Currency> = {};
  for (const c of currenciesList) {
    currMap[c.code.toUpperCase()] = c;
  }

  const currentMonthStr = referenceDate.toISOString().substring(0, 7);

  // 1. Positive unlocked liquid holdings ONLY (> 0 balance, zero locked/market assets, zero credit limits)
  const positiveLiquidHoldings = holdings.filter((h) => isPositiveLiquidHolding(h, assetTypes));

  let grossPositiveLiquidBase = 0;
  const assetLiquidSnapshots = positiveLiquidHoldings.map((h) => {
    const localVal = getHoldingLocalValue(h);
    const valBase = convertToBase(localVal, h.currency, currMap);
    grossPositiveLiquidBase += valBase;
    return {
      holding: h,
      name: getSafeAssetName(h, assetTypes),
      localVal,
      valBase,
      rateToBase: currMap[h.currency.toUpperCase()]?.rateToBase || 1,
    };
  });

  // 2. Safety Buffer
  const safetyBufferBase = Math.max(
    0,
    settings.cashFlowBufferAmount !== undefined && settings.cashFlowBufferAmount > 0
      ? settings.cashFlowBufferAmount
      : minCashThresholdBase
  );

  // 3. Unpaid Recurring Bills for current cycle (excluding completed goal fulfillment pseudo-bills to avoid circular subtraction)
  let unpaidRecurringBillsBase = 0;
  for (const b of allBills) {
    if (b.isCompletedGoalBill) continue;
    const isPaidThisCycle =
      Boolean(b.isOverriddenPaid) ||
      b.lastOverriddenMonth === currentMonthStr ||
      Boolean(b.lastPostedDate && b.lastPostedDate.startsWith(currentMonthStr));
    if (isPaidThisCycle) continue;
    unpaidRecurringBillsBase += convertToBase(b.amount || 0, b.currency, currMap);
  }

  // 4. ML Predicted Possible Bills
  const predictedPossibleBillsBase = Math.max(0, predictedBills.totalPredictedAmountBase || 0);

  // 5. Net Allocatable Liquid Surplus
  const totalCommitmentsAndBufferBase = safetyBufferBase + unpaidRecurringBillsBase + predictedPossibleBillsBase;
  const netLiquidSurplusBase = Math.max(0, grossPositiveLiquidBase - totalCommitmentsAndBufferBase);

  // Estimate monthly net savings velocity (monthly income - monthly recurring bills - historical monthly spend)
  let monthlyIncomeBase = 0;
  for (const inc of incomeStreams) {
    const mult =
      inc.period === 'weekly'
        ? 52 / 12
        : inc.period === 'biweekly'
        ? 26 / 12
        : inc.period === 'quarterly'
        ? 1 / 3
        : inc.period === 'yearly'
        ? 1 / 12
        : 1;
    monthlyIncomeBase += convertToBase(inc.amountPerPeriod * mult, inc.currency, currMap);
  }

  const ninetyDaysAgo = new Date(referenceDate);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentSpendsBase = transactions
    .filter((t) => t.kind === 'spend' && new Date(t.date) >= ninetyDaysAgo)
    .reduce((sum, t) => sum + t.amount * (t.fxRateUsed || 1), 0);
  const avgMonthlySpendBase = recentSpendsBase > 0 ? recentSpendsBase / 3 : predictedBills.monthlyEssentialBaselineBase;
  const estimatedMonthlyNetSavingsBase = Math.max(0, monthlyIncomeBase - avgMonthlySpendBase);

  // Sort active goals by priority (high -> mid -> low)
  const priorityRank: Record<string, number> = { high: 1, mid: 2, low: 3 };
  const activeGoals = goals
    .filter((g) => !g.isCompleted)
    .sort((a, b) => (priorityRank[a.priority || 'mid'] || 2) - (priorityRank[b.priority || 'mid'] || 2));

  const assessmentsByGoalId: Record<string, GoalMLAssessment> = {};

  for (const goal of activeGoals) {
    const goalRate = currMap[goal.currency.toUpperCase()]?.rateToBase || 1;
    const goalSymbol = currMap[goal.currency.toUpperCase()]?.symbol || `${goal.currency} `;

    const isDebt = goal.goalType === 'debt_payoff';
    const matchedLiab =
      isDebt && goal.targetLiabilityId ? liabilities.find((l) => l.id === goal.targetLiabilityId) : undefined;

    const targetLocal = isDebt ? goal.startingDebtAmount || goal.cost : goal.cost;
    const accumulatedLocal = isDebt
      ? Math.max(0, targetLocal - (matchedLiab ? matchedLiab.outstanding : 0))
      : goal.accumulatedTotal || 0;

    const remainingLocal = Math.max(0, targetLocal - accumulatedLocal);
    const remainingBase = remainingLocal * goalRate;

    const fundedPct = targetLocal > 0 ? Math.min(100, (accumulatedLocal / targetLocal) * 100) : 0;

    // How much of this goal can be covered right now from Net Liquid Surplus (without touching safety buffer or bills)
    const allocatableSurplusBase = Math.min(remainingBase, netLiquidSurplusBase);
    const allocatableSurplusLocal = goalRate > 0 ? allocatableSurplusBase / goalRate : allocatableSurplusBase;

    const totalAchievableLocal = Math.min(targetLocal, accumulatedLocal + allocatableSurplusLocal);
    const combinedReadinessPct = targetLocal > 0 ? Math.min(100, (totalAchievableLocal / targetLocal) * 100) : 0;
    const achievableFromSurplusPct = Math.max(0, combinedReadinessPct - fundedPct);

    const shortfallAfterSurplusLocal = Math.max(0, remainingLocal - allocatableSurplusLocal);
    const shortfallAfterSurplusBase = shortfallAfterSurplusLocal * goalRate;

    // Build concrete suggestion-only contributors across positive liquid assets proportionally
    const contributors: GoalContributorSuggestion[] = [];
    if (allocatableSurplusBase > 0 && grossPositiveLiquidBase > 0 && remainingBase > 0) {
      // Rank liquid assets largest balance first for crisp allocation suggestions
      const sortedAssets = [...assetLiquidSnapshots].sort((a, b) => b.valBase - a.valBase);
      let remainingToSuggestBase = allocatableSurplusBase;

      for (let i = 0; i < sortedAssets.length; i++) {
        const item = sortedAssets[i];
        if (remainingToSuggestBase <= 0.5) break;

        // Each asset's proportional share of total positive liquid cash, capped at netLiquidSurplus share
        const assetSurplusCapBase = (item.valBase / grossPositiveLiquidBase) * netLiquidSurplusBase;
        const takeBase =
          i === sortedAssets.length - 1
            ? Math.min(assetSurplusCapBase, remainingToSuggestBase)
            : Math.min(assetSurplusCapBase, remainingToSuggestBase);

        if (takeBase < 1) continue;

        const takeLocalInAssetCurr = item.rateToBase > 0 ? takeBase / item.rateToBase : takeBase;
        const pctOfAsset = item.localVal > 0 ? Math.min(100, (takeLocalInAssetCurr / item.localVal) * 100) : 0;
        const pctOfGoalRemaining = remainingBase > 0 ? Math.min(100, (takeBase / remainingBase) * 100) : 0;

        contributors.push({
          assetId: item.holding.id,
          assetName: item.name,
          currency: item.holding.currency,
          availableBalanceLocal: item.localVal,
          suggestedAmountLocal: Math.round(takeLocalInAssetCurr),
          suggestedAmountBase: Math.round(takeBase),
          pctOfAsset: Math.round(pctOfAsset * 10) / 10,
          pctOfGoalRemaining: Math.round(pctOfGoalRemaining * 10) / 10,
        });

        remainingToSuggestBase -= takeBase;
      }
    }

    // Format contributor suggestion copy: Asset 1 as exact currency amount, Asset 2+ with percentage & amount
    let contributorSummaryText = '';
    if (contributors.length === 0) {
      contributorSummaryText =
        grossPositiveLiquidBase <= 0
          ? 'No positive liquid cash balances available. Credit limits and locked investments are excluded from goal calculations.'
          : 'Available liquid cash is currently reserved for your safety buffer, recurring bills, and ML-projected upcoming expenses.';
    } else {
      const parts = contributors.slice(0, 3).map((c, idx) => {
        const cSym = currMap[c.currency.toUpperCase()]?.symbol || `${c.currency} `;
        const amtStr = formatMoney(c.suggestedAmountLocal, c.currency, cSym);
        if (idx === 0) {
          return `${amtStr} (${c.pctOfAsset.toFixed(0)}%) from ${c.assetName}`;
        }
        return `${c.pctOfAsset.toFixed(1)}% (${amtStr}) from ${c.assetName}`;
      });
      contributorSummaryText = `Suggested liquid allocation: ${parts.join(' and ')}.`;
    }

    // Estimate months to close remaining shortfall
    const configuredMonthlyLocal =
      (goal.sources || []).reduce((s, src) => s + (src.monthlyIncrement || 0), 0) ||
      goal.monthlyContribution ||
      0;
    const configuredMonthlyBase = configuredMonthlyLocal * goalRate;
    const velocityBase =
      configuredMonthlyBase > 0
        ? configuredMonthlyBase
        : estimatedMonthlyNetSavingsBase > 0
        ? estimatedMonthlyNetSavingsBase * 0.5
        : 0;

    const estimatedMonthsToComplete =
      shortfallAfterSurplusBase <= 0
        ? 0
        : velocityBase > 0
        ? Math.max(1, Math.ceil(shortfallAfterSurplusBase / velocityBase))
        : null;

    // Mature, serious, institutional ML readiness & proximity guidance
    const fmtRemaining = formatMoney(remainingLocal, goal.currency, goalSymbol);
    const fmtShortfall = formatMoney(shortfallAfterSurplusLocal, goal.currency, goalSymbol);

    let mlMotivationHeadline = '';
    let mlMotivationBody = '';

    if (remainingLocal <= 0) {
      mlMotivationHeadline = 'Target capital fully accumulated — ready for settlement';
      mlMotivationBody = `100% of ${formatMoney(targetLocal, goal.currency, goalSymbol)} has been accumulated from verified liquid contributions.`;
    } else if (shortfallAfterSurplusLocal <= 0) {
      mlMotivationHeadline = `100% achievable from net liquid surplus (${fmtRemaining} remaining)`;
      mlMotivationBody = `After reserving your safety buffer, unpaid recurring bills, and ML-estimated upcoming expenses, your positive liquid cash can cover the entire remaining ${fmtRemaining} without touching locked assets or credit lines.`;
    } else if (combinedReadinessPct >= 75) {
      mlMotivationHeadline = `Within striking distance: only ${fmtShortfall} beyond current liquid surplus`;
      mlMotivationBody = `This objective is ${combinedReadinessPct.toFixed(0)}% achievable today (${fundedPct.toFixed(0)}% accumulated + ${achievableFromSurplusPct.toFixed(0)}% from net liquid surplus). ${
        estimatedMonthsToComplete
          ? `Maintaining disciplined cash allocation closes the final ${fmtShortfall} in approximately ${estimatedMonthsToComplete} ${estimatedMonthsToComplete === 1 ? 'month' : 'months'}.`
          : `Requires ${fmtShortfall} in additional net liquid savings to complete.`
      }`;
    } else if (combinedReadinessPct > 0) {
      mlMotivationHeadline = `${combinedReadinessPct.toFixed(0)}% achievable — ${fmtShortfall} additional liquid savings required`;
      mlMotivationBody = `Total remaining target is ${fmtRemaining}, of which ${formatMoney(allocatableSurplusLocal, goal.currency, goalSymbol)} can be sourced from current net liquid surplus. ${
        estimatedMonthsToComplete
          ? `Projected completion in ~${estimatedMonthsToComplete} months at current savings pace.`
          : 'Continue building positive liquid reserves to close the remaining gap.'
      }`;
    } else {
      mlMotivationHeadline = `${fmtRemaining} required — preserve buffer and build net liquid surplus`;
      mlMotivationBody =
        estimatedMonthsToComplete
          ? `Current liquid balances are earmarked for bills and safety reserves. At your estimated savings rate, this target is projected in ~${estimatedMonthsToComplete} months.`
          : `Current liquid balances are earmarked for recurring obligations and safety buffer. Credit limits and locked deposits are excluded.`;
    }

    assessmentsByGoalId[goal.id] = {
      goalId: goal.id,
      goalName: goal.name,
      targetAmountLocal: targetLocal,
      accumulatedAmountLocal: accumulatedLocal,
      remainingAmountLocal: remainingLocal,
      remainingAmountBase: remainingBase,
      fundedPct: Math.round(fundedPct * 10) / 10,
      achievableFromSurplusPct: Math.round(achievableFromSurplusPct * 10) / 10,
      combinedReadinessPct: Math.round(combinedReadinessPct * 10) / 10,
      allocatableSurplusLocal: Math.round(allocatableSurplusLocal),
      allocatableSurplusBase: Math.round(allocatableSurplusBase),
      shortfallAfterSurplusLocal: Math.round(shortfallAfterSurplusLocal),
      estimatedMonthsToComplete,
      contributors,
      contributorSummaryText,
      mlMotivationHeadline,
      mlMotivationBody,
    };
  }

  return {
    grossPositiveLiquidBase: Math.round(grossPositiveLiquidBase),
    safetyBufferBase: Math.round(safetyBufferBase),
    unpaidRecurringBillsBase: Math.round(unpaidRecurringBillsBase),
    predictedPossibleBillsBase: Math.round(predictedPossibleBillsBase),
    netLiquidSurplusBase: Math.round(netLiquidSurplusBase),
    estimatedMonthlyNetSavingsBase: Math.round(estimatedMonthlyNetSavingsBase),
    assessmentsByGoalId,
  };
}

export const DEFAULT_ONLINE_LEARNER_STATE: OnlineSpendIncomeModelState = {
  monthlySpendBaselineEma: 0,
  essentialSpendEma: 0,
  discretionarySpendEma: 0,
  spendForecastBias: 1.0,
  categoryEmaMonthly: {},
  completedMonthActuals: {},
  completedMonthPredictions: {},
  annualSalaryEma: 0,
  salaryGrowthRateEma: 0,
  lastTrainedDataSignature: '',
  totalOnlineUpdates: 0,
  lastUpdatedAt: new Date().toISOString(),
  halfPredictions: {
    observedMonthKey: new Date().toISOString().substring(0, 7),
    monthElapsedFraction: 0.5,
    partialMonthObservedSpendBase: 0,
    projectedFullMonthSpendBase: 0,
    projectedRemainingMonthSpendBase: 0,
    nextMonthSpendEstimateBase: 0,
    nextMonthNetSavingsEstimateBase: 0,
    predictedCategoryBreakdown: {},
  },
};

export function getStoredOnlineLearnerState(): OnlineSpendIncomeModelState {
  try {
    const raw = localStorage.getItem(ONLINE_LEARNER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_ONLINE_LEARNER_STATE,
        ...parsed,
        halfPredictions: {
          ...DEFAULT_ONLINE_LEARNER_STATE.halfPredictions,
          ...(parsed.halfPredictions || {}),
        },
      };
    }
  } catch {}
  return { ...DEFAULT_ONLINE_LEARNER_STATE };
}

export function saveOnlineLearnerState(state: OnlineSpendIncomeModelState): void {
  try {
    localStorage.setItem(ONLINE_LEARNER_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to persist online learner state:', e);
  }
}

/**
 * Online Continuous Learner across user's live transactions, bills, salary streams, and holdings.
 * Updates spend EMAs, category weights, spendForecastBias (comparing completed months' reality vs model prediction),
 * salary trajectory EMA, career model intercept alignment, and partial-month ("half-prediction") forecasts.
 */
export function syncOnlineLearnerWithData(params: {
  transactions: Transaction[];
  incomeStreams: IncomeStream[];
  currenciesList: Currency[];
  baseCurrency: string;
  careerProfile: CareerProfile;
  careerWeights: CareerModelWeights;
  netWorthBase: number;
  referenceDate?: Date;
}): {
  onlineState: OnlineSpendIncomeModelState;
  careerWeightsUpdated?: CareerModelWeights;
  didTrain: boolean;
} {
  const {
    transactions,
    incomeStreams,
    currenciesList,
    baseCurrency,
    careerProfile,
    careerWeights,
    netWorthBase,
    referenceDate = new Date(),
  } = params;

  const currMap: Record<string, Currency> = {};
  for (const c of currenciesList) currMap[c.code.toUpperCase()] = c;

  // Compute annual salary from configured streams + recent salary credits
  let streamAnnualBase = 0;
  for (const inc of incomeStreams) {
    const mult =
      inc.period === 'weekly'
        ? 52
        : inc.period === 'biweekly'
        ? 26
        : inc.period === 'quarterly'
        ? 4
        : inc.period === 'yearly'
        ? 1
        : 12;
    streamAnnualBase += convertToBase(inc.amountPerPeriod * mult, inc.currency, currMap);
  }

  const spendSumSig = Math.round(
    transactions.filter((t) => t.kind === 'spend').reduce((s, t) => s + t.amount, 0)
  );
  const incomeSumSig = Math.round(
    transactions.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0)
  );
  const dataSig = `${transactions.length}:${spendSumSig}:${incomeSumSig}:${incomeStreams.length}:${Math.round(streamAnnualBase)}:${referenceDate.toISOString().substring(0, 10)}`;

  const state = getStoredOnlineLearnerState();
  if (state.lastTrainedDataSignature === dataSig) {
    return { onlineState: state, didTrain: false };
  }

  const currentMonthKey = referenceDate.toISOString().substring(0, 7);
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate() || 30;
  const dayOfMonth = Math.max(1, referenceDate.getDate());
  const monthElapsedFraction = Math.min(1, Math.max(0.05, dayOfMonth / daysInMonth));

  const essentialSet = new Set(['bills', 'groceries', 'food & dining', 'transport', 'health', 'loans & emi', 'utilities']);

  // Aggregate monthly spend by YYYY-MM and category
  const monthTotals = new Map<string, number>();
  const monthEssential = new Map<string, number>();
  const monthDiscretionary = new Map<string, number>();
  const monthCatTotals = new Map<string, Record<string, number>>();

  let currentMonthSpendBase = 0;
  const currentMonthCategories: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.kind !== 'spend') continue;
    if (tx.tags?.includes('Goal Contribution') || tx.tags?.includes('Goal Fulfilled')) continue;

    const amtBase =
      tx.currency.toUpperCase() === baseCurrency.toUpperCase()
        ? tx.amount
        : tx.fxRateUsed && tx.fxRateUsed !== 1
        ? tx.amount * tx.fxRateUsed
        : convertToBase(tx.amount, tx.currency, currMap);

    const mKey = (tx.date || '').substring(0, 7);
    if (!mKey) continue;

    const cat = (tx.category || 'General').trim();
    const isEss = essentialSet.has(cat.toLowerCase());

    if (mKey === currentMonthKey) {
      currentMonthSpendBase += amtBase;
      currentMonthCategories[cat] = (currentMonthCategories[cat] || 0) + amtBase;
    } else {
      monthTotals.set(mKey, (monthTotals.get(mKey) || 0) + amtBase);
      if (isEss) {
        monthEssential.set(mKey, (monthEssential.get(mKey) || 0) + amtBase);
      } else {
        monthDiscretionary.set(mKey, (monthDiscretionary.get(mKey) || 0) + amtBase);
      }
      const catRec = monthCatTotals.get(mKey) || {};
      catRec[cat] = (catRec[cat] || 0) + amtBase;
      monthCatTotals.set(mKey, catRec);
    }
  }

  const sortedCompletedMonths = Array.from(monthTotals.keys()).sort();
  const alpha = 0.35; // EMA learning rate

  let spendBaselineEma = state.monthlySpendBaselineEma || 0;
  let essentialEma = state.essentialSpendEma || 0;
  let discretionaryEma = state.discretionarySpendEma || 0;
  let forecastBias = state.spendForecastBias || 1.0;
  const catEma: Record<string, number> = { ...(state.categoryEmaMonthly || {}) };
  const completedActuals: Record<string, number> = { ...(state.completedMonthActuals || {}) };
  const completedPreds: Record<string, number> = { ...(state.completedMonthPredictions || {}) };

  for (const mKey of sortedCompletedMonths) {
    const actual = monthTotals.get(mKey) || 0;
    const ess = monthEssential.get(mKey) || 0;
    const disc = monthDiscretionary.get(mKey) || 0;

    // If this completed month hasn't been trained on yet (or its actual changed), run online gradient step
    if (completedActuals[mKey] !== Math.round(actual)) {
      const priorPred =
        completedPreds[mKey] ||
        (spendBaselineEma > 0 ? spendBaselineEma * forecastBias : actual);

      if (priorPred > 0 && spendBaselineEma > 0) {
        const relErr = Math.max(-0.5, Math.min(0.5, (actual - priorPred) / priorPred));
        forecastBias = Math.max(0.65, Math.min(1.45, +(forecastBias + 0.08 * relErr).toFixed(4)));
      }
      completedActuals[mKey] = Math.round(actual);
      completedPreds[mKey] = Math.round(priorPred);
    }

    spendBaselineEma = spendBaselineEma > 0 ? spendBaselineEma * (1 - alpha) + actual * alpha : actual;
    essentialEma = essentialEma > 0 ? essentialEma * (1 - alpha) + ess * alpha : ess;
    discretionaryEma = discretionaryEma > 0 ? discretionaryEma * (1 - alpha) + disc * alpha : disc;

    const mCats = monthCatTotals.get(mKey) || {};
    for (const [cName, cVal] of Object.entries(mCats)) {
      catEma[cName] = catEma[cName] ? catEma[cName] * (1 - alpha) + cVal * alpha : cVal;
    }
  }

  // If no completed past months exist yet, seed EMA from current month velocity
  if (spendBaselineEma <= 0 && currentMonthSpendBase > 0) {
    spendBaselineEma = Math.round(currentMonthSpendBase / Math.max(0.25, monthElapsedFraction));
    for (const [cName, cVal] of Object.entries(currentMonthCategories)) {
      catEma[cName] = Math.round(cVal / Math.max(0.25, monthElapsedFraction));
    }
  }

  // Half-month / Partial-month trajectory prediction:
  // Blends linear run-rate from partial month with learned historical baseline EMA * bias
  const runRateFullMonth = currentMonthSpendBase / Math.max(0.15, monthElapsedFraction);
  const historicalAnchor = spendBaselineEma > 0 ? spendBaselineEma * forecastBias : runRateFullMonth;
  const projectedFullMonthSpendBase = Math.round(
    Math.max(
      currentMonthSpendBase,
      monthElapsedFraction * runRateFullMonth + (1 - monthElapsedFraction) * historicalAnchor
    )
  );
  const projectedRemainingMonthSpendBase = Math.max(0, Math.round(projectedFullMonthSpendBase - currentMonthSpendBase));
  const nextMonthSpendEstimateBase = Math.round(
    (spendBaselineEma > 0 ? spendBaselineEma * 0.65 + projectedFullMonthSpendBase * 0.35 : projectedFullMonthSpendBase) *
      forecastBias
  );

  // Store prediction for current month so once the month rolls over, reality vs prediction updates bias!
  completedPreds[currentMonthKey] = projectedFullMonthSpendBase;

  // Predicted category breakdown for next cycle
  const predictedCategoryBreakdown: Record<string, number> = {};
  for (const [cName, cVal] of Object.entries(catEma)) {
    predictedCategoryBreakdown[cName] = Math.round(cVal * forecastBias);
  }
  for (const [cName, cVal] of Object.entries(currentMonthCategories)) {
    if (!predictedCategoryBreakdown[cName]) {
      predictedCategoryBreakdown[cName] = Math.round((cVal / Math.max(0.25, monthElapsedFraction)) * forecastBias);
    }
  }

  // Online Salary Learning: detect salary changes and nudge CareerModelWeights if actual salary diverges
  let annualSalaryEma = state.annualSalaryEma || 0;
  let salaryGrowthRateEma = state.salaryGrowthRateEma || 0;
  let careerWeightsUpdated: CareerModelWeights | undefined;

  if (streamAnnualBase > 0) {
    if (annualSalaryEma > 0 && Math.abs(streamAnnualBase - annualSalaryEma) / annualSalaryEma >= 0.01) {
      const observedJump = (streamAnnualBase - annualSalaryEma) / annualSalaryEma;
      salaryGrowthRateEma = +(
        salaryGrowthRateEma * 0.6 + Math.max(-0.5, Math.min(1.0, observedJump)) * 0.4
      ).toFixed(4);

      // Compare newly observed salary reality against Career ML prediction and gently shift baseIntercept
      const predRes = predictCareerAndSalary(careerProfile, 0, netWorthBase, careerWeights);
      if (predRes.predictedCurrentMarketMedian > 0) {
        const salRelErr =
          (streamAnnualBase - predRes.predictedCurrentMarketMedian) / predRes.predictedCurrentMarketMedian;
        const clamped = Math.max(-0.4, Math.min(0.5, salRelErr));
        if (Math.abs(clamped) >= 0.03) {
          const nextW: CareerModelWeights = {
            ...careerWeights,
            baseIntercept: Math.max(
              0.45,
              Math.min(2.8, +(careerWeights.baseIntercept + clamped * 0.05).toFixed(4))
            ),
            tuneIterations: (careerWeights.tuneIterations || 0) + 1,
          };
          saveCareerWeights(nextW);
          careerWeightsUpdated = nextW;
        }
      }
    }
    annualSalaryEma = annualSalaryEma > 0 ? Math.round(annualSalaryEma * 0.5 + streamAnnualBase * 0.5) : Math.round(streamAnnualBase);
  }

  const monthlyIncomeBase = streamAnnualBase / 12;
  const nextMonthNetSavingsEstimateBase = Math.round(monthlyIncomeBase - nextMonthSpendEstimateBase);

  const nextState: OnlineSpendIncomeModelState = {
    monthlySpendBaselineEma: Math.round(spendBaselineEma),
    essentialSpendEma: Math.round(essentialEma),
    discretionarySpendEma: Math.round(discretionaryEma),
    spendForecastBias: forecastBias,
    categoryEmaMonthly: Object.fromEntries(
      Object.entries(catEma).map(([k, v]) => [k, Math.round(v)])
    ),
    completedMonthActuals: completedActuals,
    completedMonthPredictions: completedPreds,
    annualSalaryEma,
    salaryGrowthRateEma,
    lastTrainedDataSignature: dataSig,
    totalOnlineUpdates: (state.totalOnlineUpdates || 0) + 1,
    lastUpdatedAt: new Date().toISOString(),
    halfPredictions: {
      observedMonthKey: currentMonthKey,
      monthElapsedFraction: Math.round(monthElapsedFraction * 1000) / 1000,
      partialMonthObservedSpendBase: Math.round(currentMonthSpendBase),
      projectedFullMonthSpendBase,
      projectedRemainingMonthSpendBase,
      nextMonthSpendEstimateBase,
      nextMonthNetSavingsEstimateBase,
      predictedCategoryBreakdown,
    },
  };

  saveOnlineLearnerState(nextState);
  return { onlineState: nextState, careerWeightsUpdated, didTrain: true };
}

const CLOSED_LOOP_ML_STORAGE_KEY = 'networthiq_ml_closed_loop_state_v1';

export const ENGAGEMENT_STRATEGY_LABELS: Record<EngagementStrategyStyle, string> = {
  direct_cost_impact: 'Silent Bleed & Exact Rupee Retention',
  comparative_peer_table: 'Asymmetric Spread & Option Mirror',
  goal_velocity_framing: 'Future-Self & Goal Trajectory Anchor',
  concise_executive_brief: 'Private-Wealth Quiet Default',
};

const STRATEGY_ROTATION_ORDER: EngagementStrategyStyle[] = [
  'direct_cost_impact',
  'comparative_peer_table',
  'goal_velocity_framing',
  'concise_executive_brief',
];

export const DEFAULT_CLOSED_LOOP_ML_STATE: ClosedLoopMLState = {
  activeStrategy: 'concise_executive_brief',
  escalationLevel: 1,
  microWinsCount: 0,
  cumulativeSavedBase: 0,
  lastWhisperSummary: '',
  strategyScores: {
    direct_cost_impact: { attempts: 1, successes: 1, failures: 0, score: 0.78 },
    comparative_peer_table: { attempts: 1, successes: 1, failures: 0, score: 0.75 },
    goal_velocity_framing: { attempts: 1, successes: 1, failures: 0, score: 0.74 },
    concise_executive_brief: { attempts: 1, successes: 1, failures: 0, score: 0.80 },
  },
  domainStats: {
    broker_fees: { successes: 0, failures: 0, accuracyBias: 1.0 },
    spending: { successes: 0, failures: 0, accuracyBias: 1.0 },
    earnings: { successes: 0, failures: 0, accuracyBias: 1.0 },
    asset_allocation: { successes: 0, failures: 0, accuracyBias: 1.0 },
    debt_strategy: { successes: 0, failures: 0, accuracyBias: 1.0 },
  },
  processedLedgerIds: [],
  recentOutcomes: [],
  brokerProfiles: [],
  totalRealityAudits: 0,
  lastUpdatedAt: new Date().toISOString(),
};

export function getStoredClosedLoopMLState(): ClosedLoopMLState {
  try {
    const raw = localStorage.getItem(CLOSED_LOOP_ML_STORAGE_KEY);
    if (!raw) return DEFAULT_CLOSED_LOOP_ML_STATE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CLOSED_LOOP_ML_STATE,
      ...parsed,
      strategyScores: {
        ...DEFAULT_CLOSED_LOOP_ML_STATE.strategyScores,
        ...(parsed.strategyScores || {}),
      },
      domainStats: {
        ...DEFAULT_CLOSED_LOOP_ML_STATE.domainStats,
        ...(parsed.domainStats || {}),
      },
      processedLedgerIds: Array.isArray(parsed.processedLedgerIds) ? parsed.processedLedgerIds : [],
      recentOutcomes: Array.isArray(parsed.recentOutcomes) ? parsed.recentOutcomes : [],
      brokerProfiles: Array.isArray(parsed.brokerProfiles) ? parsed.brokerProfiles : [],
    };
  } catch {
    return DEFAULT_CLOSED_LOOP_ML_STATE;
  }
}

export function saveClosedLoopMLState(state: ClosedLoopMLState): void {
  try {
    localStorage.setItem(CLOSED_LOOP_ML_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Calculates exact brokerage / transfer charge for personal lending or cash/card-to-bank withdrawal:
 * - 'percent': e.g. 0.3% or 3% of amount
 * - 'per_unit': X fixed amount for every N amount (e.g. 300 for every 10,000 => Math.ceil(10000 / 10000) * 300 = 300)
 * - 'flat': flat fixed fee
 */
export function computeBrokerFeeAmount(
  amount: number,
  feeMode: 'none' | 'percent' | 'per_unit' | 'flat',
  params: {
    feePct?: number;
    feePerUnitAmount?: number;
    feeUnitSize?: number;
    flatFee?: number;
  }
): number {
  const safeAmt = Math.max(0, Number(amount) || 0);
  if (safeAmt <= 0 || feeMode === 'none') return 0;

  if (feeMode === 'percent') {
    const pct = Math.max(0, Number(params.feePct) || 0);
    return Math.round(((safeAmt * pct) / 100) * 100) / 100;
  }

  if (feeMode === 'per_unit') {
    const unitCharge = Math.max(0, Number(params.feePerUnitAmount) || 0);
    const unitSize = Math.max(1, Number(params.feeUnitSize) || 10000);
    const slabs = Math.ceil(safeAmt / unitSize);
    return Math.round(slabs * unitCharge * 100) / 100;
  }

  if (feeMode === 'flat') {
    return Math.round(Math.max(0, Number(params.flatFee ?? params.feePerUnitAmount) || 0) * 100) / 100;
  }

  return 0;
}

/**
 * Correlates historical (Card / Bank Source, Broker Name) -> brokerage fee structure
 * across both ledger transactions and personal loan receivables.
 */
export function correlateCardBrokerFees(
  transactions: Transaction[],
  receivables: Receivable[],
  liabilities: Liability[],
  holdings: Holding[],
  assetTypes: AssetType[] = []
): BrokerCardFeeProfile[] {
  const map = new Map<string, BrokerCardFeeProfile>();

  const resolveSourceMeta = (sourceId?: string): { id: string; name: string; kind: 'card' | 'bank' } | null => {
    if (!sourceId) return null;
    const card = liabilities.find((l) => l.id === sourceId && l.kind === 'card');
    if (card) {
      return { id: card.id, name: getSafeLiabilityName(card), kind: 'card' };
    }
    const hold = holdings.find((h) => h.id === sourceId);
    if (hold) {
      return { id: hold.id, name: getSafeAssetName(hold, assetTypes), kind: 'bank' };
    }
    return null;
  };

  const ingestEvent = (opts: {
    sourceId?: string;
    brokerName?: string;
    principal: number;
    fee: number;
    feeMode?: 'none' | 'percent' | 'per_unit' | 'flat';
    feePct?: number;
    feePerUnitAmount?: number;
    feeUnitSize?: number;
    date: string;
  }) => {
    const brokerClean = (opts.brokerName || '').trim();
    const meta = resolveSourceMeta(opts.sourceId);
    if (!meta || (!brokerClean && opts.fee <= 0)) return;
    const effectiveBroker = brokerClean || (meta.kind === 'card' ? 'Card Direct / Cash Advance' : 'Direct Bank Transfer');
    const principal = Math.max(1, opts.principal);
    const fee = Math.max(0, opts.fee);
    const key = `${meta.id}::${effectiveBroker.toLowerCase()}`;

    const existing = map.get(key);
    const nextPrincipal = (existing?.totalPrincipalRouted || 0) + principal;
    const nextFees = (existing?.totalFeesPaid || 0) + fee;
    const effectivePct = Math.round(((nextFees / nextPrincipal) * 100) * 1000) / 1000;
    const isNewer = !existing || opts.date >= existing.lastUsedDate;

    map.set(key, {
      sourceId: meta.id,
      sourceName: meta.name,
      sourceKind: meta.kind,
      brokerName: effectiveBroker,
      sampleCount: (existing?.sampleCount || 0) + 1,
      effectiveFeePct: effectivePct,
      feeMode: isNewer && opts.feeMode ? opts.feeMode : existing?.feeMode || (fee > 0 ? 'percent' : 'none'),
      feePct: isNewer && opts.feePct !== undefined ? opts.feePct : existing?.feePct ?? effectivePct,
      feePerUnitAmount: isNewer && opts.feePerUnitAmount !== undefined ? opts.feePerUnitAmount : existing?.feePerUnitAmount,
      feeUnitSize: isNewer && opts.feeUnitSize !== undefined ? opts.feeUnitSize : existing?.feeUnitSize,
      lastUsedDate: isNewer ? opts.date : existing.lastUsedDate,
      totalPrincipalRouted: nextPrincipal,
      totalFeesPaid: nextFees,
    });
  };

  // Avoid double counting if both a Receivable and its disbursement Transaction have broker info:
  // track receivable disbursement dates + amounts
  const recSignatures = new Set<string>();

  for (const r of receivables) {
    if (!r.fundingSourceId) continue;
    const disbursed = r.disbursedAmount ?? Math.max(0, r.principalAmount - (r.transferFeeAmount || 0));
    const fee = r.transferFeeAmount || 0;
    if (!r.brokerName && fee <= 0) continue;
    recSignatures.add(`${r.fundingSourceId}:${r.issueDate}:${Math.round(r.principalAmount)}`);
    ingestEvent({
      sourceId: r.fundingSourceId,
      brokerName: r.brokerName,
      principal: disbursed > 0 ? disbursed : r.principalAmount,
      fee,
      feeMode: r.feeMode,
      feePct: r.feePct,
      feePerUnitAmount: r.feePerUnitAmount,
      feeUnitSize: r.feeUnitSize,
      date: r.issueDate,
    });
  }

  for (const tx of transactions) {
    if (!tx.fromId) continue;
    if (!tx.brokerName && (tx.brokerageFee || 0) <= 0) continue;
    const sig = `${tx.fromId}:${tx.date}:${Math.round(tx.amount)}`;
    if (recSignatures.has(sig)) continue;
    const fee = tx.brokerageFee || 0;
    const netPrincipal = Math.max(1, tx.amount - fee);
    ingestEvent({
      sourceId: tx.fromId,
      brokerName: tx.brokerName,
      principal: netPrincipal,
      fee,
      feeMode: tx.brokerFeeMode,
      feePct: tx.brokerFeePct,
      feePerUnitAmount: tx.brokerFeePerUnit,
      feeUnitSize: tx.brokerFeeUnitSize,
      date: tx.date,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.effectiveFeePct - b.effectiveFeePct);
}

export interface CardBrokerRecommendationOption {
  sourceId: string;
  sourceName: string;
  sourceKind: 'card' | 'bank';
  brokerName: string;
  projectedFee: number;
  effectiveFeePct: number;
  availableCapacity: number;
  hasSufficientCapacity: boolean;
  isHistoricalEmpirical: boolean;
}

export interface CardBrokerRecommendationResult {
  amountNeeded: number;
  bestOption: CardBrokerRecommendationOption | null;
  selectedOptionFee: number | null;
  potentialSavings: number;
  alternatives: CardBrokerRecommendationOption[];
  knownBrokers: string[];
  advisoryMessage: string;
}

/**
 * Recommends the lowest-charge card / account + broker combination for a given withdrawal or personal loan amount.
 */
export function recommendBestCardForBrokerAmount(params: {
  amountNeeded: number;
  liabilities: Liability[];
  holdings: Holding[];
  assetTypes?: AssetType[];
  transactions: Transaction[];
  receivables: Receivable[];
  preferredBrokerName?: string;
  selectedSourceId?: string;
  currentEnteredFee?: number;
  activeStrategy?: EngagementStrategyStyle;
  currSymbol?: string;
}): CardBrokerRecommendationResult {
  const {
    amountNeeded,
    liabilities,
    holdings,
    assetTypes = [],
    transactions,
    receivables,
    preferredBrokerName,
    selectedSourceId,
    currentEnteredFee,
    activeStrategy = 'direct_cost_impact',
    currSymbol = '₹',
  } = params;

  const profiles = correlateCardBrokerFees(transactions, receivables, liabilities, holdings, assetTypes);
  const knownBrokers = Array.from(
    new Set(profiles.map((p) => p.brokerName).filter((b) => b && b !== 'Direct Bank Transfer'))
  );

  const safeAmt = Math.max(0, Number(amountNeeded) || 0);
  if (safeAmt <= 0) {
    return {
      amountNeeded: 0,
      bestOption: null,
      selectedOptionFee: null,
      potentialSavings: 0,
      alternatives: [],
      knownBrokers,
      advisoryMessage: '',
    };
  }

  const options: CardBrokerRecommendationOption[] = [];
  const brokerFilter = (preferredBrokerName || '').trim().toLowerCase();

  const estimateCardCapacity = (card: Liability): number => {
    const creditAvail = Math.max(0, (card.creditLimit ?? card.limit ?? 0) - (card.outstanding || 0));
    if (card.cardType === 'hybrid' && card.linkedAccountId) {
      const bank = holdings.find((h) => h.id === card.linkedAccountId);
      const bankBal = Math.max(0, bank?.principalOrValue || 0);
      const sweepIn = holdings
        .filter((h) => Boolean(h.isSweepIn) && h.sweepInTargetAccountId === card.linkedAccountId)
        .reduce((s, h) => s + Math.max(0, h.principalOrValue || 0), 0);
      return bankBal + sweepIn + creditAvail;
    }
    if (card.cardType === 'debit' && card.linkedAccountId) {
      const bank = holdings.find((h) => h.id === card.linkedAccountId);
      return Math.max(0, bank?.principalOrValue || 0);
    }
    return creditAvail;
  };

  // 1. Add empirical historical card/broker profiles first
  for (const prof of profiles) {
    if (prof.sourceKind !== 'card') continue;
    const card = liabilities.find((l) => l.id === prof.sourceId && l.kind === 'card');
    if (!card) continue;
    const cap = estimateCardCapacity(card);
    let projectedFee = 0;
    if (prof.feeMode === 'per_unit' && prof.feePerUnitAmount && prof.feeUnitSize) {
      projectedFee = computeBrokerFeeAmount(safeAmt, 'per_unit', {
        feePerUnitAmount: prof.feePerUnitAmount,
        feeUnitSize: prof.feeUnitSize,
      });
    } else {
      projectedFee = Math.round(((safeAmt * prof.effectiveFeePct) / 100) * 100) / 100;
    }

    // Prioritize matching broker if user typed one, still keep cross-broker comparison
    options.push({
      sourceId: card.id,
      sourceName: getSafeLiabilityName(card),
      sourceKind: 'card',
      brokerName: prof.brokerName,
      projectedFee,
      effectiveFeePct: prof.effectiveFeePct,
      availableCapacity: cap,
      hasSufficientCapacity: cap >= safeAmt + projectedFee,
      isHistoricalEmpirical: true,
    });
  }

  // 2. Also include any wallet cards without empirical broker history yet using card type baseline
  const cards = liabilities.filter((l) => l.kind === 'card');
  for (const card of cards) {
    const alreadyCovered = options.some(
      (o) =>
        o.sourceId === card.id &&
        (!brokerFilter || o.brokerName.toLowerCase() === brokerFilter)
    );
    if (alreadyCovered) continue;

    const cap = estimateCardCapacity(card);
    let assumedPct = 2.0;
    let labelBroker = preferredBrokerName?.trim() || 'Broker / Card Desk';
    if (card.cardType === 'debit') {
      assumedPct = 0;
      labelBroker = preferredBrokerName?.trim() || 'Direct Bank / Debit';
    } else if (card.cardType === 'hybrid') {
      const bank = card.linkedAccountId ? holdings.find((h) => h.id === card.linkedAccountId) : undefined;
      const posBank = Math.max(0, bank?.principalOrValue || 0);
      // Hybrid draws positive bank balance first at 0% card surcharge, only credit portion incurs broker charge
      const creditPortion = Math.max(0, safeAmt - posBank);
      assumedPct = safeAmt > 0 ? Math.round(((creditPortion * 1.5) / safeAmt) * 100) / 100 : 0;
    }

    const projectedFee = Math.round(((safeAmt * assumedPct) / 100) * 100) / 100;
    options.push({
      sourceId: card.id,
      sourceName: getSafeLiabilityName(card),
      sourceKind: 'card',
      brokerName: labelBroker,
      projectedFee,
      effectiveFeePct: assumedPct,
      availableCapacity: cap,
      hasSufficientCapacity: cap >= safeAmt + projectedFee,
      isHistoricalEmpirical: false,
    });
  }

  const viableOptions = options
    .filter((o) => o.hasSufficientCapacity)
    .sort((a, b) => {
      if (a.projectedFee !== b.projectedFee) return a.projectedFee - b.projectedFee;
      if (a.isHistoricalEmpirical !== b.isHistoricalEmpirical) return a.isHistoricalEmpirical ? -1 : 1;
      return b.availableCapacity - a.availableCapacity;
    });

  const bestOption = viableOptions[0] || options.sort((a, b) => a.projectedFee - b.projectedFee)[0] || null;
  const selectedOpt = selectedSourceId
    ? viableOptions.find((o) => o.sourceId === selectedSourceId) ||
      options.find((o) => o.sourceId === selectedSourceId)
    : null;

  const selectedFee =
    currentEnteredFee !== undefined
      ? currentEnteredFee
      : selectedOpt
      ? selectedOpt.projectedFee
      : null;

  const potentialSavings =
    bestOption && selectedFee !== null && selectedOptionIsDifferent(bestOption, selectedSourceId, selectedFee)
      ? Math.max(0, Math.round((selectedFee - bestOption.projectedFee) * 100) / 100)
      : 0;

  let advisoryMessage = '';
  if (bestOption) {
    if (potentialSavings > 0 && selectedFee !== null) {
      advisoryMessage = formatAdaptiveAdvisory(activeStrategy, {
        headline: `Switch to ${bestOption.sourceName} (${bestOption.brokerName})`,
        directCostText: `Checking ${bestOption.sourceName} via ${bestOption.brokerName} lowers brokerage on ${currSymbol}${safeAmt.toLocaleString()} from ${currSymbol}${selectedFee.toLocaleString()} to ${currSymbol}${bestOption.projectedFee.toLocaleString()} — saving ${currSymbol}${potentialSavings.toLocaleString()} immediately.`,
        comparativeText: `Comparison for ${currSymbol}${safeAmt.toLocaleString()}: Current selection charges ${currSymbol}${selectedFee.toLocaleString()} vs ${bestOption.sourceName} (${bestOption.brokerName}) at ${currSymbol}${bestOption.projectedFee.toLocaleString()} (${bestOption.effectiveFeePct.toFixed(2)}%).`,
        goalVelocityText: `Routing ${currSymbol}${safeAmt.toLocaleString()} through ${bestOption.sourceName} preserves ${currSymbol}${potentialSavings.toLocaleString()} in net liquid surplus toward your active goals instead of brokerage leakage.`,
        conciseText: `Recommended check: ${bestOption.sourceName} via ${bestOption.brokerName} (Est. fee ${currSymbol}${bestOption.projectedFee.toLocaleString()}, saves ${currSymbol}${potentialSavings.toLocaleString()}).`,
      });
    } else {
      advisoryMessage = `Lowest estimated fee for ${currSymbol}${safeAmt.toLocaleString()}: ${bestOption.sourceName} via ${bestOption.brokerName} (${currSymbol}${bestOption.projectedFee.toLocaleString()} · ${bestOption.effectiveFeePct.toFixed(2)}%).`;
    }
  }

  return {
    amountNeeded: safeAmt,
    bestOption,
    selectedOptionFee: selectedFee,
    potentialSavings,
    alternatives: viableOptions.slice(0, 4),
    knownBrokers,
    advisoryMessage,
  };
}

function selectedOptionIsDifferent(
  best: CardBrokerRecommendationOption,
  selectedSourceId?: string,
  selectedFee?: number | null
): boolean {
  if (!selectedSourceId) return true;
  if (best.sourceId !== selectedSourceId) return true;
  if (selectedFee !== null && selectedFee !== undefined && selectedFee > best.projectedFee + 0.5) return true;
  return false;
}

/**
 * Detects recurring personal loan / broker withdrawal patterns (interval, typical amount, broker, and card)
 * and builds a NOTIFY-ONLY forecast when the user approaches their next predicted broker usage window.
 */
export function predictNextBrokerUsage(
  transactions: Transaction[],
  receivables: Receivable[],
  liabilities: Liability[],
  holdings: Holding[],
  assetTypes: AssetType[] = [],
  referenceDate: Date = new Date()
): BrokerUsageForecast {
  const events: Array<{ date: string; amount: number; brokerName: string; sourceId?: string; fee: number }> = [];
  const seenSig = new Set<string>();

  for (const r of receivables) {
    if (!r.brokerName && (r.transferFeeAmount || 0) <= 0) continue;
    const amt = r.disbursedAmount ?? Math.max(0, r.principalAmount - (r.transferFeeAmount || 0));
    const sig = `${r.fundingSourceId || ''}:${r.issueDate}:${Math.round(r.principalAmount)}`;
    seenSig.add(sig);
    events.push({
      date: r.issueDate,
      amount: amt > 0 ? amt : r.principalAmount,
      brokerName: r.brokerName || 'Card Broker',
      sourceId: r.fundingSourceId,
      fee: r.transferFeeAmount || 0,
    });
  }

  for (const tx of transactions) {
    if (!tx.brokerName && (tx.brokerageFee || 0) <= 0) continue;
    const sig = `${tx.fromId || ''}:${tx.date}:${Math.round(tx.amount)}`;
    if (seenSig.has(sig)) continue;
    const fee = tx.brokerageFee || 0;
    events.push({
      date: tx.date,
      amount: Math.max(1, tx.amount - fee),
      brokerName: tx.brokerName || 'Card Broker',
      sourceId: tx.fromId,
      fee,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) {
    return {
      hasPattern: false,
      sampleCount: 0,
      avgIntervalDays: 30,
      daysSinceLastUse: 0,
      daysUntilExpectedUse: 30,
      expectedNextDateStr: referenceDate.toISOString().split('T')[0],
      isUpcomingWindow: false,
      typicalAmount: 0,
      predictedBrokerName: '',
      habitualProjectedFee: 0,
      recommendedProjectedFee: 0,
      potentialFeeSaved: 0,
    };
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  let avgIntervalDays = 30;
  if (events.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < events.length; i++) {
      const prevMs = new Date(events[i - 1].date).getTime();
      const currMs = new Date(events[i].date).getTime();
      const diff = Math.round((currMs - prevMs) / msPerDay);
      if (diff >= 1 && diff <= 180) intervals.push(diff);
    }
    if (intervals.length > 0) {
      avgIntervalDays = Math.max(3, Math.round(intervals.reduce((s, d) => s + d, 0) / intervals.length));
    }
  }

  const lastEvent = events[events.length - 1];
  const lastDateMs = new Date(lastEvent.date).getTime();
  const daysSinceLastUse = Math.max(0, Math.floor((referenceDate.getTime() - lastDateMs) / msPerDay));
  const expectedNextMs = lastDateMs + avgIntervalDays * msPerDay;
  const expectedNextDateStr = new Date(expectedNextMs).toISOString().split('T')[0];
  const daysUntilExpectedUse = Math.round((expectedNextMs - referenceDate.getTime()) / msPerDay);

  const typicalAmount = Math.round(
    events.slice(-5).reduce((s, e) => s + e.amount, 0) / Math.min(5, events.length)
  );

  // Most frequent broker & habitual source
  const brokerCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const ev of events) {
    brokerCounts.set(ev.brokerName, (brokerCounts.get(ev.brokerName) || 0) + 1);
    if (ev.sourceId) sourceCounts.set(ev.sourceId, (sourceCounts.get(ev.sourceId) || 0) + 1);
  }
  const predictedBrokerName =
    Array.from(brokerCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || lastEvent.brokerName;
  const habitualSourceId =
    Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || lastEvent.sourceId;

  const habitualCard = liabilities.find((l) => l.id === habitualSourceId);
  const habitualBank = holdings.find((h) => h.id === habitualSourceId);
  const habitualSourceName = habitualCard
    ? getSafeLiabilityName(habitualCard)
    : habitualBank
    ? getSafeAssetName(habitualBank, assetTypes)
    : undefined;

  const rec = recommendBestCardForBrokerAmount({
    amountNeeded: typicalAmount,
    liabilities,
    holdings,
    assetTypes,
    transactions,
    receivables,
    preferredBrokerName: predictedBrokerName,
    selectedSourceId: habitualSourceId,
  });

  const habitualProjectedFee =
    rec.selectedOptionFee !== null
      ? rec.selectedOptionFee
      : Math.round((lastEvent.fee / Math.max(1, lastEvent.amount)) * typicalAmount);
  const recommendedProjectedFee = rec.bestOption ? rec.bestOption.projectedFee : habitualProjectedFee;
  const potentialFeeSaved = Math.max(0, Math.round((habitualProjectedFee - recommendedProjectedFee) * 100) / 100);

  // Notify-only window: when we have >=2 historical uses and expected date is within 7 days (or up to 5 days overdue),
  // OR even after 1 recorded brokered withdrawal if there is a clear lower-fee card in the wallet to notify about.
  const isUpcomingWindow =
    (events.length >= 2 && daysUntilExpectedUse <= 7 && daysUntilExpectedUse >= -5) ||
    (events.length === 1 && potentialFeeSaved > 0 && daysSinceLastUse <= 30);

  return {
    hasPattern: events.length >= 1,
    sampleCount: events.length,
    avgIntervalDays,
    daysSinceLastUse,
    daysUntilExpectedUse,
    expectedNextDateStr,
    isUpcomingWindow,
    typicalAmount,
    predictedBrokerName,
    habitualSourceId,
    habitualSourceName,
    habitualProjectedFee,
    recommendedCardId: rec.bestOption?.sourceId,
    recommendedCardName: rec.bestOption?.sourceName,
    recommendedBrokerName: rec.bestOption?.brokerName || predictedBrokerName,
    recommendedProjectedFee,
    potentialFeeSaved,
  };
}

/**
 * Formats an ML insight or warning according to the currently active adaptive engagement strategy.
 */
export function formatAdaptiveAdvisory(
  style: EngagementStrategyStyle,
  payload: {
    headline: string;
    directCostText: string;
    comparativeText: string;
    goalVelocityText: string;
    conciseText: string;
    priorFailureAck?: string;
  }
): string {
  const prefix = payload.priorFailureAck ? `${payload.priorFailureAck} ` : '';
  switch (style) {
    case 'direct_cost_impact':
      return `${prefix}${payload.directCostText}`;
    case 'comparative_peer_table':
      return `${prefix}${payload.comparativeText}`;
    case 'goal_velocity_framing':
      return `${prefix}${payload.goalVelocityText}`;
    case 'concise_executive_brief':
      return `${prefix}${payload.conciseText}`;
    default:
      return `${prefix}${payload.directCostText}`;
  }
}

function selectNextEngagementStrategy(
  current: EngagementStrategyStyle,
  scores: ClosedLoopMLState['strategyScores'],
  wasSuccess: boolean,
  escalationLevel: number = 1
): EngagementStrategyStyle {
  if (wasSuccess) {
    // Keep pushing with the exact behavioral lever that succeeded — even if only by a few rupees
    return current;
  }
  // If current strategy has high historical affinity and this is only escalation step 2,
  // intensify this same strategy once before rotating to the strongest alternative
  if ((scores[current]?.score ?? 0) >= 0.82 && escalationLevel <= 2) {
    return current;
  }
  const alternatives = STRATEGY_ROTATION_ORDER.filter((s) => s !== current);
  alternatives.sort((a, b) => (scores[b]?.score ?? 0.5) - (scores[a]?.score ?? 0.5));
  return alternatives[0] || 'direct_cost_impact';
}

/**
 * Predicts the exact optimal manner to settle a loan installment/prepayment right now
 * based on user-defined prepayment policy, lock-in window, cross-portfolio debt fees,
 * safe liquid cash surplus, active goals, and learned behavioral framing state.
 */
export function predictOptimalLoanPaymentPlan(params: {
  loan: Liability;
  liabilities: Liability[];
  holdings: Holding[];
  assetTypes: AssetType[];
  goals: Goal[];
  currencies: Currency[];
  settings: AppSettings;
  freeCashBase: number;
  transactions: Transaction[];
  closedLoopState?: ClosedLoopMLState;
}): PredictedLoanPaymentPlan {
  const {
    loan,
    liabilities,
    holdings,
    assetTypes,
    goals,
    currencies,
    settings,
    freeCashBase,
    transactions,
    closedLoopState,
  } = params;

  const mlState = closedLoopState || getStoredClosedLoopMLState();
  const activeStrategy = mlState.activeStrategy || 'concise_executive_brief';
  const escalationLevel = Math.max(1, Math.min(4, mlState.escalationLevel || 1));

  const currMap: Record<string, Currency> = {};
  for (const c of currencies) currMap[c.code] = c;
  const loanCurrObj = currMap[loan.currency];
  const currSymbol = loanCurrObj?.symbol || loan.currency;
  const fxToBase = loanCurrObj?.rateToBase || 1;

  const fullAmount = Math.max(0, loan.outstanding || 0);
  const remTenure = resolveRemainingTenureMonths(loan);
  const scheduledEmi = Math.min(
    fullAmount,
    loan.monthlyEmi && loan.monthlyEmi > 0
      ? loan.monthlyEmi
      : calculateContractualEmi(fullAmount, loan.ratePct || 0, Math.max(1, remTenure))
  );

  const lockStatus = getLoanLockInStatus(loan);

  // Pick optimal positive liquid account: prefer linked bank if sufficient, else lowest-yield idle liquid cash with coverage
  const liquidHoldings = holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes));
  const sortedForFunding = [...liquidHoldings].sort((a, b) => {
    const aLinked = loan.linkedAccountId === a.id ? 1 : 0;
    const bLinked = loan.linkedAccountId === b.id ? 1 : 0;
    if (aLinked !== bLinked) return bLinked - aLinked;
    const aRate = a.fixedRatePct ?? a.expectedRatePct ?? 0;
    const bRate = b.fixedRatePct ?? b.expectedRatePct ?? 0;
    if (Math.abs(aRate - bRate) > 0.25 && (a.principalOrValue || 0) >= scheduledEmi && (b.principalOrValue || 0) >= scheduledEmi) {
      return aRate - bRate; // Drain lowest-earning idle cash first
    }
    return (b.principalOrValue || 0) - (a.principalOrValue || 0);
  });
  const bestAsset =
    sortedForFunding.find((h) => (h.principalOrValue || 0) >= scheduledEmi) || sortedForFunding[0];
  const bestAssetName = bestAsset ? getSafeAssetName(bestAsset, assetTypes) : 'Liquid Account';
  const bestAssetYield = bestAsset ? (bestAsset.fixedRatePct ?? bestAsset.expectedRatePct ?? 2.5) : 2.5;

  // Evaluate portfolio-wide strategy with safe deployable monthly surplus (45% of free cash above safety threshold)
  const safeDeployableBase = Math.max(0, freeCashBase * 0.45);
  const debtEval = evaluateDebtStrategies(liabilities, safeDeployableBase, currMap, settings);
  const bestPortfolioStrat = debtEval.strategies[debtEval.recommendedStrategy];
  const loanPlanItem = bestPortfolioStrat.items.find((it) => it.liabilityId === loan.id);

  // Check if another unlocked debt has lower prepayment charge or higher priority
  const fullChargeEval = calculateLoanPrepaymentCharge(loan, fullAmount, {
    currentOutstanding: fullAmount,
    remainingTenureOverride: remTenure,
  });

  let betterAlt: { id: string; name: string; penaltyPct: number; ratePct: number } | undefined;
  for (const other of liabilities) {
    if (other.id === loan.id || (other.outstanding || 0) <= 0) continue;
    if (other.kind === 'loan') {
      const otherLock = getLoanLockInStatus(other);
      if (otherLock.isLockedIn) continue;
      const otherCharge = calculateLoanPrepaymentCharge(other, other.outstanding || 0);
      if (
        fullChargeEval.totalPenaltyWithTax > 0 &&
        (otherCharge.penaltyPct < fullChargeEval.penaltyPct ||
          (otherCharge.penaltyPct === 0 && (other.ratePct || 0) >= (loan.ratePct || 0) * 0.8))
      ) {
        if (!betterAlt || otherCharge.penaltyPct < betterAlt.penaltyPct || (other.ratePct || 0) > betterAlt.ratePct) {
          betterAlt = {
            id: other.id,
            name: getSafeLiabilityName(other),
            penaltyPct: otherCharge.penaltyPct,
            ratePct: other.ratePct || 0,
          };
        }
      }
    } else if (other.cardType !== 'debit') {
      const cardApr = other.ratePct || (other.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5) * 12;
      if (fullChargeEval.totalPenaltyWithTax > 0 || cardApr > (loan.ratePct || 0)) {
        if (!betterAlt || cardApr > betterAlt.ratePct) {
          betterAlt = {
            id: other.id,
            name: getSafeLiabilityName(other),
            penaltyPct: 0,
            ratePct: cardApr,
          };
        }
      }
    }
  }

  const isHigherFeeThanAlternative = fullChargeEval.totalPenaltyWithTax > 0 && Boolean(betterAlt);

  // Determine exact predicted payment mode & amount
  let recommendedMode: 'emi' | 'custom' | 'full' = 'emi';
  let recommendedAmount = scheduledEmi;
  let projectedPenaltyCharge = 0;
  let projectedPenaltyPct = 0;
  let projectedGrossInterestSaved = 0;
  let projectedNetBenefit = 0;
  let projectedMonthsSaved = 0;
  let strategyRationale = '';

  const maxLiquidForThisAccount = bestAsset ? Math.max(0, bestAsset.principalOrValue || 0) : 0;
  const safeSurplusLocal = fxToBase > 0 ? safeDeployableBase / fxToBase : safeDeployableBase;
  const maxSafePaymentLocal = Math.min(
    fullAmount,
    maxLiquidForThisAccount > 0 ? maxLiquidForThisAccount : fullAmount,
    scheduledEmi + safeSurplusLocal
  );

  if (lockStatus.isLockedIn) {
    recommendedMode = 'emi';
    recommendedAmount = scheduledEmi;
    strategyRationale = `Lock-in active for ${lockStatus.remainingLockInMonths} more month(s); scheduled EMI avoids contractual breach while preserving surplus.`;
  } else if (isHigherFeeThanAlternative && betterAlt) {
    recommendedMode = 'emi';
    recommendedAmount = scheduledEmi;
    strategyRationale = `Settling exact EMI (${formatMoney(scheduledEmi, loan.currency, currSymbol, settings.numberGrouping, 0)}) sidesteps the ${fullChargeEval.penaltyPct}% prepayment charge here so surplus can clear ${betterAlt.name} (${betterAlt.penaltyPct}% fee) first.`;
  } else {
    // Check if full payoff is safely covered and financially net-positive
    const fullSim = simulateLoanPrepayment(loan, fullAmount, { maintainTenureReduceEmi: false });
    const fullTotalOutflow = fullAmount + fullChargeEval.totalPenaltyWithTax;
    if (
      fullAmount > scheduledEmi &&
      safeSurplusLocal + scheduledEmi >= fullTotalOutflow &&
      maxLiquidForThisAccount >= fullTotalOutflow &&
      fullSim.isFinanciallyBeneficial &&
      fullSim.netFinancialBenefit > 0
    ) {
      recommendedMode = 'full';
      recommendedAmount = fullAmount;
      projectedPenaltyCharge = fullChargeEval.totalPenaltyWithTax;
      projectedPenaltyPct = fullChargeEval.penaltyPct;
      projectedGrossInterestSaved = fullSim.grossInterestSaved;
      projectedNetBenefit = fullSim.netFinancialBenefit;
      projectedMonthsSaved = fullSim.monthsSaved;
      strategyRationale = `Safe liquid surplus covers complete retirement of ${getSafeLiabilityName(loan)},permanently eliminating ${formatMoney(fullSim.netFinancialBenefit, loan.currency, currSymbol, settings.numberGrouping, 0)} in net future interest.`;
    } else {
      // Compute precision partial prepayment slice (even a modest slice saves compounding interest)
      const strategySuggestedLocal =
        loanPlanItem && fxToBase > 0
          ? loanPlanItem.recommendedPayment / fxToBase
          : scheduledEmi + safeSurplusLocal * 0.5;
      const rawCandidate = Math.min(
        maxSafePaymentLocal,
        Math.max(strategySuggestedLocal, scheduledEmi + Math.min(safeSurplusLocal * 0.6, fullAmount - scheduledEmi))
      );
      // Round extra slice cleanly so it feels natural and deliberate
      const rawExtra = Math.max(0, rawCandidate - scheduledEmi);
      const step = rawExtra >= 5000 ? 500 : rawExtra >= 1000 ? 100 : rawExtra >= 100 ? 50 : 10;
      const roundedExtra = Math.floor(rawExtra / step) * step;
      const candidateTotal = Math.min(fullAmount, scheduledEmi + roundedExtra);

      if (candidateTotal > scheduledEmi + 25) {
        const partCharge = calculateLoanPrepaymentCharge(loan, candidateTotal, {
          currentOutstanding: fullAmount,
          remainingTenureOverride: remTenure,
        });
        const partSim = simulateLoanPrepayment(loan, candidateTotal, { maintainTenureReduceEmi: false });
        if (
          partSim.isFinanciallyBeneficial &&
          partSim.netFinancialBenefit > 0 &&
          maxLiquidForThisAccount >= candidateTotal + partCharge.totalPenaltyWithTax
        ) {
          recommendedMode = candidateTotal >= fullAmount ? 'full' : 'custom';
          recommendedAmount = candidateTotal;
          projectedPenaltyCharge = partCharge.totalPenaltyWithTax;
          projectedPenaltyPct = partCharge.penaltyPct;
          projectedGrossInterestSaved = partSim.grossInterestSaved;
          projectedNetBenefit = partSim.netFinancialBenefit;
          projectedMonthsSaved = partSim.monthsSaved;
          strategyRationale = `Adding a ${formatMoney(candidateTotal - scheduledEmi, loan.currency, currSymbol, settings.numberGrouping, 0)} precision principal slice trims ${partSim.monthsSaved} month(s) and keeps ${formatMoney(partSim.netFinancialBenefit, loan.currency, currSymbol, settings.numberGrouping, 0)} out of lender interest.`;
        } else {
          recommendedMode = 'emi';
          recommendedAmount = scheduledEmi;
          strategyRationale =
            partCharge.totalPenaltyWithTax > 0
              ? `Prepayment charge (${formatMoney(partCharge.totalPenaltyWithTax, loan.currency, currSymbol, settings.numberGrouping, 0)}) outweighs partial interest saved right now; exact Monthly EMI protects your capital.`
              : `Exact Monthly EMI preserves your configured cash safety cushion this cycle.`;
        }
      } else {
        recommendedMode = 'emi';
        recommendedAmount = scheduledEmi;
        strategyRationale = `Exact Monthly EMI maintains full liquidity buffer while keeping repayment history spotless.`;
      }
    }
  }

  // Personal ledger cues for uncanny, classy behavioral choice-architecture copy
  const activeGoal = goals.find((g) => !g.isCompleted && g.cost > (g.accumulatedTotal || 0));
  const recentLoanTxs = transactions.filter(
    (t) => !t.isReversed && (t.toId === loan.id || t.kind === 'emi')
  );
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const habitualDay =
    recentLoanTxs.length > 0
      ? weekdayNames[new Date(recentLoanTxs[0].date).getDay()] || 'settlement day'
      : weekdayNames[new Date().getDay()];

  const extraSlice = Math.max(0, Math.round((recommendedAmount - scheduledEmi) * 100) / 100);
  const spreadPct = Math.max(0, Math.round(((loan.ratePct || 0) - bestAssetYield) * 100) / 100);
  const dailyInterestBleed = Math.round(((fullAmount * ((loan.ratePct || 0) / 100)) / 365) * 100) / 100;

  const recAmtFmt = formatMoney(recommendedAmount, loan.currency, currSymbol, settings.numberGrouping, 0);
  const extraFmt = formatMoney(extraSlice, loan.currency, currSymbol, settings.numberGrouping, 0);
  const netBenFmt = formatMoney(
    Math.max(projectedNetBenefit, fullChargeEval.totalPenaltyWithTax),
    loan.currency,
    currSymbol,
    settings.numberGrouping,
    0
  );
  const dailyFmt = formatMoney(dailyInterestBleed, loan.currency, currSymbol, settings.numberGrouping, 0);

  let whisperHeadline = 'Your Precision Trajectory';
  let whisperBody = strategyRationale;
  let ctaAnchorLabel = `Execute ${recAmtFmt} Precision Plan`;
  let deviationWhisper = '';

  if (extraSlice > 0) {
    if (activeStrategy === 'concise_executive_brief') {
      whisperHeadline =
        escalationLevel >= 3
          ? `Quietly Reclaiming ${netBenFmt} Before Next Billing Cycle`
          : `Pre-Aligned to Your ${recAmtFmt} Signature Allocation`;
      whisperBody = `You rarely leave ${bestAssetYield}% cash idle in ${bestAssetName} when a ${loan.ratePct}% facility is open (${spreadPct}% negative carry). Routing ${extraFmt} above EMI quietly erases ${projectedMonthsSaved > 0 ? `${projectedMonthsSaved} mo of tenure and ` : ''}${netBenFmt} of bank interest — without touching your safety reserve.`;
      ctaAnchorLabel = `Settle ${recAmtFmt} & Lock In +${netBenFmt}`;
      deviationWhisper = `Dropping back to bare EMI leaves ${netBenFmt} scheduled to compound in the lender's favor.`;
    } else if (activeStrategy === 'goal_velocity_framing') {
      const goalCue = activeGoal
        ? `frees future monthly cashflow ${projectedMonthsSaved} mo sooner toward "${activeGoal.name}"`
        : `accelerates your debt-free crossover by ${Math.max(1, projectedMonthsSaved)} month(s)`;
      whisperHeadline = `Compounding Momentum · ${habitualDay} Ledger Cadence`;
      whisperBody = `Following your ${habitualDay} discipline, pairing this EMI with ${extraFmt} from ${bestAssetName} ${goalCue} and retains ${netBenFmt} inside your own net worth.`;
      ctaAnchorLabel = `Confirm ${recAmtFmt} Trajectory`;
      deviationWhisper = `Paying minimum delays debt-free velocity and surrenders ${netBenFmt} in avoidable interest.`;
    } else if (activeStrategy === 'comparative_peer_table') {
      whisperHeadline = `Asymmetric Spread Detected (${loan.ratePct}% Loan vs ${bestAssetYield}% Cash)`;
      whisperBody = `Lender schedule collects ${dailyFmt}/day on this principal. Your ${recAmtFmt} settlement (${extraFmt} principal cut, ${projectedPenaltyPct}% fee) converts a ${spreadPct}% rate drag into an instant ${netBenFmt} guaranteed return.`;
      ctaAnchorLabel = `Capture ${netBenFmt} Spread (${recAmtFmt})`;
      deviationWhisper = `Standard EMI keeps the ${spreadPct}% negative spread open for the full ${remTenure}-month schedule.`;
    } else {
      // direct_cost_impact (especially sharp at higher escalation levels)
      whisperHeadline =
        escalationLevel >= 2
          ? `Unclaimed ${netBenFmt} Interest Shield Available Right Now`
          : `Direct Principal Strike · Saves ${netBenFmt}`;
      whisperBody = `Every day at ${fullAmount.toLocaleString()} costs ${dailyFmt} in interest. Settling ${recAmtFmt} today extinguishes ${extraFmt} of raw principal immediately and blocks ${netBenFmt} from ever leaving your account.`;
      ctaAnchorLabel = `Extinguish Principal (${recAmtFmt})`;
      deviationWhisper = `Choosing minimum payment authorizes ${netBenFmt} in extra future interest charges.`;
    }
  } else {
    // Optimal manner IS exact EMI (due to lock-in, higher fee than another debt, or buffer protection)
    if (isHigherFeeThanAlternative && betterAlt) {
      whisperHeadline = `Fee-Shielded EMI · Preserving Capital for ${betterAlt.name}`;
      whisperBody = `Lenders count on borrowers prepaying ${fullChargeEval.penaltyPct}%-fee loans out of habit. Holding strictly to your ${recAmtFmt} EMI here pays ${currSymbol}0 penalty and keeps surplus ready for ${betterAlt.name} (${betterAlt.penaltyPct}% fee).`;
      ctaAnchorLabel = `Settle Zero-Fee EMI (${recAmtFmt})`;
      deviationWhisper = `Adding extra principal here triggers a ${fullChargeEval.penaltyPct}% policy fee while ${betterAlt.name} sits unlocked at ${betterAlt.penaltyPct}%.`;
    } else {
      whisperHeadline = `Disciplined ${recAmtFmt} Contractual Settlement`;
      whisperBody = lockStatus.isLockedIn
        ? `While the ${lockStatus.remainingLockInMonths}-month lock-in runs down, settling exact ${recAmtFmt} EMI keeps your credit spotless and lets surplus compound undisturbed.`
        : `Exact ${recAmtFmt} EMI protects your liquid reserve floor today so upcoming commitments clear effortlessly.`;
      ctaAnchorLabel = `Confirm ${recAmtFmt} EMI`;
      deviationWhisper = `Over-allocating right now would dip into your protected liquidity buffer or incur policy charges.`;
    }
  }

  return {
    loanId: loan.id,
    loanName: getSafeLiabilityName(loan),
    currency: loan.currency,
    recommendedMode,
    recommendedAmount,
    scheduledEmiAmount: scheduledEmi,
    extraPrincipalSlice: extraSlice,
    recommendedMaintainTenure: false,
    recommendedAssetId: bestAsset?.id,
    recommendedAssetName: bestAssetName,
    projectedPenaltyCharge,
    projectedPenaltyPct,
    projectedGrossInterestSaved,
    projectedNetBenefit,
    projectedMonthsSaved,
    isLockedIn: lockStatus.isLockedIn,
    remainingLockInMonths: lockStatus.remainingLockInMonths,
    isHigherFeeThanAlternative,
    betterAlternativeDebtId: betterAlt?.id,
    betterAlternativeDebtName: betterAlt?.name,
    betterAlternativePenaltyPct: betterAlt?.penaltyPct,
    strategyRationale,
    whisperHeadline,
    whisperBody,
    ctaAnchorLabel,
    deviationWhisper,
    escalationLevel,
    activeStrategy,
  };
}

/**
 * Immediate Closed-Loop Behavioral Retraining:
 * Evaluates what the user actually did (loan payment, duplicate prevention/override, goal funding, asset addition)
 * against the ML's predicted optimal path:
 * - Even if it succeeds by a few rupees (`microSavedBase > 0`), reinforces and keeps pushing with that strategy!
 * - If it fails (`microSavedBase <= 0` when a better move existed), escalates intensity and adapts strategy!
 */
export function recordBehavioralOutcomeAndRetrain(params: {
  domain: RealityCheckDomain;
  subEventLabel: string;
  ledgerRefId: string;
  predictedSummary: string;
  actualRealitySummary: string;
  wasSuccess: boolean;
  partialSuccess?: boolean;
  microSavedBase: number;
  avoidableCostOrDeltaBase?: number;
  isDebtPrepaySignal?: boolean;
  isAssetGrowthSignal?: boolean;
}): ClosedLoopMLState {
  const prev = getStoredClosedLoopMLState();
  if (prev.processedLedgerIds.includes(params.ledgerRefId)) {
    return prev;
  }

  const processedSet = new Set<string>(prev.processedLedgerIds);
  processedSet.add(params.ledgerRefId);

  const strategyUsed = prev.activeStrategy || 'concise_executive_brief';
  const prevEscalation = Math.max(1, Math.min(4, prev.escalationLevel || 1));

  const strategyScores: ClosedLoopMLState['strategyScores'] = {
    direct_cost_impact: { ...prev.strategyScores.direct_cost_impact },
    comparative_peer_table: { ...prev.strategyScores.comparative_peer_table },
    goal_velocity_framing: { ...prev.strategyScores.goal_velocity_framing },
    concise_executive_brief: { ...prev.strategyScores.concise_executive_brief },
  };
  const domainStats: ClosedLoopMLState['domainStats'] = {
    broker_fees: { ...prev.domainStats.broker_fees },
    spending: { ...prev.domainStats.spending },
    earnings: { ...prev.domainStats.earnings },
    asset_allocation: { ...prev.domainStats.asset_allocation },
    debt_strategy: { ...prev.domainStats.debt_strategy },
  };

  const stratEntry = strategyScores[strategyUsed];
  stratEntry.attempts += 1;

  let nextEscalation = prevEscalation;
  let microWinsCount = prev.microWinsCount || 0;
  let cumulativeSavedBase = prev.cumulativeSavedBase || 0;

  if (params.wasSuccess) {
    stratEntry.successes += 1;
    // Reward even partial micro-wins (saving a few rupees) so the model keeps pushing in this successful style!
    const alpha = params.partialSuccess ? 0.10 : 0.18;
    stratEntry.score = Math.min(0.99, stratEntry.score * (1 - alpha) + alpha * 1.0);
    domainStats[params.domain].successes += 1;
    microWinsCount += 1;
    cumulativeSavedBase = Math.round((cumulativeSavedBase + Math.max(0, params.microSavedBase)) * 100) / 100;
    nextEscalation = params.partialSuccess ? prevEscalation : Math.max(1, prevEscalation - 1);
  } else {
    stratEntry.failures += 1;
    stratEntry.score = Math.max(0.15, stratEntry.score * 0.82 + 0.18 * 0.12);
    domainStats[params.domain].failures += 1;
    nextEscalation = Math.min(4, prevEscalation + 1);
  }

  domainStats[params.domain].lastEvaluatedRef = params.ledgerRefId;

  const nextStrategy = selectNextEngagementStrategy(
    strategyUsed,
    strategyScores,
    params.wasSuccess,
    nextEscalation
  );

  // Also synchronize RL policy weights when debt prepay or asset growth behavior is observed
  try {
    const rl = getStoredRLWeights();
    if (params.isDebtPrepaySignal !== undefined) {
      const delta = params.wasSuccess ? 0.03 : -0.02;
      rl.policyWeights.debtPrepay = Math.max(0.15, Math.min(0.85, rl.policyWeights.debtPrepay + delta));
      rl.totalDecisions = (rl.totalDecisions || 0) + 1;
      if (params.wasSuccess) rl.successfulTransfers = (rl.successfulTransfers || 0) + 1;
      saveRLWeights(rl);
    } else if (params.isAssetGrowthSignal) {
      rl.policyWeights.highYieldSweep = Math.max(0.15, Math.min(0.85, rl.policyWeights.highYieldSweep + 0.025));
      rl.totalDecisions = (rl.totalDecisions || 0) + 1;
      if (params.wasSuccess) rl.successfulTransfers = (rl.successfulTransfers || 0) + 1;
      saveRLWeights(rl);
    }
  } catch {
    // ignore storage quota errors
  }

  const failureAcknowledgment = !params.wasSuccess
    ? `Self-audit (Escalation Lv.${nextEscalation}): Prior ${ENGAGEMENT_STRATEGY_LABELS[strategyUsed].toLowerCase()} framing left value on the table — ${
        nextStrategy === strategyUsed
          ? `intensifying ${ENGAGEMENT_STRATEGY_LABELS[nextStrategy].toLowerCase()} precision`
          : `shifting to ${ENGAGEMENT_STRATEGY_LABELS[nextStrategy].toLowerCase()}`
      } for your next decision.`
    : undefined;

  const outcomeRecord: RealityCheckOutcomeRecord = {
    id: `rc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    domain: params.domain,
    subEventLabel: params.subEventLabel,
    ledgerRefId: params.ledgerRefId,
    predictedSummary: params.predictedSummary,
    actualRealitySummary: params.actualRealitySummary,
    outcome: params.wasSuccess ? 'success' : 'fail',
    partialSuccess: params.partialSuccess,
    microSavedBase: Math.max(0, Math.round(params.microSavedBase * 100) / 100),
    avoidableCostOrDeltaBase: Math.max(0, Math.round((params.avoidableCostOrDeltaBase || 0) * 100) / 100),
    strategyUsed,
    nextStrategySelected: nextStrategy,
    escalationLevelAfter: nextEscalation,
    failureAcknowledgment,
  };

  const nextState: ClosedLoopMLState = {
    ...prev,
    activeStrategy: nextStrategy,
    escalationLevel: nextEscalation,
    microWinsCount,
    cumulativeSavedBase,
    lastWhisperSummary: params.wasSuccess
      ? `Reinforced ${ENGAGEMENT_STRATEGY_LABELS[nextStrategy]} (+${Math.round(params.microSavedBase).toLocaleString()} value protected)`
      : failureAcknowledgment || prev.lastWhisperSummary,
    strategyScores,
    domainStats,
    processedLedgerIds: Array.from(processedSet).slice(-400),
    recentOutcomes: [outcomeRecord, ...prev.recentOutcomes].slice(0, 45),
    totalRealityAudits: (prev.totalRealityAudits || 0) + 1,
    lastUpdatedAt: new Date().toISOString(),
  };

  saveClosedLoopMLState(nextState);
  return nextState;
}

/**
 * Closed-Loop Reality vs. Prediction Engine:
 * Continuously audits the source-of-truth ledger (transactions, receivables, holdings, liabilities, incomeStreams)
 * against ML predictions & optimal choices across ALL 5 domains:
 * 1. broker_fees (Did user pick optimal low-fee card/broker vs overpaying brokerage?)
 * 2. spending (Did actual completed-month spend stay aligned with ML forecast vs overshoot?)
 * 3. earnings (Did recorded income / career transition match ML expected salary trajectory?)
 * 4. asset_allocation (Did new holdings / investments align with surplus & yield rules?)
 * 5. debt_strategy (Did loan prepayments avoid lock-in violations / excessive penalty bleed?)
 *
 * Whenever a warning fails to persuade the user (outcome === 'fail'), the model:
 * - Updates strategy efficacy weights & domain biases
 * - Explicitly logs a failure acknowledgment admitting the prior framing did not convey impact clearly
 * - Shifts `activeStrategy` to a more engaging communication approach for future suggestions.
 */
export function syncClosedLoopRealityEngine(params: {
  transactions: Transaction[];
  receivables: Receivable[];
  holdings: Holding[];
  liabilities: Liability[];
  incomeStreams: IncomeStream[];
  assetTypes: AssetType[];
  currencies: Currency[];
  baseCurrency: string;
  currSymbol?: string;
  onlineState: OnlineSpendIncomeModelState;
  careerPrediction?: CareerPredictionResult;
}): { state: ClosedLoopMLState; didUpdate: boolean } {
  const {
    transactions,
    receivables,
    holdings,
    liabilities,
    assetTypes,
    currencies,
    baseCurrency,
    currSymbol = '₹',
    onlineState,
    careerPrediction,
  } = params;

  const prev = getStoredClosedLoopMLState();
  const brokerProfiles = correlateCardBrokerFees(transactions, receivables, liabilities, holdings, assetTypes);

  const processedSet = new Set<string>(prev.processedLedgerIds);
  const newOutcomes: RealityCheckOutcomeRecord[] = [];
  let activeStrategy = prev.activeStrategy;
  const strategyScores: ClosedLoopMLState['strategyScores'] = {
    direct_cost_impact: { ...prev.strategyScores.direct_cost_impact },
    comparative_peer_table: { ...prev.strategyScores.comparative_peer_table },
    goal_velocity_framing: { ...prev.strategyScores.goal_velocity_framing },
    concise_executive_brief: { ...prev.strategyScores.concise_executive_brief },
  };
  const domainStats: ClosedLoopMLState['domainStats'] = {
    broker_fees: { ...prev.domainStats.broker_fees },
    spending: { ...prev.domainStats.spending },
    earnings: { ...prev.domainStats.earnings },
    asset_allocation: { ...prev.domainStats.asset_allocation },
    debt_strategy: { ...prev.domainStats.debt_strategy },
  };

  const recordOutcome = (
    domain: RealityCheckDomain,
    ledgerRefId: string,
    outcome: 'success' | 'fail',
    predictedSummary: string,
    actualRealitySummary: string,
    avoidableCostOrDeltaBase: number,
    biasFactor: number = 1.0
  ) => {
    if (processedSet.has(ledgerRefId)) return;
    processedSet.add(ledgerRefId);

    const stratEntry = strategyScores[activeStrategy];
    stratEntry.attempts += 1;
    if (outcome === 'success') {
      stratEntry.successes += 1;
      stratEntry.score = Math.min(0.98, stratEntry.score * 0.85 + 0.15 * 1.0);
      domainStats[domain].successes += 1;
    } else {
      stratEntry.failures += 1;
      stratEntry.score = Math.max(0.15, stratEntry.score * 0.8 + 0.2 * 0.1);
      domainStats[domain].failures += 1;
    }
    domainStats[domain].accuracyBias = Math.max(
      0.65,
      Math.min(1.45, domainStats[domain].accuracyBias * 0.85 + biasFactor * 0.15)
    );
    domainStats[domain].lastEvaluatedRef = ledgerRefId;

    const strategyUsed = activeStrategy;
    const nextStrategySelected = selectNextEngagementStrategy(activeStrategy, strategyScores, outcome === 'success');
    const failureAcknowledgment =
      outcome === 'fail'
        ? `Model self-audit: Our previous ${ENGAGEMENT_STRATEGY_LABELS[strategyUsed].toLowerCase()} note did not highlight the real ledger cost clearly enough — switching to ${ENGAGEMENT_STRATEGY_LABELS[nextStrategySelected].toLowerCase()}.`
        : undefined;

    activeStrategy = nextStrategySelected;

    newOutcomes.push({
      id: `rc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      domain,
      ledgerRefId,
      predictedSummary,
      actualRealitySummary,
      outcome,
      avoidableCostOrDeltaBase,
      strategyUsed,
      nextStrategySelected,
      failureAcknowledgment,
    });
  };

  // 1. Audit Brokered Receivables & Withdrawals (`broker_fees`)
  for (const r of receivables.slice(-15)) {
    const fee = r.transferFeeAmount || 0;
    if (!r.brokerName && fee <= 0) continue;
    const refId = `broker-rec-${r.id}`;
    if (processedSet.has(refId)) continue;
    const disbursed = r.disbursedAmount ?? Math.max(1, r.principalAmount - fee);
    const recCheck = recommendBestCardForBrokerAmount({
      amountNeeded: disbursed,
      liabilities,
      holdings,
      assetTypes,
      transactions,
      receivables,
      preferredBrokerName: r.brokerName,
      selectedSourceId: r.fundingSourceId,
      currentEnteredFee: fee,
    });

    if (recCheck.bestOption && recCheck.potentialSavings > 10) {
      recordOutcome(
        'broker_fees',
        refId,
        'fail',
        `Optimal route ${recCheck.bestOption.sourceName} est. ${currSymbol}${recCheck.bestOption.projectedFee.toLocaleString()} fee`,
        `Actual disbursement via ${r.brokerName || 'broker'} incurred ${currSymbol}${fee.toLocaleString()} fee`,
        recCheck.potentialSavings,
        1.08
      );
    } else {
      recordOutcome(
        'broker_fees',
        refId,
        'success',
        `Recommended lowest-fee funding route for ${currSymbol}${disbursed.toLocaleString()}`,
        `Executed with minimal/optimal brokerage (${currSymbol}${fee.toLocaleString()})`,
        0,
        1.0
      );
    }
  }

  for (const tx of transactions.slice(-30)) {
    if (tx.kind === 'transfer' && (tx.brokerName || (tx.brokerageFee || 0) > 0)) {
      const refId = `broker-tx-${tx.id}`;
      if (processedSet.has(refId)) continue;
      const fee = tx.brokerageFee || 0;
      const principal = Math.max(1, tx.amount - fee);
      const recCheck = recommendBestCardForBrokerAmount({
        amountNeeded: principal,
        liabilities,
        holdings,
        assetTypes,
        transactions,
        receivables,
        preferredBrokerName: tx.brokerName,
        selectedSourceId: tx.fromId,
        currentEnteredFee: fee,
      });

      if (recCheck.bestOption && recCheck.potentialSavings > 10) {
        recordOutcome(
          'broker_fees',
          refId,
          'fail',
          `Suggested ${recCheck.bestOption.sourceName} (${currSymbol}${recCheck.bestOption.projectedFee.toLocaleString()} fee)`,
          `Withdrawal via ${tx.brokerName || 'card cash advance'} cost ${currSymbol}${fee.toLocaleString()}`,
          recCheck.potentialSavings,
          1.08
        );
      } else {
        recordOutcome(
          'broker_fees',
          refId,
          'success',
          `Optimal withdrawal card/broker check for ${currSymbol}${principal.toLocaleString()}`,
          `Completed at optimal fee (${currSymbol}${fee.toLocaleString()})`,
          0,
          1.0
        );
      }
    }

    // 2. Audit Debt Prepayment Penalties (`debt_strategy`)
    if (tx.prepaymentPenaltyPaid !== undefined && tx.prepaymentPenaltyPaid > 0) {
      const refId = `debt-prepay-${tx.id}`;
      if (!processedSet.has(refId)) {
        const penaltyRatio = tx.prepaymentPenaltyPaid / Math.max(1, tx.amount);
        const wasCostly = penaltyRatio > 0.03; // >3% penalty ratio warns that penalty ate a high share of principal
        recordOutcome(
          'debt_strategy',
          refId,
          wasCostly ? 'fail' : 'success',
          wasCostly
            ? 'Prioritize penalty-free or lower-penalty debt before high-fee foreclosure'
            : 'Prepay high-APR principal where interest saved exceeds prepayment fee',
          `Paid ${currSymbol}${tx.prepaymentPenaltyPaid.toLocaleString()} prepayment charge on ${currSymbol}${tx.amount.toLocaleString()} outflow`,
          tx.prepaymentPenaltyPaid,
          wasCostly ? 1.06 : 0.98
        );
      }
    }
  }

  // 3. Audit Completed Monthly Spending vs ML Prediction (`spending`)
  const completedKeys = Object.keys(onlineState.completedMonthActuals || {}).sort();
  for (const mKey of completedKeys.slice(-3)) {
    const refId = `spend-month-${mKey}`;
    if (processedSet.has(refId)) continue;
    const actual = onlineState.completedMonthActuals[mKey] || 0;
    const predicted = onlineState.completedMonthPredictions[mKey] || onlineState.monthlySpendBaselineEma || 0;
    if (actual > 0 && predicted > 0) {
      const ratio = actual / predicted;
      const overshoot = Math.max(0, actual - predicted);
      recordOutcome(
        'spending',
        refId,
        ratio <= 1.12 ? 'success' : 'fail',
        `Forecasted ${mKey} spend at ${currSymbol}${Math.round(predicted).toLocaleString()}`,
        `Actual ledger spend closed at ${currSymbol}${Math.round(actual).toLocaleString()} (${Math.round((ratio - 1) * 100)}%)`,
        overshoot,
        Math.max(0.8, Math.min(1.25, ratio))
      );
    }
  }

  // 4. Audit Earnings / Salary Reality vs ML Career Prediction (`earnings`)
  if (careerPrediction && onlineState.annualSalaryEma > 0) {
    const salBucket = Math.round(onlineState.annualSalaryEma / 10000);
    const refId = `earnings-sync-${salBucket}`;
    if (!processedSet.has(refId) && careerPrediction.predictedCurrentMarketMedian > 0) {
      const ratio = onlineState.annualSalaryEma / careerPrediction.predictedCurrentMarketMedian;
      const delta = Math.abs(onlineState.annualSalaryEma - careerPrediction.predictedCurrentMarketMedian);
      recordOutcome(
        'earnings',
        refId,
        ratio >= 0.88 ? 'success' : 'fail',
        `Model expected annual compensation near ${currSymbol}${Math.round(careerPrediction.predictedCurrentMarketMedian).toLocaleString()}`,
        `Ledger annualized income recorded at ${currSymbol}${Math.round(onlineState.annualSalaryEma).toLocaleString()}`,
        delta,
        Math.max(0.8, Math.min(1.25, ratio))
      );
    }
  }

  // 5. Audit Asset Purchases & Yield Discipline (`asset_allocation`)
  const currMapForHoldings: Record<string, Currency> = {};
  for (const c of currencies) currMapForHoldings[c.code.toUpperCase()] = c;
  void baseCurrency;

  for (const h of holdings.slice(-10)) {
    if (!h.startDate && !h.createdAt) continue;
    const refId = `asset-acq-${h.id}`;
    if (processedSet.has(refId)) continue;
    const valBase = convertToBase(getHoldingLocalValue(h), h.currency, currMapForHoldings);
    if (valBase <= 0) continue;
    const isYieldBearing =
      (h.fixedRatePct || 0) > 0 ||
      (h.expectedRatePct || 0) > 0 ||
      Boolean(h.isSweepIn) ||
      (h.units || 0) > 0;
    if (isYieldBearing) {
      recordOutcome(
        'asset_allocation',
        refId,
        'success',
        `Deploy surplus into productive / yield-bearing assets`,
        `Added ${getSafeAssetName(h, assetTypes)} (${currSymbol}${Math.round(valBase).toLocaleString()})`,
        0,
        1.0
      );
    }
  }

  const profilesChanged = JSON.stringify(prev.brokerProfiles) !== JSON.stringify(brokerProfiles);
  if (newOutcomes.length === 0 && !profilesChanged) {
    return { state: prev, didUpdate: false };
  }

  let nextEscalation = prev.escalationLevel || 1;
  let nextMicroWins = prev.microWinsCount || 0;
  let nextCumulativeSaved = prev.cumulativeSavedBase || 0;
  for (const out of newOutcomes) {
    if (out.outcome === 'success') {
      nextMicroWins += 1;
      nextEscalation = Math.max(1, nextEscalation - 1);
    } else {
      nextEscalation = Math.min(4, nextEscalation + 1);
    }
  }

  const nextState: ClosedLoopMLState = {
    ...prev,
    activeStrategy,
    escalationLevel: nextEscalation,
    microWinsCount: nextMicroWins,
    cumulativeSavedBase: nextCumulativeSaved,
    strategyScores,
    domainStats,
    processedLedgerIds: Array.from(processedSet).slice(-400),
    recentOutcomes: [...newOutcomes, ...prev.recentOutcomes].slice(0, 45),
    brokerProfiles,
    totalRealityAudits: prev.totalRealityAudits + newOutcomes.length,
    lastUpdatedAt: new Date().toISOString(),
  };

  saveClosedLoopMLState(nextState);
  return { state: nextState, didUpdate: true };
}

/**
 * Serializes every ML model's weights, biases, feedback history, and active half-predictions
 * so backups (JSON and CSV) can replicate and resume exact model learning on any device.
 */
export function exportFullMLReplicationState(extra?: {
  creditPrediction?: CreditScorePrediction;
  careerPrediction?: CareerPredictionResult;
  predictedBills?: PredictedBillsSummary;
  rlRecommendations?: RLMovementRecommendation[];
  goalLiquidPlan?: GoalLiquidSurplusPlan;
  brokerUsageForecast?: BrokerUsageForecast;
  overriddenAutoBills?: Record<string, string>;
  dismissedInsights?: Record<string, boolean>;
  snoozedInsights?: Record<string, string>;
}): FullMLReplicationState {
  let investmentModelWeights: MLInvestmentModelWeights | undefined;
  let mlFeedbackLog: MLModelFeedbackRecord[] | undefined;
  let billOverrideHistory: any[] | undefined;
  let continuousEngineAnchor: any | undefined;

  try {
    const rawInv = localStorage.getItem(INVESTMENT_WEIGHTS_STORAGE_KEY);
    if (rawInv) investmentModelWeights = JSON.parse(rawInv);
  } catch {}
  try {
    const rawFb = localStorage.getItem(INVESTMENT_FEEDBACK_STORAGE_KEY);
    if (rawFb) mlFeedbackLog = JSON.parse(rawFb);
  } catch {}
  try {
    const rawOv = localStorage.getItem('networthiq_bill_overrides');
    if (rawOv) billOverrideHistory = JSON.parse(rawOv);
  } catch {}
  try {
    const rawAnc = localStorage.getItem('networthiq_calc_engine_anchor');
    if (rawAnc) continuousEngineAnchor = JSON.parse(rawAnc);
  } catch {}

  return {
    creditModelWeights: getStoredCreditWeights(),
    rlModelWeights: getStoredRLWeights(),
    careerProfile: getStoredCareerProfile(),
    careerModelWeights: getStoredCareerWeights(),
    investmentModelWeights,
    mlFeedbackLog,
    onlineSpendIncomeState: getStoredOnlineLearnerState(),
    closedLoopMLState: getStoredClosedLoopMLState(),
    halfPredictionsSnapshot: {
      capturedAt: new Date().toISOString(),
      creditPrediction: extra?.creditPrediction,
      careerPrediction: extra?.careerPrediction,
      predictedBills: extra?.predictedBills,
      rlRecommendations: extra?.rlRecommendations,
      goalLiquidPlan: extra?.goalLiquidPlan,
      brokerUsageForecast: extra?.brokerUsageForecast,
    },
    overriddenAutoBills: extra?.overriddenAutoBills,
    billOverrideHistory,
    continuousEngineAnchor,
    dismissedInsights: extra?.dismissedInsights,
    snoozedInsights: extra?.snoozedInsights,
  };
}

/**
 * Restores every ML model's weights, biases, profiles, and half-predictions into localStorage
 * and returns hydrated CareerProfile and CareerModelWeights for immediate React state sync.
 */
export function restoreFullMLReplicationState(bundle?: FullMLReplicationState): {
  careerProfile?: CareerProfile;
  careerModelWeights?: CareerModelWeights;
  onlineSpendIncomeState?: OnlineSpendIncomeModelState;
  closedLoopMLState?: ClosedLoopMLState;
  overriddenAutoBills?: Record<string, string>;
  dismissedInsights?: Record<string, boolean>;
  snoozedInsights?: Record<string, string>;
} {
  if (!bundle || typeof bundle !== 'object') return {};

  try {
    if (bundle.creditModelWeights) {
      saveCreditWeights({ ...DEFAULT_CREDIT_WEIGHTS, ...(bundle.creditModelWeights as CreditModelWeights) });
    }
    if (bundle.rlModelWeights) {
      saveRLWeights({ ...DEFAULT_RL_WEIGHTS, ...bundle.rlModelWeights });
    }
    if (bundle.careerProfile) {
      saveCareerProfile({ ...DEFAULT_CAREER_PROFILE, ...bundle.careerProfile });
    }
    if (bundle.careerModelWeights) {
      saveCareerWeights({ ...DEFAULT_CAREER_WEIGHTS, ...bundle.careerModelWeights });
    }
    if (bundle.investmentModelWeights) {
      localStorage.setItem(INVESTMENT_WEIGHTS_STORAGE_KEY, JSON.stringify(bundle.investmentModelWeights));
    }
    if (bundle.mlFeedbackLog) {
      localStorage.setItem(INVESTMENT_FEEDBACK_STORAGE_KEY, JSON.stringify(bundle.mlFeedbackLog));
    }
    if (bundle.onlineSpendIncomeState) {
      saveOnlineLearnerState({ ...DEFAULT_ONLINE_LEARNER_STATE, ...bundle.onlineSpendIncomeState });
    }
    if (bundle.closedLoopMLState) {
      saveClosedLoopMLState({ ...DEFAULT_CLOSED_LOOP_ML_STATE, ...bundle.closedLoopMLState });
    }
    if (bundle.overriddenAutoBills) {
      localStorage.setItem('networthiq_auto_bill_overrides', JSON.stringify(bundle.overriddenAutoBills));
    }
    if (bundle.billOverrideHistory) {
      localStorage.setItem('networthiq_bill_overrides', JSON.stringify(bundle.billOverrideHistory));
    }
    if (bundle.continuousEngineAnchor) {
      localStorage.setItem('networthiq_calc_engine_anchor', JSON.stringify(bundle.continuousEngineAnchor));
    }
  } catch (e) {
    console.error('Failed to restore ML replication state:', e);
  }

  return {
    careerProfile: bundle.careerProfile ? getStoredCareerProfile() : undefined,
    careerModelWeights: bundle.careerModelWeights ? getStoredCareerWeights() : undefined,
    onlineSpendIncomeState: bundle.onlineSpendIncomeState ? getStoredOnlineLearnerState() : undefined,
    closedLoopMLState: bundle.closedLoopMLState ? getStoredClosedLoopMLState() : undefined,
    overriddenAutoBills: bundle.overriddenAutoBills,
    dismissedInsights: bundle.dismissedInsights,
    snoozedInsights: bundle.snoozedInsights,
  };
}

/**
 * Studies user alert clearance/dismissal & action patterns to adapt on-device ML coaching:
 * - If the user clears a required-action alert without resolving it yet, the model logs the
 *   deferral pattern and adapts framing style so the next resurfaced reminder lands better.
 * - If the user clears optional/informational alerts, the model learns to keep guidance concise
 *   and prioritizes high-impact prompts.
 */
export function recordAlertDismissalSignal(params: {
  alertId: string;
  title: string;
  requiresAction: boolean;
  wasPositiveMilestone?: boolean;
  userActed?: boolean;
}): ClosedLoopMLState {
  const lower = `${params.alertId} ${params.title}`.toLowerCase();
  let domain: RealityCheckDomain = 'spending';
  if (lower.includes('emi') || lower.includes('card') || lower.includes('loan') || lower.includes('debt')) {
    domain = 'debt_strategy';
  } else if (lower.includes('broker') || lower.includes('atm') || lower.includes('fee')) {
    domain = 'broker_fees';
  } else if (lower.includes('asset') || lower.includes('goal') || lower.includes('cash') || lower.includes('yield')) {
    domain = 'asset_allocation';
  } else if (lower.includes('salary') || lower.includes('income')) {
    domain = 'earnings';
  }

  const timeBucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  const refId = `alert-sig-${params.alertId}-${params.userActed ? 'act' : 'dismiss'}-${timeBucket}`;

  if (params.wasPositiveMilestone || params.userActed) {
    return recordBehavioralOutcomeAndRetrain({
      domain,
      subEventLabel: params.wasPositiveMilestone ? 'Milestone Acknowledged' : 'Alert Acted Upon',
      ledgerRefId: refId,
      predictedSummary: `Surface timely guidance: ${params.title}`,
      actualRealitySummary: params.userActed
        ? `User opened action path for "${params.title}"`
        : `User acknowledged positive milestone "${params.title}"`,
      wasSuccess: true,
      partialSuccess: !params.userActed,
      microSavedBase: params.userActed ? 50 : 10,
    });
  }

  return recordBehavioralOutcomeAndRetrain({
    domain,
    subEventLabel: params.requiresAction ? 'Required Alert Snoozed' : 'Optional Alert Cleared',
    ledgerRefId: refId,
    predictedSummary: params.requiresAction
      ? `Immediate action advised: ${params.title}`
      : `Optional suggestion: ${params.title}`,
    actualRealitySummary: params.requiresAction
      ? `User dismissed "${params.title}" — snoozed to re-verify later if still unresolved`
      : `User cleared "${params.title}" — discarded permanently & calibrated preference`,
    wasSuccess: !params.requiresAction,
    partialSuccess: !params.requiresAction,
    microSavedBase: 0,
    avoidableCostOrDeltaBase: params.requiresAction ? 100 : 0,
  });
}




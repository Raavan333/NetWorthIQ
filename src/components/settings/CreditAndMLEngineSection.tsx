import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CreditScoreRecord } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  getStoredCreditWeights,
  getStoredRLWeights,
  ENGAGEMENT_STRATEGY_LABELS,
} from '../../lib/mlEngine';
import { formatDuplicateWindowLabel } from '../../lib/anomalyDetector';
import {
  Brain,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Plus,
  Trash2,
  Check,
  Sparkles,
  Sliders,
  History,
  Activity,
  Clock,
  Lock,
} from 'lucide-react';

const DUPLICATE_WINDOW_PRESETS = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
  { label: '48h', minutes: 2880 },
];

export const CreditAndMLEngineSection: React.FC = () => {
  const {
    creditScores,
    addCreditScore,
    deleteCreditScore,
    creditPrediction,
    onlineLearnerState,
    closedLoopMLState,
    currencies,
    settings,
    updateSettings,
  } = useApp();

  const [isAddingScore, setIsAddingScore] = useState(false);
  const [newScore, setNewScore] = useState('');
  const [bureau, setBureau] = useState('CIBIL');
  const [scoreDate, setScoreDate] = useState(new Date().toISOString().split('T')[0]);
  const [scoreNotes, setScoreNotes] = useState('');
  const [scoreError, setScoreError] = useState('');
  const [learningFeedbackMsg, setLearningFeedbackMsg] = useState('');

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const [utilThreshold, setUtilThreshold] = useState(
    settings.creditUtilizationThresholdPct ? String(settings.creditUtilizationThresholdPct) : '30'
  );
  const [dupWindowInput, setDupWindowInput] = useState(
    String(settings.duplicateDetectionWindowMinutes ?? 60)
  );

  const creditWeights = getStoredCreditWeights();
  const rlWeights = getStoredRLWeights();

  const handleSaveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    const scoreNum = parseInt(newScore, 10);
    if (isNaN(scoreNum) || scoreNum < 300 || scoreNum > 900) {
      setScoreError('Credit score must be between 300 and 900.');
      return;
    }
    setScoreError('');

    const previousBias = creditWeights.bias;
    const previousUtilWeight = creditWeights.utilizationWeight;

    const record: CreditScoreRecord = {
      id: `score-${Date.now()}`,
      date: scoreDate,
      score: scoreNum,
      bureau,
      notes: scoreNotes.trim() || undefined,
    };

    await addCreditScore(record);
    const updatedWeights = getStoredCreditWeights();

    const deltaBias = (updatedWeights.bias - previousBias).toFixed(1);
    const deltaUtil = (updatedWeights.utilizationWeight - previousUtilWeight).toFixed(2);

    setLearningFeedbackMsg(
      `Reinforcement learning cycle completed! Model weights adapted: Bias ${deltaBias >= '0' ? '+' : ''}${deltaBias}, Util weight adjusted by ${deltaUtil}. Confidence score: ${updatedWeights.confidenceScore}%.`
    );

    setIsAddingScore(false);
    setNewScore('');
    setScoreNotes('');
  };

  const handleSaveThreshold = async () => {
    const val = parseFloat(utilThreshold);
    if (!isNaN(val) && val > 0 && val <= 100) {
      await updateSettings({ creditUtilizationThresholdPct: val });
    }
  };

  const handleSaveDuplicateWindow = async (minutesOverride?: number) => {
    const raw = minutesOverride !== undefined ? minutesOverride : parseInt(dupWindowInput, 10);
    if (!isNaN(raw) && raw >= 1 && raw <= 43200) {
      setDupWindowInput(String(raw));
      await updateSettings({ duplicateDetectionWindowMinutes: raw });
    }
  };

  const isOverThreshold = creditPrediction.creditUtilizationPct >= (settings.creditUtilizationThresholdPct || 30);
  const activeDupMinutes = settings.duplicateDetectionWindowMinutes ?? 60;
  const enforcePrepay = Boolean(settings.enforcePrepaymentStrategy);
  const enforceDup = Boolean(settings.enforceDuplicateGuard);
  const enableWhisper = settings.enableSubtleGuidanceFraming !== false;

  return (
    <div className="space-y-6">
      {/* 0. Strategy Enforcement, Duplicate Guard Window & Closed-Loop Behavioral Engine */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-emerald-400" />
              <span>Strategy Enforcement &amp; Behavioral Guidance Controls</span>
            </h4>
            <p className="text-xs text-slate-400">
              Enforce recommended prepayment and duplicate-prevention rules, configure exact duplicate time windows, and inspect closed-loop micro-win retraining.
            </p>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-emerald-300 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 whitespace-nowrap">
            Active Lever: {ENGAGEMENT_STRATEGY_LABELS[closedLoopMLState.activeStrategy]} · Lv.{closedLoopMLState.escalationLevel || 1}
          </span>
        </div>

        {/* Enforcement Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Lock size={13} className={enforcePrepay ? 'text-emerald-400' : 'text-slate-500'} />
                  <span>Prepayment Fee Guard</span>
                </span>
                <button
                  type="button"
                  onClick={() => updateSettings({ enforcePrepaymentStrategy: !enforcePrepay })}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                    enforcePrepay
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {enforcePrepay ? 'Enforced' : 'Warn Only'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Blocks extra principal prepayments when policy charges exceed interest saved or when a lower-fee debt is unlocked.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck size={13} className={enforceDup ? 'text-cyan-400' : 'text-slate-500'} />
                  <span>Duplicate Spend Guard</span>
                </span>
                <button
                  type="button"
                  onClick={() => updateSettings({ enforceDuplicateGuard: !enforceDup })}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                    enforceDup
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {enforceDup ? 'Enforced' : 'Warn Only'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Gates predicted duplicate charges within your configured time window unless explicitly marked intentional.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles size={13} className={enableWhisper ? 'text-indigo-400' : 'text-slate-500'} />
                  <span>Precision Choice Anchoring</span>
                </span>
                <button
                  type="button"
                  onClick={() => updateSettings({ enableSubtleGuidanceFraming: !enableWhisper })}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap ${
                    enableWhisper
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {enableWhisper ? 'Active' : 'Standard'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Pre-aligns loan bill settlements to your optimal trajectory and adapts persuasion intensity from real ledger outcomes.
              </p>
            </div>
          </div>
        </div>

        {/* Configurable Minimum Duplicate Time-Range */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Clock size={13} className="text-cyan-400" />
                <span>Duplicate Window (same source, amount, chip &amp; category):</span>
                <span className="text-[11px] font-mono text-cyan-300 ml-1">({formatDuplicateWindowLabel(activeDupMinutes)})</span>
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Predicted as duplicate strictly when <strong>same source, same amount, same chip, and same category</strong> occur within this window. Entries beyond this window are never flagged.
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="1"
                max="43200"
                value={dupWindowInput}
                onChange={(e) => setDupWindowInput(e.target.value)}
                className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono tabular-nums text-center"
              />
              <span className="text-[11px] text-slate-400 font-mono">min</span>
              <button
                type="button"
                onClick={() => handleSaveDuplicateWindow()}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                Apply
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1">Presets:</span>
            {DUPLICATE_WINDOW_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                onClick={() => handleSaveDuplicateWindow(preset.minutes)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono tabular-nums cursor-pointer transition-colors whitespace-nowrap ${
                  activeDupMinutes === preset.minutes
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Closed-Loop Micro-Win & Escalation Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] font-sans block">MICRO-WINS &amp; ALIGNED MOVES</span>
            <span className="text-base font-bold text-emerald-400">
              {closedLoopMLState.microWinsCount || 0}
            </span>
            <span className="text-[10px] font-sans text-slate-500 block mt-0.5">
              Reinforces even small rupee wins
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] font-sans block">CUMULATIVE VALUE PROTECTED</span>
            <span className="text-base font-bold text-cyan-400">
              {formatMoney(closedLoopMLState.cumulativeSavedBase || 0, baseCurr, currSym, settings.numberGrouping, 0)}
            </span>
            <span className="text-[10px] font-sans text-slate-500 block mt-0.5">
              Interest, fees, goals &amp; duplicates saved
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] font-sans block">PERSUASION ESCALATION</span>
            <span className="text-base font-bold text-indigo-400">
              Level {closedLoopMLState.escalationLevel || 1} / 4
            </span>
            <span className="text-[10px] font-sans text-slate-500 block mt-0.5">
              Audits logged: {closedLoopMLState.totalRealityAudits}
            </span>
          </div>
        </div>
      </div>

      {/* 1. Predictive Credit Score & Confidence Model */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Brain size={16} className="text-cyan-400" />
              <span>Credit Score ML Predictor & Reinforcement Engine</span>
            </h4>
            <p className="text-xs text-slate-400">
              Self-tuning online model that predicts your credit score, tracks utilization penalties, and improves as you log authentic scores.
            </p>
          </div>

          {!isAddingScore && (
            <button
              onClick={() => setIsAddingScore(true)}
              className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus size={13} /> Log New Score
            </button>
          )}
        </div>

        {/* Learning Flash Feedback */}
        {learningFeedbackMsg && (
          <div className="p-3 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2">
            <Sparkles size={16} className="shrink-0" />
            <span>{learningFeedbackMsg}</span>
          </div>
        )}

        {/* Log Score Modal/Inline */}
        {isAddingScore && (
          <form onSubmit={handleSaveScore} className="p-4 rounded-xl bg-slate-950 border border-cyan-500/40 space-y-3">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sparkles size={14} className="text-cyan-400" />
              <span>Log Authentic Credit Bureau Score (Trains ML Model)</span>
            </div>

            {scoreError && (
              <div className="p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {scoreError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Official Score (300 - 900)</label>
                <input
                  type="number"
                  min="300"
                  max="900"
                  placeholder="e.g. 785"
                  value={newScore}
                  onChange={(e) => setNewScore(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono font-bold"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Bureau / Source</label>
                <select
                  value={bureau}
                  onChange={(e) => setBureau(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="CIBIL">CIBIL TransUnion</option>
                  <option value="Experian">Experian</option>
                  <option value="Equifax">Equifax</option>
                  <option value="CRIF">CRIF High Mark</option>
                  <option value="FICO">FICO Score</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Report Date</label>
                <input
                  type="date"
                  value={scoreDate}
                  onChange={(e) => setScoreDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Notes (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Clean report after closing personal loan"
                value={scoreNotes}
                onChange={(e) => setScoreNotes(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              />
            </div>

            <p className="text-[10px] text-slate-400">
              When saved, the model computes prediction error (actual minus predicted score) and shifts its weights and biases via gradient delta rule.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingScore(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Check size={13} /> Update & Train Model
              </button>
            </div>
          </form>
        )}

        {/* Prediction & Metrics Gauges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Predicted Score Gauge */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] text-slate-400 font-medium">Model Predicted Score</span>
            <div className="flex items-baseline gap-2 my-2">
              <span className="text-3xl font-black font-mono text-cyan-400">
                {creditPrediction.predictedScore}
              </span>
              <span className="text-xs text-slate-500 font-mono">/ 900</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-300">
                Confidence: <strong className="text-cyan-300 font-mono tabular-nums">{creditPrediction.confidenceScore}%</strong>
              </span>
            </div>
          </div>

          {/* Utilization Gauge */}
          <div className={`p-4 rounded-xl border flex flex-col justify-between ${
            isOverThreshold
              ? 'bg-rose-950/20 border-rose-500/40'
              : 'bg-slate-950/70 border-slate-800'
          }`}>
            <span className="text-[11px] text-slate-400 font-medium">Credit Card Utilization</span>
            <div className="flex items-baseline gap-2 my-2">
              <span className={`text-3xl font-black font-mono ${isOverThreshold ? 'text-rose-400' : 'text-emerald-400'}`}>
                {creditPrediction.creditUtilizationPct}%
              </span>
              <span className="text-xs text-slate-400">
                (Ceiling: {settings.creditUtilizationThresholdPct || 30}%)
              </span>
            </div>
            <div className="text-[11px]">
              {isOverThreshold ? (
                <span className="text-rose-400 flex items-center gap-1 font-semibold">
                  <AlertTriangle size={13} /> Above 30% limit (Penalizes score)
                </span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-1">
                  <ShieldCheck size={13} /> Healthy prime utilization
                </span>
              )}
            </div>
          </div>

          {/* Latest Verified Score */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <span className="text-[11px] text-slate-400 font-medium">Last Verified Bureau Score</span>
            <div className="flex items-baseline gap-2 my-2">
              {creditScores.length > 0 ? (
                <>
                  <span className="text-3xl font-black font-mono text-white">
                    {creditScores[0].score}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">({creditScores[0].bureau})</span>
                </>
              ) : (
                <span className="text-sm text-slate-500 font-medium">No bureau score logged</span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {creditScores.length > 0
                ? `Logged on ${creditScores[0].date}`
                : 'Log a score to seed training'}
            </div>
          </div>
        </div>

        {/* Model Weights & Bias Inspection */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
          <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Sliders size={13} className="text-cyan-400" />
            <span>Active Model Weights & Biases (Trained via Reinforcement)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">UTILIZATION WEIGHT</span>
              <span className="text-cyan-300 font-bold">{creditWeights.utilizationWeight.toFixed(2)}</span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">DEBT RATIO WEIGHT</span>
              <span className="text-cyan-300 font-bold">{creditWeights.debtRatioWeight.toFixed(2)}</span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">PAYMENT HISTORY</span>
              <span className="text-cyan-300 font-bold">{creditWeights.paymentHistoryWeight.toFixed(2)}</span>
            </div>
            <div className="p-2 rounded bg-slate-900 border border-slate-800">
              <span className="text-slate-500 block text-[9px]">MODEL BIAS (INTERCEPT)</span>
              <span className="text-emerald-400 font-bold">{creditWeights.bias.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Utilization Threshold Setting */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-white block">Credit Utilization Warning Ceiling</span>
            <span className="text-[11px] text-slate-400">
              Alert triggers whenever any individual card or overall debt crosses this percentage (standard is 30%).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="5"
              max="90"
              value={utilThreshold}
              onChange={(e) => setUtilThreshold(e.target.value)}
              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono text-center"
            />
            <span className="text-slate-400 font-bold">%</span>
            <button
              onClick={handleSaveThreshold}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
            >
              Update
            </button>
          </div>
        </div>

        {/* Score History Log */}
        {creditScores.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <History size={13} className="text-slate-400" />
              <span>Historical Score Logs</span>
            </div>
            <div className="space-y-1.5">
              {creditScores.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold font-mono text-white">{s.score}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">
                      {s.bureau}
                    </span>
                    <span className="text-slate-400 text-[11px]">{s.date}</span>
                    {s.notes && <span className="text-slate-500 text-[11px] italic truncate max-w-xs">{s.notes}</span>}
                  </div>
                  <button
                    onClick={() => deleteCreditScore(s.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                    title="Delete log"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Cashflow Surplus & Asset Movement Policy Diagnostics */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <Activity size={16} className="text-emerald-400" />
          <span>Surplus Cashflow Movement RL Policy</span>
        </h4>
        <p className="text-xs text-slate-400">
          Reinforcement learning algorithm that monitors idle bank balances and dynamically suggests optimal sweeps into higher-performing investment assets or high-interest debt prepayment.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] block">HIGH-YIELD SWEEP WEIGHT</span>
            <span className="text-base font-bold text-emerald-400">{rlWeights.policyWeights.highYieldSweep.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-1">Learns when investment moves yield return</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] block">DEBT PREPAY WEIGHT</span>
            <span className="text-base font-bold text-cyan-400">{rlWeights.policyWeights.debtPrepay.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-1">Prioritizes clearing cards & high APR loans</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] block">LIQUIDITY SAFETY WEIGHT</span>
            <span className="text-base font-bold text-amber-400">{rlWeights.policyWeights.liquiditySafety.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 block mt-1">Protects minimum emergency cash cushion</span>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <span>Total Strategy Decisions: <strong className="text-white font-mono tabular-nums">{rlWeights.totalDecisions}</strong></span>
          <span>Transfers Executed: <strong className="text-emerald-400 font-mono tabular-nums">{rlWeights.successfulTransfers}</strong></span>
          <span>Policy Confidence: <strong className="text-cyan-400 font-mono tabular-nums">{rlWeights.confidenceScore}%</strong></span>
        </div>
      </div>

      {/* 3. Continuous Online Spend, Salary & Half-Prediction Learner */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp size={16} className="text-purple-400" />
              <span>Online Spend, Salary &amp; Half-Prediction Learner</span>
            </h4>
            <p className="text-xs text-slate-400">
              Continuously adapts spend EMAs, category velocities, salary growth, and partial-month ("half-prediction") forecasts from live ledger entries.
            </p>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-purple-300 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
            Updates: {onlineLearnerState.totalOnlineUpdates}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] font-sans block">MONTHLY SPEND EMA</span>
            <span className="text-base font-bold text-white">
              {formatMoney(onlineLearnerState.monthlySpendBaselineEma, baseCurr, currSym, settings.numberGrouping, 0)}
            </span>
            <span className="text-[10px] font-sans text-slate-500 block mt-1">
              Forecast Bias: {onlineLearnerState.spendForecastBias.toFixed(3)}x
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] font-sans block">PARTIAL-MONTH HALF-PREDICTION</span>
            <span className="text-base font-bold text-cyan-400">
              {formatMoney(
                onlineLearnerState.halfPredictions.projectedFullMonthSpendBase,
                baseCurr,
                currSym,
                settings.numberGrouping,
                0
              )}
            </span>
            <span className="text-[10px] font-sans text-slate-500 block mt-1">
              Observed so far ({Math.round(onlineLearnerState.halfPredictions.monthElapsedFraction * 100)}% mo):{' '}
              {formatMoney(
                onlineLearnerState.halfPredictions.partialMonthObservedSpendBase,
                baseCurr,
                currSym,
                settings.numberGrouping,
                0
              )}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 text-[10px] font-sans block">LEARNED SALARY RUN-RATE EMA</span>
            <span className="text-base font-bold text-emerald-400">
              {formatMoney(onlineLearnerState.annualSalaryEma, baseCurr, currSym, settings.numberGrouping, 0)}
            </span>
            <span className="text-[10px] font-sans text-slate-500 block mt-1">
              Growth EMA: {(onlineLearnerState.salaryGrowthRateEma * 100).toFixed(1)}% · Next Mo Spend:{' '}
              {formatMoney(
                onlineLearnerState.halfPredictions.nextMonthSpendEstimateBase,
                baseCurr,
                currSym,
                settings.numberGrouping,
                0
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

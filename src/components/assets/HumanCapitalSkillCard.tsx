import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CareerTransitionRecord } from '../../types';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { EditCareerProfileModal } from './EditCareerProfileModal';
import { Modal } from '../common/Modal';
import {
  GraduationCap,
  Briefcase,
  Building2,
  Rocket,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Coins,
  Brain,
  Sliders,
  CheckCircle2,
  RefreshCw,
  Award,
} from 'lucide-react';

export const HumanCapitalSkillCard: React.FC = () => {
  const {
    careerProfile,
    careerPrediction,
    careerModelWeights,
    tuneCareerModel,
    logCareerTransition,
    resetCareerModelWeights,
    incomeStreams,
    engineResult,
    settings,
    currencies,
    setActiveModal,
    postSalary,
  } = useApp();

  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isTuneModalOpen, setIsTuneModalOpen] = useState(false);
  const [isRealityModalOpen, setIsRealityModalOpen] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState('');
  const [lastTransitionResult, setLastTransitionResult] = useState<CareerTransitionRecord | null>(null);

  // Reality vs Prediction logging state (Previous / Current / Next Role & Salary)
  const [transitionType, setTransitionType] = useState<'previous' | 'current_update' | 'next_offer'>('next_offer');
  const [transitionRole, setTransitionRole] = useState('');
  const [transitionSalary, setTransitionSalary] = useState('');
  const [transitionCompanyType, setTransitionCompanyType] = useState<'mnc' | 'startup' | 'midsize'>('mnc');
  const [transitionYear, setTransitionYear] = useState(String(new Date().getFullYear()));
  const [transitionExp, setTransitionExp] = useState(
    String(careerProfile.yearsOfExperience !== undefined ? careerProfile.yearsOfExperience : 0)
  );
  const [transitionAge, setTransitionAge] = useState(
    careerProfile.age !== undefined
      ? String(careerProfile.age)
      : settings.age !== undefined
      ? String(settings.age)
      : ''
  );
  const [syncSalaryStream, setSyncSalaryStream] = useState(true);
  const [realityError, setRealityError] = useState('');

  // Tuning modal form state
  const [roleFeedback, setRoleFeedback] = useState<
    'aligned' | 'too_senior' | 'too_junior' | 'different_field' | 'management_focus' | 'technical_focus'
  >('aligned');
  const [salaryFeedback, setSalaryFeedback] = useState<'accurate' | 'too_high' | 'too_low'>('accurate');
  const [customTargetSalary, setCustomTargetSalary] = useState('');
  const [feedbackComment, setFeedbackComment] = useState('');

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const annualSalary = engineResult.salaryYearlyIncomeBase || careerPrediction.currentAnnualSalary;
  const monthlySalary = annualSalary / 12;

  // Formatting education label
  const getEduLabel = () => {
    switch (careerProfile.education) {
      case 'tier1_tech':
        return 'Tier-1 Engineering (IIT/NIT/BITS)';
      case 'tier1_mba':
        return 'Tier-1 B-School (IIM/ISB)';
      case 'masters':
        return "Master's Degree (MS/M.Tech)";
      case 'bachelors_tech':
        return "Bachelor's in Tech (B.Tech/BE)";
      case 'bachelors_other':
        return "Bachelor's Degree";
      case 'doctorate':
        return 'Ph.D. / Doctorate';
      case 'bootcamp_selftaught':
        return 'Self-Taught / Bootcamp';
      default:
        return 'Professional Degree';
    }
  };

  const handleApplyFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    const targetSalNum = customTargetSalary ? parseFloat(customTargetSalary) : undefined;

    tuneCareerModel({
      predictedSalary: careerPrediction.predictedCurrentMarketMedian,
      userActualOrTargetSalary: targetSalNum,
      roleFeedback,
      salaryFeedback,
      comments: feedbackComment.trim() || undefined,
    });

    setFeedbackSuccess('Model weights successfully shifted! Projections re-calibrated.');
    setTimeout(() => {
      setFeedbackSuccess('');
      setIsTuneModalOpen(false);
    }, 1800);
  };

  const handleQuickTune = (
    rFeedback: 'aligned' | 'too_senior' | 'too_junior' | 'different_field' | 'management_focus' | 'technical_focus',
    sFeedback: 'accurate' | 'too_high' | 'too_low',
    label: string
  ) => {
    tuneCareerModel({
      predictedSalary: careerPrediction.predictedCurrentMarketMedian,
      roleFeedback: rFeedback,
      salaryFeedback: sFeedback,
      comments: `Quick action: ${label}`,
    });
    setFeedbackSuccess(`Tuned! Shifted model weights (${label}).`);
    setTimeout(() => setFeedbackSuccess(''), 2500);
  };

  const handleLogCareerReality = async (e: React.FormEvent) => {
    e.preventDefault();
    const salNum = parseFloat(transitionSalary);
    if (isNaN(salNum) || salNum <= 0) {
      setRealityError('Enter a valid annual compensation amount.');
      return;
    }
    const expNum = Math.max(0, parseFloat(transitionExp) || 0);
    const yrNum = parseInt(transitionYear, 10) || new Date().getFullYear();
    const ageNum = transitionAge.trim() !== '' ? parseFloat(transitionAge) : undefined;

    const record = await logCareerTransition({
      transitionType,
      role: transitionRole.trim() || careerProfile.currentRole || 'Professional Role',
      actualSalary: salNum,
      companyType: transitionCompanyType,
      year: yrNum,
      experienceAtTransition: expNum,
      ageAtTransition: ageNum !== undefined && !isNaN(ageNum) ? ageNum : undefined,
      applyAsActiveRole: transitionType !== 'previous',
      syncIncomeStream: transitionType !== 'previous' && syncSalaryStream,
    });

    setLastTransitionResult(record);
    setRealityError('');
    setTransitionSalary('');
    setTransitionRole('');
    setFeedbackSuccess(
      `Compared reality (${formatCompactMoney(record.actualSalary, baseCurr, currSym)}) vs model (${formatCompactMoney(
        record.modelPredictedSalary,
        baseCurr,
        currSym
      )}): weights & biases updated (${record.predictionErrorPct >= 0 ? '+' : ''}${record.predictionErrorPct}% error).`
    );
    setTimeout(() => setFeedbackSuccess(''), 5000);
  };

  return (
    <div className="rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800/90 p-5 shadow-xl relative overflow-hidden space-y-4">
      {/* Decorative ambient background */}
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

      {/* Header with Title & Realized Accounting Status Tag */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center shadow-inner">
              <GraduationCap size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Career &amp; Compensation
              </h3>
              <p className="text-xs text-slate-400">
                Projected salary trajectory based on role, education, and experience
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick feedback toast */}
      {feedbackSuccess && (
        <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in font-medium">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
          <span>{feedbackSuccess}</span>
        </div>
      )}

      {/* Active Run-Rate & Contribution Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80">
        <div>
          <span className="text-[11px] font-medium text-slate-400 block uppercase tracking-wider">
            Current Salary Run-Rate
          </span>
          <div className="text-xl font-black text-white font-mono mt-0.5">
            {formatMoney(annualSalary, baseCurr, currSym, settings.numberGrouping, 0)}
            <span className="text-xs text-slate-400 font-normal ml-1">/yr</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            ~{formatMoney(monthlySalary, baseCurr, currSym, settings.numberGrouping, 0)}/mo net
          </span>
        </div>

        <div>
          <span className="text-[11px] font-medium text-slate-400 block uppercase tracking-wider">
            Net Rate Velocity Contribution
          </span>
          <div className="text-xl font-black text-emerald-400 font-mono mt-0.5">
            +{careerPrediction.netRateContributionPct.toFixed(1)}% p.a.
          </div>
          <span className="text-[11px] text-slate-400">
            Propels your Net Cash Engine velocity
          </span>
        </div>

        <div className="flex flex-col justify-center gap-1.5">
          <button
            onClick={() => setActiveModal('income')}
            className="w-full py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all"
          >
            <Briefcase size={13} className="text-cyan-400" />
            Manage Income Streams ({incomeStreams.length})
          </button>
          {incomeStreams.length > 0 && (
            <button
              onClick={() => postSalary(incomeStreams[0].id)}
              className="w-full py-1.5 px-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all"
            >
              <Coins size={13} />
              Credit This Month's Payday
            </button>
          )}
        </div>
      </div>

      {/* ML Prediction & Career Trajectory Forecast Box */}
      <div className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center">
              <Sparkles size={14} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Compensation Benchmarks
              </h4>
              <span className="text-[11px] text-slate-400">
                Estimated market range for your profile
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setTransitionExp(String(careerProfile.yearsOfExperience ?? 0));
                setTransitionAge(
                  careerProfile.age !== undefined
                    ? String(careerProfile.age)
                    : settings.age !== undefined
                    ? String(settings.age)
                    : ''
                );
                setRealityError('');
                setIsRealityModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              title="Enter previous, current, or next actual salary & role to train weights against reality"
            >
              <TrendingUp size={13} />
              <span>Log Salary / Role Reality</span>
            </button>

            <button
              onClick={() => setIsTuneModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              title="Calibrate compensation estimates"
            >
              <Sliders size={13} />
              <span>Calibrate</span>
            </button>

            <button
              onClick={() => setIsEditProfileOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span>
                {careerProfile.currentRole || careerProfile.yearsOfExperience
                  ? `Edit Profile (${careerProfile.yearsOfExperience || 0}y exp)`
                  : 'Configure Profile'}
              </span>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

        {/* Current Standing Profile Tag or Clean Slate Guide */}
        {!careerProfile.currentRole && (careerProfile.yearsOfExperience || 0) === 0 && annualSalary === 0 && !careerProfile.technicalSkills?.length ? (
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-white block">Clean Slate Profile</span>
              <span className="text-[11px] text-slate-400">
                Zero predetermined assumptions. Add your educational major, technical skills, and goals to generate customized role trajectories.
              </span>
            </div>
            <button
              onClick={() => setIsEditProfileOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-300 font-semibold shrink-0 cursor-pointer text-xs"
            >
              Enter Skills & Education
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-200 font-semibold border border-slate-800">
                {careerProfile.currentRole || (careerProfile.yearsOfExperience === 0 ? 'Fresh Graduate / Career Starter' : 'Role Unspecified')}
              </span>
              {(careerProfile.age ?? settings.age) !== undefined && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 font-mono tabular-nums">
                  Age {careerProfile.age ?? settings.age}
                </span>
              )}
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 font-mono tabular-nums">
                {careerProfile.yearsOfExperience ?? 0} yrs exp
              </span>
              {careerProfile.educationalMajor && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-cyan-300 border border-slate-800">
                  Major: {careerProfile.educationalMajor}
                </span>
              )}
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-cyan-300 border border-slate-800">
                {getEduLabel()}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 font-mono tabular-nums">
                Market Median: {formatCompactMoney(careerPrediction.predictedCurrentMarketMedian, baseCurr, currSym)}
              </span>
              <span
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                  careerPrediction.marketPosition === 'top_percentile'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : careerPrediction.marketPosition === 'fair'
                    ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                    : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                }`}
              >
                {careerPrediction.marketPosition === 'top_percentile'
                  ? 'Top 15% Percentile'
                  : careerPrediction.marketPosition === 'fair'
                  ? 'Fair Market Value'
                  : 'Growth Opportunity'}
              </span>
            </div>

            {/* Ingested Skills & Strengths Badges */}
            {(careerProfile.technicalSkills?.length || careerProfile.behavioralStrengths?.length) ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-[10px] text-slate-400 font-mono">Active Inputs:</span>
                {careerProfile.technicalSkills?.map((s) => (
                  <span key={s} className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px]">
                    {s}
                  </span>
                ))}
                {careerProfile.behavioralStrengths?.map((s) => (
                  <span key={s} className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px]">
                    {s}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Dynamic Personalized Model Guidance */}
        {careerPrediction.personalizedAdvice && (
          <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-500/30 text-xs text-purple-200 flex items-start gap-2.5">
            <Brain size={16} className="text-purple-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-white block">Model Career Guidance</span>
              <p className="text-[11px] text-purple-200/90 leading-relaxed">
                {careerPrediction.personalizedAdvice}
              </p>
            </div>
          </div>
        )}

        {/* Dual Next-Role Predictions: Top MNC vs Venture Startup */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* 1. Top Tier MNC / Enterprise */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-blue-950/20 to-slate-950 border border-blue-500/30 relative">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-blue-400 font-bold text-xs uppercase tracking-wider">
                <Building2 size={14} />
                <span>Next Move: Top Tier MNC / Enterprise</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">
                +{careerPrediction.mncPrediction.expectedIncrementPct}% increment
              </span>
            </div>

            <div className="text-sm font-bold text-white mb-1">
              {careerPrediction.mncPrediction.nextRole}
            </div>

            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-lg font-black text-white">
                {formatCompactMoney(
                  careerPrediction.mncPrediction.expectedSalary,
                  baseCurr,
                  currSym,
                  settings.numberGrouping
                )}
                /yr
              </span>
              <span className="text-[11px] text-blue-300">
                +
                {formatCompactMoney(
                  careerPrediction.mncPrediction.annualRsuBonus,
                  baseCurr,
                  currSym
                )}
                /yr RSUs &amp; Bonus
              </span>
            </div>

            <div className="mt-2.5 pt-2 border-t border-blue-900/40 text-[10px] text-slate-400 space-y-1.5">
              <div className="flex items-center justify-between">
                <span>Enterprise Stability Index:</span>
                <span className="font-bold text-slate-200 font-mono tabular-nums">
                  {careerPrediction.mncPrediction.stabilityScore}/100
                </span>
              </div>
              <div>
                <span className="block text-slate-400 mb-1">In-Demand Role Competencies:</span>
                <div className="flex flex-wrap gap-1">
                  {careerPrediction.mncPrediction.skillsInDemand.map((s) => (
                    <span
                      key={s}
                      className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[9px]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 2. High-Growth Venture / Scale-up Startup */}
          <div className="p-3.5 rounded-xl bg-gradient-to-br from-purple-950/20 to-slate-950 border border-purple-500/30 relative">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-purple-400 font-bold text-xs uppercase tracking-wider">
                <Rocket size={14} />
                <span>Next Move: High-Growth Venture / Startup</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">
                +{careerPrediction.startupPrediction.expectedIncrementPct}% increment
              </span>
            </div>

            <div className="text-sm font-bold text-white mb-1">
              {careerPrediction.startupPrediction.nextRole}
            </div>

            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-lg font-black text-white">
                {formatCompactMoney(
                  careerPrediction.startupPrediction.expectedSalary,
                  baseCurr,
                  currSym,
                  settings.numberGrouping
                )}
                /yr
              </span>
              <span className="text-[11px] text-purple-300">
                +{careerPrediction.startupPrediction.equityUpsidePct}% ESOP Equity Pool
              </span>
            </div>

            <div className="mt-2.5 pt-2 border-t border-purple-900/40 text-[10px] text-slate-400 space-y-1.5">
              <div className="flex items-center justify-between">
                <span>Ownership & Velocity Index:</span>
                <span className="font-bold text-slate-200">
                  {careerPrediction.startupPrediction.upsidePotentialScore}/100
                </span>
              </div>
              <div>
                <span className="block text-slate-400 mb-1">In-Demand Role Competencies:</span>
                <div className="flex flex-wrap gap-1">
                  {careerPrediction.startupPrediction.skillsInDemand.map((s) => (
                    <span
                      key={s}
                      className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[9px]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Tuning Actions Strip */}
        <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-300 font-medium">
            <Sliders size={13} className="text-purple-400" />
            <span>Quick Feedback (Tune Weights):</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => handleQuickTune('too_junior', 'too_low', 'Salary/Role too low')}
              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium cursor-pointer transition-colors"
            >
              Aim Higher (+Seniority)
            </button>
            <button
              onClick={() => handleQuickTune('management_focus', 'accurate', 'People Leadership')}
              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium cursor-pointer transition-colors"
            >
              Leadership Focus
            </button>
            <button
              onClick={() => handleQuickTune('technical_focus', 'accurate', 'Technical Architecture')}
              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-[11px] font-medium cursor-pointer transition-colors"
            >
              Deep Tech Specialist
            </button>
            <button
              onClick={() => setIsTuneModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:text-white text-[11px] font-semibold cursor-pointer transition-colors"
            >
              More Options...
            </button>
          </div>
        </div>

        {/* Human Capital Present Value (Lifetime Skill Valuation) */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
              <Award size={14} className="text-amber-400" />
              Human Capital Net Present Value (Lifetime Skill Asset)
            </span>
            <p className="text-[10px] text-slate-400">
              Discounted cashflow of projected future earnings over 5 & 10 years at 8% discount rate.
            </p>
          </div>

          <div className="flex items-center gap-4 font-mono tabular-nums">
            <div>
              <span className="text-[10px] text-slate-400 block">5-Yr Skill Asset</span>
              <span className="text-sm font-bold text-white">
                {formatCompactMoney(careerPrediction.humanCapitalNpv5Yr, baseCurr, currSym)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">10-Yr Skill Asset</span>
              <span className="text-sm font-bold text-emerald-400">
                {formatCompactMoney(careerPrediction.humanCapitalNpv10Yr, baseCurr, currSym)}
              </span>
            </div>
          </div>
        </div>

        {/* Recent Reality vs Prediction Transitions Audit */}
        {careerProfile.careerTransitions && careerProfile.careerTransitions.length > 0 && (
          <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <TrendingUp size={13} className="text-emerald-400" />
                <span>Logged Career Reality vs Model Calibration ({careerProfile.careerTransitions.length})</span>
              </span>
              <button
                type="button"
                onClick={() => setIsRealityModalOpen(true)}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
              >
                + Add Entry
              </button>
            </div>
            <div className="space-y-1.5">
              {careerProfile.careerTransitions.slice(-3).reverse().map((tr) => (
                <div
                  key={tr.id}
                  className="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                >
                  <div>
                    <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-1.5">
                      {tr.transitionType === 'next_offer'
                        ? 'Next Offer'
                        : tr.transitionType === 'current_update'
                        ? 'Current'
                        : 'Previous'}
                    </span>
                    <strong className="text-white">{tr.role}</strong>
                    <span className="text-slate-400 ml-1.5">
                      ({tr.year} · {tr.experienceAtTransition}y exp · {tr.companyType.toUpperCase()})
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-slate-300">
                    Actual:{' '}
                    <strong className="text-emerald-400">
                      {formatCompactMoney(tr.actualSalary, baseCurr, currSym)}
                    </strong>{' '}
                    vs Pred:{' '}
                    <span className="text-slate-400">
                      {formatCompactMoney(tr.modelPredictedSalary, baseCurr, currSym)}
                    </span>{' '}
                    <span className={tr.predictionErrorPct >= 0 ? 'text-cyan-400' : 'text-amber-400'}>
                      ({tr.predictionErrorPct >= 0 ? '+' : ''}
                      {tr.predictionErrorPct}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      {isEditProfileOpen && (
        <EditCareerProfileModal
          isOpen={isEditProfileOpen}
          onClose={() => setIsEditProfileOpen(false)}
        />
      )}

      {/* Log Salary / Role Reality Modal */}
      {isRealityModalOpen && (
        <Modal
          isOpen={isRealityModalOpen}
          onClose={() => setIsRealityModalOpen(false)}
          title="Log Career Reality vs Model Prediction"
          subtitle="Enter a previous, current, or next role & salary to compare reality against the model and shift weights & biases"
          maxWidth="max-w-xl"
        >
          <form onSubmit={handleLogCareerReality} className="space-y-4 text-xs">
            {realityError && (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300">
                {realityError}
              </div>
            )}

            {lastTransitionResult && (
              <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-1.5">
                <div className="font-bold text-emerald-300 flex items-center justify-between">
                  <span>Weights &amp; Biases Shifted from Reality</span>
                  <span className="font-mono tabular-nums">
                    Error: {lastTransitionResult.predictionErrorPct >= 0 ? '+' : ''}
                    {lastTransitionResult.predictionErrorPct}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 font-mono tabular-nums">
                  Actual: {formatMoney(lastTransitionResult.actualSalary, baseCurr, currSym, settings.numberGrouping, 0)} vs
                  Predicted: {formatMoney(lastTransitionResult.modelPredictedSalary, baseCurr, currSym, settings.numberGrouping, 0)}
                </div>
                <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                  Intercept Δ: {lastTransitionResult.weightShifts.baseInterceptDelta >= 0 ? '+' : ''}
                  {lastTransitionResult.weightShifts.baseInterceptDelta} · Exp Slope Δ:{' '}
                  {lastTransitionResult.weightShifts.experienceCoeffDelta >= 0 ? '+' : ''}
                  {lastTransitionResult.weightShifts.experienceCoeffDelta} · Company Bias Δ:{' '}
                  {lastTransitionResult.weightShifts.companyBiasDelta >= 0 ? '+' : ''}
                  {lastTransitionResult.weightShifts.companyBiasDelta}%
                </div>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">Milestone Stage</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'previous', label: 'Previous Role' },
                  { id: 'current_update', label: 'Current Role Update' },
                  { id: 'next_offer', label: 'Next Role / Offer' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTransitionType(opt.id as 'previous' | 'current_update' | 'next_offer')}
                    className={`py-2 px-2.5 rounded-xl border font-semibold cursor-pointer transition-colors ${
                      transitionType === opt.id
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Role / Title</label>
                <input
                  type="text"
                  value={transitionRole}
                  onChange={(e) => setTransitionRole(e.target.value)}
                  placeholder={careerProfile.currentRole || 'e.g. Senior Software Engineer'}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Actual Annual Compensation ({baseCurr})
                </label>
                <input
                  type="number"
                  step="any"
                  value={transitionSalary}
                  onChange={(e) => setTransitionSalary(e.target.value)}
                  placeholder="e.g. 2400000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono tabular-nums"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Company Tier</label>
                <select
                  value={transitionCompanyType}
                  onChange={(e) => setTransitionCompanyType(e.target.value as 'mnc' | 'startup' | 'midsize')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100"
                >
                  <option value="mnc">MNC / Enterprise</option>
                  <option value="startup">Venture Startup</option>
                  <option value="midsize">Mid-Size</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Year</label>
                <input
                  type="number"
                  value={transitionYear}
                  onChange={(e) => setTransitionYear(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 font-mono tabular-nums"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Exp (Any Decimal)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="60"
                  value={transitionExp}
                  onChange={(e) => setTransitionExp(e.target.value)}
                  placeholder="e.g. 1.7"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 font-mono tabular-nums"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Age (Optional)</label>
                <input
                  type="number"
                  step="any"
                  min="14"
                  max="100"
                  value={transitionAge}
                  onChange={(e) => setTransitionAge(e.target.value)}
                  placeholder="e.g. 24"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 font-mono tabular-nums"
                />
              </div>
            </div>

            {transitionType !== 'previous' && (
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={syncSalaryStream}
                  onChange={(e) => setSyncSalaryStream(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                />
                <span>Also update active recurring salary stream to match this annual compensation</span>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsRealityModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles size={14} />
                <span>Compare &amp; Train Model</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Model Tuning & Feedback Modal */}
      {isTuneModalOpen && (
        <Modal
          isOpen={isTuneModalOpen}
          onClose={() => setIsTuneModalOpen(false)}
          title="Tune ML Model Weights & Biases"
          subtitle="Give feedback on predictions to calibrate regression slopes, intercepts, and seniority sensitivity"
          maxWidth="max-w-xl"
        >
          <form onSubmit={handleApplyFeedback} className="space-y-4 text-xs">
            {/* Active Model Parameters Display */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-purple-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Brain size={14} className="text-purple-400" />
                  Active Model Weights & Biases
                </span>
                <span className="font-mono text-[10px] text-purple-300 px-2 py-0.5 rounded bg-purple-500/15">
                  Tuning Iteration #{careerModelWeights.tuneIterations || 0}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Base Intercept</span>
                  <span className="font-bold text-white">{careerModelWeights.baseIntercept.toFixed(3)}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Experience Weight</span>
                  <span className="font-bold text-white">{careerModelWeights.experienceCoeff.toFixed(3)}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Technical Skill Weight</span>
                  <span className="font-bold text-emerald-400">{careerModelWeights.technicalSkillCoeff.toFixed(3)}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Leadership Weight</span>
                  <span className="font-bold text-blue-400">{careerModelWeights.behavioralStrengthCoeff.toFixed(3)}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Weakness Penalty</span>
                  <span className="font-bold text-amber-400">{careerModelWeights.weaknessPenaltyCoeff.toFixed(3)}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Learning Rate</span>
                  <span className="font-bold text-purple-400">0.080</span>
                </div>
              </div>
            </div>

            {/* Role Feedback Selection */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">
                How does the predicted role trajectory feel?
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'aligned', label: 'Well Aligned' },
                  { id: 'too_senior', label: 'Too Senior' },
                  { id: 'too_junior', label: 'Too Junior' },
                  { id: 'different_field', label: 'Field Misaligned' },
                  { id: 'management_focus', label: 'Shift to Management' },
                  { id: 'technical_focus', label: 'Shift to Tech Specialist' },
                ].map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setRoleFeedback(item.id as any)}
                    className={`p-2 rounded-xl border text-center font-medium transition-all cursor-pointer ${
                      roleFeedback === item.id
                        ? 'bg-purple-600/20 border-purple-500 text-white font-bold shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Salary Feedback Selection */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">
                How does the predicted compensation figure compare?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'too_low', label: 'Too Low (Undervalued)' },
                  { id: 'accurate', label: 'Accurate Market Value' },
                  { id: 'too_high', label: 'Too High (Optimistic)' },
                ].map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setSalaryFeedback(item.id as any)}
                    className={`p-2 rounded-xl border text-center font-medium transition-all cursor-pointer ${
                      salaryFeedback === item.id
                        ? 'bg-purple-600/20 border-purple-500 text-white font-bold shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Specific Target Figure (Optional) */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Your Exact Expected / Realistic Annual Target ({baseCurr})
              </label>
              <input
                type="number"
                value={customTargetSalary}
                onChange={(e) => setCustomTargetSalary(e.target.value)}
                placeholder={`Current prediction: ${careerPrediction.predictedCurrentMarketMedian}. Enter your target...`}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:border-purple-500 focus:outline-none"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                The gradient optimizer will calculate the delta ratio and shift the model intercept directly toward your target.
              </p>
            </div>

            {/* Feedback Notes */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Additional Context / Feedback Notes (Optional)
              </label>
              <input
                type="text"
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="e.g. In my city, tier-1 tech packages have higher signing bonuses..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:border-purple-500 focus:outline-none"
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  resetCareerModelWeights();
                  setFeedbackSuccess('Reset all model weights back to documented baseline.');
                  setTimeout(() => setFeedbackSuccess(''), 2500);
                  setIsTuneModalOpen(false);
                }}
                className="text-slate-400 hover:text-rose-400 text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <RefreshCw size={13} />
                <span>Reset Weights to Baseline</span>
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsTuneModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-600/30"
                >
                  <Sparkles size={14} />
                  <span>Apply & Shift Weights</span>
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

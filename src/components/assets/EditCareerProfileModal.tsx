import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { CareerProfile, EducationLevel, PreviousSalaryRecord } from '../../types';
import { Modal } from '../common/Modal';
import {
  Briefcase,
  GraduationCap,
  Plus,
  Trash2,
  TrendingUp,
  Sparkles,
  Building2,
  Rocket,
  Compass,
  Award,
  AlertCircle,
  Tag,
  X,
  Target,
  DollarSign,
} from 'lucide-react';

interface EditCareerProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EDUCATION_OPTIONS: { value: EducationLevel; label: string }[] = [
  { value: 'tier1_tech', label: 'Tier-1 Tech / Engineering (IIT, NIT, BITS, Top Global)' },
  { value: 'tier1_mba', label: 'Tier-1 Business School (IIM, ISB, Ivy League)' },
  { value: 'masters', label: "Master's Degree (M.Tech, MS, MCA, MBA)" },
  { value: 'bachelors_tech', label: "Bachelor's in Tech / Engineering (B.Tech, BE, BCA)" },
  { value: 'bachelors_other', label: "Bachelor's in Commerce / Science / Arts" },
  { value: 'doctorate', label: 'Ph.D. / Research Doctorate' },
  { value: 'bootcamp_selftaught', label: 'Self-Taught / Intensive Bootcamp / Diploma' },
];

const SUGGESTED_SKILLS = [
  'Python',
  'SQL',
  'React',
  'Node.js',
  'Financial Modeling',
  'Excel & DCF',
  'Data Analysis',
  'Machine Learning',
  'Cloud / AWS',
  'Figma & UX',
  'Product Roadmapping',
  'Growth Marketing',
  'Accounting',
];

const SUGGESTED_STRENGTHS = [
  'High Agency & Execution',
  'Strategic Thinking',
  'Team Leadership',
  'Stakeholder Management',
  'Analytical Rigor',
  'Complex Problem Solving',
  'Speed-to-Production',
];

const SUGGESTED_WEAKNESSES = [
  'Public Speaking',
  'System Design at Scale',
  'Budget Negotiation',
  'Cloud Infrastructure',
  'Statistical Evaluation',
  'Executive Presence',
];

export const EditCareerProfileModal: React.FC<EditCareerProfileModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { careerProfile, updateCareerProfile, settings, currencies } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const [currentRole, setCurrentRole] = useState(careerProfile.currentRole || '');
  const [age, setAge] = useState(
    careerProfile.age !== undefined
      ? String(careerProfile.age)
      : settings.age !== undefined
      ? String(settings.age)
      : ''
  );
  const [yearsOfExperience, setYearsOfExperience] = useState(
    careerProfile.yearsOfExperience !== undefined ? careerProfile.yearsOfExperience.toString() : '0'
  );
  const [education, setEducation] = useState<EducationLevel>(careerProfile.education || 'bachelors_tech');
  const [educationalMajor, setEducationalMajor] = useState(careerProfile.educationalMajor || '');
  const [careerGoals, setCareerGoals] = useState(careerProfile.careerGoals || '');
  const [salaryExpectation, setSalaryExpectation] = useState(
    careerProfile.salaryExpectation ? careerProfile.salaryExpectation.toString() : ''
  );
  const [targetCompanyType, setTargetCompanyType] = useState<'all' | 'mnc' | 'startup'>(
    careerProfile.targetCompanyType || 'all'
  );
  const [industry, setIndustry] = useState(careerProfile.industry || '');

  // Skills & strengths lists
  const [technicalSkills, setTechnicalSkills] = useState<string[]>(careerProfile.technicalSkills || []);
  const [skillInput, setSkillInput] = useState('');

  const [behavioralStrengths, setBehavioralStrengths] = useState<string[]>(
    careerProfile.behavioralStrengths || []
  );
  const [strengthInput, setStrengthInput] = useState('');

  const [weaknessesOrGrowthAreas, setWeaknessesOrGrowthAreas] = useState<string[]>(
    careerProfile.weaknessesOrGrowthAreas || []
  );
  const [weaknessInput, setWeaknessInput] = useState('');

  const [previousSalaries, setPreviousSalaries] = useState<PreviousSalaryRecord[]>(
    careerProfile.previousSalaries && Array.isArray(careerProfile.previousSalaries)
      ? [...careerProfile.previousSalaries]
      : []
  );

  const [newYear, setNewYear] = useState((new Date().getFullYear() - 1).toString());
  const [newRole, setNewRole] = useState('');
  const [newSalary, setNewSalary] = useState('');
  const [newType, setNewType] = useState<'mnc' | 'startup' | 'midsize'>('mnc');

  // Helpers to add chips
  const addSkill = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !technicalSkills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setTechnicalSkills([...technicalSkills, trimmed]);
    }
    setSkillInput('');
  };

  const removeSkill = (val: string) => {
    setTechnicalSkills(technicalSkills.filter((s) => s !== val));
  };

  const addStrength = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !behavioralStrengths.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setBehavioralStrengths([...behavioralStrengths, trimmed]);
    }
    setStrengthInput('');
  };

  const removeStrength = (val: string) => {
    setBehavioralStrengths(behavioralStrengths.filter((s) => s !== val));
  };

  const addWeakness = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !weaknessesOrGrowthAreas.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setWeaknessesOrGrowthAreas([...weaknessesOrGrowthAreas, trimmed]);
    }
    setWeaknessInput('');
  };

  const removeWeakness = (val: string) => {
    setWeaknessesOrGrowthAreas(weaknessesOrGrowthAreas.filter((s) => s !== val));
  };

  const handleAddSalaryRecord = () => {
    const yr = parseInt(newYear, 10);
    const sal = parseFloat(newSalary);
    if (!yr || isNaN(sal) || sal <= 0) return;

    setPreviousSalaries((prev) => [
      ...prev,
      {
        year: yr,
        role: newRole.trim() || currentRole || 'Role',
        salary: sal,
        companyType: newType,
      },
    ]);

    setNewSalary('');
    setNewRole('');
  };

  const handleRemoveSalaryRecord = (index: number) => {
    setPreviousSalaries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAge = age.trim() !== '' ? parseFloat(age) : undefined;
    const parsedExp = Math.max(0, parseFloat(yearsOfExperience) || 0);
    const updated: CareerProfile = {
      ...careerProfile,
      currentRole: currentRole.trim(),
      age: parsedAge !== undefined && !isNaN(parsedAge) && parsedAge > 0 ? parsedAge : undefined,
      yearsOfExperience: parsedExp,
      education,
      educationalMajor: educationalMajor.trim() || undefined,
      careerGoals: careerGoals.trim() || undefined,
      salaryExpectation: salaryExpectation ? parseFloat(salaryExpectation) : undefined,
      industry: industry.trim() || '',
      targetCompanyType,
      technicalSkills,
      behavioralStrengths,
      weaknessesOrGrowthAreas,
      previousSalaries: [...previousSalaries].sort((a, b) => a.year - b.year),
    };

    updateCareerProfile(updated);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Dynamic ML Career & Skill Asset Profile"
      subtitle="Feed skills, goals, age, exact experience, and salary history to calibrate predictions"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="career-profile-form"
            className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold shadow-md shadow-emerald-600/25 flex items-center justify-center gap-1.5 cursor-pointer text-xs transition-all"
          >
            <Sparkles size={14} /> Train & Recalibrate ML Model
          </button>
        </div>
      }
    >
      <form id="career-profile-form" onSubmit={handleSubmit} className="space-y-4 text-xs">
        {/* Role, Experience (Any Decimal), & Age */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-5">
            <label className="block text-slate-300 font-semibold mb-1">
              Current Professional Role / Title
            </label>
            <input
              type="text"
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value)}
              placeholder="e.g. Student, Data Analyst, SDE II"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-medium focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Leave blank if fresh graduate / career starter.
            </p>
          </div>

          <div className="sm:col-span-4">
            <label className="block text-slate-300 font-semibold mb-1">
              Experience (Years — Any Decimal)
            </label>
            <input
              type="number"
              step="any"
              min="0"
              max="60"
              placeholder="e.g. 1.7 or 1.8"
              value={yearsOfExperience}
              onChange={(e) => setYearsOfExperience(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono tabular-nums font-medium focus:border-emerald-500 focus:outline-none"
              required
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Accepts any exact decimal (0, 1.7, 1.8, 3.25, etc.).
            </p>
          </div>

          <div className="sm:col-span-3">
            <label className="block text-slate-300 font-semibold mb-1">
              Age (Years)
            </label>
            <input
              type="number"
              step="any"
              min="14"
              max="100"
              placeholder="e.g. 24"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono tabular-nums font-medium focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Saved across profile &amp; exports.
            </p>
          </div>
        </div>

        {/* Educational Background & Major */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <GraduationCap size={14} className="text-cyan-400" />
              Educational Credential Tier
            </label>
            <select
              value={education}
              onChange={(e) => setEducation(e.target.value as EducationLevel)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-medium focus:border-emerald-500 focus:outline-none"
            >
              {EDUCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Degree Major / Field of Study
            </label>
            <input
              type="text"
              value={educationalMajor}
              onChange={(e) => setEducationalMajor(e.target.value)}
              placeholder="e.g. Computer Science, Finance, Mechanical, Design, MBA"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-medium focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Career Goals & Salary Expectation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <Compass size={14} className="text-purple-400" />
              Career Goals & Direction
            </label>
            <input
              type="text"
              value={careerGoals}
              onChange={(e) => setCareerGoals(e.target.value)}
              placeholder="e.g. Engineering Leadership, Founder/CTO, Quant Trader"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-medium focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1.5">
              <DollarSign size={14} className="text-emerald-400" />
              Salary Expectation ({baseCurr} / year)
            </label>
            <input
              type="number"
              value={salaryExpectation}
              onChange={(e) => setSalaryExpectation(e.target.value)}
              placeholder="e.g. 1500000"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono font-medium focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* 1. TECHNICAL SKILLS INPUT */}
        <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-bold text-slate-200 flex items-center gap-1.5">
              <Tag size={14} className="text-emerald-400" />
              Technical & Domain Skills ({technicalSkills.length})
            </label>
            <span className="text-[10px] text-slate-400">Press Enter or comma to add</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addSkill(skillInput);
                }
              }}
              placeholder="Add skill (e.g. Python, SQL, Financial Modeling, React, Figma)..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => addSkill(skillInput)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
            >
              Add
            </button>
          </div>

          {/* Active Skills Chips */}
          <div className="flex flex-wrap gap-1.5 min-h-[28px]">
            {technicalSkills.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium text-[11px] flex items-center gap-1.5"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeSkill(s)}
                  className="hover:text-rose-400 cursor-pointer"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>

          {/* Suggestions */}
          <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-900">
            <span className="text-[10px] text-slate-500 mr-1 self-center">Suggestions:</span>
            {SUGGESTED_SKILLS.filter((s) => !technicalSkills.includes(s)).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => addSkill(s)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* 2. BEHAVIORAL & INTERPERSONAL STRENGTHS */}
        <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
          <label className="font-bold text-slate-200 flex items-center gap-1.5">
            <Award size={14} className="text-blue-400" />
            Interpersonal & Behavioral Strengths ({behavioralStrengths.length})
          </label>

          <div className="flex gap-2">
            <input
              type="text"
              value={strengthInput}
              onChange={(e) => setStrengthInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addStrength(strengthInput);
                }
              }}
              placeholder="Add strength (e.g. Team Leadership, Strategic Thinking, High Agency)..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => addStrength(strengthInput)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 min-h-[28px]">
            {behavioralStrengths.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 font-medium text-[11px] flex items-center gap-1.5"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeStrength(s)}
                  className="hover:text-rose-400 cursor-pointer"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-900">
            <span className="text-[10px] text-slate-500 mr-1 self-center">Suggestions:</span>
            {SUGGESTED_STRENGTHS.filter((s) => !behavioralStrengths.includes(s)).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => addStrength(s)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* 3. WEAKNESSES & GROWTH AREAS */}
        <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
          <label className="font-bold text-slate-200 flex items-center gap-1.5">
            <AlertCircle size={14} className="text-amber-400" />
            Weaknesses & Growth Areas (Informs Skill Gap Forecast) ({weaknessesOrGrowthAreas.length})
          </label>

          <div className="flex gap-2">
            <input
              type="text"
              value={weaknessInput}
              onChange={(e) => setWeaknessInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addWeakness(weaknessInput);
                }
              }}
              placeholder="Add growth area (e.g. Public Speaking, System Scalability, Cloud Infra)..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => addWeakness(weaknessInput)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 min-h-[28px]">
            {weaknessesOrGrowthAreas.map((s) => (
              <span
                key={s}
                className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium text-[11px] flex items-center gap-1.5"
              >
                {s}
                <button
                  type="button"
                  onClick={() => removeWeakness(s)}
                  className="hover:text-rose-400 cursor-pointer"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-900">
            <span className="text-[10px] text-slate-500 mr-1 self-center">Suggestions:</span>
            {SUGGESTED_WEAKNESSES.filter((s) => !weaknessesOrGrowthAreas.includes(s)).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => addWeakness(s)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* Target Company Direction */}
        <div>
          <label className="block text-slate-300 font-semibold mb-1">
            Target Trajectory Focus
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setTargetCompanyType('all')}
              className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer font-medium ${
                targetCompanyType === 'all'
                  ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              Balanced (Both)
            </button>
            <button
              type="button"
              onClick={() => setTargetCompanyType('mnc')}
              className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer font-medium flex items-center justify-center gap-1.5 ${
                targetCompanyType === 'mnc'
                  ? 'bg-blue-500/15 border-blue-500/60 text-blue-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Building2 size={13} /> Top Tier MNC
            </button>
            <button
              type="button"
              onClick={() => setTargetCompanyType('startup')}
              className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer font-medium flex items-center justify-center gap-1.5 ${
                targetCompanyType === 'startup'
                  ? 'bg-purple-500/15 border-purple-500/60 text-purple-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Rocket size={13} /> High-Growth Startup
            </button>
          </div>
        </div>

        {/* Previous Salaries & Trajectory Track */}
        <div className="pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                <TrendingUp size={14} className="text-emerald-400" />
                Previous Salary & Historical Milestones (Optional)
              </h4>
              <p className="text-[10px] text-slate-400">
                The ML model calculates your historical growth CAGR to forecast upcoming jump multipliers.
              </p>
            </div>
          </div>

          <div className="space-y-2 mb-3">
            {previousSalaries.map((rec, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-300 px-2 py-0.5 rounded bg-slate-900 text-[11px]">
                    {rec.year}
                  </span>
                  <div>
                    <span className="font-medium text-slate-200">{rec.role}</span>
                    <span className="text-[10px] text-slate-400 ml-2 uppercase tracking-wider">
                      ({rec.companyType || 'tech'})
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-emerald-400">
                    {currSym}
                    {rec.salary.toLocaleString()} /yr
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSalaryRecord(index)}
                    className="text-slate-500 hover:text-rose-400 transition-colors p-1 cursor-pointer"
                    title="Remove record"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add Previous Salary Record Row */}
          <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2">
            <span className="text-[11px] font-semibold text-slate-300">Add Historical Milestone</span>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input
                type="number"
                placeholder="Year (e.g. 2023)"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
              />
              <input
                type="text"
                placeholder="Role / Title"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
              />
              <input
                type="number"
                placeholder={`Salary in ${baseCurr}`}
                value={newSalary}
                onChange={(e) => setNewSalary(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
              />
              <div className="flex gap-1.5">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as 'mnc' | 'startup' | 'midsize')}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 flex-1"
                >
                  <option value="mnc">MNC</option>
                  <option value="startup">Startup</option>
                  <option value="midsize">Mid-Size</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddSalaryRecord}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center cursor-pointer"
                  title="Add salary milestone"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

      </form>
    </Modal>
  );
};

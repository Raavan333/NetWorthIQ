import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Holding, LiquidityClass, ReturnMode, AssetType, InterestPayoutFrequency, RenewalOption, MarketCapCategory, RiskAssessment, Transaction } from '../../types';
import { Zap, FolderPlus, Check, Building2, TrendingUp, AlertTriangle, Trash2, Shield, Lock } from 'lucide-react';
import { DatePickerField } from '../common/DatePickerField';
import {
  isBankAccountHolding,
  isSpendableLiquidHolding,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
  resolveAssetTypeLabel,
} from '../../lib/assetRules';
import { formatMoney } from '../../lib/formatters';
import { cleanAccountDigitsInput } from '../../lib/smsEngine';

interface AddEditAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialHolding?: Holding | null;
}

export const AddEditAssetModal: React.FC<AddEditAssetModalProps> = ({
  isOpen,
  onClose,
  initialHolding,
}) => {
  const {
    assetTypes,
    addAssetType,
    currencies,
    addHolding,
    updateHolding,
    deleteHolding,
    settings,
    holdings,
    liabilities,
    addTransaction,
    getAccountLiquidityWithSweepIn,
    breakSweepInForDeficit,
  } = useApp();

  const isBankType = (tid: string) => tid === 'type-bank' || tid.includes('bank');

  const [typeId, setTypeId] = useState(initialHolding?.typeId || assetTypes[0]?.id || 'type-bank');
  const [name, setName] = useState(initialHolding?.name || '');
  const [currency, setCurrency] = useState(initialHolding?.currency || settings.baseCurrency || 'INR');
  const [isMarketAsset, setIsMarketAsset] = useState(
    initialHolding?.units !== undefined || false
  );
  const [principalOrValue, setPrincipalOrValue] = useState<string>(() => {
    if (initialHolding?.principalOrValue !== undefined) {
      return initialHolding.principalOrValue.toString();
    }
    // Default to 0 for bank accounts and all standard new assets as requested
    return '0';
  });
  const [units, setUnits] = useState(initialHolding?.units?.toString() || '');
  const [avgBuyPrice, setAvgBuyPrice] = useState(initialHolding?.avgBuyPrice?.toString() || '');
  const [currentPrice, setCurrentPrice] = useState(initialHolding?.currentPrice?.toString() || '');
  const [fixedRatePct, setFixedRatePct] = useState(initialHolding?.fixedRatePct?.toString() || '');
  const [expectedRatePct, setExpectedRatePct] = useState(
    initialHolding?.expectedRatePct?.toString() || ''
  );
  const [startDate, setStartDate] = useState(initialHolding?.startDate || '');
  const [maturityDate, setMaturityDate] = useState(initialHolding?.maturityDate || '');
  const [liquidityClass, setLiquidityClass] = useState<LiquidityClass>(
    initialHolding?.liquidityClass || 'Immediate'
  );
  const [isSweepIn, setIsSweepIn] = useState(initialHolding?.isSweepIn || false);
  const [withdrawnFromSourceId, setWithdrawnFromSourceId] = useState(initialHolding?.withdrawnFromSourceId || '');
  const [cashAdvanceFeePct, setCashAdvanceFeePct] = useState('2.5');
  const [accountLastDigits, setAccountLastDigits] = useState(initialHolding?.accountLastDigits || '');
  const [notes, setNotes] = useState(initialHolding?.notes || '');
  const [error, setError] = useState('');

  // Bank accounts list for FD funding, sweep-in redemption, and interest/maturity settlement targets
  const safeHoldings = holdings || [];
  const safeLiabilities = liabilities || [];
  const strictBanks = safeHoldings.filter((h) => isBankAccountHolding(h, assetTypes));
  const bankAccounts =
    strictBanks.length > 0
      ? strictBanks
      : safeHoldings.filter((h) => isSpendableLiquidHolding(h, assetTypes));

  // FD / RD / Bond lifecycle state
  const [sweepInTargetAccountId, setSweepInTargetAccountId] = useState(
    initialHolding?.sweepInTargetAccountId || bankAccounts[0]?.id || ''
  );
  const [interestPayoutAccountId, setInterestPayoutAccountId] = useState(
    initialHolding?.interestPayoutAccountId || bankAccounts[0]?.id || ''
  );
  const [interestPayoutFrequency, setInterestPayoutFrequency] = useState<InterestPayoutFrequency>(
    initialHolding?.interestPayoutFrequency || 'at_maturity'
  );
  const [renewalOption, setRenewalOption] = useState<RenewalOption>(
    initialHolding?.renewalOption || 'renew_principal_and_interest'
  );
  const [maturitySettlementAccountId, setMaturitySettlementAccountId] = useState(
    initialHolding?.maturitySettlementAccountId || bankAccounts[0]?.id || ''
  );

  // Fund new FD from bank account state
  const [fundFdFromBank, setFundFdFromBank] = useState(!initialHolding && bankAccounts.length > 0);
  const [fdFundingBankId, setFdFundingBankId] = useState(bankAccounts[0]?.id || '');

  // Keep source/settlement bank IDs synchronized whenever modal opens, asset type changes, or holdings load
  useEffect(() => {
    if (bankAccounts.length === 0) return;
    const defaultBankId = bankAccounts[0].id;
    if (!fdFundingBankId || !bankAccounts.some((b) => b.id === fdFundingBankId)) {
      setFdFundingBankId(defaultBankId);
    }
    if (!sweepInTargetAccountId || !bankAccounts.some((b) => b.id === sweepInTargetAccountId)) {
      setSweepInTargetAccountId(initialHolding?.sweepInTargetAccountId || defaultBankId);
    }
    if (!interestPayoutAccountId || !bankAccounts.some((b) => b.id === interestPayoutAccountId)) {
      setInterestPayoutAccountId(initialHolding?.interestPayoutAccountId || defaultBankId);
    }
    if (!maturitySettlementAccountId || !bankAccounts.some((b) => b.id === maturitySettlementAccountId)) {
      setMaturitySettlementAccountId(initialHolding?.maturitySettlementAccountId || defaultBankId);
    }
  }, [
    isOpen,
    typeId,
    bankAccounts,
    fdFundingBankId,
    sweepInTargetAccountId,
    interestPayoutAccountId,
    maturitySettlementAccountId,
    initialHolding,
  ]);

  // Stock / Equity market cap & gain state
  const [marketCapCategory, setMarketCapCategory] = useState<MarketCapCategory>(
    initialHolding?.marketCapCategory || 'large_cap'
  );
  const [realisedGainLoss, setRealisedGainLoss] = useState(
    initialHolding?.realisedGainLoss?.toString() || ''
  );

  // Risk Assessment state for asset
  const [riskLevel, setRiskLevel] = useState<RiskAssessment>(
    initialHolding?.riskLevel || (initialHolding?.typeId === 'type-bank' ? 'ultra_safe' : 'low_risk')
  );

  // Custom Category & Asset Type creator state
  const [showCustomCreator, setShowCustomCreator] = useState(false);
  const [customCatName, setCustomCatName] = useState('');
  const [customTypeName, setCustomTypeName] = useState('');
  const [customReturnMode, setCustomReturnMode] = useState<ReturnMode>('fixed');
  const [customLiquidity, setCustomLiquidity] = useState<LiquidityClass>('Short');
  const [customCreatorError, setCustomCreatorError] = useState('');

  const selectedType = (assetTypes || []).find((t) => t.id === typeId);
  const isFdAsset =
    typeId === 'type-fd' ||
    typeId.includes('fd') ||
    Boolean(selectedType && selectedType.name.toLowerCase().includes('fixed deposit')) ||
    Boolean(selectedType && selectedType.name.toLowerCase() === 'fd');

  const isFixedIncomeAsset =
    isFdAsset ||
    typeId.includes('bond') ||
    typeId.includes('rd') ||
    typeId.includes('p2p') ||
    liquidityClass === 'Locked' ||
    Boolean(selectedType && selectedType.name.toLowerCase().includes('bond')) ||
    Boolean(selectedType && selectedType.name.toLowerCase().includes('recurring deposit')) ||
    Boolean(selectedType && selectedType.category?.toLowerCase().includes('fixed income')) ||
    Boolean(selectedType && selectedType.category?.toLowerCase().includes('alternative lending'));

  const isEquityAsset =
    isMarketAsset ||
    typeId.includes('stock') ||
    typeId.includes('mf') ||
    Boolean(selectedType && selectedType.category?.toLowerCase().includes('equities'));

  // Available withdrawal sources for Hand Cash: liquid bank accounts & cards (excluding term loans & locked assets)
  const withdrawalSources = [
    ...bankAccounts.map((h) => ({
      id: h.id,
      name: `${getSafeAssetName(h, assetTypes)} · ${resolveAssetTypeLabel(h, assetTypes)} (${h.currency || 'INR'})`,
      isCreditCard: false,
    })),
    ...safeLiabilities.filter((l) => l.kind === 'card').map((c) => ({
      id: c.id,
      name: `${getSafeLiabilityName(c)} · ${c.cardType === 'debit' ? 'Debit Card' : c.cardType === 'hybrid' ? 'Hybrid Card' : 'Credit Card'}`,
      isCreditCard: c.cardType === 'credit' || !c.cardType,
    })),
  ];

  // Group asset types into distinct suitable buckets per user specifications:
  // 1. Liquid Cash & Banking: bank accounts, hand cash, digital wallets
  const bucketCash = (assetTypes || []).filter(
    (t) =>
      t.category === 'Liquid Cash & Banking' ||
      t.category === 'Cash & Liquid Assets' ||
      t.id.includes('bank') ||
      t.id.includes('cash')
  );
  // 2. Equities & Market Investments: Indian stocks, US stocks, mutual funds
  const bucketEquities = (assetTypes || []).filter(
    (t) =>
      !bucketCash.some((b) => b.id === t.id) &&
      (t.category === 'Equities & Market Investments' ||
        t.category === 'Equities & Market' ||
        t.id.includes('stock') ||
        t.id.includes('mf'))
  );
  // 3. Fixed Income & Term Deposits: FDs, corporate bonds
  const bucketFixedIncome = (assetTypes || []).filter(
    (t) =>
      !bucketCash.some((b) => b.id === t.id) &&
      !bucketEquities.some((b) => b.id === t.id) &&
      (t.category === 'Fixed Income & Term Deposits' ||
        t.category === 'Fixed Income & Lending' ||
        t.id.includes('fd') ||
        t.id.includes('bond'))
  );
  // 4. Alternative Lending & Credit: P2P lending
  const bucketLending = (assetTypes || []).filter(
    (t) =>
      !bucketCash.some((b) => b.id === t.id) &&
      !bucketEquities.some((b) => b.id === t.id) &&
      !bucketFixedIncome.some((b) => b.id === t.id) &&
      (t.category === 'Alternative Lending & Credit' || t.id.includes('p2p'))
  );
  // 5. User-Defined Custom Categories & Assets
  const bucketCustom = (assetTypes || []).filter(
    (t) =>
      !bucketCash.some((b) => b.id === t.id) &&
      !bucketEquities.some((b) => b.id === t.id) &&
      !bucketFixedIncome.some((b) => b.id === t.id) &&
      !bucketLending.some((b) => b.id === t.id)
  );

  // Handle selected type defaults
  const handleTypeChange = (newTypeId: string) => {
    if (newTypeId === '__NEW_CUSTOM__') {
      setShowCustomCreator(true);
      return;
    }
    setTypeId(newTypeId);
    const selected = (assetTypes || []).find((t) => t.id === newTypeId);
    if (selected) {
      setLiquidityClass(selected.defaultLiquidity);
      setIsMarketAsset(selected.returnMode === 'realised-only');
    }
    // If switching to Bank Account while creating a new asset with blank or non-set balance, default to '0'
    if (!initialHolding && isBankType(newTypeId) && (!principalOrValue || principalOrValue.trim() === '')) {
      setPrincipalOrValue('0');
    }
  };

  // Create new custom asset type & category
  const handleCreateCustomAssetType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTypeName.trim()) {
      setCustomCreatorError('Please enter an asset type name');
      return;
    }
    const cat = customCatName.trim() || 'Custom Categories';
    const newId = `type-custom-${Date.now()}`;
    const newType: AssetType = {
      id: newId,
      name: customTypeName.trim(),
      category: cat,
      returnMode: customReturnMode,
      defaultLiquidity: customLiquidity,
      isBuiltIn: false,
    };

    await addAssetType(newType);
    setTypeId(newId);
    setLiquidityClass(customLiquidity);
    setIsMarketAsset(customReturnMode === 'realised-only');
    setShowCustomCreator(false);
    setCustomCatName('');
    setCustomTypeName('');
    setCustomCreatorError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Mandatory Asset Name
    if (!name.trim()) {
      setError('Asset name is required. Please provide a descriptive name.');
      return;
    }

    // 2. Fixed Deposit / Fixed Income Strict Validation
    if (isFixedIncomeAsset) {
      if (!startDate || startDate.trim() === '') {
        setError('Incomplete Asset Information: Fixed Deposits and term investments require a valid Start Date.');
        return;
      }
      const startTs = new Date(startDate).getTime();
      if (isNaN(startTs)) {
        setError('Incomplete Asset Information: Please enter a valid deposit start date (YYYY-MM-DD).');
        return;
      }

      if (!maturityDate || maturityDate.trim() === '') {
        setError('Incomplete Asset Information: Fixed Deposits and term investments require a valid Maturity Date.');
        return;
      }
      const maturityTs = new Date(maturityDate).getTime();
      if (isNaN(maturityTs)) {
        setError('Incomplete Asset Information: Please enter a valid maturity date (YYYY-MM-DD).');
        return;
      }

      if (maturityTs <= startTs) {
        setError('Invalid Asset Dates: Maturity date must be strictly after the deposit start date.');
        return;
      }

      const pVal = parseFloat(principalOrValue);
      if (isNaN(pVal) || pVal <= 0) {
        setError('Incomplete Asset Information: Fixed Deposits require a valid deposit principal amount greater than 0.');
        return;
      }

      const rateVal = parseFloat(fixedRatePct);
      if (isNaN(rateVal) || rateVal < 0) {
        setError('Incomplete Asset Information: Please enter a valid annual rate (0% or greater, e.g. 0% for friendly loan or 7.1% for FD).');
        return;
      }
    }

    // 3. Market Assets (Stocks, Mutual Funds, ETFs)
    else if (isMarketAsset) {
      const uNum = parseFloat(units);
      if (isNaN(uNum) || uNum <= 0) {
        setError('Market assets require valid units or quantity greater than 0.');
        return;
      }
      const pNum = parseFloat(currentPrice);
      if (isNaN(pNum) || pNum <= 0) {
        setError('Market assets require a valid current market price greater than 0.');
        return;
      }
      if (avgBuyPrice) {
        const bNum = parseFloat(avgBuyPrice);
        if (isNaN(bNum) || bNum < 0) {
          setError('Average purchase price cannot be negative.');
          return;
        }
      }
    }

    // 4. Other Standard Assets (Bank, Cash, Real Estate, Friendly Loans, EPF, etc.)
    else {
      const rawVal = principalOrValue.trim() === '' ? '0' : principalOrValue;
      const pVal = parseFloat(rawVal);
      if (isNaN(pVal) || pVal < 0) {
        setError('Please enter a valid balance or valuation (0 or greater).');
        return;
      }
    }

    // 5. General date range check if both dates provided
    if (startDate && maturityDate) {
      if (new Date(maturityDate).getTime() <= new Date(startDate).getTime()) {
        setError('Maturity date must be after the purchase/start date.');
        return;
      }
    }

    const unitsNum = isMarketAsset && units ? parseFloat(units) : undefined;
    const priceNum = isMarketAsset && currentPrice ? parseFloat(currentPrice) : undefined;
    const buyPriceNum = isMarketAsset && avgBuyPrice ? parseFloat(avgBuyPrice) : undefined;
    const isBank = isBankType(typeId);
    const rawVal = (!isMarketAsset && principalOrValue.trim() === '' && isBank) ? '0' : principalOrValue;
    const principalNum = !isMarketAsset && rawVal !== ''
      ? (parseFloat(rawVal) || 0)
      : (unitsNum && priceNum ? unitsNum * priceNum : 0);

    const isHandCashType = typeId === 'type-cash-hand' || typeId === 'type-cash';
    let calculatedFee: number | undefined = initialHolding?.cashAdvanceFee;
    let selectedSourceName: string | undefined = initialHolding?.withdrawnFromSourceId;

    if (isHandCashType && withdrawnFromSourceId) {
      const src = withdrawalSources.find((s) => s.id === withdrawnFromSourceId);
      selectedSourceName = src ? src.name : withdrawnFromSourceId;
      if (src?.isCreditCard) {
        const feePct = parseFloat(cashAdvanceFeePct) || 2.5;
        calculatedFee = Math.round((principalNum * feePct) / 100);
      } else {
        calculatedFee = undefined;
      }
    }

    const unrealisedCalc =
      isMarketAsset && unitsNum && priceNum && buyPriceNum
        ? (priceNum - buyPriceNum) * unitsNum
        : undefined;

    const holdingData: Holding = {
      id: initialHolding?.id || `hold-${Date.now()}`,
      name: name.trim(),
      typeId,
      currency,
      principalOrValue: principalNum,
      units: unitsNum,
      currentPrice: priceNum,
      avgBuyPrice: buyPriceNum,
      fixedRatePct: fixedRatePct !== '' ? parseFloat(fixedRatePct) : undefined,
      expectedRatePct: expectedRatePct !== '' ? parseFloat(expectedRatePct) : undefined,
      startDate: startDate || undefined,
      maturityDate: maturityDate || undefined,
      liquidityClass: isFdAsset ? 'Locked' : liquidityClass,
      notes: notes.trim() || undefined,
      isAssumed: false,
      isSweepIn: isFdAsset ? isSweepIn : undefined,
      sweepInTargetAccountId: isFdAsset && isSweepIn ? sweepInTargetAccountId : undefined,
      interestPayoutAccountId: isFixedIncomeAsset ? interestPayoutAccountId : undefined,
      interestPayoutFrequency: isFixedIncomeAsset ? interestPayoutFrequency : undefined,
      renewalOption: isFixedIncomeAsset ? renewalOption : undefined,
      maturitySettlementAccountId: isFixedIncomeAsset && renewalOption === 'do_not_renew' ? maturitySettlementAccountId : undefined,
      marketCapCategory: isEquityAsset ? marketCapCategory : undefined,
      realisedGainLoss: isEquityAsset && realisedGainLoss ? parseFloat(realisedGainLoss) : undefined,
      unrealisedGainLoss: unrealisedCalc,
      withdrawnFromSourceId: isHandCashType ? selectedSourceName : undefined,
      cashAdvanceFee: isHandCashType ? calculatedFee : undefined,
      accountLastDigits: cleanAccountDigitsInput(accountLastDigits) || undefined,
      customCategory: selectedType?.category,
      riskLevel,
    };

    if (initialHolding) {
      await updateHolding(holdingData);
    } else {
      // If funding a new FD from a bank account per user specification:
      // "account cannot pay to an existing FD, it can create a new FD and for that amount can be deducted"
      if (isFdAsset && fundFdFromBank && fdFundingBankId && principalNum > 0) {
        const fundingBank = safeHoldings.find((h) => h.id === fdFundingBankId);
        if (!fundingBank) {
          setError('Selected funding bank account not found.');
          return;
        }
        const curBal = fundingBank.principalOrValue || 0;
        const { totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(fundingBank.id);

        if (totalAvailable < principalNum) {
          setError(
            `Cannot create FD: Insufficient liquid funds in "${getSafeAssetName(fundingBank, assetTypes)}". Available: ${curBal.toLocaleString()} ${fundingBank.currency} (+ ${totalSweepIn.toLocaleString()} in Sweep-In FDs = ${totalAvailable.toLocaleString()} total), required: ${principalNum.toLocaleString()} ${fundingBank.currency}.`
          );
          return;
        }

        if (curBal < principalNum) {
          const deficit = principalNum - Math.max(0, curBal);
          await breakSweepInForDeficit(fundingBank.id, deficit, `Create Fixed Deposit: ${name.trim()}`);
        }

        const updatedBal = curBal >= principalNum ? curBal - principalNum : 0;
        await updateHolding({ ...fundingBank, principalOrValue: updatedBal });

        const fundTx: Transaction = {
          id: `tx-fd-fund-${Date.now()}`,
          date: startDate || new Date().toISOString().split('T')[0],
          kind: 'transfer',
          amount: principalNum,
          currency: currency || fundingBank.currency,
          fromId: fdFundingBankId,
          toId: holdingData.id,
          reason: `Funded New Fixed Deposit: ${name.trim()}`,
          category: 'Investment',
          tags: ['FD Creation', 'Account Transfer'],
          fxRateUsed: 1.0,
        };
        await addTransaction(fundTx);
      }

      await addHolding(holdingData);
    }
    onClose();
  };

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!initialHolding) return;
    await deleteHolding(initialHolding.id);
    onClose();
  };

  const modalFooter = (
    <div className="flex items-center justify-between gap-2.5 w-full flex-wrap sm:flex-nowrap">
      {initialHolding ? (
        !isDeleting ? (
          <button
            type="button"
            onClick={() => setIsDeleting(true)}
            className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Trash2 size={14} />
            <span>Delete Asset</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <span className="text-[11px] text-rose-300 font-medium">Delete asset?</span>
            <button
              type="button"
              onClick={handleDelete}
              className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition-colors"
            >
              Yes, Delete
            </button>
            <button
              type="button"
              onClick={() => setIsDeleting(false)}
              className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )
      ) : (
        <div />
      )}

      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs sm:text-sm font-semibold cursor-pointer transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="add-edit-asset-form"
          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/25 cursor-pointer transition-all"
        >
          {initialHolding ? 'Save Changes' : 'Add Holding'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialHolding ? 'Edit Asset' : 'Add New Asset'}
      subtitle="Track bank accounts, stocks, mutual funds, corporate bonds, FDs, and custom assets"
      footer={modalFooter}
    >
      <form id="add-edit-asset-form" onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 text-rose-300 text-xs flex items-start gap-2.5 animate-shake shadow-sm">
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium leading-relaxed">{error}</div>
          </div>
        )}

        {/* Asset Type Selector with Bucket Grouping and Custom Option */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-slate-300">
              Asset Category & Type
            </label>
            <button
              type="button"
              onClick={() => setShowCustomCreator(!showCustomCreator)}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <FolderPlus size={13} />
              <span>{showCustomCreator ? 'Hide Creator' : '+ Custom Category'}</span>
            </button>
          </div>

          <select
            value={typeId}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
          >
            {/* Bucket 1: Liquid Cash & Banking */}
            {bucketCash.length > 0 && (
              <optgroup label="Liquid Cash & Banking">
                {bucketCash.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}

            {/* Bucket 2: Equities & Market Investments */}
            {bucketEquities.length > 0 && (
              <optgroup label="Equities & Market Investments">
                {bucketEquities.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}

            {/* Bucket 3: Fixed Income & Term Deposits */}
            {bucketFixedIncome.length > 0 && (
              <optgroup label="Fixed Income & Term Deposits">
                {bucketFixedIncome.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}

            {/* Bucket 4: Alternative Lending & Credit */}
            {bucketLending.length > 0 && (
              <optgroup label="Alternative Lending & Credit">
                {bucketLending.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}

            {/* Bucket 5: Custom User-Defined Categories */}
            {bucketCustom.length > 0 && (
              <optgroup label="Custom Categories & Assets">
                {bucketCustom.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.category || 'Custom'})
                  </option>
                ))}
              </optgroup>
            )}

            <option value="__NEW_CUSTOM__" className="text-emerald-400 font-bold">
              + Define New Custom Category & Asset...
            </option>
          </select>
        </div>

        {/* Inline Custom Category / Type Creator */}
        {showCustomCreator && (
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-emerald-500/40 space-y-3 animate-fade-in shadow-lg shadow-emerald-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <FolderPlus size={14} className="text-emerald-400" />
                Define Custom Asset Category & Type
              </span>
              <button
                type="button"
                onClick={() => setShowCustomCreator(false)}
                className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Close
              </button>
            </div>

            {customCreatorError && (
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-300 text-xs">
                {customCreatorError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Category Bucket Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Real Estate, Crypto, Gold"
                  value={customCatName}
                  onChange={(e) => setCustomCatName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Asset Type Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Commercial Flat, Sovereign Gold"
                  value={customTypeName}
                  onChange={(e) => setCustomTypeName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Tracking Mode
                </label>
                <select
                  value={customReturnMode}
                  onChange={(e) => setCustomReturnMode(e.target.value as ReturnMode)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="fixed">Fixed Balance / Fixed % Return</option>
                  <option value="realised-only">Units & Market Price</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Default Liquidity
                </label>
                <select
                  value={customLiquidity}
                  onChange={(e) => setCustomLiquidity(e.target.value as LiquidityClass)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="Immediate">Immediate (Cash / Instant)</option>
                  <option value="Short">Short-Term (1-3 days)</option>
                  <option value="Locked">Locked (Term / Illiquid)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleCreateCustomAssetType}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Check size={13} />
                <span>Save Category & Select</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">Asset Name</label>
            <input
              type="text"
              placeholder="e.g. HDFC Salary Account, Infosys Stocks, L&T Corporate Bond"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              {(currencies || []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Account Last 4 Digits for Automated On-Device SMS Transaction Routing */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Account Last 4 Digits <span className="text-slate-500 font-normal">(supports multiple, e.g. 4913, 913)</span>
          </label>
          <input
            type="text"
            maxLength={60}
            placeholder="e.g. 4913, 913"
            value={accountLastDigits}
            onChange={(e) => setAccountLastDigits(e.target.value.replace(/[^0-9,\s]/g, ''))}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
          />
          <span className="text-[10px] text-slate-500 block mt-0.5">
            Matches incoming bank debit/credit SMS alerts (e.g. A/c ending 4913 or 913) to automatically route transactions.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Liquidity Class</label>
            <select
              value={liquidityClass}
              onChange={(e) => setLiquidityClass(e.target.value as LiquidityClass)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="Immediate">Immediate (Cash / Bank / Instant)</option>
              <option value="Short">Short-Term (Stocks / MFs / Bonds)</option>
              <option value="Locked">Locked (FD / Term / P2P Lending)</option>
            </select>
          </div>

          <div className="flex items-center pt-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                id="marketToggle"
                checked={isMarketAsset}
                onChange={(e) => setIsMarketAsset(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500 bg-slate-950 border-slate-800 cursor-pointer"
              />
              <span className="text-xs text-slate-300 font-medium select-none">
                Track via Units & Price (Stocks, MFs)
              </span>
            </label>
          </div>
        </div>

        {isMarketAsset ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Units Held</label>
              <input
                type="number"
                step="any"
                placeholder="40"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Current Price</label>
              <input
                type="number"
                step="any"
                placeholder="1500"
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Avg Buy Price</label>
              <input
                type="number"
                step="any"
                placeholder="1450"
                value={avgBuyPrice}
                onChange={(e) => setAvgBuyPrice(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
              />
            </div>
          </div>
        ) : initialHolding && isFdAsset ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-400">
                Deposit Principal (Locked)
              </label>
              <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1 font-mono">
                <Lock size={11} /> Locked FD Contract
              </span>
            </div>
            <input
              type="number"
              value={principalOrValue}
              disabled
              className="w-full bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-400 font-mono cursor-not-allowed opacity-80"
            />
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90 leading-relaxed">
              <Lock size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Locked Asset Rule:</strong> FDs are fixed contracts and cannot receive top-ups or direct deposits once created. To invest more, please create a new FD.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-400">
                  {isBankType(typeId)
                    ? 'Current Bank Account Balance'
                    : isFdAsset
                    ? 'Fixed Deposit Principal Amount'
                    : 'Current Principal or Balance'}
                </label>
                {isBankType(typeId) && (
                  <span className="text-[10px] text-emerald-400 font-medium">
                    Zero balance permitted (defaults to 0)
                  </span>
                )}
              </div>
              <input
                type="number"
                step="any"
                placeholder={isBankType(typeId) ? '0' : '150000'}
                value={principalOrValue}
                onChange={(e) => setPrincipalOrValue(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                required={!isBankType(typeId)}
              />
              {isBankType(typeId) && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Zero-balance accounts ($0 / ₹0) can be created as default. You can fund or link this account anytime.
                </p>
              )}
            </div>

            {/* Fund New FD from Bank Account Option */}
            {!initialHolding && isFdAsset && (
              <div className="p-3.5 rounded-xl bg-cyan-950/25 border border-cyan-500/35 space-y-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fundFdFromBank}
                    onChange={(e) => setFundFdFromBank(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 bg-slate-900 border-slate-700 focus:ring-cyan-400 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-cyan-200">
                    Fund this new Fixed Deposit from a Bank Account (deduct principal)
                  </span>
                </label>

                {fundFdFromBank && (
                  <div className="space-y-2 pt-1.5 border-t border-cyan-800/40 animate-fade-in">
                    <label className="block text-xs font-medium text-slate-200">
                      Source Bank Account
                    </label>
                    {bankAccounts.length === 0 ? (
                      <div className="text-rose-400 text-xs">
                        No bank accounts available. Add a bank account first or uncheck to record an existing deposit without deduction.
                      </div>
                    ) : (
                      <>
                        <select
                          value={fdFundingBankId || bankAccounts[0].id}
                          onChange={(e) => setFdFundingBankId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-slate-100 font-medium focus:outline-none focus:border-cyan-400"
                        >
                          {bankAccounts.map((b) => {
                            const sym = currencies?.find((c) => c.code === b.currency)?.symbol || `${b.currency} `;
                            const { totalSweepIn } = getAccountLiquidityWithSweepIn(b.id);
                            return (
                              <option key={b.id} value={b.id}>
                                {formatAssetOptionLabel(b, assetTypes, { currSymbol: sym, sweepInAmount: totalSweepIn })}
                              </option>
                            );
                          })}
                        </select>
                        {(() => {
                          const activeBank =
                            bankAccounts.find((b) => b.id === fdFundingBankId) || bankAccounts[0];
                          if (!activeBank) return null;
                          const { balance, totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(activeBank.id);
                          return (
                            <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="min-w-0">
                                <span className="font-semibold text-white block break-words">
                                  {getSafeAssetName(activeBank, assetTypes)}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {resolveAssetTypeLabel(activeBank, assetTypes)} · {activeBank.currency}
                                </span>
                              </div>
                              <div className="text-right font-mono tabular-nums">
                                <span className="text-emerald-400 font-semibold block">
                                  Avail: {formatMoney(balance, activeBank.currency)}
                                </span>
                                {totalSweepIn > 0 && (
                                  <span className="text-[11px] text-cyan-300 block">
                                    + {formatMoney(totalSweepIn, activeBank.currency)} Sweep-In ({formatMoney(totalAvailable, activeBank.currency)} total)
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Accounts cannot top up existing locked FDs, only fund newly created deposits from available bank balance (with LIFO Sweep-In redemption if required).
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Return Rates: Only show appropriate rate for the asset type */}
        {typeId === 'type-bank' ? (
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Fixed Annual Interest Rate (% p.a.)
            </label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 2.50"
              value={fixedRatePct}
              onChange={(e) => setFixedRatePct(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
            />
            <span className="text-[10px] text-slate-500">Savings/checking accounts typically yield 1.0% to 2.5% maximum.</span>
          </div>
        ) : typeId === 'type-cash-hand' || typeId === 'type-cash' ? (
          <div className="space-y-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Withdrawn From (Source Account / Card)
              </label>
              <select
                value={withdrawnFromSourceId}
                onChange={(e) => setWithdrawnFromSourceId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <option value="">Select source account (optional)</option>
                {withdrawalSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {withdrawalSources.find((s) => s.id === withdrawnFromSourceId)?.isCreditCard && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-2">
                <div className="flex items-center justify-between">
                  <span>Credit Card Cash Advance Fee (%)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={cashAdvanceFeePct}
                    onChange={(e) => setCashAdvanceFeePct(e.target.value)}
                    className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-right font-mono"
                  />
                </div>
                <p className="text-[10px] text-amber-400/90 leading-tight">
                  Withdrawing physical cash from a credit card incurs an upfront cash advance fee. Debit cards incur ₹0 fee.
                </p>
                {principalOrValue && parseFloat(principalOrValue) > 0 && (
                  <div className="text-[11px] font-bold text-white pt-1 border-t border-amber-500/20">
                    Calculated advance fee:{' '}
                    {((parseFloat(principalOrValue) * (parseFloat(cashAdvanceFeePct) || 2.5)) / 100).toFixed(0)}{' '}
                    {currency}
                  </div>
                )}
              </div>
            )}

            <span className="text-[10px] text-slate-500 block">
              Physical Hand Cash does not accrue interest. Track withdrawals and spend directly.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-400">
                  Fixed Return Rate (% p.a.)
                </label>
                <button
                  type="button"
                  onClick={() => setFixedRatePct('0')}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold cursor-pointer transition-colors"
                  title="Asset with 0% return (e.g. Lent money to a friend to return later)"
                >
                  0% (Friend Loan / 0% Return)
                </button>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 0 for Friend, 7.1 for FD, 9.5 for Bonds"
                value={fixedRatePct}
                onChange={(e) => setFixedRatePct(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-500">
                0% or positive. E.g. 0% for money lent to friend, 7.1% for FD
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Expected Market Return (% p.a.)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 12.0 (Informational)"
                value={expectedRatePct}
                onChange={(e) => setExpectedRatePct(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-500">Informational only; 0 in strict calculation</span>
            </div>
          </div>
        )}

        {/* Market Capitalization Category & Gain Tracking for Stocks/Equities */}
        {isEquityAsset && (
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400">
              <TrendingUp size={14} />
              <span>Stock Market Capitalization & Performance</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Market Cap Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'mega_cap', label: 'Mega Cap', desc: '₹2L+ Cr / Bluechip Giants' },
                  { id: 'large_cap', label: 'Large Cap', desc: '₹50K - ₹2L Cr / Leaders' },
                  { id: 'mid_cap', label: 'Mid Cap', desc: '₹15K - ₹50K Cr / High Growth' },
                  { id: 'small_cap', label: 'Small Cap', desc: '< ₹15K Cr / Emerging' },
                ].map((cap) => (
                  <button
                    key={cap.id}
                    type="button"
                    onClick={() => setMarketCapCategory(cap.id as MarketCapCategory)}
                    className={`p-2 rounded-xl border text-left cursor-pointer transition-all ${
                      marketCapCategory === cap.id
                        ? 'border-cyan-500 bg-cyan-950/30 text-white shadow-sm'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold">{cap.label}</div>
                    <div className="text-[10px] text-slate-500 line-clamp-1">{cap.desc}</div>
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                Used by the ML Investment Model to recommend optimal market cap diversification
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Realised Gain / Loss (Cumulative)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. +15000 or -4500"
                  value={realisedGainLoss}
                  onChange={(e) => setRealisedGainLoss(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono"
                />
                <span className="text-[10px] text-slate-500">Realized profits or losses booked from past sales</span>
              </div>
              {units && currentPrice && avgBuyPrice && (
                <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-center">
                  <span className="text-[10px] text-slate-400">Calculated Unrealised P&L:</span>
                  <span
                    className={`text-sm font-bold font-mono ${
                      (parseFloat(currentPrice) - parseFloat(avgBuyPrice)) >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {(parseFloat(currentPrice) - parseFloat(avgBuyPrice)) >= 0 ? '+' : ''}
                    {((parseFloat(currentPrice) - parseFloat(avgBuyPrice)) * parseFloat(units)).toFixed(2)}{' '}
                    {currency}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fixed Income & Term Deposit Lifecycle (Sweep-in, Interest Repayment, Renewal & Maturity) */}
        {isFixedIncomeAsset && (
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-emerald-500/30 space-y-3.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <Building2 size={14} />
              <span>Deposit Lifecycle, Sweep-In & Repayment Setup</span>
            </div>

            {/* Sweep-in facility */}
            {isFdAsset && (
              <div className="space-y-2 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSweepIn}
                    onChange={(e) => {
                      setIsSweepIn(e.target.checked);
                      if (e.target.checked) setLiquidityClass('Immediate');
                    }}
                    className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Zap size={14} className="text-emerald-400" />
                    Auto Sweep-In Facility (Immediately Cashable)
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 leading-relaxed pl-6">
                  Breaks automatically into savings on demand with zero penalty, adding directly to <strong className="text-emerald-400">Free Cash</strong>.
                </p>

                {isSweepIn && (
                  <div className="pl-6 pt-1 space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-300">
                      Linked Bank Account for Sweep-In Redemption:
                    </label>
                    <select
                      value={sweepInTargetAccountId || bankAccounts[0]?.id || ''}
                      onChange={(e) => setSweepInTargetAccountId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                    >
                      {bankAccounts.length > 0 ? (
                        bankAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {formatAssetOptionLabel(b, assetTypes)}
                          </option>
                        ))
                      ) : (
                        <option value="">No Bank Account Available</option>
                      )}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Interest Repayment Schedule & Linked Account */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Interest Repayment Frequency
                </label>
                <select
                  value={interestPayoutFrequency}
                  onChange={(e) => setInterestPayoutFrequency(e.target.value as InterestPayoutFrequency)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                >
                  <option value="at_maturity">Cumulative at Maturity (Compound)</option>
                  <option value="monthly">Monthly Interest Repayment</option>
                  <option value="quarterly">Quarterly Interest Repayment</option>
                  <option value="yearly">Yearly Interest Repayment</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Interest Credited To Account
                </label>
                <select
                  value={interestPayoutAccountId || bankAccounts[0]?.id || ''}
                  onChange={(e) => setInterestPayoutAccountId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                >
                  {bankAccounts.length > 0 ? (
                    bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {formatAssetOptionLabel(b, assetTypes)}
                      </option>
                    ))
                  ) : (
                    <option value="">No Bank Account Available</option>
                  )}
                </select>
              </div>
            </div>

            {/* Renewal & Maturity Settlement */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Renewal Option on Maturity
                </label>
                <select
                  value={renewalOption}
                  onChange={(e) => setRenewalOption(e.target.value as RenewalOption)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                >
                  <option value="renew_principal_and_interest">Auto-Renew Principal + Interest (Cumulative)</option>
                  <option value="renew_principal_only">Renew Principal Only (Payout Interest)</option>
                  <option value="do_not_renew">Do Not Renew (Full Payout to Bank)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Maturity Settlement Bank Account
                </label>
                <select
                  value={maturitySettlementAccountId || bankAccounts[0]?.id || ''}
                  onChange={(e) => setMaturitySettlementAccountId(e.target.value)}
                  disabled={renewalOption !== 'do_not_renew'}
                  className={`w-full bg-slate-900 border rounded-xl px-3 py-2 text-xs text-slate-100 ${
                    renewalOption === 'do_not_renew'
                      ? 'border-emerald-500/50'
                      : 'border-slate-800 opacity-60 cursor-not-allowed'
                  }`}
                >
                  {bankAccounts.length > 0 ? (
                    bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {formatAssetOptionLabel(b, assetTypes)}
                      </option>
                    ))
                  ) : (
                    <option value="">No Bank Account Available</option>
                  )}
                </select>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {renewalOption === 'do_not_renew'
                    ? 'Upon maturity, principal and interest credit here and update ledger'
                    : 'Auto-renews at maturity; interest routed per schedule'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Dates: Omit entirely for Bank Accounts and Hand Cash */}
        {typeId !== 'type-bank' && typeId !== 'type-cash-hand' && typeId !== 'type-cash' && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DatePickerField
                label={isFixedIncomeAsset ? 'Deposit Start Date' : 'Purchase / Acquisition Date'}
                required={isFixedIncomeAsset}
                value={startDate}
                onChange={(d) => {
                  setStartDate(d);
                  setError('');
                }}
                placeholder="YYYY-MM-DD or DD/MM/YYYY"
                helperText={isFixedIncomeAsset ? 'Date funds were placed in deposit' : 'Initial acquisition date'}
              />
              <DatePickerField
                label={isFixedIncomeAsset ? 'Maturity Date' : 'Maturity Date (Optional)'}
                required={isFixedIncomeAsset}
                value={maturityDate}
                onChange={(d) => {
                  setMaturityDate(d);
                  setError('');
                }}
                placeholder="YYYY-MM-DD or DD/MM/YYYY"
                helperText={isFixedIncomeAsset ? 'Date principal + interest matures' : 'Optional target termination date'}
              />
            </div>
            {isFixedIncomeAsset && (
              <p className="text-[11px] text-amber-400/90 flex items-center gap-1.5 pt-0.5">
                <AlertTriangle size={12} className="shrink-0 text-amber-400" />
                <span>Start date and maturity date are strictly required for term deposits to calculate compounding and returns.</span>
              </p>
            )}
          </div>
        )}

        {/* Risk Assessment & Security Grading (User Requested) */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <Shield size={14} className="text-emerald-400" />
              <span>Asset Risk Assessment & Capital Security</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              Hierarchy: Banks/FDs &gt; Large Cap &gt; Small Cap &gt; P2P
            </span>
          </div>

          <p className="text-[11px] text-slate-300 leading-relaxed">
            Bank accounts and FDs are slow but highly secure (zero capital loss). Stocks offer higher growth but involve market risk. Rate this asset's risk profile so the AI and ML models prioritize maximizing returns safely:
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              {
                id: 'ultra_safe',
                label: 'Ultra Safe',
                badge: 'Capital Preserved',
                desc: 'Bank accounts, FDs, Govt bonds',
              },
              {
                id: 'low_risk',
                label: 'Low Risk',
                badge: 'Large Cap / AAA',
                desc: 'Blue-chips, AAA corporate debt',
              },
              {
                id: 'moderate_risk',
                label: 'Moderate',
                badge: 'Mid Cap Equities',
                desc: 'Index funds, growth stocks',
              },
              {
                id: 'high_risk',
                label: 'High Risk',
                badge: 'Small Cap',
                desc: 'Small cap equities, volatile',
              },
              {
                id: 'speculative',
                label: 'Speculative',
                badge: 'P2P / Unsecured',
                desc: 'P2P lending, high default risk',
              },
            ].map((r) => {
              const isSelected = riskLevel === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRiskLevel(r.id as RiskAssessment)}
                  className={`p-2 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected
                      ? r.id === 'ultra_safe'
                        ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200 shadow-sm'
                        : r.id === 'low_risk'
                        ? 'border-teal-500 bg-teal-950/40 text-teal-200 shadow-sm'
                        : r.id === 'moderate_risk'
                        ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 shadow-sm'
                        : r.id === 'high_risk'
                        ? 'border-amber-500 bg-amber-950/40 text-amber-200 shadow-sm'
                        : 'border-rose-500 bg-rose-950/40 text-rose-200 shadow-sm'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className="text-xs font-bold">{r.label}</div>
                  <div className="text-[10px] font-semibold opacity-90 line-clamp-1">{r.badge}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5 line-clamp-1">{r.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Pre-warning if user chooses High Risk or Speculative per user prompt */}
          {(riskLevel === 'high_risk' || riskLevel === 'speculative') && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-1 animate-fade-in">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <span>Risk & Capital Security Warning</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-normal">
                {riskLevel === 'speculative'
                  ? 'P2P lending and speculative instruments carry severe default risk with no capital guarantee. NetWorthIQ recommends keeping core capital in Bank Accounts, FDs, and Large Cap assets.'
                  : 'Small cap equities carry high volatility and sharp drawdowns. While potential return is higher, prioritize Large Cap and Bank FDs to maximize earnings in a secure way.'}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Notes</label>
          <input
            type="text"
            placeholder="Account number, broker name, purpose..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
          />
        </div>
      </form>
    </Modal>
  );
};

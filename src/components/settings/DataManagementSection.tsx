import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  exportHoldingsToCsv,
  parseHoldingsCsv,
  exportTransactionsToCsv,
  parseTransactionsCsv,
  exportLiabilitiesToCsv,
  parseLiabilitiesCsv,
  exportBillsToCsv,
  parseBillsCsv,
  exportGoalsToCsv,
  parseGoalsCsv,
  exportIncomeStreamsToCsv,
  parseIncomeStreamsCsv,
  exportCreditScoresToCsv,
  parseCreditScoresCsv,
  exportReceivablesToCsv,
  parseReceivablesCsv,
  exportProfileAndCareerToCsv,
  parseProfileAndCareerCsv,
  exportMLStateToCsv,
  parseMLStateCsv,
  exportMasterCsv,
  parseMasterCsv,
} from '../../lib/csvHelper';
import { exportFullMLReplicationState } from '../../lib/mlEngine';
import { encryptExportData, decryptExportData } from '../../lib/crypto';
import { downloadFile, downloadMultipleFiles, copyTextToClipboard } from '../../lib/downloadHelper';
import { ExportDownloadModal } from '../common/ExportDownloadModal';
import {
  Download,
  Upload,
  Check,
  AlertTriangle,
  Lock,
  Database,
  Trash2,
  Table,
  ShieldCheck,
  Info,
  Layers,
  Copy,
} from 'lucide-react';
import {
  Holding,
  Liability,
  Transaction,
  Bill,
  Goal,
  IncomeStream,
  CreditScoreRecord,
  AppSettings,
  CareerProfile,
  FullMLReplicationState,
  Receivable,
} from '../../types';

type CsvTableTarget =
  | 'holdings'
  | 'transactions'
  | 'liabilities'
  | 'bills'
  | 'goals'
  | 'income_streams'
  | 'credit_scores'
  | 'receivables'
  | 'profile_career'
  | 'ml_state';

export const DataManagementSection: React.FC = () => {
  const {
    settings,
    assetTypes,
    holdings,
    liabilities,
    incomeStreams,
    creditScores,
    receivables,
    careerProfile,
    onlineLearnerState,
    creditPrediction,
    careerPrediction,
    predictedBills,
    rlRecommendations,
    goalLiquidPlan,
    brokerUsageForecast,
    transactions,
    bills,
    rawBills,
    goals,
    snapshots,
    addHoldingsBulk,
    addLiabilitiesBulk,
    addTransactionsBulk,
    addBillsBulk,
    restoreMasterEntities,
    wipeAllData,
    exportFullBackup,
    importFullBackup,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'json' | 'csv' | 'reset'>('json');
  const [passphrase, setPassphrase] = useState('');
  const [copiedJson, setCopiedJson] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Pre-import JSON inspector state
  const [jsonInspection, setJsonInspection] = useState<{
    fileName: string;
    rawText: string;
    isEncrypted: boolean;
    data?: any;
    summary?: {
      holdingsCount: number;
      liabilitiesCount: number;
      transactionsCount: number;
      billsCount: number;
      goalsCount: number;
      snapshotsCount: number;
      incomeStreamsCount: number;
      creditScoresCount: number;
      hasProfileAndSkills: boolean;
      hasMLReplication: boolean;
      schemaVersion: number;
      exportedAt?: string;
    };
  } | null>(null);
  const [pasteJsonMode, setPasteJsonMode] = useState(false);
  const [pastedJsonText, setPastedJsonText] = useState('');

  // CSV Import States
  const [csvTarget, setCsvTarget] = useState<CsvTableTarget>('holdings');
  const [csvImportMode, setCsvImportMode] = useState<'append' | 'replace'>('append');
  const [csvPreview, setCsvPreview] = useState<{
    fileName: string;
    target: CsvTableTarget;
    items: any[];
    settingsPartial?: Partial<AppSettings>;
    careerProfileParsed?: CareerProfile;
    mlBundleParsed?: FullMLReplicationState;
    errors: string[];
  } | null>(null);

  // Combined Export File States
  const [masterPreview, setMasterPreview] = useState<{
    fileName: string;
    holdings: Holding[];
    liabilities: Liability[];
    transactions: Transaction[];
    bills: Bill[];
    goals: Goal[];
    incomeStreams: IncomeStream[];
    creditScores: CreditScoreRecord[];
    receivables: Receivable[];
    settingsPartial?: Partial<AppSettings>;
    careerProfile?: CareerProfile;
    mlBundle?: FullMLReplicationState;
    errors: string[];
  } | null>(null);

  // Export preview & download modal
  const [exportModal, setExportModal] = useState<{
    isOpen: boolean;
    title: string;
    filename: string;
    content: string;
    mimeType: string;
  } | null>(null);
  const [masterImportMode, setMasterImportMode] = useState<'append' | 'replace'>('replace');

  // Wipe confirmation modal state
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [showWipeDialog, setShowWipeDialog] = useState(false);

  const getLiveMLBundle = (): FullMLReplicationState =>
    exportFullMLReplicationState({
      creditPrediction,
      careerPrediction,
      predictedBills,
      rlRecommendations,
      goalLiquidPlan,
      brokerUsageForecast,
    });

  const showStatus = (type: 'success' | 'error' | 'info', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
  };

  // Direct Copy JSON Handler
  const handleCopyJson = async () => {
    const rawJson = exportFullBackup();
    if (passphrase.trim()) {
      try {
        const cipher = await encryptExportData(rawJson, passphrase);
        const ok = await copyTextToClipboard(cipher);
        if (ok) {
          setCopiedJson(true);
          setTimeout(() => setCopiedJson(false), 2500);
          showStatus('success', 'Encrypted JSON copied to clipboard.');
        } else {
          setExportModal({
            isOpen: true,
            title: 'Encrypted Backup (JSON)',
            filename: `networthiq_vault_encrypted_${new Date().toISOString().split('T')[0]}.json`,
            content: cipher,
            mimeType: 'application/json',
          });
        }
      } catch {
        showStatus('error', 'Encryption failed. Check your passphrase.');
      }
      return;
    }

    const ok = await copyTextToClipboard(rawJson);
    if (ok) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2500);
      showStatus('success', 'JSON backup copied to clipboard.');
    } else {
      setExportModal({
        isOpen: true,
        title: 'Vault Backup (JSON)',
        filename: `networthiq_vault_${new Date().toISOString().split('T')[0]}.json`,
        content: rawJson,
        mimeType: 'application/json',
      });
    }
  };

  // 1. JSON Export Handler
  const handleExportJson = async (encrypt: boolean) => {
    const rawJson = exportFullBackup();
    const today = new Date().toISOString().split('T')[0];

    if (encrypt) {
      if (!passphrase.trim()) {
        showStatus('error', 'Enter a passphrase to export an encrypted JSON file.');
        return;
      }
      try {
        const cipher = await encryptExportData(rawJson, passphrase);
        const filename = `networthiq_vault_encrypted_${today}.json`;
        await downloadFile(filename, cipher, 'application/json');
        setExportModal({
          isOpen: true,
          title: 'Encrypted Backup (JSON)',
          filename,
          content: cipher,
          mimeType: 'application/json',
        });
        showStatus('success', 'Encrypted JSON export ready.');
      } catch {
        showStatus('error', 'Encryption failed. Check your passphrase.');
      }
    } else {
      const filename = `networthiq_vault_${today}.json`;
      await downloadFile(filename, rawJson, 'application/json');
      setExportModal({
        isOpen: true,
        title: 'Vault Backup (JSON)',
        filename,
        content: rawJson,
        mimeType: 'application/json',
      });
      showStatus('success', 'JSON backup ready.');
    }
  };

  const inspectJsonText = (text: string, sourceLabel: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      showStatus('error', 'JSON content is empty.');
      return;
    }
    const isEncrypted = trimmed.includes('"salt"') && trimmed.includes('"iv"') && trimmed.includes('"data"');
    if (isEncrypted) {
      setJsonInspection({
        fileName: sourceLabel,
        rawText: trimmed,
        isEncrypted: true,
      });
      setPasteJsonMode(false);
    } else {
      try {
        const parsed = JSON.parse(trimmed);
        setJsonInspection({
          fileName: sourceLabel,
          rawText: trimmed,
          isEncrypted: false,
          data: parsed,
          summary: {
            holdingsCount: parsed.holdings?.length || 0,
            liabilitiesCount: parsed.liabilities?.length || 0,
            transactionsCount: parsed.transactions?.length || 0,
            billsCount: parsed.bills?.length || 0,
            goalsCount: parsed.goals?.length || 0,
            snapshotsCount: parsed.snapshots?.length || 0,
            incomeStreamsCount: parsed.incomeStreams?.length || 0,
            creditScoresCount: parsed.creditScores?.length || 0,
            hasProfileAndSkills: Boolean(parsed.careerProfile || parsed.mlReplicationState?.careerProfile),
            hasMLReplication: Boolean(parsed.mlReplicationState || parsed.onlineLearnerState || parsed.careerModelWeights),
            schemaVersion: typeof parsed.version === 'number' ? parsed.version : 1,
            exportedAt: parsed.exportedAt,
          },
        });
        setPasteJsonMode(false);
      } catch {
        showStatus('error', 'Provided content is not valid JSON.');
      }
    }
  };

  // JSON File Picker & Pre-Inspection
  const handleJsonFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = (event.target?.result as string) || '';
      inspectJsonText(text, file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Decrypt inspected file if needed
  const handleDecryptInspectedJson = async () => {
    if (!jsonInspection?.rawText || !passphrase.trim()) {
      showStatus('error', 'Enter your encryption passphrase.');
      return;
    }
    try {
      const decryptedText = await decryptExportData(jsonInspection.rawText, passphrase);
      const parsed = JSON.parse(decryptedText);
      setJsonInspection({
        fileName: jsonInspection.fileName,
        rawText: decryptedText,
        isEncrypted: false,
        data: parsed,
        summary: {
          holdingsCount: parsed.holdings?.length || 0,
          liabilitiesCount: parsed.liabilities?.length || 0,
          transactionsCount: parsed.transactions?.length || 0,
          billsCount: parsed.bills?.length || 0,
          goalsCount: parsed.goals?.length || 0,
          snapshotsCount: parsed.snapshots?.length || 0,
          incomeStreamsCount: parsed.incomeStreams?.length || 0,
          creditScoresCount: parsed.creditScores?.length || 0,
          hasProfileAndSkills: Boolean(parsed.careerProfile || parsed.mlReplicationState?.careerProfile),
          hasMLReplication: Boolean(parsed.mlReplicationState || parsed.onlineLearnerState || parsed.careerModelWeights),
          schemaVersion: typeof parsed.version === 'number' ? parsed.version : 1,
          exportedAt: parsed.exportedAt,
        },
      });
      showStatus('success', 'Backup decrypted. Review summary to restore.');
    } catch {
      showStatus('error', 'Decryption failed: incorrect passphrase or invalid file.');
    }
  };

  // Confirm and Execute JSON Restore
  const handleConfirmJsonRestore = async () => {
    if (!jsonInspection?.rawText) return;
    try {
      const ok = await importFullBackup(jsonInspection.rawText);
      if (ok) {
        showStatus('success', 'Complete backup (accounts, ledger, profile, skills, and ML state) restored.');
        setJsonInspection(null);
        setPastedJsonText('');
      } else {
        showStatus('error', 'Failed to restore backup structure.');
      }
    } catch {
      showStatus('error', 'An error occurred during restore.');
    }
  };

  // 2. CSV Exports & Combined Export File (Lossless Full Replication)
  const handleExportCsv = (
    type:
      | 'holdings'
      | 'transactions'
      | 'liabilities'
      | 'bills'
      | 'goals'
      | 'income_streams'
      | 'credit_scores'
      | 'receivables'
      | 'profile_career'
      | 'ml_state'
      | 'all'
      | 'master'
  ) => {
    const today = new Date().toISOString().split('T')[0];
    const mlBundle = getLiveMLBundle();

    if (type === 'master') {
      const content = exportMasterCsv(
        holdings,
        assetTypes,
        liabilities,
        transactions,
        rawBills || bills,
        goals,
        {
          incomeStreams,
          creditScores,
          receivables,
          settings,
          careerProfile,
          mlBundle,
        }
      );
      const filename = `networthiq_combined_${today}.txt`;
      downloadFile(filename, content, 'text/plain');
      setExportModal({
        isOpen: true,
        title: 'Combined Export (All 10 Tables + ML State)',
        filename,
        content,
        mimeType: 'text/plain',
      });
      showStatus('success', 'Combined replication export ready.');
      return;
    }

    if (type === 'all') {
      const files = [
        { filename: `networthiq_holdings_${today}.csv`, content: exportHoldingsToCsv(holdings, assetTypes), mimeType: 'text/csv' },
        { filename: `networthiq_transactions_${today}.csv`, content: exportTransactionsToCsv(transactions, holdings, liabilities), mimeType: 'text/csv' },
        { filename: `networthiq_liabilities_${today}.csv`, content: exportLiabilitiesToCsv(liabilities), mimeType: 'text/csv' },
        { filename: `networthiq_bills_${today}.csv`, content: exportBillsToCsv(rawBills || bills, holdings, liabilities), mimeType: 'text/csv' },
        { filename: `networthiq_goals_${today}.csv`, content: exportGoalsToCsv(goals, holdings), mimeType: 'text/csv' },
        { filename: `networthiq_income_streams_${today}.csv`, content: exportIncomeStreamsToCsv(incomeStreams), mimeType: 'text/csv' },
        { filename: `networthiq_credit_scores_${today}.csv`, content: exportCreditScoresToCsv(creditScores), mimeType: 'text/csv' },
        { filename: `networthiq_receivables_${today}.csv`, content: exportReceivablesToCsv(receivables), mimeType: 'text/csv' },
        { filename: `networthiq_profile_career_${today}.csv`, content: exportProfileAndCareerToCsv(settings, careerProfile), mimeType: 'text/csv' },
        { filename: `networthiq_ml_models_state_${today}.csv`, content: exportMLStateToCsv(mlBundle), mimeType: 'text/csv' },
      ];
      downloadMultipleFiles(files, 350);

      const masterContent = exportMasterCsv(
        holdings,
        assetTypes,
        liabilities,
        transactions,
        rawBills || bills,
        goals,
        {
          incomeStreams,
          creditScores,
          receivables,
          settings,
          careerProfile,
          mlBundle,
        }
      );
      setExportModal({
        isOpen: true,
        title: 'All CSV Tables + ML Replication Export',
        filename: `networthiq_all_tables_${today}.txt`,
        content: masterContent,
        mimeType: 'text/plain',
      });
      showStatus('success', 'Downloading all 10 CSV replication tables.');
      return;
    }

    let csv = '';
    let filename = '';
    let title = '';

    if (type === 'holdings') {
      csv = exportHoldingsToCsv(holdings, assetTypes);
      filename = `networthiq_holdings_${today}.csv`;
      title = 'Assets & Holdings (CSV)';
    } else if (type === 'transactions') {
      csv = exportTransactionsToCsv(transactions, holdings, liabilities);
      filename = `networthiq_transactions_${today}.csv`;
      title = 'Transactions (CSV)';
    } else if (type === 'liabilities') {
      csv = exportLiabilitiesToCsv(liabilities);
      filename = `networthiq_liabilities_${today}.csv`;
      title = 'Liabilities & Cards (CSV)';
    } else if (type === 'bills') {
      csv = exportBillsToCsv(rawBills || bills, holdings, liabilities);
      filename = `networthiq_bills_${today}.csv`;
      title = 'Recurring Bills (CSV)';
    } else if (type === 'goals') {
      csv = exportGoalsToCsv(goals, holdings);
      filename = `networthiq_goals_${today}.csv`;
      title = 'Goals (CSV)';
    } else if (type === 'income_streams') {
      csv = exportIncomeStreamsToCsv(incomeStreams);
      filename = `networthiq_income_streams_${today}.csv`;
      title = 'Income & Salary Streams (CSV)';
    } else if (type === 'credit_scores') {
      csv = exportCreditScoresToCsv(creditScores);
      filename = `networthiq_credit_scores_${today}.csv`;
      title = 'Credit Scores (CSV)';
    } else if (type === 'receivables') {
      csv = exportReceivablesToCsv(receivables);
      filename = `networthiq_receivables_${today}.csv`;
      title = 'Receivables & Loans Given (CSV)';
    } else if (type === 'profile_career') {
      csv = exportProfileAndCareerToCsv(settings, careerProfile);
      filename = `networthiq_profile_career_${today}.csv`;
      title = 'Profile, Age, Skills & Career (CSV)';
    } else if (type === 'ml_state') {
      csv = exportMLStateToCsv(mlBundle);
      filename = `networthiq_ml_models_state_${today}.csv`;
      title = 'ML Models & Half-Predictions (CSV)';
    }

    downloadFile(filename, csv, 'text/csv');
    setExportModal({
      isOpen: true,
      title,
      filename,
      content: csv,
      mimeType: 'text/csv',
    });
    showStatus('success', `${title} export ready.`);
  };

  // Combined File Pick & Parse
  const handleMasterFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseMasterCsv(text, assetTypes, holdings, liabilities, settings.baseCurrency);
      setMasterPreview({
        fileName: file.name,
        holdings: parsed.holdings,
        liabilities: parsed.liabilities,
        transactions: parsed.transactions,
        bills: parsed.bills,
        goals: parsed.goals,
        incomeStreams: parsed.incomeStreams,
        creditScores: parsed.creditScores,
        receivables: parsed.receivables,
        settingsPartial: parsed.settingsPartial,
        careerProfile: parsed.careerProfile,
        mlBundle: parsed.mlBundle,
        errors: parsed.errors,
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Confirm and Execute Combined File Import
  const handleConfirmMasterImport = async () => {
    if (!masterPreview) return;
    try {
      await restoreMasterEntities(
        {
          holdings: masterPreview.holdings,
          liabilities: masterPreview.liabilities,
          transactions: masterPreview.transactions,
          bills: masterPreview.bills,
          goals: masterPreview.goals,
          incomeStreams: masterPreview.incomeStreams,
          creditScores: masterPreview.creditScores,
          receivables: masterPreview.receivables,
          settingsPartial: masterPreview.settingsPartial,
          careerProfile: masterPreview.careerProfile,
          mlBundle: masterPreview.mlBundle,
        },
        masterImportMode
      );
      showStatus(
        'success',
        `Imported ${masterPreview.holdings.length} assets, ${masterPreview.liabilities.length} liabilities, ${masterPreview.transactions.length} transactions, ${masterPreview.receivables.length} receivables, ${masterPreview.incomeStreams.length} salary streams, ${masterPreview.creditScores.length} credit scores${masterPreview.mlBundle ? ', and ML weights/half-predictions' : ''}.`
      );
      setMasterPreview(null);
    } catch {
      showStatus('error', 'Failed to import records from file.');
    }
  };

  // CSV Import File Pick & Parse
  const handleCsvFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;

      if (csvTarget === 'holdings') {
        const { items, errors } = parseHoldingsCsv(text, assetTypes, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'holdings', items, errors });
      } else if (csvTarget === 'transactions') {
        const { items, errors } = parseTransactionsCsv(text, holdings, liabilities, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'transactions', items, errors });
      } else if (csvTarget === 'liabilities') {
        const { items, errors } = parseLiabilitiesCsv(text, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'liabilities', items, errors });
      } else if (csvTarget === 'bills') {
        const { items, errors } = parseBillsCsv(text, holdings, liabilities, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'bills', items, errors });
      } else if (csvTarget === 'goals') {
        const { items, errors } = parseGoalsCsv(text, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'goals', items, errors });
      } else if (csvTarget === 'income_streams') {
        const { items, errors } = parseIncomeStreamsCsv(text, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'income_streams', items, errors });
      } else if (csvTarget === 'credit_scores') {
        const { items, errors } = parseCreditScoresCsv(text);
        setCsvPreview({ fileName: file.name, target: 'credit_scores', items, errors });
      } else if (csvTarget === 'receivables') {
        const { items, errors } = parseReceivablesCsv(text, settings.baseCurrency);
        setCsvPreview({ fileName: file.name, target: 'receivables', items, errors });
      } else if (csvTarget === 'profile_career') {
        const { settingsPartial, careerProfile: cp, errors } = parseProfileAndCareerCsv(text);
        setCsvPreview({
          fileName: file.name,
          target: 'profile_career',
          items: [
            {
              name: cp?.currentRole || settingsPartial?.profileName || 'Career & Profile',
              amount: `${cp?.yearsOfExperience ?? 0}y exp${cp?.age ? ` · Age ${cp.age}` : ''}`,
              currency: settingsPartial?.baseCurrency || settings.baseCurrency,
            },
          ],
          settingsPartial,
          careerProfileParsed: cp,
          errors,
        });
      } else if (csvTarget === 'ml_state') {
        const { mlBundle, errors } = parseMLStateCsv(text);
        setCsvPreview({
          fileName: file.name,
          target: 'ml_state',
          items: [
            {
              name: 'ML Weights, Biases & Half-Predictions',
              amount: `${mlBundle?.onlineSpendIncomeState?.totalOnlineUpdates ?? 0} updates`,
              currency: settings.baseCurrency,
            },
          ],
          mlBundleParsed: mlBundle,
          errors,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Confirm CSV Import into Store
  const handleConfirmCsvImport = async () => {
    if (!csvPreview || csvPreview.items.length === 0) return;

    try {
      if (csvPreview.target === 'holdings') {
        await addHoldingsBulk(csvPreview.items as Holding[], csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} assets.`);
      } else if (csvPreview.target === 'transactions') {
        if (csvImportMode === 'replace') {
          await restoreMasterEntities({ transactions: csvPreview.items as Transaction[] }, 'replace');
        } else {
          await addTransactionsBulk(csvPreview.items as Transaction[]);
        }
        showStatus('success', `Imported ${csvPreview.items.length} transactions.`);
      } else if (csvPreview.target === 'liabilities') {
        await addLiabilitiesBulk(csvPreview.items as Liability[], csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} liabilities.`);
      } else if (csvPreview.target === 'bills') {
        await addBillsBulk(csvPreview.items as Bill[], csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} recurring bills.`);
      } else if (csvPreview.target === 'goals') {
        await restoreMasterEntities({ goals: csvPreview.items as Goal[] }, csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} goals.`);
      } else if (csvPreview.target === 'income_streams') {
        await restoreMasterEntities({ incomeStreams: csvPreview.items as IncomeStream[] }, csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} salary/income streams.`);
      } else if (csvPreview.target === 'credit_scores') {
        await restoreMasterEntities({ creditScores: csvPreview.items as CreditScoreRecord[] }, csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} credit score records.`);
      } else if (csvPreview.target === 'receivables') {
        await restoreMasterEntities({ receivables: csvPreview.items as Receivable[] }, csvImportMode);
        showStatus('success', `Imported ${csvPreview.items.length} receivables / personal loans.`);
      } else if (csvPreview.target === 'profile_career') {
        await restoreMasterEntities(
          {
            settingsPartial: csvPreview.settingsPartial,
            careerProfile: csvPreview.careerProfileParsed,
          },
          'replace'
        );
        showStatus('success', 'Restored user profile, age, decimal experience, skills, and salary history.');
      } else if (csvPreview.target === 'ml_state' && csvPreview.mlBundleParsed) {
        await restoreMasterEntities({ mlBundle: csvPreview.mlBundleParsed }, 'replace');
        showStatus('success', 'Restored ML weights, biases, and half-predictions.');
      }
      setCsvPreview(null);
    } catch {
      showStatus('error', 'Failed to import CSV data.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Database size={18} className="text-emerald-400" />
          <h3 className="text-base font-bold text-white tracking-tight">
            Data Management
          </h3>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          Export, copy, or restore your financial records in JSON and CSV formats.
        </p>
      </div>

      {/* Status Banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-fade-in ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : statusMessage.type === 'error'
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <Check size={16} />
          ) : statusMessage.type === 'error' ? (
            <AlertTriangle size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Sub Navigation */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('json')}
          className={`px-3.5 py-1.5 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'json'
              ? 'bg-slate-800 text-emerald-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database size={13} />
          <span>JSON Backup</span>
        </button>

        <button
          onClick={() => setActiveTab('csv')}
          className={`px-3.5 py-1.5 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'csv'
              ? 'bg-slate-800 text-cyan-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Table size={13} />
          <span>CSV Tables</span>
        </button>

        <button
          onClick={() => setActiveTab('reset')}
          className={`px-3.5 py-1.5 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
            activeTab === 'reset'
              ? 'bg-slate-800 text-rose-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Trash2 size={13} />
          <span>Reset</span>
        </button>
      </div>

      {/* 1. JSON BACKUP & RESTORE */}
      {activeTab === 'json' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
            <div>
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Holdings</span>
              <div className="text-base font-bold text-white font-mono mt-0.5">{holdings.length}</div>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Liabilities</span>
              <div className="text-base font-bold text-rose-400 font-mono mt-0.5">{liabilities.length}</div>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Transactions</span>
              <div className="text-base font-bold text-cyan-400 font-mono mt-0.5">{transactions.length}</div>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Snapshots</span>
              <div className="text-base font-bold text-amber-400 font-mono mt-0.5">{snapshots.length}</div>
            </div>
          </div>

          {/* Optional Passphrase Field */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Lock size={14} className="text-emerald-400" />
              <span>Encryption Passphrase (Optional)</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Set a passphrase to encrypt your backup, or leave blank for plain JSON.
            </p>
            <input
              type="password"
              placeholder="Enter passphrase (optional)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Export Card */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Download size={16} className="text-emerald-400" />
                  <h4 className="text-sm font-semibold text-white">Export Backup (JSON)</h4>
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Download or copy a complete archive of your settings, accounts, cards, loans, goals, and ledger history.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleExportJson(false)}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Download size={13} />
                  <span>Plain JSON</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    copiedJson
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700'
                  }`}
                >
                  {copiedJson ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedJson ? 'Copied' : 'Copy JSON'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportJson(true)}
                  className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                >
                  <Lock size={13} />
                  <span>Encrypted</span>
                </button>
              </div>
            </div>

            {/* Restore Card */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-cyan-400" />
                  <h4 className="text-sm font-semibold text-white">Restore Backup (JSON)</h4>
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Select a JSON backup file or paste copied JSON text to inspect and restore your data.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <label className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                  <Upload size={13} className="text-cyan-400" />
                  <span>Select File</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleJsonFilePick}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setPasteJsonMode((prev) => !prev)}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Copy size={13} className="text-cyan-400" />
                  <span>Paste JSON</span>
                </button>
              </div>
            </div>
          </div>

          {/* Paste JSON Box */}
          {pasteJsonMode && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">Paste JSON Backup</span>
                <button
                  type="button"
                  onClick={() => {
                    setPasteJsonMode(false);
                    setPastedJsonText('');
                  }}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <textarea
                value={pastedJsonText}
                onChange={(e) => setPastedJsonText(e.target.value)}
                rows={5}
                placeholder="Paste exported JSON here..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => inspectJsonText(pastedJsonText, 'Pasted JSON')}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                >
                  Inspect Backup
                </button>
              </div>
            </div>
          )}

          {/* Pre-Import Inspection */}
          {jsonInspection && (
            <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={17} className="text-emerald-400" />
                  <span className="text-sm font-semibold text-white">Backup Summary</span>
                </div>
                <button
                  onClick={() => setJsonInspection(null)}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>
                  Source: <strong className="font-mono text-emerald-400">{jsonInspection.fileName}</strong>
                </span>
                {jsonInspection.summary && (
                  <span className="font-mono text-[11px] text-slate-400">
                    Schema v{jsonInspection.summary.schemaVersion}
                  </span>
                )}
              </div>

              {jsonInspection.isEncrypted ? (
                <div className="space-y-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-xs text-amber-300 font-semibold flex items-center gap-1.5">
                    <Lock size={14} /> Password-encrypted backup
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Enter the passphrase used during export to unlock and inspect.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="Enter passphrase"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
                    />
                    <button
                      onClick={handleDecryptInspectedJson}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      Unlock
                    </button>
                  </div>
                </div>
              ) : jsonInspection.summary ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-emerald-400">
                        {jsonInspection.summary.holdingsCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Holdings</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-rose-400">
                        {jsonInspection.summary.liabilitiesCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Liabilities</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-cyan-400">
                        {jsonInspection.summary.transactionsCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Transactions</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-amber-400">
                        {jsonInspection.summary.billsCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Bills</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-indigo-400">
                        {jsonInspection.summary.goalsCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Goals</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-emerald-300">
                        {jsonInspection.summary.incomeStreamsCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Salary Streams</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-cyan-300">
                        {jsonInspection.summary.creditScoresCount}
                      </div>
                      <div className="text-[10px] text-slate-400">Credit Scores</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-purple-300">
                        {jsonInspection.summary.hasMLReplication ? 'Included' : 'Baseline'}
                      </div>
                      <div className="text-[10px] text-slate-400">Skills &amp; ML State</div>
                    </div>
                  </div>

                  {jsonInspection.summary.exportedAt && (
                    <div className="text-[11px] text-slate-400">
                      Exported: <span className="font-mono text-slate-200">{jsonInspection.summary.exportedAt}</span>
                    </div>
                  )}

                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                    <AlertTriangle size={15} className="shrink-0" />
                    <span>Restoring will replace current records, career profile, and ML weights with this archive.</span>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setJsonInspection(null)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmJsonRestore}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check size={14} /> Confirm Restore
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* 2. CSV TABLES EXPORT & IMPORT */}
      {activeTab === 'csv' && (
        <div className="space-y-4">
          {/* Combined File */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-sm">
                  <Layers size={15} className="text-indigo-400" />
                  <span>Combined Replication Export File</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                  Exports all 9 tables together: Holdings, Liabilities, Transactions, Bills, Goals, Salary Streams, Credit Scores, Profile (Age, Experience, Skills, Career History), and ML Weights &amp; Half-Predictions.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleExportCsv('master')}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Download size={14} /> Export Combined File
              </button>
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Upload size={14} className="text-indigo-400" />
                  Import Combined File
                </span>

                <label className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
                  <Upload size={13} />
                  <span>Choose File</span>
                  <input
                    type="file"
                    accept=".txt,.csv"
                    onChange={handleMasterFilePick}
                    className="hidden"
                  />
                </label>
              </div>

              {masterPreview && (
                <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 font-mono">
                      {masterPreview.fileName}
                    </span>
                    <button
                      onClick={() => setMasterPreview(null)}
                      className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-emerald-400">
                        {masterPreview.holdings.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Assets</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-rose-400">
                        {masterPreview.liabilities.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Liabilities</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-cyan-400">
                        {masterPreview.transactions.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Transactions</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-amber-400">
                        {masterPreview.bills.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Bills</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-violet-400">
                        {masterPreview.goals.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Goals</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-emerald-300">
                        {masterPreview.incomeStreams.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Salary Streams</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-cyan-300">
                        {masterPreview.creditScores.length}
                      </div>
                      <div className="text-[10px] text-slate-400">Credit Scores</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-mono font-bold text-purple-300">
                        {masterPreview.mlBundle || masterPreview.careerProfile ? 'Yes' : 'No'}
                      </div>
                      <div className="text-[10px] text-slate-400">Profile &amp; ML</div>
                    </div>
                  </div>

                  {masterPreview.errors.length > 0 && (
                    <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] space-y-1">
                      <div className="font-semibold">Warnings:</div>
                      {masterPreview.errors.slice(0, 3).map((err, i) => (
                        <div key={i}>• {err}</div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-3 text-xs">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="masterMode"
                          checked={masterImportMode === 'replace'}
                          onChange={() => setMasterImportMode('replace')}
                          className="text-indigo-600 bg-slate-900 border-slate-700"
                        />
                        <span className="text-slate-300">Exact Replicate (Replace)</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="masterMode"
                          checked={masterImportMode === 'append'}
                          onChange={() => setMasterImportMode('append')}
                          className="text-indigo-600 bg-slate-900 border-slate-700"
                        />
                        <span className="text-slate-300">Append</span>
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={handleConfirmMasterImport}
                      className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check size={14} /> Confirm Import
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Individual CSV Exports */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <Download size={15} className="text-cyan-400" />
                  <span>Individual CSV Tables (All 9 Domains)</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Every table includes full IDs, links, profile parameters, and ML model states so your exact setup can be replicated.
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleExportCsv('all')}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={13} /> Download All 9 CSVs
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => handleExportCsv('holdings')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-emerald-400 block">Assets</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{holdings.length} records</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('transactions')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-cyan-400 block">Transactions</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{transactions.length} records</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('liabilities')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-rose-400 block">Liabilities</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{liabilities.length} records</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('bills')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-amber-400 block">Bills</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{bills.length} records</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('goals')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-violet-400 block">Goals</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{goals.length} records</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('income_streams')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-emerald-300 block">Salary &amp; Income</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{incomeStreams.length} streams</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('credit_scores')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-cyan-300 block">Credit Scores</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{creditScores.length} logs</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('receivables')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-teal-300 block">Receivables</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">{receivables.length} loans given</span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('profile_career')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-indigo-300 block">Profile &amp; Skills</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {careerProfile.yearsOfExperience ?? 0}y exp · {careerProfile.technicalSkills?.length || 0} skills
                </span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv('ml_state')}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left cursor-pointer transition-all"
              >
                <span className="text-xs font-semibold text-purple-300 block">ML Models &amp; Half-Predictions</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Weights, biases &amp; reality audit ({onlineLearnerState.totalOnlineUpdates} updates)
                </span>
                <span className="text-[11px] font-medium text-slate-300 mt-2 flex items-center gap-1">
                  <Download size={11} /> Export CSV
                </span>
              </button>
            </div>
          </div>

          {/* CSV Import */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3.5">
            <div>
              <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Upload size={15} className="text-emerald-400" />
                <span>Import CSV Table</span>
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Select target table, choose a CSV file, and review parsed rows before importing.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Target Table
                </label>
                <select
                  value={csvTarget}
                  onChange={(e) => {
                    setCsvTarget(e.target.value as CsvTableTarget);
                    setCsvPreview(null);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                >
                  <option value="holdings">Assets &amp; Holdings</option>
                  <option value="transactions">Transactions</option>
                  <option value="liabilities">Liabilities &amp; Cards</option>
                  <option value="bills">Recurring Bills</option>
                  <option value="goals">Goals</option>
                  <option value="income_streams">Salary &amp; Income Streams</option>
                  <option value="credit_scores">Credit Scores</option>
                  <option value="receivables">Receivables &amp; Loans Given</option>
                  <option value="profile_career">Profile, Age, Skills &amp; Career</option>
                  <option value="ml_state">ML Models &amp; Half-Predictions</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Import Mode
                </label>
                <select
                  value={csvImportMode}
                  onChange={(e) => setCsvImportMode(e.target.value as 'append' | 'replace')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                >
                  <option value="append">Append to existing records</option>
                  <option value="replace">Replace existing {csvTarget}</option>
                </select>
              </div>
            </div>

            <div className="pt-1">
              <label className="w-full py-3 px-4 rounded-xl border border-dashed border-slate-700 hover:border-emerald-500 bg-slate-950/60 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors">
                <Upload size={15} className="text-emerald-400" />
                <span>Choose CSV File</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFilePick}
                  className="hidden"
                />
              </label>
            </div>

            {csvPreview && (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3 animate-fade-in">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-white">{csvPreview.fileName}</span>
                    <span className="text-slate-400 ml-2">
                      ({csvPreview.items.length} rows
                      {csvPreview.errors.length > 0 ? `, ${csvPreview.errors.length} warnings` : ''})
                    </span>
                  </div>
                  <button
                    onClick={() => setCsvPreview(null)}
                    className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>

                {csvPreview.errors.length > 0 && (
                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] max-h-24 overflow-y-auto space-y-0.5">
                    {csvPreview.errors.slice(0, 5).map((err, idx) => (
                      <div key={idx}>• {err}</div>
                    ))}
                    {csvPreview.errors.length > 5 && (
                      <div className="font-semibold">+ {csvPreview.errors.length - 5} more warnings</div>
                    )}
                  </div>
                )}

                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-lg">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900 text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-2">Name / Description</th>
                        <th className="p-2">Amount</th>
                        <th className="p-2">Currency</th>
                        <th className="p-2 font-sans">Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {csvPreview.items.slice(0, 10).map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="p-2 font-sans font-medium text-slate-200">
                            {item.name || item.reason || 'Record'}
                          </td>
                          <td className="p-2 text-emerald-400">
                            {item.amount ?? item.principalOrValue ?? item.outstanding ?? '-'}
                          </td>
                          <td className="p-2 text-slate-300">{item.currency || settings.baseCurrency}</td>
                          <td className="p-2 font-sans text-slate-400">{csvImportMode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setCsvPreview(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmCsvImport}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check size={14} /> Import ({csvPreview.items.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. RESET LOCAL DATA */}
      {activeTab === 'reset' && (
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <h4 className="text-sm font-semibold text-white">
            Reset Local Data
          </h4>

          <div className="max-w-md p-4 rounded-xl bg-slate-950/60 border border-rose-500/30 space-y-3">
            <div>
              <div className="text-xs font-semibold text-rose-400 flex items-center gap-1.5">
                <Trash2 size={14} />
                <span>Clear All Records</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Removes all saved holdings, cards, loans, income streams, and transactions from this device. Export or copy a JSON backup beforehand if you want to retain your data.
              </p>
            </div>

            <button
              onClick={() => setShowWipeDialog(true)}
              className="w-full py-2.5 rounded-xl bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600/30 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer mt-2 transition-colors"
            >
              <Trash2 size={13} /> Clear Vault Data
            </button>
          </div>
        </div>
      )}

      {/* Wipe Confirmation Dialog */}
      {showWipeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-rose-500/50 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-rose-400">
              <AlertTriangle size={20} />
              <h4 className="text-base font-bold text-white">Confirm Data Reset</h4>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This permanently deletes all {holdings.length} assets, {liabilities.length} liabilities, and{' '}
              {transactions.length} transactions from this device.
            </p>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Type <strong className="text-rose-400 font-mono">WIPE</strong> to confirm:
              </label>
              <input
                type="text"
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
                placeholder="WIPE"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => {
                  setShowWipeDialog(false);
                  setWipeConfirmText('');
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={wipeConfirmText !== 'WIPE'}
                onClick={async () => {
                  await wipeAllData();
                  setShowWipeDialog(false);
                  setWipeConfirmText('');
                  showStatus('info', 'All local data cleared.');
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Download & Copy Preview Modal (Previously missing from JSX!) */}
      {exportModal && (
        <ExportDownloadModal
          isOpen={exportModal.isOpen}
          onClose={() => setExportModal(null)}
          title={exportModal.title}
          filename={exportModal.filename}
          content={exportModal.content}
          mimeType={exportModal.mimeType}
        />
      )}
    </div>
  );
};

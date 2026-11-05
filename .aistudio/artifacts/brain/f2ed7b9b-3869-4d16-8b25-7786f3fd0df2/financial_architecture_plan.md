# NetWorthIQ Financial Systems Architecture & Implementation Plan

## Architectural Overview
NetWorthIQ is an offline-first, privacy-preserving personal net worth and liquidity intelligence platform built with React 19, TypeScript, Tailwind CSS 4, and IndexedDB storage.

---

## Phase Execution Roadmap

### Phase 1: Repository Audit & Baseline Architecture
- State management: `src/context/AppContext.tsx` orchestrates IndexedDB (`src/lib/storage.ts`) and calculation engines (`calcEngine.ts`, `taxEngine.ts`, `mlEngine.ts`, `assetRules.ts`).
- Storage stores: 19 object stores in IndexedDB with local storage fallback.
- Export/Import: Version 3 JSON format with optional passphrase-based AES-GCM encryption.

### Phase 2 & Phase 8: Financial Data Integrity & Provenance
- Create `src/lib/financialMath.ts`:
  - Decimal-safe floating-point rounding (`roundCurrency`, `safeAdd`, `safeSub`, `safeMul`, `safeDiv`) to prevent IEEE 754 precision bleed (e.g. `0.1 + 0.2 !== 0.3`).
  - Strict validation of currency codes, positive/non-negative amounts, date strings, and percentages.
  - Transfer and card repayment double-counting guards.
- Implement Data Provenance in `src/types/index.ts`:
  - Provenance tags: `'user_entered' | 'imported' | 'calculated' | 'estimated' | 'verified'`.
  - Reconciliation utility: compares holding balances against recorded transaction flows, detecting un-reconciled discrepancies without altering user data.

### Phase 3: Cash-Flow Forecasting Engine
- Create `src/lib/cashFlowForecast.ts`:
  - Date-based projection engine across a configurable window (30, 60, 90 days).
  - Distinguishes **actual/confirmed** events from **estimated** events.
  - Inflows: Active confirmed income streams on designated paydays.
  - Outflows: Scheduled bills, EMIs, credit card payment dues (respecting statement cycles & cool-off days), recurring goal contributions.
  - Scenario stress testing:
    - Delayed salary (+7 / +14 days).
    - Delayed receivables collection (+30 days).
    - Unexpected emergency expense (+₹15,000 / +₹30,000).
    - Income shock / interruption.
  - Computes opening balance, dated cash events, closing balance, minimum projected cash floor, and flags any negative-cash days.
  - Never treats locked FDs, credit limits, or uncollected loans as liquid cash.

### Phase 4: Debt Intelligence Engine
- Create `src/lib/debtEngine.ts`:
  - Compares repayment strategies:
    1. **Mandatory First**: Contractual EMIs and minimum dues paid first to prevent default and penalty compounding.
    2. **Avalanche (Interest-Rate-Priority)**: Target highest interest rate debts first to minimize total interest paid.
    3. **Snowball (Smallest-Balance-Priority)**: Target smallest balance debts first for psychological wins and cash-flow release.
  - Clearly distinguishes contractual due dates from user-desired payoff deadlines.
  - Calculates exact interest savings, remaining tenures, and prepayment fee impacts.

### Phase 5: Receivables and Personal Loans
- Add `Receivable` model in `src/types/index.ts` and storage in `src/lib/storage.ts`:
  - Tracks debtor name, principal amount, current outstanding, interest rate, issue date, expected collection date, confidence score (0-100%), funding source (e.g., bank account vs credit card), and partial collection history.
  - If funded via credit card, preserves the separate card liability repayment obligation.
  - Excludes uncollected receivables from liquid spending cash.
  - Dedicated Receivables UI with partial repayment logging and write-off handling.

### Phase 6: Dependency-Aware Goals
- Coordinate surplus allocation:
  - Emergency buffer floor: First priority is maintaining user's safety cash buffer.
  - Contractual obligations: High priority debt & upcoming bills are protected before allocating surplus to discretionary goals.
  - Prevents double-allocation of the same rupee across competing goals.
  - Feasibility scoring: Realistic timeline based on actual net surplus and user priority ranks.

### Phase 7: Model Maturity & ML Reliability
- Audit and refine `src/lib/mlEngine.ts`:
  - Enforce explicit observation thresholds (e.g. minimum 3 historical pay cycles, 10 spending transactions).
  - When observations are below threshold, clearly display "Insufficient data" with specific missing inputs, rather than guessing or fabricating confidence.
  - Distinguish Heuristic Baseline from Online Trained Weights.

### Phase 9: Security & Privacy
- Enhance `src/lib/crypto.ts`:
  - Upgrade PIN hashing to WebCrypto PBKDF2 with 100,000 iterations and salt, with backward-compatible migration for existing salted SHA-256 hashes.
  - Validate import payload structure and sanitization before state ingestion.

### Phase 10: Financial Calculation Tests
- Create automated test suite `tests/financialCalculations.test.ts` verifying:
  - Decimal rounding and precision.
  - Hybrid card multi-tier debit-credit logic.
  - FD locked status and sweep-in deduction.
  - Forecast cash depletion detection.
  - Debt avalanche vs snowball calculations.
  - Double-counting prevention on transfers & card payments.

### Phase 11: User Interface
- Provide UI tabs/modals for Cash-Flow Forecasting, Debt Intelligence, Receivables Manager, and Data Provenance & Reconciliation.
- Consistent visual indicators for actual vs projected data and data freshness.

### Phase 12: External Cash Inflows & Direct Outside Settlements
- **Scenario 1 (Cash Inflow into Account):** Record money received from loved ones, family gifts, bonuses, and reimbursements directly into any bank account or cash holding using `safeAdd`, recording an audited `Transaction` (`kind: 'income'`).
- **Scenario 2 (Direct Outside Bill Settlement):** Settle bills or loan EMIs paid directly by an outside third party (parents, company, loved one) without debiting the user's personal bank accounts. Reduces liability balances where applicable and records double-entry relief.
- **Scenario 3 (Earmarked Goal Funding):** Direct cash gifts into an account and atomically boost an active Goal's `accumulatedTotal`, creating audited goal transaction records and triggering milestone completion when reaching 100%.
- **Interactive UI Touchpoints:**
  - `ReceiveMoneyModal` accessible globally via TopHeader (`+ Receive`), Home Dashboard quick actions, Spend view header, and Income hub.
  - `PayBillModal` integrated toggle: "My Accounts / Cards" vs "Paid by Loved One / Outside" allowing instant third-party bill settlement.
  - Comprehensive unit test suite verification in `tests/financialCalculations.test.ts` (Suite 12).


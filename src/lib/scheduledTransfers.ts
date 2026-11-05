import { ScheduledTransfer } from '../types';

/**
 * Computes the next calendar execution date for a scheduled transfer.
 * If the scheduled day in the current month has already elapsed (or already executed),
 * the next execution date moves to the next month/quarter.
 *
 * Example: If today is Oct 27 and dayOfMonth is 5, next execution is Nov 05.
 * It will strictly wait until Nov 05 before executing.
 */
export function computeNextScheduledDate(
  dayOfMonth: number,
  frequency: 'monthly' | 'quarterly' | 'once' = 'monthly',
  fromDate: Date = new Date(),
  lastExecutedMonth?: string
): string {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth(); // 0-11
  const todayDay = fromDate.getDate();

  const currentYearMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const clampedDayThisMonth = Math.min(Math.max(1, dayOfMonth), daysInCurrentMonth);

  // If already executed this month, OR today is past the scheduled day this month:
  // (e.g. today is 27th and scheduled day is 5th):
  const hasElapsedThisMonth = todayDay > clampedDayThisMonth || lastExecutedMonth === currentYearMonth;

  let targetYear = year;
  let targetMonth = month;

  if (hasElapsedThisMonth) {
    const step = frequency === 'quarterly' ? 3 : 1;
    targetMonth += step;
    if (targetMonth > 11) {
      targetYear += Math.floor(targetMonth / 12);
      targetMonth = targetMonth % 12;
    }
  }

  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const finalDay = Math.min(Math.max(1, dayOfMonth), daysInTargetMonth);

  const targetDateObj = new Date(targetYear, targetMonth, finalDay);
  return `${targetDateObj.getFullYear()}-${String(targetDateObj.getMonth() + 1).padStart(2, '0')}-${String(targetDateObj.getDate()).padStart(2, '0')}`;
}

/**
 * Determines whether a scheduled transfer is due for execution today.
 * Strictly waits until the calendar date reaches the target day.
 */
export function isScheduledTransferDue(st: ScheduledTransfer, today: Date = new Date()): boolean {
  if (!st.isActive) return false;

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentDay = today.getDate();

  // If already executed today, do not re-run
  if (st.lastExecutedDate === todayStr) return false;

  // If already executed this month for a monthly transfer, do not re-run
  if (st.frequency === 'monthly' && st.lastExecutedMonth === currentYearMonth) {
    return false;
  }

  // If nextExecutionDate is defined, check if today has reached it
  if (st.nextExecutionDate) {
    return todayStr >= st.nextExecutionDate;
  }

  // Fallback for legacy transfers without nextExecutionDate:
  // If the transfer was created in the current month after the scheduled date, it must wait for next month
  if (st.createdAt && st.createdAt.startsWith(currentYearMonth)) {
    const createdDay = parseInt(st.createdAt.split('-')[2], 10) || 1;
    if (createdDay > st.dayOfMonth) {
      return false; // Created after this month's scheduled day, must wait for next month
    }
  }

  // Must wait until today is on or after the scheduled day of month
  return currentDay >= st.dayOfMonth && st.lastExecutedMonth !== currentYearMonth;
}

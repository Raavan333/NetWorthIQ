export function formatMoney(
  amount: number,
  currencyCode: string = 'INR',
  symbol?: string,
  grouping: 'inr' | 'international' | 'auto' = 'auto',
  decimals: number = 2,
  ..._rest: any[]
): string {
  if (amount === undefined || amount === null || isNaN(amount)) return (0).toFixed(decimals);
  const sym = symbol ? `${symbol} ` : '';
  const abs = Math.abs(amount);

  let numStr = '';
  if (
    grouping === 'inr' ||
    (grouping === 'auto' && (currencyCode === 'INR' || !symbol || symbol === '₹'))
  ) {
    const fixed = abs.toFixed(decimals);
    const parts = fixed.split('.');
    let intPart = parts[0];
    const decPart = parts[1];
    if (intPart.length > 3) {
      const last3 = intPart.substring(intPart.length - 3);
      const other = intPart.substring(0, intPart.length - 3);
      intPart = other.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    }
    numStr = decPart !== undefined ? `${intPart}.${decPart}` : intPart;
  } else {
    numStr = abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  const sign = amount < 0 ? '-' : '';
  return `${sign}${sym}${numStr}`;
}

export function getLastWorkingDayOfMonth(year: number, month: number): number {
  const lastDay = new Date(year, month + 1, 0);
  const dayOfWeek = lastDay.getDay();
  if (dayOfWeek === 0) {
    return lastDay.getDate() - 2;
  } else if (dayOfWeek === 6) {
    return lastDay.getDate() - 1;
  }
  return lastDay.getDate();
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return dateStr;
}

export function formatCompactMoney(
  amount: number,
  currencyCode: string = 'INR',
  symbol?: string,
  ..._rest: any[]
): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '0';
  const sym = symbol ? `${symbol} ` : '';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (currencyCode === 'INR' || !symbol || symbol === '₹') {
    if (abs >= 10000000) {
      return `${sign}${sym}${(abs / 10000000).toFixed(2)} Cr`;
    }
    if (abs >= 100000) {
      return `${sign}${sym}${(abs / 100000).toFixed(2)} L`;
    }
    if (abs >= 1000) {
      return `${sign}${sym}${(abs / 1000).toFixed(1)}k`;
    }
    return `${sign}${sym}${abs.toFixed(0)}`;
  }

  if (abs >= 1000000000) {
    return `${sign}${sym}${(abs / 1000000000).toFixed(2)}B`;
  }
  if (abs >= 1000000) {
    return `${sign}${sym}${(abs / 1000000).toFixed(2)}M`;
  }
  if (abs >= 1000) {
    return `${sign}${sym}${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}${sym}${abs.toFixed(0)}`;
}


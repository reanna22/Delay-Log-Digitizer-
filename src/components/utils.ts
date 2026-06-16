/**
 * Parse time string (e.g., "5:55" or "1:20" or "1.20") and return positive minute values.
 */
export function calculateMinutesDiff(start: string, end: string): number {
  if (!start || !end) return 0;
  try {
    const parseTime = (t: string) => {
      // replace dots with colons in case they write 5.55 instead of 5:55
      const parts = t.trim().replace('.', ':').split(':');
      if (parts.length < 2) return null;
      let h = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    };
    
    const sMin = parseTime(start);
    const eMin = parseTime(end);
    if (sMin === null || eMin === null) return 0;
    
    if (eMin < sMin) {
      // Handles overnight delays (e.g. 11:50 PM to 12:10 AM => 23:50 to 00:10)
      return (1440 - sMin) + eMin;
    }
    return eMin - sMin;
  } catch (err) {
    console.error('Error calculating minutes difference:', err);
    return 0;
  }
}

/**
 * Returns a comparable numeric value (e.g. month * 100 + day) for chronological sorting.
 * Handles formats like: "22-May", "May 22", "2-Jun", "22/05", "20/5", "20-5", "2-6", etc.
 * Supports alphabetical month names/abbreviations.
 */
export function parseDateToComparable(dateStr: string, globalDateFallback?: string): number {
  const target = (dateStr || globalDateFallback || '2-Jun').trim().toLowerCase();
  if (!target) return 0;

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  // 1. Try to find alphabetic month index
  let foundMonthIdx = -1;
  for (let i = 0; i < months.length; i++) {
    if (target.includes(months[i])) {
      foundMonthIdx = i;
      break;
    }
  }

  // Extract numeric components
  const numbers = target.match(/\d+/g)?.map(Number) || [];

  if (foundMonthIdx !== -1) {
    // If a month word was found, the first number in the string is likely the day (e.g., 20 in "May 20" or "20-May")
    const day = numbers.length > 0 ? numbers[0] : 1;
    return (foundMonthIdx + 1) * 100 + day;
  }

  // 2. If it is standard digit-based (e.g., 20/5, 20-5, 2/6, 5/20)
  if (numbers.length >= 2) {
    const num1 = numbers[0];
    const num2 = numbers[1];

    if (num1 > 12 && num2 <= 12) {
      // num1 is day, num2 is month (e.g., 20/5)
      return num2 * 100 + num1;
    } else if (num2 > 12 && num1 <= 12) {
      // num1 is month, num2 is day (e.g., 5/20)
      return num1 * 100 + num2;
    } else {
      // Standard UK/Maritime DD/MM format (e.g., 2/6 => 2nd of June)
      const day = num1;
      const month = num2;
      return month * 100 + day;
    }
  }

  // 3. Fallback for single number (treat as day of June)
  if (numbers.length === 1) {
    return 6 * 100 + numbers[0];
  }

  return 0;
}

/**
 * Convert time string to minutes since midnight for sorting
 * e.g., "08:30" -> 510, "14:15" -> 855
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace('.', ':');
  const parts = cleaned.split(':');
  if (parts.length < 2) {
    const matches = cleaned.match(/\d+/);
    if (matches) {
      const h = parseInt(matches[0], 10);
      if (!isNaN(h)) return h * 60;
    }
    return 0;
  }
  const h = parseInt(parts[0].replace(/\D/g, ''), 10);
  const m = parseInt(parts[1].replace(/\D/g, ''), 10);
  if (isNaN(h)) return 0;
  return h * 60 + (isNaN(m) ? 0 : m);
}



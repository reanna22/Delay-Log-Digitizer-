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

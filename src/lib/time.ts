/** Calendar date (YYYY-MM-DD) in the operating timezone. Aging uses the same "today" as the database. */
export function todayIn(timezone = 'Asia/Kolkata', at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

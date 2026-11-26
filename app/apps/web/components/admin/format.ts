/** Small formatting helpers shared by the admin console tabs. */

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (iso: string) => new Date(iso).toLocaleString();

export const dayFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
export const timeFmt = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "24 Nov 2026" over "8:20 am to 9:20 am" (or both dates when the exam spans days). */
export function examWindow(startsAt: string | null, endsAt: string | null) {
  if (!startsAt) return { top: 'No start set', bottom: '' };
  const s = new Date(startsAt);
  if (!endsAt) return { top: dayFmt.format(s), bottom: `from ${timeFmt.format(s)}` };
  const e = new Date(endsAt);
  if (dayFmt.format(s) === dayFmt.format(e)) {
    return { top: dayFmt.format(s), bottom: `${timeFmt.format(s)} – ${timeFmt.format(e)}` };
  }
  return {
    top: `${dayFmt.format(s)}, ${timeFmt.format(s)}`,
    bottom: `to ${dayFmt.format(e)}, ${timeFmt.format(e)}`,
  };
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export function thisMonth(): string {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Converting between the server's UTC times and the date / time people type on this device.
export const fromServer = (v?: string | null): Date | null =>
  v ? new Date(v.endsWith('Z') || /[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`) : null;

const pad = (n: number) => String(n).padStart(2, '0');

export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "2026-11-16" + "07:30" (device time) -> Date, or null if either is malformed. */
export function parseLocal(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  return isNaN(d.getTime()) || +tm[1] > 23 || +tm[2] > 59 ? null : d;
}

export const fmtDateTime = (d?: Date | null) =>
  d ? d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtTime = (d?: Date | null) => (d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

/** Monday 00:00 of the week containing d (device time). */
export function weekStart(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export const addDaysTo = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function buildLocalDate(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0
): Date {
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

export function formatInputValue(date: Date, withTime = false): string {
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withTime) return datePart;
  return `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function createCurrentDateTimeInput(): string {
  return formatInputValue(new Date(), true);
}

export function parseDateValue(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const localDateTimeMatch = trimmed.match(LOCAL_DATE_TIME_RE);
  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second] = localDateTimeMatch;
    return buildLocalDate(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? '0')
    );
  }

  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return buildLocalDate(Number(year), Number(month), Number(day));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function extractCalendarDate(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const directMatch = trimmed.match(DATE_ONLY_RE);
  if (directMatch) return directMatch[0];

  const prefixMatch = trimmed.match(DATE_PREFIX_RE);
  if (prefixMatch) return prefixMatch[1];

  const parsed = parseDateValue(trimmed);
  return parsed ? formatInputValue(parsed, false) : '';
}

export function toInputValue(value?: string | null, withTime = false): string {
  if (!value) return '';
  if (!withTime) return extractCalendarDate(value);

  const parsed = parseDateValue(value);
  return parsed ? formatInputValue(parsed, true) : '';
}

export function toStoredIso(value?: string | null, withTime = false): string | null {
  if (!value) return null;

  const source = withTime ? value : extractCalendarDate(value);
  const parsed = parseDateValue(source);
  return parsed ? parsed.toISOString() : null;
}

export function formatCalendarDate(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }
): string {
  if (!value) return '';
  const parsed = parseDateValue(extractCalendarDate(value) || value);
  return parsed ? parsed.toLocaleDateString('es-CO', options) : value;
}

export function formatDateTimeLabel(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  if (!value) return '';
  const parsed = parseDateValue(value);
  return parsed ? parsed.toLocaleString('es-CO', options) : value;
}

export function getDateOnlyKey(value?: string | null): string {
  return extractCalendarDate(value);
}

export function calculateAge(value?: string | null): number | null {
  const calendarDate = extractCalendarDate(value);
  if (!calendarDate) return null;

  const [year, month, day] = calendarDate.split('-').map(Number);
  if (!year || !month || !day) return null;

  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age;
}

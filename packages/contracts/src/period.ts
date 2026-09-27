const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new Error("Unknown source timezone");
  }
}

/** Offset of `timeZone` at `instant`, in milliseconds (local = utc + offset). */
function timeZoneOffsetMs(instant: Date, timeZone: string) {
  const wholeSecond = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(wholeSecond).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  let year = Number(parts.year), month = Number(parts.month), day = Number(parts.day), hour = Number(parts.hour);
  if (hour === 24) {
    hour = 0;
    const rolled = new Date(Date.UTC(year, month - 1, day + 1));
    year = rolled.getUTCFullYear();
    month = rolled.getUTCMonth() + 1;
    day = rolled.getUTCDate();
  }
  const asUtc = Date.UTC(year, month - 1, day, hour, Number(parts.minute), Number(parts.second));
  return asUtc - wholeSecond.getTime();
}

/** Convert a wall-clock time in an IANA zone to UTC. Rejects dates that do not exist there. */
export function wallTimeToUtc(date: string, hours: number, minutes: number, seconds: number, milliseconds: number, timeZone: string) {
  const match = calendarDate.exec(date);
  if (!match || hours > 23 || minutes > 59 || seconds > 59 || milliseconds > 999) throw new Error("Invalid calendar date");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error("Invalid calendar date");
  assertTimeZone(timeZone);
  const guess = Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds);
  const first = timeZoneOffsetMs(new Date(guess), timeZone);
  let result = new Date(guess - first);
  const second = timeZoneOffsetMs(result, timeZone);
  if (second !== first) result = new Date(guess - second);
  const check = timeZoneOffsetMs(result, timeZone);
  const wall = new Date(result.getTime() + check);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day ||
      wall.getUTCHours() !== hours || wall.getUTCMinutes() !== minutes || wall.getUTCSeconds() !== seconds) {
    throw new Error("Source timezone cannot represent that local time");
  }
  return result;
}

/** Inclusive calendar period: start 00:00:00.000 through end 23:59:59.999 in `timeZone`, as UTC. */
export function inclusivePeriodUtc(startDate: string, endDate: string, timeZone: string) {
  const periodStart = wallTimeToUtc(startDate, 0, 0, 0, 0, timeZone);
  const periodEnd = wallTimeToUtc(endDate, 23, 59, 59, 999, timeZone);
  if (periodStart > periodEnd) throw new Error("Invalid report period");
  return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() };
}

/** `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss` interpreted in `timeZone`. */
export function wallDateTimeToUtc(value: string, timeZone: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Invalid source as-of time");
  return wallTimeToUtc(match[1] ?? "", Number(match[2]), Number(match[3]), Number(match[4] ?? 0), 0, timeZone).toISOString();
}

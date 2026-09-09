// Real hour-by-hour visual overview of one day — availability windows as
// shaded bands, confirmed bookings and custom events positioned by their
// actual time and (for bookings) duration. Read-only: this is the "see my
// whole day at a glance" view; actually booking/cancelling/assigning still
// happens through the existing flat slot list rendered below it, which
// already has all the interaction affordances (Book/Cancel/Assign
// buttons) wired to specific slot times.
const PX_PER_MIN = 1;
const PAD_MINUTES = 60;
const DEFAULT_START_MIN = 6 * 60; // 6:00 AM
const DEFAULT_END_MIN = 21 * 60; // 9:00 PM

export interface GridWindow {
  startTime: string; // "HH:MM:SS"
  endTime: string;
}

export interface GridBooking {
  id: string;
  start: Date;
  end: Date;
  label: string;
}

export interface GridEvent {
  id: string;
  time: string | null; // "HH:MM:SS", null = no specific time (not shown on the grid)
  title: string;
}

function timeStrToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function dateToMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function DayHourGrid({
  windows,
  bookings,
  events,
}: {
  windows: GridWindow[];
  bookings: GridBooking[];
  events: GridEvent[];
}) {
  const timedEvents = events.filter((e): e is GridEvent & { time: string } => e.time != null);

  const allMinutes = [
    ...windows.flatMap((w) => [timeStrToMinutes(w.startTime), timeStrToMinutes(w.endTime)]),
    ...bookings.flatMap((b) => [dateToMinutes(b.start), dateToMinutes(b.end)]),
    ...timedEvents.map((e) => timeStrToMinutes(e.time)),
  ];

  const rangeStart =
    allMinutes.length > 0
      ? Math.max(0, Math.floor((Math.min(...allMinutes) - PAD_MINUTES) / 60) * 60)
      : DEFAULT_START_MIN;
  const rangeEnd =
    allMinutes.length > 0
      ? Math.min(24 * 60, Math.ceil((Math.max(...allMinutes) + PAD_MINUTES) / 60) * 60)
      : DEFAULT_END_MIN;

  const totalMinutes = Math.max(60, rangeEnd - rangeStart);
  const gridHeight = totalMinutes * PX_PER_MIN;

  const hourMarks: number[] = [];
  for (let h = Math.ceil(rangeStart / 60); h <= Math.floor(rangeEnd / 60); h++) {
    hourMarks.push(h * 60);
  }

  function topFor(minutes: number): number {
    return (minutes - rangeStart) * PX_PER_MIN;
  }

  return (
    <div className="flex border border-steel/20 mb-6 max-w-2xl">
      <div className="w-14 shrink-0 border-r border-steel/20 relative" style={{ height: gridHeight }}>
        {hourMarks.map((min) => (
          <div
            key={min}
            className="absolute right-2 -translate-y-1/2 font-body text-[10px] text-steel"
            style={{ top: topFor(min) }}
          >
            {formatMinutes(min)}
          </div>
        ))}
      </div>

      <div className="flex-1 relative" style={{ height: gridHeight }}>
        {hourMarks.map((min) => (
          <div
            key={min}
            className="absolute left-0 right-0 border-t border-steel/10"
            style={{ top: topFor(min) }}
          />
        ))}

        {windows.map((w, i) => {
          const start = timeStrToMinutes(w.startTime);
          const end = timeStrToMinutes(w.endTime);
          return (
            <div
              key={i}
              className="absolute left-0 right-0 bg-positive/5"
              style={{ top: topFor(start), height: Math.max(0, (end - start) * PX_PER_MIN) }}
            />
          );
        })}

        {bookings.map((b) => {
          const start = dateToMinutes(b.start);
          const end = dateToMinutes(b.end);
          return (
            <div
              key={b.id}
              className="absolute left-1 right-1 bg-rust/80 text-graphite px-2 py-0.5 overflow-hidden"
              style={{ top: topFor(start), height: Math.max(18, (end - start) * PX_PER_MIN) }}
            >
              <p className="font-body text-[11px] font-medium leading-tight truncate">{b.label}</p>
            </div>
          );
        })}

        {timedEvents.map((e) => {
          const start = timeStrToMinutes(e.time);
          return (
            <div
              key={e.id}
              className="absolute left-1 right-1 bg-moss/80 text-graphite px-2 py-0.5 overflow-hidden"
              style={{ top: topFor(start), height: 18 }}
            >
              <p className="font-body text-[11px] font-medium leading-tight truncate">{e.title}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

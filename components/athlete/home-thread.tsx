// The line above Today on a client's Home: goal, place in the program, streak. Only the parts that are true are passed in.
export function HomeThread({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <p aria-label="Your progress" className="font-body text-sm text-steel flex flex-wrap items-center gap-x-2 gap-y-1">
      {lines.map((line, i) => (
        <span key={line} className="inline-flex items-center gap-x-2">
          {i > 0 && <span aria-hidden="true">&middot;</span>}
          <span>{line}</span>
        </span>
      ))}
    </p>
  );
}

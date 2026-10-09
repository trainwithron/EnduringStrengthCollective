// A cluster of three people, for the Group entry in the coach rail. The library's own "users" icons show two people and look almost the same as the single-person Clients icon at rail
// size; three heads in a row read as "many". Drawn like the other rail icons (24px grid, 2px rounded stroke, current colour).
export function ThreePeopleIcon({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="6" r="2.5" />
      <path d="M7.5 15.5a4.5 4.5 0 0 1 9 0" />
      <circle cx="4.5" cy="9" r="2" />
      <path d="M1 18a3.5 3.5 0 0 1 5.5-2.8" />
      <circle cx="19.5" cy="9" r="2" />
      <path d="M23 18a3.5 3.5 0 0 0-5.5-2.8" />
    </svg>
  );
}

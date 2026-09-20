export function BrowserMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2.75"
        y="4.25"
        width="18.5"
        height="15.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2.75 9.25h18.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6.1" cy="6.75" r="0.9" fill="currentColor" />
      <circle cx="9.1" cy="6.75" r="0.9" fill="currentColor" />
      <path
        d="M7.25 15.5l2.25-2.5 2.25 2.5 3-3.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

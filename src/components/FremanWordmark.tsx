/**
 * The Freman wordmark — "Freman" with a red-to-light gradient sweep,
 * matching the brand logo. Ends on `foreground` so it stays legible on
 * light backgrounds (red → near-black) and dark ones (red → white).
 */
export function FremanWordmark({ className }: { className?: string }) {
  return (
    <span
      className={`bg-gradient-to-r from-red-600 via-red-400 to-foreground bg-clip-text font-semibold tracking-tight text-transparent ${
        className ?? ""
      }`}
    >
      Freman
    </span>
  );
}

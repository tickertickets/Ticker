export function VerifiedBadge({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={`inline-block flex-shrink-0 ${className}`}
      aria-label="verified"
    >
      <circle cx="12" cy="12" r="12" fill="#3B82F6" />
      <path
        d="M7 12.5L10.5 16L17 9"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function isVerified(username?: string | null): boolean {
  return username === "tickerofficial";
}

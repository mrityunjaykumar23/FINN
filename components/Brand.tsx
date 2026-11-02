/** Original FINN signal mark: an F assembled from a stem and three measured bars. */
export function FinnMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 6h4v20H6zM13 6h13v4H13zM13 14h10v4H13z" fill="currentColor" />
      <path
        d="M13 22h4v4h-4zM20 22h3v4h-3z"
        fill="currentColor"
        opacity=".45"
      />
    </svg>
  );
}
export function FinnAvatar() {
  return (
    <span className="finn-avatar" aria-label="FINN Research">
      <FinnMark />
    </span>
  );
}
export function Logo() {
  return (
    <div className="brand" aria-label="FINN. Financial Investment Agent">
      <span className="brand-mark">
        <FinnMark />
      </span>
      <span>
        FINN<span className="brand-dot">.</span>
      </span>
    </div>
  );
}

/** Provider symbols sit on folded paper, rather than invented account portraits. */
export function ProviderMark({ provider }: { provider: string | null }) {
  return <span className="provider-mark" aria-hidden="true">
    {provider === "cloudflare" ? <span className="provider-cloudflare" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {provider === null ? <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></> : provider === "direct" ? <path d="M5 12h14m-6-6 6 6-6 6" /> : <><path d="M8 8h8v8H8zM12 3v5M12 16v5M3 12h5M16 12h5" /><circle cx="12" cy="3" r="1" /><circle cx="12" cy="21" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="21" cy="12" r="1" /></>}
    </svg>}
  </span>;
}

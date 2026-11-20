export function PayamLogo() {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        width="30"
        height="30"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="payamGoldStroke" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F8E1A0" />
            <stop offset="52%" stopColor="#D4A853" />
            <stop offset="100%" stopColor="#8E6822" />
          </linearGradient>
          <linearGradient id="payamCoreFill" x1="18" y1="14" x2="48" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F5D78E" />
            <stop offset="100%" stopColor="#B8872E" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="58" height="58" rx="14" fill="#101827" stroke="url(#payamGoldStroke)" strokeWidth="2.4" />
        <polygon points="32,10 52,21.5 52,42.5 32,54 12,42.5 12,21.5" fill="rgba(212,168,83,0.09)" stroke="url(#payamGoldStroke)" strokeWidth="1.4" />
        <path
          d="M23 45V19H35.5C41.2 19 44.5 22.1 44.5 27.1C44.5 32.1 41.2 35.3 35.5 35.3H28.5V45H23ZM28.5 30.7H34.9C37.6 30.7 39.1 29.3 39.1 27.1C39.1 24.9 37.6 23.6 34.9 23.6H28.5V30.7Z"
          fill="url(#payamCoreFill)"
        />
        <circle cx="44" cy="43" r="3.4" fill="#34D399" />
      </svg>
      <span className="flex items-baseline gap-1.5">
        <span className="font-display text-base font-bold text-slate-100">پیام</span>
        <span className="text-[11px] font-medium text-[#D4A853]/90 hidden sm:inline">میز XAUUSD</span>
      </span>
    </span>
  );
}

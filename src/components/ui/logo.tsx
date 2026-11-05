/** The product mark: an orbit of three agents around a spark. Pure SVG, animated with CSS. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="lm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="0.5" stopColor="#c084fc" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#lm-g)" />
      <g className="spin-slow" style={{ transformOrigin: "20px 20px" }}>
        <circle cx="20" cy="20" r="11" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="3 3" />
        <circle cx="31" cy="20" r="2.6" fill="#fff" />
        <circle cx="14.5" cy="29.5" r="2.2" fill="#fff" fillOpacity="0.85" />
        <circle cx="14.5" cy="10.5" r="1.8" fill="#fff" fillOpacity="0.7" />
      </g>
      <path d="M20 13 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fff" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[15px] font-bold tracking-tight text-white">
        Marketing<span className="text-grad">Agent</span>
      </span>
    </span>
  );
}

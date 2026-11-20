// Nen cac dai cong phia sau lop kinh mo. Mau lay tu bien CSS nen tu doi theo che do sang/toi.
export default function Backdrop() {
  return (
    <svg className="backdrop" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="bd-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--bd-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--bd-3)' }} />
        </linearGradient>
        <radialGradient id="bd-glow-a">
          <stop offset="0" style={{ stopColor: 'var(--bd-glow)' }} />
          <stop offset="1" stopColor="transparent" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" style={{ fill: 'var(--bd-0)' }} />
      <path d="M0 250C360 90 760 470 1440 250V0H0z" fill="url(#bd-band)" />
      <path d="M0 470C430 330 920 720 1440 520V650C930 860 430 500 0 640z" style={{ fill: 'var(--bd-2)' }} />
      <path d="M0 790C470 650 1010 930 1440 790V900H0z" fill="url(#bd-band)" opacity=".85" />
      <g fill="none" style={{ stroke: 'var(--bd-line)' }} strokeWidth="1.5">
        <path d="M0 250C360 90 760 470 1440 250" />
        <path d="M0 470C430 330 920 720 1440 520" opacity=".6" />
        <path d="M0 790C470 650 1010 930 1440 790" opacity=".6" />
      </g>
      <circle cx="1150" cy="170" r="430" fill="url(#bd-glow-a)" />
      <circle cx="180" cy="820" r="380" fill="url(#bd-glow-a)" opacity=".8" />
    </svg>
  );
}

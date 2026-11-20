const GRADIENTS = [
  ['#a78bfa', '#6d28d9'],
  ['#f0abfc', '#a21caf'],
  ['#93c5fd', '#4338ca'],
  ['#fda4af', '#be185d'],
  ['#5eead4', '#0f766e'],
  ['#fcd34d', '#c2410c'],
];

export default function Avatar({ name = '?', online, size = 42 }) {
  const hash = [...name].reduce((sum, ch) => sum + ch.codePointAt(0), 0);
  const [from, to] = GRADIENTS[hash % GRADIENTS.length];
  const initial = name.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? '?';
  return (
    <span className="avatar" style={{ width: size, height: size, background: `linear-gradient(135deg, ${from}, ${to})`, fontSize: size * 0.42 }}>
      {initial}
      {online && <i className="avatar-dot" title="Đang trực tuyến" />}
    </span>
  );
}

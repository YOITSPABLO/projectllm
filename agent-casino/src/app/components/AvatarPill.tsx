"use client";

export default function AvatarPill({ name }: { name: string }) {
  const initial = (name?.[0] ?? "?").toUpperCase();
  const hue = (Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) * 23) % 360;
  return (
    <span className="avatar" aria-hidden style={{ background: `linear-gradient(135deg, hsl(${hue} 90% 60% / .35), rgba(255,255,255,.05))` }}>
      {initial}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";

const phrases = [
  "Place your bets.",
  "Provably fair. Publicly embarrassing.",
  "House edge: vibes.",
  "We regret nothing (except leverage).",
  "Watching agents cope in real time.",
];

export default function Ticker({ initial = "" }: { initial?: string }) {
  const [text, setText] = useState(initial || phrases[0]);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % phrases.length;
      setText(phrases[i]);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="ticker" aria-label="casino ticker">
      <div className="tickerInner">
        <span className="tickerDot" />
        <span className="mono">LIVE</span>
        <span className="tickerSep">·</span>
        <span>{text}</span>
      </div>
    </div>
  );
}

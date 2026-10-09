"use client";

import { useEffect, useState } from "react";

/** "mm:ss" counting down from the seconds the server reported. */
export function Countdown({ seconds, label }: { seconds: number; label: string }) {
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = Math.max(0, Math.round((deadline - nowMs) / 1000));
  return (
    <span className={`font-bold tabular-nums ${left < 7 * 60 ? "text-danger" : ""}`}>
      {label} {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  valueMs: number;
  onChange: (ms: number) => void;
};

const MAX_MS = 10 * 60 * 1000;

function clampSeconds(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.min(59, Math.max(0, n));
}

function clampMinutes(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n);
}

export default function DurationInput({ valueMs, onChange }: Props) {
  const [minutes, setMinutes] = useState(() => Math.floor(valueMs / 60000));
  const [seconds, setSeconds] = useState(() => Math.floor((valueMs % 60000) / 1000));

  const lastEmittedRef = useRef(valueMs);

  useEffect(() => {
    if (valueMs !== lastEmittedRef.current) {
      setMinutes(Math.floor(valueMs / 60000));
      setSeconds(Math.floor((valueMs % 60000) / 1000));
      lastEmittedRef.current = valueMs;
    }
  }, [valueMs]);

  function emit(m: number, s: number) {
    const ms = Math.min(m * 60000 + s * 1000, MAX_MS);
    lastEmittedRef.current = ms;
    onChange(ms);
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="number"
        min={0}
        value={minutes}
        onChange={(e) => {
          const m = clampMinutes(Number(e.target.value));
          setMinutes(m);
          emit(m, seconds);
        }}
        style={{ width: 60 }}
      />
      <span>分</span>

      <input
        type="number"
        min={0}
        max={59}
        value={seconds}
        onChange={(e) => {
          const s = clampSeconds(Number(e.target.value));
          setSeconds(s);
          emit(minutes, s);
        }}
        style={{ width: 60 }}
      />
      <span>秒</span>
    </div>
  );
}

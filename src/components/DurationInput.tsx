"use client";

import { useEffect, useState } from "react";

type Props = {
  valueMs: number;
  onChange: (ms: number) => void;
};

export default function DurationInput({ valueMs, onChange }: Props) {
  const [minutes, setMinutes] = useState(Math.floor(valueMs / 60000));
  const [seconds, setSeconds] = useState(Math.floor((valueMs % 60000) / 1000));

  useEffect(() => {
    const rawMs = minutes * 60000 + seconds * 1000;
    const ms = Math.min(rawMs, 10 * 60 * 1000);
    onChange(ms);
  }, [minutes, seconds, onChange]);

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="number"
        min={0}
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        style={{width: 60 }}
      />
      <span>分</span>

      <input
        type="number"
        min={0}
        max={59}
        value={seconds}
        onChange={(e) => {
          const val = Math.min(59, Math.max(0, Number(e.target.value)));
          setSeconds(val);
        }}
        style={{ width: 60 }}
      />
      <span>秒</span>
    </div>
  );
}
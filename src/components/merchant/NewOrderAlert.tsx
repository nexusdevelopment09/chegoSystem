"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

type Props = {
  /** Orders waiting for the store to accept or refuse. */
  waiting: number;
  /** One of them has been waiting too long: the alert gets stronger. */
  urgent: boolean;
};

/**
 * Rings until someone accepts or refuses the new orders, and shows a browser
 * notification when a new one arrives. Browsers only allow sound after a
 * click, so the first visit asks to turn the sound on.
 */
export function NewOrderAlert({ waiting, urgent }: Props) {
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef(waiting);

  // Repeats the beep while there is something waiting.
  useEffect(() => {
    if (!soundOn || waiting === 0) return;

    const beep = () => {
      const context = audio.current;
      if (!context) return;
      const tones = urgent ? [880, 1175, 880, 1175] : [660, 880];
      tones.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        oscillator.type = urgent ? "square" : "sine";
        gain.gain.value = urgent ? 0.25 : 0.15;
        oscillator.connect(gain).connect(context.destination);
        const start = context.currentTime + index * 0.22;
        oscillator.start(start);
        oscillator.stop(start + 0.18);
      });
    };

    beep();
    const timer = setInterval(beep, urgent ? 2000 : 4000);
    return () => clearInterval(timer);
  }, [soundOn, waiting, urgent]);

  // A browser notification for each new arrival, even with the tab in the background.
  useEffect(() => {
    if (waiting > previous.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Chegô: novo pedido!", { body: "Tem pedido esperando você aceitar.", tag: "chego-novo-pedido" });
    }
    previous.current = waiting;
  }, [waiting]);

  async function enable() {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio.current = new Context();
    await audio.current.resume();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => undefined);
    }
    setSoundOn(true);
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="new-order-alert"
      data-waiting={waiting}
      data-urgent={urgent}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-3 ${
        waiting === 0 ? "bg-white ring-1 ring-peach" : urgent ? "animate-pulse bg-danger text-white" : "bg-brand text-coffee"
      }`}
    >
      <p className="font-bold">
        {waiting === 0
          ? "Nenhum pedido novo esperando."
          : urgent
            ? `Atenção: ${waiting} pedido${waiting > 1 ? "s" : ""} esperando há muito tempo!`
            : `${waiting} pedido${waiting > 1 ? "s" : ""} novo${waiting > 1 ? "s" : ""} esperando aceite.`}
      </p>
      {soundOn ? (
        <span className="text-sm font-semibold">Som ligado</span>
      ) : (
        <Button type="button" variant="secondary" className="min-h-11 px-4 text-sm" onClick={enable}>
          Ligar o som de alerta
        </Button>
      )}
    </div>
  );
}

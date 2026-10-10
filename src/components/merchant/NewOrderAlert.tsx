"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

type Props = {
  /** Pedidos esperando a loja aceitar ou recusar. */
  waiting: number;
  /** Um deles está esperando há tempo demais: o alerta fica mais forte. */
  urgent: boolean;
};

/**
 * Toca até alguém aceitar ou recusar os pedidos novos, e mostra uma notificação
 * do navegador quando chega um novo. Os navegadores só liberam som depois de um
 * clique, então a primeira visita pede para ligar o som.
 */
export function NewOrderAlert({ waiting, urgent }: Props) {
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef(waiting);

  // Repete o bipe enquanto houver algo esperando.
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

  // Uma notificação do navegador para cada pedido que chega, mesmo com a aba em segundo plano.
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

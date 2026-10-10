"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Props = {
  qrSvg: string;
  code: string;
  /** Segundos que faltavam quando a página foi montada, pelo relógio do servidor. */
  secondsLeft: number;
};

/** QR Code do Pix, "copia e cola" com botão de copiar e a contagem regressiva. */
export function PixBox({ qrSvg, code, secondsLeft }: Props) {
  const [copied, setCopied] = useState(false);
  // Conta no aparelho, a partir do tempo que o servidor informou que faltava.
  const [deadline] = useState(() => Date.now() + secondsLeft * 1000);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.round((deadline - nowMs) / 1000));

  const minutes = String(Math.floor(left / 60)).padStart(2, "0");
  const seconds = String(left % 60).padStart(2, "0");

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-lg" role="timer" aria-live="off">
        Pague em até{" "}
        <strong data-testid="pix-countdown" className={left <= 180 ? "text-danger" : ""}>
          {minutes}:{seconds}
        </strong>
      </p>
      {left <= 180 && left > 0 && <p className="text-sm font-bold text-danger">Seu Pix vai expirar em menos de 3 minutos.</p>}

      {/* O SVG é gerado no servidor pela biblioteca de QR, a partir do nosso próprio código. */}
      <div className="rounded-2xl bg-white p-3 ring-1 ring-peach" role="img" aria-label="QR Code do Pix" data-testid="pix-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />

      <label className="flex w-full flex-col gap-1.5 text-sm font-semibold">
        Pix copia e cola
        <textarea readOnly value={code} rows={3} data-testid="pix-code" onFocus={(event) => event.target.select()}
          className="rounded-2xl border-2 border-peach bg-cream px-3 py-2 font-mono text-xs" />
      </label>
      <Button
        type="button"
        className="w-full"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Código copiado!" : "Copiar código"}
      </Button>
    </div>
  );
}

"use client";

import { useRef, type ReactNode } from "react";
import { buttonClass } from "./Button";

/**
 * Botão que abre uma janela (o <dialog> do navegador: prende o foco e fecha no Esc).
 * O conteúdo costuma ser um ActionForm; a janela fica aberta para mostrar o resultado.
 */
export function Modal({ trigger, title, children, variant = "secondary", danger = false, testId }: {
  trigger: string; title: string; children: ReactNode; variant?: "primary" | "secondary"; danger?: boolean; testId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} data-testid={testId}
        className={buttonClass(variant, `min-h-11 px-4 text-sm ${danger ? "text-danger ring-danger" : ""}`)}>
        {trigger}
      </button>
      <dialog ref={dialog} aria-label={title}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-card bg-white p-0 text-coffee shadow-xl backdrop:bg-coffee/40">
        <div className="flex flex-col gap-3 p-5">
          <header className="flex items-start justify-between gap-3">
            <h2 className={`text-xl ${danger ? "text-danger" : ""}`}>{title}</h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Fechar" className="min-h-11 min-w-11 rounded-full text-2xl leading-none hover:bg-peach/40">×</button>
          </header>
          {children}
        </div>
      </dialog>
    </>
  );
}

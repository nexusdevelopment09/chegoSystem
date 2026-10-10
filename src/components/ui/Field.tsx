import type { InputHTMLAttributes, ReactNode } from "react";

export const inputClass =
  "min-h-12 w-full rounded-2xl border-2 border-peach bg-white px-4 text-base text-coffee placeholder:text-coffee-soft/70 focus:border-brand-dark focus:outline-none";

/** Os seletores de arquivo têm uma largura embutida grande; isto os mantém dentro de telas estreitas. */
export const fileInputClass = "block w-full min-w-0 max-w-full text-sm font-normal";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
};

/** Campo de texto com rótulo, usado por todos os formulários. */
export function Field({ label, hint, className, ...props }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <input className={`${inputClass} ${className ?? ""}`} {...props} />
      {hint && <span className="text-sm font-normal text-coffee-soft">{hint}</span>}
    </label>
  );
}

/** Linha embaixo do formulário para a mensagem de erro da ação. Anunciada aos leitores de tela. */
export function FormError({ message }: { message?: string }) {
  return (
    <p role="alert" aria-live="polite" className="min-h-5 text-sm font-semibold text-danger">
      {message}
    </p>
  );
}

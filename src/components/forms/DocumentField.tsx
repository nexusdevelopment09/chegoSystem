"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui/Field";
import { formatDocument, type DocumentType } from "@/lib/documents";

const OPTIONS: { value: DocumentType; label: string; hint: string }[] = [
  { value: "cpf", label: "CPF", hint: "Pessoa física" },
  { value: "cnpj", label: "CNPJ", hint: "Empresa ou MEI" },
];

/**
 * Documento de um cadastro: a pessoa escolhe CPF ou CNPJ e o campo se ajusta
 * (tamanho e pontuação). Envia `documentType` e `documentNumber`.
 */
export function DocumentField({ defaultType = "cpf", defaultNumber = "" }: { defaultType?: DocumentType; defaultNumber?: string }) {
  const [type, setType] = useState<DocumentType>(defaultType);
  const [number, setNumber] = useState(() => formatDocument(defaultType, defaultNumber));

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold">Tipo de cadastro</legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => (
          <label key={option.value}
            className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-peach bg-white px-3 has-checked:border-brand-dark has-checked:bg-cream">
            <input type="radio" name="documentType" value={option.value} checked={type === option.value}
              onChange={() => { setType(option.value); setNumber(formatDocument(option.value, number)); }}
              className="size-5 shrink-0 accent-brand-dark" />
            <span className="min-w-0 text-sm font-bold">
              {option.label}
              <span className="block text-xs font-normal text-coffee-soft">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Número do documento ({type === "cpf" ? "CPF" : "CNPJ"})
        <input name="documentNumber" required inputMode="numeric" autoComplete="off" value={number}
          maxLength={type === "cpf" ? 14 : 18} placeholder={type === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
          onChange={(event) => setNumber(formatDocument(type, event.target.value))} className={inputClass} />
      </label>
    </fieldset>
  );
}

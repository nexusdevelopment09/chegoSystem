"use client";

import { useEffect, useRef, useState } from "react";
import { fileInputClass } from "@/components/ui/Field";

type Props = {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Maior lado, em pixels, da foto que sai do aparelho. */
  maxSide?: number;
  className?: string;
};

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Reduz a foto no próprio aparelho. Devolve null quando o navegador não consegue abrir o formato. */
async function shrink(file: File, maxSide: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    // Navegadores que não gravam WebP devolvem PNG (bem maior); nesse caso vale o JPEG.
    const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
    const webp = await encode("image/webp");
    return webp && webp.type === "image/webp" ? webp : await encode("image/jpeg");
  } catch {
    return null;
  }
}

/**
 * Campo de foto para qualquer formato de imagem. Antes de enviar, a foto é
 * reduzida no próprio aparelho (fotos de celular têm vários MB), para o envio
 * ser rápido mesmo em internet fraca. O servidor ainda confere e regrava tudo.
 */
export function ImageInput({ name, label, required, hint, maxSide = 1600, className = "" }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function onChange() {
    const field = input.current;
    const file = field?.files?.[0];
    if (!field || !file) {
      setPreview(null);
      setNote(null);
      return;
    }
    setNote("Preparando a foto...");
    const small = await shrink(file, maxSide);
    // A pessoa pode ter trocado o arquivo enquanto a foto era preparada.
    if (field.files?.[0] !== file) return;

    if (small && small.size < file.size) {
      const extension = small.type === "image/webp" ? "webp" : "jpg";
      const transfer = new DataTransfer();
      transfer.items.add(new File([small], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type: small.type }));
      field.files = transfer.files;
      setNote(`Foto pronta para enviar: ${kb(small.size)} (o arquivo original tinha ${kb(file.size)}).`);
    } else {
      setNote(small ? `Foto pronta para enviar: ${kb(file.size)}.` : `O arquivo vai ser enviado como está (${kb(file.size)}).`);
    }
    setPreview(small ? URL.createObjectURL(small.size < file.size ? small : file) : null);
  }

  return (
    <label className={`flex min-w-0 flex-col gap-1.5 text-sm font-semibold ${className}`}>
      {label}
      <input ref={input} type="file" name={name} accept="image/*" required={required} onChange={onChange} className={fileInputClass} />
      <span className="text-sm font-normal text-coffee-soft">{hint ?? "Qualquer formato de imagem. A foto é reduzida antes de enviar, para não pesar."}</span>
      {note && <span role="status" className="text-sm font-normal text-coffee">{note}</span>}
      {/* Prévia local (blob), sem tamanho conhecido de antemão: <img> comum. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="Prévia da foto escolhida" className="mt-1 max-h-40 w-auto max-w-full self-start rounded-xl bg-peach object-contain" />}
    </label>
  );
}

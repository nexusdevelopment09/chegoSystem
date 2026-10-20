"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/ui/Icon";

type Props = {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Maior lado, em pixels, da foto que sai do aparelho. */
  maxSide?: number;
  className?: string;
  /** Imagem já salva: aparece na prévia até ser trocada. */
  currentUrl?: string | null;
  /** Mostra "Remover" (envia `${name}Remove=on`) quando há imagem salva. */
  removable?: boolean;
  /** Tipos aceitos (ex.: ["image/jpeg", "image/png", "image/webp"]). Sem a lista, qualquer imagem. */
  types?: string[];
  /** Formato da prévia: quadrada (logo) ou deitada (capa, banner). */
  shape?: "square" | "wide";
};

const MAX_BYTES = 15 * 1024 * 1024;
const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const TYPE_NAMES: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP" };

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
 * Campo de foto com botão de verdade ("Escolher imagem" / "Trocar imagem"), que abre a
 * galeria ou os arquivos no celular e no computador. Mostra a imagem salva, a prévia da
 * nova e, se pedido, "Remover". Antes de enviar, confere tipo e tamanho e reduz a foto
 * no próprio aparelho (fotos de celular têm vários MB). O servidor confere e regrava tudo;
 * a imagem só muda depois que ele confirma (a mensagem de "salvo" vem do formulário).
 */
export function ImageInput({ name, label, required, hint, maxSide = 1600, className = "", currentUrl = null, removable = false, types, shape = "wide" }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const { pending } = useFormStatus();

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function reset(message: string | null = null) {
    if (input.current) input.current.value = "";
    setPreview(null);
    setNote(null);
    setError(message);
  }

  async function onChange() {
    const field = input.current;
    const file = field?.files?.[0];
    if (!field || !file) return reset();
    setError(null);
    if (types && !types.includes(file.type)) {
      return reset(`Formato não aceito. Envie ${types.map((type) => TYPE_NAMES[type] ?? type).join(", ")}.`);
    }
    if (file.size > MAX_BYTES) return reset(`A imagem tem ${kb(file.size)}. O limite é 15 MB.`);
    setRemove(false);
    setNote("Preparando a foto...");
    const small = await shrink(file, maxSide);
    // A pessoa pode ter trocado o arquivo enquanto a foto era preparada.
    if (field.files?.[0] !== file) return;

    if (small && small.size < file.size) {
      const extension = small.type === "image/webp" ? "webp" : "jpg";
      const transfer = new DataTransfer();
      transfer.items.add(new File([small], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type: small.type }));
      field.files = transfer.files;
      setNote(`Pronta para enviar: ${kb(small.size)} (o original tinha ${kb(file.size)}). Salve para confirmar.`);
    } else {
      setNote(small ? `Pronta para enviar: ${kb(file.size)}. Salve para confirmar.` : `O arquivo vai ser enviado como está (${kb(file.size)}). Salve para confirmar.`);
    }
    setPreview(small ? URL.createObjectURL(small.size < file.size ? small : file) : null);
  }

  const shown = preview ?? (remove ? null : currentUrl);
  const chosen = preview !== null || note !== null;
  const box = shape === "square" ? "size-24" : "aspect-[3/1] w-full max-w-sm";

  return (
    <div className={`flex min-w-0 flex-col gap-2 text-sm ${className}`} data-testid={`image-input-${name}`}>
      <span className="font-semibold" id={`${id}-label`}>{label}</span>
      <div className={`${box} overflow-hidden rounded-2xl bg-peach ring-1 ring-peach`}>
        {shown ? (
          // Prévia local (blob) ou a imagem salva, sem tamanho conhecido de antemão: <img> comum.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={preview ? `Prévia: ${label}` : `${label} atual`} className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center px-2 text-center text-xs text-coffee-soft">{remove ? "Será removida ao salvar" : "Sem imagem"}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* O botão é o rótulo do campo: tocar nele abre a galeria/arquivos do aparelho. */}
        <label className="group relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-white px-4 font-bold text-brand-dark ring-1 ring-brand-dark hover:bg-cream has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brand-dark">
          <Icon name="image" size={16} />
          {shown || chosen ? "Trocar imagem" : "Escolher imagem"}
          <input
            ref={input} type="file" name={name} required={required} onChange={onChange}
            accept={types ? types.join(",") : "image/*"} aria-labelledby={`${id}-label`}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        {chosen && (
          <button type="button" onClick={() => reset()} className="min-h-11 rounded-full px-3 font-semibold text-coffee-soft hover:text-coffee">
            Desfazer
          </button>
        )}
        {removable && currentUrl && !chosen && (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 px-2 font-semibold text-danger">
            <input type="checkbox" name={`${name}Remove`} checked={remove} onChange={(event) => setRemove(event.target.checked)} className="size-5 accent-brand-dark" />
            Remover
          </label>
        )}
      </div>
      <span className="text-coffee-soft">{hint ?? "Qualquer formato de imagem. A foto é reduzida antes de enviar, para não pesar."}</span>
      {error && <span role="alert" className="font-bold text-danger">{error}</span>}
      {pending && chosen ? (
        <span role="status" className="font-semibold text-coffee">Enviando a imagem...</span>
      ) : (
        note && <span role="status" className="text-coffee">{note}</span>
      )}
    </div>
  );
}

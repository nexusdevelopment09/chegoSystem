import { LogoIcon } from "@/components/brand/LogoIcon";

type Props = {
  /** Caminho terminado em "-800.webp"; a versão de 400px fica ao lado. */
  url: string | null;
  alt: string;
  /** Largura desenhada em pixels de CSS, para escolher o arquivo certo. */
  size: number;
  className?: string;
  priority?: boolean;
};

/** Foto do produto em WebP com dois tamanhos, ou um fundo suave quando não há foto. */
export function ProductImage({ url, alt, size, className = "", priority = false }: Props) {
  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-peach ${className}`} role="img" aria-label={`${alt} (sem foto)`}>
        <LogoIcon size={Math.round(size / 3)} className="opacity-40" />
      </div>
    );
  }

  const small = url.replace(/-800\.webp$/, "-400.webp");
  return (
    // <img> comum: os arquivos já são WebP nos dois tamanhos necessários.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={size > 400 ? url : small}
      srcSet={`${small} 400w, ${url} 800w`}
      sizes={`${size}px`}
      alt={alt}
      width={size}
      height={size}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`bg-peach object-cover ${className}`}
    />
  );
}

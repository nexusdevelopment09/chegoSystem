import { smallVariant } from "@/lib/image-url";

type Props = {
  /** Endereço da imagem grande; a versão pequena fica ao lado, terminada em "-small.webp". */
  url: string;
  alt: string;
  /** Tamanho da imagem grande, para o navegador reservar o espaço antes de carregar. */
  width: number;
  height: number;
  /** Imagem do topo da página: carrega primeiro. As outras só quando chegam perto da tela. */
  priority?: boolean;
  className?: string;
};

/**
 * Capa de loja ou banner. O celular baixa a versão pequena (metade da largura) e
 * só telas grandes baixam a grande: é o que deixa a página leve em internet fraca.
 */
export function WideImage({ url, alt, width, height, priority = false, className = "" }: Props) {
  const small = smallVariant(url);
  return (
    // <img> comum: os arquivos já são WebP nos dois tamanhos necessários.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      srcSet={`${small} ${Math.round(width / 2)}w, ${url} ${width}w`}
      sizes="(max-width: 640px) 100vw, 1000px"
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`bg-peach object-cover ${className}`}
    />
  );
}

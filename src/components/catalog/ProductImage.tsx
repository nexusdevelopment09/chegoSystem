import { LogoIcon } from "@/components/brand/LogoIcon";

type Props = {
  /** Path ending in "-800.webp"; the 400px version sits next to it. */
  url: string | null;
  alt: string;
  /** Rendered width in CSS pixels, to pick the right file. */
  size: number;
  className?: string;
  priority?: boolean;
};

/** Product picture in WebP with two sizes, or a soft placeholder when there is none. */
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
    // Plain <img>: the files are already WebP in the two sizes needed.
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

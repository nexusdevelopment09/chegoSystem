import type { SVGProps } from "react";

// Ícones em SVG, desenhados no próprio projeto. Substituem emojis e caracteres como ★,
// que viram "quadradinhos" em aparelhos sem a fonte certa. Herdam a cor do texto.
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></>,
  pin: <><path d="M19 10c0 5.5-7 11-7 11s-7-5.5-7-11a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9Z" /><path d="M10.3 20.5a2 2 0 0 0 3.4 0" /></>,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
  play: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  store: <><path d="M4 10v10h16V10" /><path d="M2.5 10 4.5 4h15l2 6Z" /><path d="M9.5 20v-5.5h5V20" /></>,
  bike: <><circle cx="5.5" cy="17" r="3.5" /><circle cx="18.5" cy="17" r="3.5" /><path d="M5.5 17 9 9h5l4.5 8" /><path d="M8 6h3" /><path d="M14 9l1.5-3H18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
} as const;

export type IconName = keyof typeof PATHS | "star";

type Props = Omit<SVGProps<SVGSVGElement>, "name"> & { name: IconName; size?: number };

/** Decorativo por padrão (aria-hidden). Quem precisa de nome acessível o coloca no botão ou link. */
export function Icon({ name, size = 20, className = "", ...props }: Props) {
  if (name === "star") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor" className={className} {...props}>
        <path d="M12 2.8 14.8 8.6l6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}

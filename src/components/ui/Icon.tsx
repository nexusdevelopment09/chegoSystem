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
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  ticket: <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" /><path d="M14 6v12" strokeDasharray="2 2" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></>,
  sort: <><path d="M7 4v16" /><path d="m3 16 4 4 4-4" /><path d="M17 20V4" /><path d="m13 8 4-4 4 4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.5" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></>,
  cash: <><rect x="2.5" y="6.5" width="19" height="11" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4" /><path d="M18 10v4" /></>,
  pix: <><path d="m12 3 4.2 4.2-4.2 4.2-4.2-4.2Z" /><path d="m12 12.6 4.2 4.2L12 21l-4.2-4.2Z" /><path d="m3 12 4.2-4.2 4.2 4.2-4.2 4.2Z" /><path d="m12.6 12 4.2-4.2L21 12l-4.2 4.2Z" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
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

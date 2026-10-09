import { LogoIcon } from "./LogoIcon";

type LogoProps = {
  /** Icon height in pixels; the word scales with it. */
  size?: number;
  className?: string;
};

export function Logo({ size = 40, className }: LogoProps) {
  return (
    <span
      className={`inline-flex items-center font-display font-bold leading-none text-coffee ${className ?? ""}`}
      style={{ gap: size * 0.2, fontSize: size * 0.8 }}
    >
      <LogoIcon size={size} />
      <span>Chegô</span>
    </span>
  );
}

type LogoIconProps = {
  size?: number;
  className?: string;
  /** Leave empty when the icon sits next to the word "Chegô". */
  title?: string;
};

export function LogoIcon({ size = 40, className, title }: LogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="100" height="100" rx="28" fill="#E8611A" />
      <path
        d="M37 40V28a13 13 0 0 1 26 0v12"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M25 38h50l-3.5 41a5 5 0 0 1-5 4.6h-33a5 5 0 0 1-5-4.6z"
        fill="#FFFFFF"
      />
      <circle cx="41.5" cy="53" r="4.2" fill="#E8611A" />
      <circle cx="58.5" cy="53" r="4.2" fill="#E8611A" />
      <path
        d="M38.5 64q11.5 11 23 0"
        fill="none"
        stroke="#E8611A"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

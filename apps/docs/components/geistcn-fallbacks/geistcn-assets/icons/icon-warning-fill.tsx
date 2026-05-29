export function IconWarningFill({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      role="img"
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.56.5c.57 0 1.1.33 1.35.85l5.9 12.22a1 1 0 0 1-.9 1.43H1.09a1 1 0 0 1-.9-1.43L6.1 1.35A1.5 1.5 0 0 1 7.44.5zM8 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2m-.75-1.25h1.5v-4h-1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

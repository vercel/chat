export function IconCheckCircleFill({
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
        clipRule="evenodd"
        d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-4.47-1.47.53-.53L11 4.94l-.53.53L6.5 9.44l-.97-.97L5 7.94 3.94 9l.53.53 1.5 1.5c.3.3.77.3 1.06 0z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

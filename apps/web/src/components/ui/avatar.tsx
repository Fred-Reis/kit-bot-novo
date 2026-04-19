import { twMerge } from 'tailwind-merge';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'lg';
  className?: string;
}

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function Avatar({ name, size = 'sm', className }: AvatarProps) {
  return (
    <span
      data-slot="avatar"
      className={twMerge(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground',
        size === 'sm' ? 'size-[30px] text-xs' : 'size-[44px] text-sm',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

import { twMerge } from 'tailwind-merge';
import { CustomButton } from '@/components/ui/btn';

type Illustration =
  | 'properties'
  | 'leads'
  | 'tenants'
  | 'documents'
  | 'payments'
  | 'gallery'
  | 'filter'
  | 'activity'
  | 'contracts';

interface EmptyStateProps {
  illustration: Illustration;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const illustrations: Record<Illustration, React.ReactNode> = {
  properties: (
    <Svg>
      <rect x="16" y="40" width="64" height="44" rx="3" />
      <path d="M8 44 L48 12 L88 44" />
      <rect x="36" y="60" width="24" height="24" rx="2" />
      <line x1="48" y1="26" x2="48" y2="26" />
      <line x1="48" y1="18" x2="48" y2="10" />
      <line x1="44" y1="14" x2="52" y2="14" />
    </Svg>
  ),
  leads: (
    <Svg>
      <path d="M72 12H24a8 8 0 00-8 8v32a8 8 0 008 8h8l8 12 8-12h24a8 8 0 008-8V20a8 8 0 00-8-8z" />
      <circle cx="36" cy="36" r="3" fill="currentColor" stroke="none" />
      <circle cx="48" cy="36" r="3" fill="currentColor" stroke="none" />
      <circle cx="60" cy="36" r="3" fill="currentColor" stroke="none" />
    </Svg>
  ),
  tenants: (
    <Svg>
      <circle cx="48" cy="30" r="16" />
      <path d="M16 84c0-17.7 14.3-32 32-32s32 14.3 32 32" />
      <rect x="60" y="52" width="20" height="24" rx="3" />
      <path d="M64 52V44a6 6 0 0112 0v8" />
    </Svg>
  ),
  documents: (
    <Svg>
      <rect x="20" y="8" width="40" height="52" rx="3" />
      <rect x="28" y="16" width="48" height="52" rx="3" fill="none" />
      <line x1="36" y1="28" x2="52" y2="28" />
      <line x1="36" y1="36" x2="56" y2="36" />
      <line x1="36" y1="44" x2="48" y2="44" />
    </Svg>
  ),
  payments: (
    <Svg>
      <rect x="12" y="24" width="72" height="48" rx="6" />
      <line x1="12" y1="40" x2="84" y2="40" />
      <circle cx="48" cy="60" r="10" />
      <polyline points="42,60 46,64 54,56" />
    </Svg>
  ),
  gallery: (
    <Svg>
      <rect x="8" y="20" width="80" height="56" rx="6" />
      <circle cx="30" cy="38" r="7" />
      <polyline points="8,64 32,44 52,60 68,46 88,64" />
    </Svg>
  ),
  filter: (
    <Svg>
      <path d="M12 20h72l-28 36v28l-16-8V56L12 20z" />
      <line x1="64" y1="64" x2="84" y2="84" strokeWidth="4" />
      <line x1="84" y1="64" x2="64" y2="84" strokeWidth="4" />
    </Svg>
  ),
  activity: (
    <Svg>
      <circle cx="48" cy="48" r="36" />
      <polyline points="48,24 48,48 64,60" />
      <path d="M72 20 L80 12 M80 20 L72 12" strokeWidth="3" />
    </Svg>
  ),
  contracts: (
    <Svg>
      <rect x="16" y="8" width="64" height="80" rx="4" />
      <line x1="28" y1="28" x2="68" y2="28" />
      <line x1="28" y1="40" x2="68" y2="40" />
      <line x1="28" y1="52" x2="52" y2="52" />
      <line x1="28" y1="70" x2="68" y2="70" />
    </Svg>
  ),
};

export function EmptyState({ illustration, title, subtitle, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={twMerge(
        'flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground',
        className,
      )}
    >
      <div className="opacity-30">{illustrations[illustration]}</div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action && (
        <CustomButton variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </CustomButton>
      )}
    </div>
  );
}

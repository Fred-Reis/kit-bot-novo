import { twMerge } from 'tailwind-merge';
import type { ComponentProps } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { formatActivityLabel } from '@/lib/activity-labels';
import type { ActivityLogEntry } from '@/lib/queries';
import { relativeTime } from '@/lib/utils';

export interface ActivityRowProps extends ComponentProps<'li'> {
  entry: ActivityLogEntry;
}

export function ActivityRow({ entry, className, ...props }: ActivityRowProps) {
  const actor = entry.actorLabel ?? 'Sistema';
  const verb = formatActivityLabel(entry.action);
  return (
    <li
      data-slot="activity-row"
      className={twMerge('flex items-center justify-between px-5 py-3', className)}
      {...props}
    >
      <div className="flex items-center gap-3">
        <Avatar
          name={actor}
          size="sm"
          className="size-7 bg-muted text-[10px] text-muted-foreground"
        />
        <p className="text-xs text-foreground">
          <span className="font-medium">{actor}</span> {verb}
          {entry.subject && (
            <>
              {' '}
              <span className="font-medium">{entry.subject}</span>
            </>
          )}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {relativeTime(entry.createdAt)}
      </span>
    </li>
  );
}

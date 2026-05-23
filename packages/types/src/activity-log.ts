export type ActivityLogActorType = 'system' | 'bot' | 'user';

export type ActivityLogSubjectType =
  | 'lead'
  | 'tenant'
  | 'property'
  | 'contract'
  | 'payment'
  | 'template'
  | 'rule_set'
  | 'owner';

export interface ActivityLog {
  id: string;
  ownerId: string;
  actorType: ActivityLogActorType;
  actorId: string | null;
  actorLabel: string;
  action: string;
  subjectType: ActivityLogSubjectType;
  subjectId: string;
  subject: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

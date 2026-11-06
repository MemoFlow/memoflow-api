import { LeadSignalType } from './lead-enums';

/** Domain entity for `lead_signals` (see docs/database-schema.md). */
export class LeadSignal {
  id: string;
  userId: string;
  type: LeadSignalType;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: number;

  constructor(props: {
    id: string;
    userId: string;
    type: LeadSignalType;
    firstSeenAt: Date;
    lastSeenAt: Date;
    occurrences: number;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.type = props.type;
    this.firstSeenAt = props.firstSeenAt;
    this.lastSeenAt = props.lastSeenAt;
    this.occurrences = props.occurrences;
  }
}

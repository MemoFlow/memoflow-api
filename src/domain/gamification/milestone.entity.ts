/**
 * Domain entity for `milestones` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports.
 */
export class Milestone {
  id: string;
  userId: string;
  documentId: string;
  milestoneType: string;
  xpAwarded: number;
  createdAt: Date;

  constructor(props: {
    id: string;
    userId: string;
    documentId: string;
    milestoneType: string;
    xpAwarded: number;
    createdAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.documentId = props.documentId;
    this.milestoneType = props.milestoneType;
    this.xpAwarded = props.xpAwarded;
    this.createdAt = props.createdAt;
  }
}

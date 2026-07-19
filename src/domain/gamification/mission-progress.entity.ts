/**
 * Domain entity for `mission_progress` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports.
 */
export class MissionProgress {
  id: string;
  userId: string;
  missionId: string;
  progress: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    id: string;
    userId: string;
    missionId: string;
    progress: number;
    completed: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = props.id;
    this.userId = props.userId;
    this.missionId = props.missionId;
    this.progress = props.progress;
    this.completed = props.completed;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}

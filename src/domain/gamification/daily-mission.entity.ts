/** Shape of `daily_missions.criteria` (jsonb) — see docs/database-schema.md. */
export interface MissionCriteria {
  event: string;
  target: number;
}

/**
 * Domain entity for `daily_missions` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports.
 */
export class DailyMission {
  id: string;
  code: string;
  description: string;
  xpReward: number;
  criteria: MissionCriteria;
  activeDate: Date;
  createdAt: Date;

  constructor(props: {
    id: string;
    code: string;
    description: string;
    xpReward: number;
    criteria: MissionCriteria;
    activeDate: Date;
    createdAt: Date;
  }) {
    this.id = props.id;
    this.code = props.code;
    this.description = props.description;
    this.xpReward = props.xpReward;
    this.criteria = props.criteria;
    this.activeDate = props.activeDate;
    this.createdAt = props.createdAt;
  }
}

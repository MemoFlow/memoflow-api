import { DailyMission } from './daily-mission.entity';

export const DAILY_MISSION_REPOSITORY = Symbol('DailyMissionRepository');

export interface DailyMissionRepository {
  /** Missions whose `active_date` matches the given day (time ignored). */
  findActiveOn(date: Date): Promise<DailyMission[]>;
  findById(id: string): Promise<DailyMission | null>;
}

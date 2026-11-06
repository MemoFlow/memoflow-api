import {
  AcademicLevel,
  AcquisitionChannel,
  Blocker,
  DeliverableType,
  Persona,
  WorkTool,
} from './lead-enums';

/**
 * Domain entity for `onboarding_profiles` (see docs/database-schema.md).
 * Plain TypeScript — no typeorm imports. `dueDate` is `YYYY-MM-DD`.
 */
export class OnboardingProfile {
  userId: string;
  persona: Persona;
  deliverableType: DeliverableType;
  dueDate: string;
  academicLevel: AcademicLevel;
  schoolName: string | null;
  workTools: WorkTool[];
  blockers: Blocker[];
  acquisitionChannel: AcquisitionChannel;
  marketingOptIn: boolean;
  marketingOptInAt: Date;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;

  constructor(props: {
    userId: string;
    persona: Persona;
    deliverableType: DeliverableType;
    dueDate: string;
    academicLevel: AcademicLevel;
    schoolName: string | null;
    workTools: WorkTool[];
    blockers: Blocker[];
    acquisitionChannel: AcquisitionChannel;
    marketingOptIn: boolean;
    marketingOptInAt: Date;
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.userId = props.userId;
    this.persona = props.persona;
    this.deliverableType = props.deliverableType;
    this.dueDate = props.dueDate;
    this.academicLevel = props.academicLevel;
    this.schoolName = props.schoolName;
    this.workTools = props.workTools;
    this.blockers = props.blockers;
    this.acquisitionChannel = props.acquisitionChannel;
    this.marketingOptIn = props.marketingOptIn;
    this.marketingOptInAt = props.marketingOptInAt;
    this.submittedAt = props.submittedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}

/**
 * Enum string values come verbatim from docs/contracts/lead-scoring.md.
 */
export enum Persona {
  Apprentice = 'apprentice',
  Intern = 'intern',
  Student = 'student',
  Other = 'other',
}

export enum DeliverableType {
  Thesis = 'thesis',
  ApprenticeshipReport = 'apprenticeship_report',
  InternshipReport = 'internship_report',
  Other = 'other',
}

export enum AcademicLevel {
  L3 = 'l3',
  M1 = 'm1',
  M2 = 'm2',
  Other = 'other',
}

export enum WorkTool {
  Trello = 'trello',
  Notion = 'notion',
  Teams = 'teams',
  Slack = 'slack',
  Email = 'email',
  Drive = 'drive',
  Other = 'other',
}

export enum Blocker {
  GettingStarted = 'getting_started',
  FindingPastWork = 'finding_past_work',
  Structuring = 'structuring',
  Writing = 'writing',
  LackOfTime = 'lack_of_time',
}

export enum AcquisitionChannel {
  Friend = 'friend',
  School = 'school',
  Tiktok = 'tiktok',
  Instagram = 'instagram',
  Linkedin = 'linkedin',
  Google = 'google',
  Other = 'other',
}

export enum LeadSignalType {
  ExportPaywallHit = 'export_paywall_hit',
}

export enum LeadTier {
  Hot = 'hot',
  Warm = 'warm',
  Cold = 'cold',
}

export enum SuggestedAction {
  InterviewAndProOffer = 'interview_and_pro_offer',
  ScheduledEmails = 'scheduled_emails',
  Newsletter = 'newsletter',
  NoOutreach = 'no_outreach',
}

export enum ScoreRule {
  DueWithin3Months = 'due_within_3_months',
  DueWithin3To6Months = 'due_within_3_to_6_months',
  PersonaApprentice = 'persona_apprentice',
  PersonaIntern = 'persona_intern',
  CitedTrello = 'cited_trello',
  ConnectedTool = 'connected_tool',
  ExportPaywallHit = 'export_paywall_hit',
}

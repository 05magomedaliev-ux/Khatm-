/** Контракт HTTP API: один набор типов для сервера и клиента. */
import type { AchievementCode } from './achievements.js';
import type { DayStatus, LedgerDay } from './ledger.js';
import type { MemberStats } from './stats.js';

export type MemberRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'blocked' | 'removed';
export type ReportKind = 'count' | 'range';

export interface UserView {
  id: string;
  telegramId: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
}

export interface MembershipView {
  groupId: string;
  groupName: string;
  memberId: string;
  displayName: string;
  role: MemberRole;
}

export interface MeResponse {
  user: UserView;
  memberships: MembershipView[];
}

export interface ReportView {
  id: string;
  memberId: string;
  memberName: string;
  kind: ReportKind;
  pages: number;
  startPage: number | null;
  endPage: number | null;
  readOn: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  canEdit: boolean;
}

export interface ReportInput {
  clientRequestId?: string;
  kind: ReportKind;
  pages?: number;
  startPage?: number;
  endPage?: number;
  readOn: string;
  note?: string | null;
  confirmRepeat?: boolean;
}

export interface RepeatWarningDetails {
  reason: 'range_overlap' | 'possible_duplicate';
  overlaps: {
    reportId: string;
    startPage: number;
    endPage: number;
    readOn: string;
    overlapStart: number;
    overlapEnd: number;
  }[];
}

export interface ReportWriteResponse {
  report: ReportView;
  /** true — запрос был повторной отправкой, новый отчёт не создан. */
  duplicate: boolean;
  day: LedgerDay | null;
  newAchievements: AchievementCode[];
}

export interface ReportEventView {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  actorName: string | null;
  createdAt: string;
  before: ReportSnapshot | null;
  after: ReportSnapshot | null;
}

export interface ReportSnapshot {
  kind: ReportKind;
  pages: number;
  startPage: number | null;
  endPage: number | null;
  readOn: string;
  note: string | null;
}

export interface GroupView {
  id: string;
  name: string;
  timezone: string;
  dailyMinimum: number;
  isAdmin: boolean;
  myMemberId: string;
}

export interface DashboardResponse {
  group: GroupView;
  progress: {
    memberCount: number;
    goalPages: number;
    totalPages: number;
    countedPages: number;
    percent: number;
  };
  today: {
    date: string;
    dailyMinimum: number;
    groupGoal: number;
    pages: number;
    metCount: number;
    startedCount: number;
    reportedCount: number;
    members: { memberId: string; name: string; status: DayStatus | 'not_joined' }[];
  };
  me: { memberId: string; stats: MemberStats; startedOn: string | null };
  motivation: string;
  recentReports: ReportView[];
}

export interface PersonRef {
  memberId: string;
  name: string;
}

export interface DisciplineResponse {
  date: string;
  pagesToday: number;
  groupGoal: number;
  met: (PersonRef & { pages: number })[];
  partial: (PersonRef & { pages: number; norm: number })[];
  pending: PersonRef[];
  notJoined: PersonRef[];
  missedYesterday: PersonRef[];
  debts: (PersonRef & { debt: number })[];
  cleared: (PersonRef & { date: string })[];
  longestStreak: { days: number; people: PersonRef[] } | null;
}

export interface PagesRankRow extends PersonRef {
  rank: number | null;
  totalPages: number;
  percent: number;
  isMe: boolean;
}

export interface DisciplineRankRow extends PersonRef {
  rank: number | null;
  score: number | null;
  completion: number | null;
  streakScore: number | null;
  debtScore: number | null;
  closedDays: number;
  closedStreak: number;
  closedDebt: number;
  isMe: boolean;
}

export interface LeaderboardsResponse {
  pages: PagesRankRow[];
  discipline: DisciplineRankRow[];
}

export interface AchievementView {
  code: AchievementCode;
  title: string;
  description: string;
  target: number;
  progress: number;
  earnedAt: string | null;
}

export interface ProfileResponse {
  member: PersonRef & { role: MemberRole; startedOn: string | null; photoUrl: string | null; isMe: boolean };
  today: string;
  stats: MemberStats;
  series: { date: string; pages: number; norm: number; status: DayStatus }[];
  achievements: AchievementView[];
  motivation: string;
}

export interface CalendarDay {
  date: string;
  pages: number;
  norm: number | null;
  status: DayStatus;
  provisional: boolean;
}

export interface CalendarResponse {
  month: string;
  today: string;
  startedOn: string | null;
  member: PersonRef;
  members: PersonRef[];
  days: CalendarDay[];
}

export interface DayDetailResponse {
  date: string;
  member: PersonRef;
  entry: LedgerDay | null;
  reports: ReportView[];
  groupPages: number;
  groupMet: number;
  groupStarted: number;
}

export interface InviteView {
  id: string;
  code: string;
  link: string;
  usedCount: number;
  maxUses: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface InvitePreview {
  groupId: string;
  groupName: string;
  memberCount: number;
  alreadyMember: boolean;
  unclaimed: PersonRef[];
}

export interface MemberAdminView extends PersonRef {
  role: MemberRole;
  status: MemberStatus;
  claimed: boolean;
  username: string | null;
  startedOn: string | null;
}

export interface GroupSettingsView {
  id: string;
  name: string;
  timezone: string;
  dailyMinimum: number;
  reminderTime: string;
  reportTime: string;
  remindersEnabled: boolean;
  reportsEnabled: boolean;
  chatTitle: string | null;
  chatLinked: boolean;
  linkCode: string | null;
}

export interface AdminResponse {
  settings: GroupSettingsView;
  members: MemberAdminView[];
  invites: InviteView[];
  myRole: MemberRole;
}

export interface MemberNotificationSettings {
  remindersEnabled: boolean;
  reminderTime: string | null;
  dailyReportEnabled: boolean;
  achievementsEnabled: boolean;
  groupReminderTime: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

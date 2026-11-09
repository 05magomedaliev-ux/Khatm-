import type {
  AdminResponse, ApiErrorBody, CalendarResponse, DashboardResponse, DayDetailResponse, DisciplineResponse,
  GroupSettingsView, InvitePreview, InviteView, LeaderboardsResponse, MeResponse, MemberNotificationSettings,
  MemberRole, MemberStatus, ProfileResponse, ReportEventView, ReportInput, ReportView, ReportWriteResponse,
} from '@khatm/shared';
import { webApp } from './telegram';

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const initData = webApp()?.initData ?? '';
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        Authorization: `tma ${initData}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверьте интернет и повторите.');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(response.status, err?.code ?? 'unknown', err?.message ?? 'Сервер вернул ошибку.', err?.details);
  }
  return data as T;
}

const g = (groupId: string) => `/groups/${groupId}`;

export const api = {
  me: () => request<MeResponse>('GET', '/me'),
  createGroup: (input: { name: string; timezone: string; dailyMinimum: number; displayName: string }) =>
    request<{ groupId: string }>('POST', '/groups', input),
  invitePreview: (code: string) => request<InvitePreview>('GET', `/invites/${encodeURIComponent(code)}`),
  joinInvite: (code: string, input: { memberId?: string; displayName?: string }) =>
    request<{ groupId: string }>('POST', `/invites/${encodeURIComponent(code)}/join`, input),

  dashboard: (groupId: string) => request<DashboardResponse>('GET', `${g(groupId)}/dashboard`),
  discipline: (groupId: string) => request<DisciplineResponse>('GET', `${g(groupId)}/discipline`),
  leaderboards: (groupId: string) => request<LeaderboardsResponse>('GET', `${g(groupId)}/leaderboards`),
  profile: (groupId: string, memberId: string) =>
    request<ProfileResponse>('GET', `${g(groupId)}/members/${memberId}/profile`),
  calendar: (groupId: string, memberId: string, month: string) =>
    request<CalendarResponse>('GET', `${g(groupId)}/members/${memberId}/calendar?month=${month}`),
  day: (groupId: string, memberId: string, date: string) =>
    request<DayDetailResponse>('GET', `${g(groupId)}/members/${memberId}/days/${date}`),

  reports: (groupId: string, params: { memberId?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.memberId) query.set('member_id', params.memberId);
    if (params.limit) query.set('limit', String(params.limit));
    return request<{ reports: ReportView[] }>('GET', `${g(groupId)}/reports?${query}`);
  },
  createReport: (groupId: string, input: ReportInput) =>
    request<ReportWriteResponse>('POST', `${g(groupId)}/reports`, input),
  updateReport: (groupId: string, reportId: string, input: ReportInput) =>
    request<ReportWriteResponse>('PATCH', `${g(groupId)}/reports/${reportId}`, input),
  deleteReport: (groupId: string, reportId: string) =>
    request<void>('DELETE', `${g(groupId)}/reports/${reportId}`),
  reportHistory: (groupId: string, reportId: string) =>
    request<{ events: ReportEventView[] }>('GET', `${g(groupId)}/reports/${reportId}/history`),

  admin: (groupId: string) => request<AdminResponse>('GET', `${g(groupId)}/admin`),
  updateSettings: (groupId: string, input: Partial<Omit<GroupSettingsView, 'id' | 'chatTitle' | 'chatLinked' | 'linkCode'>>) =>
    request<GroupSettingsView>('PATCH', `${g(groupId)}/settings`, input),
  createInvite: (groupId: string) => request<InviteView>('POST', `${g(groupId)}/invites`, {}),
  revokeInvite: (groupId: string, inviteId: string) =>
    request<void>('DELETE', `${g(groupId)}/invites/${inviteId}`),
  addMember: (groupId: string, displayName: string) =>
    request<{ memberId: string }>('POST', `${g(groupId)}/members`, { displayName }),
  updateMember: (
    groupId: string,
    memberId: string,
    input: { status?: MemberStatus; role?: MemberRole; startedOn?: string; displayName?: string },
  ) => request<void>('PATCH', `${g(groupId)}/members/${memberId}`, input),
  setPagesBefore: (groupId: string, memberId: string, pages: number) =>
    request<{ pagesBefore: number; totalPages: number }>('PATCH', `${g(groupId)}/members/${memberId}/pages-before`, { pages }),
  createLinkCode: (groupId: string) => request<{ linkCode: string }>('POST', `${g(groupId)}/link-code`, {}),
  unlinkChat: (groupId: string) => request<void>('DELETE', `${g(groupId)}/chat`),
  publishStats: (groupId: string) => request<{ sent: boolean }>('POST', `${g(groupId)}/publish-stats`, {}),

  notifications: (groupId: string) =>
    request<MemberNotificationSettings>('GET', `${g(groupId)}/my-notifications`),
  updateNotifications: (groupId: string, input: Partial<Omit<MemberNotificationSettings, 'groupReminderTime'>>) =>
    request<MemberNotificationSettings>('PATCH', `${g(groupId)}/my-notifications`, input),
  sendCard: (groupId: string, imageBase64: string) =>
    request<{ sent: boolean }>('POST', `${g(groupId)}/card`, { imageBase64 }),
};

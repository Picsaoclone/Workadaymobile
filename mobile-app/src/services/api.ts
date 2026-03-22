import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import {
  ApiResponse,
  AttendanceRecord,
  AttendanceCompanyDay,
  AttendanceCompanyRangeSummary,
  AttendanceRangeSummary,
  AuthUser,
  CompanyWorkSettings,
  JobRole,
  Channel,
  Company,
  EmployeeReport,
  LeaveRecord,
  Message,
  MessageAttachment,
  Notification,
  Project,
  Meeting,
  Task,
  CompanyDocument,
  DocumentStats,
} from '../types/models';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  // Avoid cached/conditional responses (e.g., 304) that may return no body on some clients.
  config.headers = config.headers || {};
  (config.headers as any)['Cache-Control'] = 'no-cache';
  (config.headers as any)['Pragma'] = 'no-cache';
  (config.headers as any)['Expires'] = '0';
  try {
    delete (config.headers as any)['If-None-Match'];
    delete (config.headers as any)['if-none-match'];
  } catch {
    // ignore
  }

  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email: string, password: string) => api.post<ApiResponse<{ user: AuthUser; token: string }>>('/auth/login', { email, password }),
  register: (payload: { name: string; email: string; password: string; phone?: string; inviteCode?: string }) =>
    api.post<ApiResponse<{ user: AuthUser; token: string }>>('/auth/register', payload),
  me: () => api.get<ApiResponse<AuthUser>>('/auth/me'),
};

export const companyApi = {
  create: (payload: { name: string; industry: string; size: string; website?: string; address?: string }) =>
    api.post('/companies', payload),
  getMyInviteCode: () =>
    api.get<ApiResponse<{ companyId: string; name: string; inviteCode: string; customInviteCode?: string }>>(
      '/companies/my/invite-code'
    ),
  setCustomInviteCode: (payload: { code: string }) =>
    api.put<ApiResponse<{ customInviteCode: string }>>('/companies/my/custom-invite-code', payload),
  getById: (id: string) => api.get<ApiResponse<Company>>(`/companies/${id}`),
  getJobRoles: () => api.get<ApiResponse<JobRole[]>>('/companies/my/job-roles'),
  createJobRole: (payload: { name: string; colorToken: JobRole['colorToken'] }) =>
    api.post<ApiResponse<JobRole>>('/companies/my/job-roles', payload),
  getWorkSettings: () => api.get<ApiResponse<CompanyWorkSettings>>('/companies/my/work-settings'),
  updateWorkSettings: (payload: { start?: string; end?: string; annualLeave?: number }) =>
    api.patch<ApiResponse<CompanyWorkSettings>>('/companies/my/work-settings', payload),
};

export const userApi = {
  getAll: () => api.get<ApiResponse<AuthUser[]>>('/users'),
  getReviewers: () => api.get<ApiResponse<Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>[]>>('/users/reviewers'),
  getById: (id: string) => api.get<ApiResponse<AuthUser>>(`/users/${id}`),
  updateProfile: (id: string, payload: Partial<AuthUser>) => api.patch<ApiResponse<AuthUser>>(`/users/${id}`, payload),
};

export const taskApi = {
  getAll: (params?: { projectId?: string; assignedTo?: string; status?: string }) => api.get<ApiResponse<Task[]>>('/tasks', { params }),
  create: (payload: {
    projectId?: string;
    title: string;
    description?: string;
    status?: 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    assignedTo: string;
    dueDate?: string;
    startDate?: string;
    progress?: number;
    subtasks?: string[];
    dependencies?: string[];
  }) => api.post<ApiResponse<Task>>('/tasks', payload),
  update: (id: string, payload: Partial<Task>) => api.patch<ApiResponse<Task>>(`/tasks/${id}`, payload),
};

export const projectApi = {
  getAll: () => api.get<ApiResponse<Project[]>>('/projects'),
  getById: (id: string) => api.get<ApiResponse<Project>>(`/projects/${id}`),
  update: (id: string, payload: Partial<Project>) => api.patch<ApiResponse<Project>>(`/projects/${id}`, payload),
  create: (payload: {
    name: string;
    description?: string;
    status: 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    leadId: string;
    teamIds: string[];
    startDate?: string;
    endDate?: string;
    progress?: number;
    color?: string;
  }) => api.post<ApiResponse<Project>>('/projects', payload),
};

export const meetingApi = {
  getAll: (params?: { range?: 'today' | 'upcoming' | 'past'; from?: string; to?: string; status?: string }) =>
    api.get<ApiResponse<Meeting[]>>('/meetings', { params }),
  create: (payload: {
    title: string;
    description?: string;
    startAt: string;
    durationMinutes: number;
    participantIds: string[];
    projectId?: string;
    reminderMinutesBefore?: number;
    callMode?: 'voice' | 'video';
  }) => api.post<ApiResponse<Meeting>>('/meetings', payload),
  respond: (id: string, status: 'accepted' | 'declined') =>
    api.patch<ApiResponse<Meeting>>(`/meetings/${id}/respond`, { status }),
  start: (id: string) =>
    api.post<ApiResponse<{ agoraChannelName: string; mode: 'voice' | 'video'; title?: string }>>(`/meetings/${id}/start`, {}),
};

export const documentApi = {
  getAll: (params?: { tab?: 'all' | 'important' | 'recent'; category?: string; q?: string }) =>
    api.get<ApiResponse<CompanyDocument[]>>('/documents', { params }),
  stats: () => api.get<ApiResponse<DocumentStats>>('/documents/stats'),
  toggleStar: (id: string, isStarred?: boolean) => api.patch<ApiResponse<CompanyDocument>>(`/documents/${id}/star`, { isStarred }),
  upload: (payload: { file: { uri: string; name: string; type: string }; title?: string; category: string; isStarred?: boolean }) => {
    const form = new FormData();
    form.append('file', payload.file as any);
    form.append('category', payload.category);
    if (payload.title) form.append('title', payload.title);
    if (typeof payload.isStarred === 'boolean') form.append('isStarred', String(payload.isStarred));
    return api.post<ApiResponse<CompanyDocument>>('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

export const channelApi = {
  getAll: () => api.get<ApiResponse<Channel[]>>('/channels'),
  create: (payload: {
    name: string;
    description?: string;
    type: 'public' | 'private' | 'dm';
    memberIds?: string[];
    dmUserIds?: [string, string];
  }) => api.post<ApiResponse<Channel>>('/channels', payload),
  addMembers: (channelId: string, memberIds: string[]) => api.post<ApiResponse<Channel>>(`/channels/${channelId}/members`, { memberIds }),
};

export const messageApi = {
  getByChannel: (channelId: string) => api.get<ApiResponse<Message[]>>(`/messages/channel/${channelId}`),
  send: (payload: { channelId: string; content: string; type?: Message['type']; attachments?: MessageAttachment[]; replyTo?: string }) =>
    api.post<ApiResponse<Message>>('/messages', payload),
};

type AgoraTokenResponse = {
  success: boolean;
  message?: string;
  data?: {
    appId: string;
    token: string;
    channelName: string;
    uid: number;
    expiresAt: number;
  };
};

export const agoraApi = {
  token: (payload: { channelName: string; uid: number; role?: 'publisher' | 'subscriber'; expireSeconds?: number }) =>
    api.post<AgoraTokenResponse>('/agora/token', payload),
};

export const uploadApi = {
  uploadImage: (file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('file', file as any);
    return api.post<ApiResponse<MessageAttachment & { publicId: string; resourceType: string }>>('/upload/image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadFile: (file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('file', file as any);
    return api.post<ApiResponse<MessageAttachment & { publicId: string; resourceType: string }>>('/upload/file', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const attendanceApi = {
  getAll: () => api.get<ApiResponse<AttendanceRecord[]>>('/attendance'),
  clockIn: (location?: string) => api.post('/attendance/clock-in', { location }),
  clockOut: () => api.post('/attendance/clock-out'),
  getMyRange: (params: { from: string; to: string }) => api.get<ApiResponse<AttendanceRangeSummary>>('/attendance/my/range', { params }),
  getCompanyDay: (params: { date: string }) => api.get<ApiResponse<AttendanceCompanyDay>>('/attendance/company/day', { params }),
  getCompanyRange: (params: { from: string; to: string }) => api.get<ApiResponse<AttendanceCompanyRangeSummary>>('/attendance/company/range', { params }),
};

export const leaveApi = {
  getAll: () => api.get<ApiResponse<LeaveRecord[]>>('/leave'),
  create: (payload: {
    type: 'annual' | 'sick' | 'unpaid' | 'other';
    leaveType?: string;
    assignedTo: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string;
  }) =>
    api.post<ApiResponse<LeaveRecord>>('/leave', payload),
  review: (id: string, status: 'approved' | 'rejected', reviewNotes?: string) =>
    api.patch<ApiResponse<LeaveRecord>>(`/leave/${id}/review`, { status, reviewNotes }),
};

export const reportApi = {
  getAll: () => api.get<ApiResponse<EmployeeReport[]>>('/reports'),
  create: (payload: {
    assignedTo: string;
    managerId?: string; // legacy
    projectId?: string;
    title: string;
    content: string;
    attachments?: MessageAttachment[];
    status?: 'draft' | 'submitted';
  }) => api.post<ApiResponse<EmployeeReport>>('/reports', payload),
  markViewed: (id: string) => api.patch<ApiResponse<EmployeeReport>>(`/reports/${id}/viewed`, {}),
  review: (id: string, payload: { status: 'approved' | 'changes_requested'; feedback?: string }) =>
    api.patch<ApiResponse<EmployeeReport>>(`/reports/${id}/review`, payload),
  update: (id: string, payload: Partial<{
    assignedTo: string;
    managerId: string;
    projectId: string;
    title: string;
    content: string;
    attachments: MessageAttachment[];
    status: 'draft' | 'submitted';
  }>) => api.patch<ApiResponse<EmployeeReport>>(`/reports/${id}`, payload),
};

export const pushTokenApi = {
  register: (payload: { token: string; platform?: 'ios' | 'android' | 'web'; provider?: 'expo' | 'fcm' }) =>
    api.post('/push-tokens/register', payload),
  unregister: (payload: { token: string }) => api.post('/push-tokens/unregister', payload),
};

type NotificationsListResponse = {
  success: boolean;
  message?: string;
  data: Notification[];
  unreadCount: number;
};

type NotificationSimpleResponse = {
  success: boolean;
  message?: string;
};

export const notificationApi = {
  getAll: () => api.get<NotificationsListResponse>('/notifications'),
  markRead: (id: string) => api.patch<NotificationSimpleResponse>(`/notifications/${id}/read`, {}),
  readAll: () => api.patch<NotificationSimpleResponse>('/notifications/read-all', {}),
  readByLink: (payload: { link: string }) => api.patch<NotificationSimpleResponse>('/notifications/read-by-link', payload),
};

type FriendRequestsResponse = {
  success: boolean;
  message?: string;
  data: {
    incoming: Array<{ _id: string; createdAt?: string; fromUser: AuthUser }>;
    outgoing: Array<{ _id: string; createdAt?: string; toUser: AuthUser }>;
  };
};

export const friendApi = {
  lookup: (phone: string) => api.get<ApiResponse<AuthUser>>('/friends/lookup', { params: { phone } }),
  sendRequest: (phone: string) => api.post<ApiResponse<any>>('/friends/requests', { phone }),
  getRequests: () => api.get<FriendRequestsResponse>('/friends/requests'),
  accept: (requestId: string) => api.post<ApiResponse<any>>(`/friends/requests/${requestId}/accept`, {}),
  reject: (requestId: string) => api.post<ApiResponse<any>>(`/friends/requests/${requestId}/reject`, {}),
  getFriends: () => api.get<ApiResponse<AuthUser[]>>('/friends/friends'),
};

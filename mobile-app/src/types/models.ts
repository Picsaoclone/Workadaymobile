export type UserRole = 'admin' | 'manager' | 'employee';

export type JobRoleColorToken = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'purple' | 'teal';

export interface JobRole {
  key: string;
  name: string;
  colorToken: JobRoleColorToken;
}

export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  jobRoleKey?: string | null;
  companyId?: string;
  phone?: string;
  position?: string;
  avatar?: string;
  isActive: boolean;
  leaveBalance?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface Company {
  _id: string;
  name: string;
  industry?: string;
  size?: string;
  address?: string;
  phone?: string;
  website?: string;
  logo?: string;
  inviteCode?: string;
  customInviteCode?: string;
  ownerId?: string;
  createdAt?: string;
}

export interface Task {
  _id: string;
  projectId?: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo: string;
  assignedBy: string;
  dueDate?: string;
  startDate?: string;
  completedAt?: string;
  progress: number;
  subtasks?: string[];
  dependencies?: string[];
  attachments?: string[];
  createdAt: string;
}

export interface Project {
  _id: string;
  name: string;
  description?: string;
  status: 'planning' | 'active' | 'on-hold' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  leadId: string;
  teamIds: string[];
  startDate?: string;
  endDate?: string;
  progress: number;
  color?: string;
  createdAt: string;
}

export type MeetingParticipantStatus = 'invited' | 'accepted' | 'declined';
export type MeetingCallMode = 'voice' | 'video';
export type MeetingStatus = 'scheduled' | 'cancelled';

export interface MeetingParticipant {
  userId: string;
  status: MeetingParticipantStatus;
  respondedAt?: string;
}

export interface Meeting {
  _id: string;
  companyId: string;
  title: string;
  description?: string | null;
  startAt: string;
  durationMinutes: number;
  projectId?: string | null;
  createdBy: string;
  participants: MeetingParticipant[];
  reminderMinutesBefore: number;
  remindedAt?: string | null;
  callInvitedAt?: string | null;
  callMode: MeetingCallMode;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
}

export type DocumentCategory = 'Kỹ thuật' | 'Thiết kế' | 'Marketing' | 'Nhân sự';

export interface CompanyDocument {
  _id: string;
  companyId: string;
  title: string;
  category: DocumentCategory;
  fileUrl: string;
  publicId: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByName: string;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentStats {
  usedBytes: number;
  quotaBytes: number;
  count: number;
}

export interface Channel {
  _id: string;
  companyId: string;
  name: string;
  description?: string;
  type: 'public' | 'private' | 'dm';
  memberIds: string[];
  adminIds: string[];
  dmUserIds?: [string, string];
  isPinned?: boolean;
  lastMessageAt?: string;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageType?: 'text' | 'image' | 'file' | 'system';
  createdBy: string;
}

export interface Message {
  _id: string;
  companyId: string;
  channelId?: string;
  senderId: string;
  recipientId?: string;
  content: string;
  type: 'text' | 'file' | 'image' | 'system';
  attachments?: MessageAttachment[];
  replyTo?: string;
  createdAt: string;
}

export interface MessageAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
  resourceType?: 'image' | 'file';
}

export interface AttendanceRecord {
  _id: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  status: 'present' | 'late' | 'absent' | 'leave';
  hoursWorked?: number;
}

export type AttendanceDayStatus = 'present' | 'late' | 'absent' | 'leave';

export type AttendanceDay = {
  date: string; // YYYY-MM-DD
  clockIn?: string;
  clockOut?: string;
  hoursWorked?: number;
  status: AttendanceDayStatus;
};

export type AttendanceRangeSummary = {
  workingHours: { start: string; end: string };
  range: { from: string; to: string };
  days: AttendanceDay[];
  stats: {
    workedDays: number;
    totalHours: number;
    avgHoursPerDay: number;
    presentDays: number;
    lateDays: number;
    leaveDays: number;
    absentDays: number;
  };
};

export type CompanyWorkSettings = {
  workingHours: { start: string; end: string };
  workingDays: number[];
  annualLeave: number;
  timezone: string;
};

export type AttendanceCompanyDayRow = {
  user: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  day: AttendanceDay;
};

export type AttendanceCompanyDay = {
  workingHours: { start: string; end: string };
  date: string;
  rows: AttendanceCompanyDayRow[];
};

export type AttendanceCompanyRangeRow = {
  user: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  stats: AttendanceRangeSummary['stats'];
};

export type AttendanceCompanyRangeSummary = {
  workingHours: { start: string; end: string };
  range: { from: string; to: string };
  overall: AttendanceRangeSummary['stats'];
  rows: AttendanceCompanyRangeRow[];
};

export interface LeaveRecord {
  _id: string;
  type?: 'annual' | 'sick' | 'unpaid' | 'other';
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewNotes?: string;
  assignedTo?: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  reviewedByUser?: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  user?: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
}

export interface EmployeeReport {
  _id: string;
  userId: string;
  managerId?: string; // legacy
  assignedTo?: string;
  projectId?: string;
  title?: string;
  date?: string;
  type?: 'daily' | 'weekly' | 'monthly';
  content: string;
  tasksCompleted?: string[];
  attachments?: MessageAttachment[];
  status: 'draft' | 'submitted' | 'viewed' | 'approved' | 'changes_requested';
  feedback?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  viewedAt?: string;
  createdAt: string;

  user?: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  assignedToUser?: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  reviewedByUser?: Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
  project?: Pick<Project, '_id' | 'name'>;
}

export type NotificationType =
  | 'task_assigned'
  | 'leave_approved'
  | 'leave_rejected'
  | 'report_submitted'
  | 'message'
  | 'mention'
  | 'project_update'
  | 'system';

export interface Notification {
  _id: string;
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt?: string;
}

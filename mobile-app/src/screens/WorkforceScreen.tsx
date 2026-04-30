import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Rect } from 'react-native-svg';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { SectionTitle } from '../components/SectionTitle';
import { colors } from '../theme/colors';
import { attendanceApi, companyApi, meetingApi, projectApi, taskApi, userApi } from '../services/api';
import { AuthUser, JobRole, Meeting, Project, Task } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { hexToRgba } from '../utils/color';

type WorkforceStatus = 'working' | 'idle' | 'meeting' | 'leave' | 'offline';

type SummaryCardKey = 'total' | WorkforceStatus;

const TASK_STATUS_ORDER: Array<Task['status']> = ['todo', 'in-progress', 'review', 'done'];

const TASK_STATUS_LABEL: Record<Task['status'], string> = {
  todo: 'Todo',
  'in-progress': 'Đang làm',
  review: 'Review',
  done: 'Done',
  cancelled: 'Đã hủy',
};

const TASK_STATUS_COLOR: Record<Task['status'], string> = {
  todo: hexToRgba(colors.muted, 0.65),
  'in-progress': colors.primary,
  review: colors.purple,
  done: colors.success,
  cancelled: colors.danger,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string) {
  const value = String(hex || '').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { r, g, b };
}

function isDarkColor(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const { r, g, b } = rgb;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.55;
}

function isNowInMeetingWindow(meeting: Meeting, now: Date) {
  if (meeting.status !== 'scheduled') return false;
  const start = new Date(meeting.startAt);
  const end = new Date(start.getTime() + Math.max(0, Number(meeting.durationMinutes || 0)) * 60_000);
  return now >= start && now <= end;
}

function initials(name: string) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const a = parts[0]?.[0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
  return (a + b).toUpperCase();
}

function formatPercent(value: number) {
  const n = Math.round(clamp(Number.isFinite(value) ? value : 0, 0, 100));
  return `${n}%`;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamp(value, 0, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  const baseColor = color || colors.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: hexToRgba(baseColor, active ? 0.18 : 0.08),
          borderColor: hexToRgba(baseColor, active ? 0.62 : 0.28),
        },
      ]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : undefined]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  tint,
}: {
  title: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}) {
  const dark = isDarkColor(tint);
  const iconColor = dark ? colors.card : colors.primaryDark;
  return (
    <Card
      style={[
        styles.summaryCard,
        {
          backgroundColor: hexToRgba(tint, 0.22),
          borderColor: hexToRgba(tint, 0.6),
        },
      ]}
    >
      <View style={[styles.summaryIcon, { backgroundColor: hexToRgba(tint, 0.95), borderColor: hexToRgba(tint, 0.75) }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={styles.summaryValue}>{String(value)}</Text>
      <Text style={styles.summaryLabel}>{title}</Text>
    </Card>
  );
}

function DonutChart({
  size,
  strokeWidth,
  segments,
}: {
  size: number;
  strokeWidth: number;
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={radius} stroke={hexToRgba(colors.border, 0.6)} strokeWidth={strokeWidth} fill="transparent" />
      <G rotation={-90} originX={cx} originY={cy}>
        {segments
          .filter((s) => s.value > 0)
          .map((seg) => {
            const frac = total > 0 ? seg.value / total : 0;
            const dash = circumference * frac;
            const gap = circumference - dash;
            const node = (
              <Circle
                key={seg.label}
                cx={cx}
                cy={cy}
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="transparent"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return node;
          })}
      </G>
    </Svg>
  );
}

function StackedBars({
  height,
  width,
  items,
}: {
  height: number;
  width: number;
  items: Array<{ key: string; label: string; stacks: Array<{ value: number; color: string }> }>;
}) {
  const barWidth = 22;
  const gap = 14;
  const chartHeight = height;
  const maxValue = Math.max(1, ...items.map((it) => it.stacks.reduce((s, x) => s + Math.max(0, x.value), 0)));

  return (
    <Svg width={width} height={height}>
      {items.map((it, index) => {
        const x = index * (barWidth + gap);
        let y = chartHeight;
        return (
          <G key={it.key}>
            {it.stacks.map((s, stackIndex) => {
              const h = (chartHeight * Math.max(0, s.value)) / maxValue;
              y -= h;
              return (
                <Rect
                  key={`${it.key}-${stackIndex}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={h}
                  rx={6}
                  ry={6}
                  fill={s.color}
                />
              );
            })}
          </G>
        );
      })}
    </Svg>
  );
}

export function WorkforceScreen() {
  const me = useAuthStore((s) => s.user);

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<
    Array<{ userId: string; status: 'present' | 'late' | 'absent' | 'leave' }>
  >([]);

  const [statusFilter, setStatusFilter] = useState<'all' | WorkforceStatus>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const loadAll = useCallback(async () => {
    if (!me) return;
    if (me.role !== 'admin') {
      setLoading(false);
      return;
    }

    setRefreshing(true);
    try {
      const [usersRes, rolesRes, tasksRes, projectsRes, meetingsRes, attendanceRes] = await Promise.all([
        userApi.getAll(),
        companyApi.getJobRoles(),
        taskApi.getAll(),
        projectApi.getAll(),
        meetingApi.getAll({ range: 'today' }),
        attendanceApi.getCompanyDay({ date: todayKey }),
      ]);

      setUsers(usersRes.data.data || []);
      setJobRoles(rolesRes.data.data || []);
      setTasks(tasksRes.data.data || []);
      setProjects(projectsRes.data.data || []);
      setMeetings(meetingsRes.data.data || []);

      const rows = attendanceRes.data.data?.rows || [];
      setAttendanceRows(
        rows.map((r: any) => ({ userId: r.user?._id, status: r.day?.status })).filter((r: any) => Boolean(r.userId && r.status))
      );
    } catch {
      // Keep UI stable even if some endpoints fail.
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [me, todayKey]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAll();
    }, [loadAll])
  );

  const activeUsers = useMemo(() => users.filter((u) => u.isActive), [users]);

  const meetingUserIds = useMemo(() => {
    const now = new Date();
    const ids = new Set<string>();
    for (const m of meetings) {
      if (!isNowInMeetingWindow(m, now)) continue;
      for (const p of m.participants || []) {
        if (p.status === 'declined') continue;
        if (p.userId) ids.add(String(p.userId));
      }
    }
    return ids;
  }, [meetings]);

  const attendanceByUserId = useMemo(() => {
    const map = new Map<string, 'present' | 'late' | 'absent' | 'leave'>();
    for (const r of attendanceRows) map.set(String(r.userId), r.status);
    return map;
  }, [attendanceRows]);

  const statusByUserId = useMemo(() => {
    const map = new Map<string, WorkforceStatus>();
    for (const u of activeUsers) {
      const id = String(u._id);
      if (meetingUserIds.has(id)) {
        map.set(id, 'meeting');
        continue;
      }

      const dayStatus = attendanceByUserId.get(id);
      if (!dayStatus) {
        map.set(id, 'offline');
        continue;
      }
      if (dayStatus === 'leave') {
        map.set(id, 'leave');
        continue;
      }
      if (dayStatus === 'present' || dayStatus === 'late') {
        map.set(id, 'working');
        continue;
      }
      map.set(id, 'idle');
    }
    return map;
  }, [activeUsers, attendanceByUserId, meetingUserIds]);

  const summary = useMemo(() => {
    const counts: Record<SummaryCardKey, number> = {
      total: activeUsers.length,
      working: 0,
      idle: 0,
      meeting: 0,
      leave: 0,
      offline: 0,
    };

    for (const u of activeUsers) {
      const st = statusByUserId.get(String(u._id)) || 'offline';
      counts[st] += 1;
    }

    return counts;
  }, [activeUsers.length, activeUsers, statusByUserId]);

  const tasksByUserId = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = String(t.assignedTo);
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const stackedBarItems = useMemo(() => {
    const items = activeUsers
      .slice()
      .sort((a, b) => (tasksByUserId.get(a._id)?.length || 0) - (tasksByUserId.get(b._id)?.length || 0))
      .reverse()
      .slice(0, 8)
      .map((u) => {
        const userTasks = tasksByUserId.get(u._id) || [];
        const counts: Record<Task['status'], number> = {
          todo: 0,
          'in-progress': 0,
          review: 0,
          done: 0,
          cancelled: 0,
        };
        for (const t of userTasks) counts[t.status] = (counts[t.status] || 0) + 1;

        return {
          key: u._id,
          label: initials(u.name),
          stacks: TASK_STATUS_ORDER.map((s) => ({ value: counts[s], color: TASK_STATUS_COLOR[s] })),
        };
      });

    return items;
  }, [activeUsers, tasksByUserId]);

  const statusSegments = useMemo(() => {
    const order: Array<{ label: string; key: WorkforceStatus; color: string }> = [
      { key: 'working', label: 'Đang làm', color: colors.success },
      { key: 'idle', label: 'Rảnh', color: colors.info },
      { key: 'meeting', label: 'Họp', color: colors.purple },
      { key: 'leave', label: 'Nghỉ phép', color: colors.warning },
      { key: 'offline', label: 'Ngoại tuyến', color: colors.muted },
    ];

    return order.map((o) => ({ label: o.label, value: summary[o.key], color: o.color }));
  }, [summary]);

  const topProjects = useMemo(() => {
    const projectById = new Map<string, Project>();
    for (const p of projects) projectById.set(String(p._id), p);

    const map = new Map<string, { projectId: string; total: number; done: number }>();
    for (const t of tasks) {
      if (!t.projectId) continue;
      const pid = String(t.projectId);
      const row = map.get(pid) || { projectId: pid, total: 0, done: 0 };
      row.total += 1;
      if (t.status === 'done') row.done += 1;
      map.set(pid, row);
    }

    return Array.from(map.values())
      .map((r) => {
        const p = projectById.get(r.projectId);
        const progress = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
        return { id: r.projectId, name: p?.name || 'Dự án', done: r.done, total: r.total, progress };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  }, [projects, tasks]);

  const departmentOptions = useMemo(() => {
    const base: Array<{ key: string; label: string; color: string }> = [{ key: 'all', label: 'Tất cả bộ phận', color: colors.primary }];
    const dedup = new Set<string>();

    for (const jr of jobRoles) {
      if (!jr.key || dedup.has(jr.key)) continue;
      dedup.add(jr.key);
      base.push({ key: jr.key, label: jr.name, color: colors.primary });
    }

    return base;
  }, [jobRoles]);

  const visibleUsers = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    return activeUsers.filter((u) => {
      const id = String(u._id);
      const st = statusByUserId.get(id) || 'offline';

      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (deptFilter !== 'all' && String(u.jobRoleKey || '') !== deptFilter) return false;

      if (q) {
        const hay = `${String(u.name || '')} ${String(u.position || '')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeUsers, deptFilter, employeeQuery, statusByUserId, statusFilter]);

  const userCards = useMemo(() => {
    return visibleUsers.map((u) => {
      const st = statusByUserId.get(String(u._id)) || 'offline';
      const userTasks = tasksByUserId.get(String(u._id)) || [];

      const current =
        userTasks.find((t) => t.status === 'in-progress') ||
        userTasks.find((t) => t.status === 'review') ||
        userTasks.find((t) => t.status === 'todo') ||
        null;

      const active = userTasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      const workload = active.length
        ? Math.round(active.reduce((s, t) => s + clamp(Number(t.progress || 0), 0, 100), 0) / active.length)
        : 0;

      const doneCount = userTasks.filter((t) => t.status === 'done').length;
      const totalCount = userTasks.filter((t) => t.status !== 'cancelled').length;

      const statusMeta: Record<WorkforceStatus, { label: string; tint: string; icon: keyof typeof Ionicons.glyphMap }> = {
        working: { label: 'Đang làm việc', tint: colors.success, icon: 'checkmark-circle-outline' },
        idle: { label: 'Rảnh rỗi', tint: colors.info, icon: 'cafe-outline' },
        meeting: { label: 'Trong cuộc họp', tint: colors.purple, icon: 'videocam-outline' },
        leave: { label: 'Nghỉ phép', tint: colors.warning, icon: 'airplane-outline' },
        offline: { label: 'Ngoại tuyến', tint: colors.muted, icon: 'moon-outline' },
      };

      const meta = statusMeta[st];

      return {
        id: u._id,
        user: u,
        status: st,
        statusLabel: meta.label,
        statusTint: meta.tint,
        statusIcon: meta.icon,
        currentTaskTitle: current?.title || 'Không có công việc hiện tại',
        currentTaskProgress: clamp(Number(current?.progress || 0), 0, 100),
        workload,
        doneCount,
        totalCount,
      };
    });
  }, [statusByUserId, tasksByUserId, visibleUsers]);

  const previewLimit = 8;
  const queryActive = employeeQuery.trim().length > 0;
  const showAll = showAllEmployees || queryActive;
  const displayedUserCards = showAll ? userCards : userCards.slice(0, previewLimit);

  if (!me) {
    return (
      <Screen safeEdges={['top', 'left', 'right']} loading>
        <View />
      </Screen>
    );
  }

  const isAdmin = me.role === 'admin';

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      loading={loading}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor={colors.primary} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <Ionicons name="people-outline" size={18} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle}>Quản lý nhân lực</Text>
          <Text style={styles.pageSubtitle}>Theo dõi trạng thái và khối lượng công việc của nhân viên</Text>
        </View>
      </View>

      {!isAdmin ? (
        <Card style={{ backgroundColor: colors.secondary }}>
          <Text style={styles.lockTitle}>Chỉ dành cho Admin</Text>
          <Text style={styles.lockDesc}>Trang “Nhân lực” chỉ cho phép tài khoản Admin truy cập.</Text>
        </Card>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summaryRow}>
            <SummaryCard title="Tổng nhân viên" value={summary.total} icon="people" tint={colors.primaryDark} />
            <SummaryCard title="Đang làm việc" value={summary.working} icon="pulse" tint={colors.success} />
            <SummaryCard title="Rảnh rỗi" value={summary.idle} icon="cafe" tint={colors.info} />
            <SummaryCard title="Trong họp" value={summary.meeting} icon="videocam" tint={colors.purple} />
            <SummaryCard title="Nghỉ phép" value={summary.leave} icon="airplane" tint={colors.warning} />
            <SummaryCard title="Ngoại tuyến" value={summary.offline} icon="moon" tint={colors.muted} />
          </ScrollView>

          <Card style={{ backgroundColor: colors.secondary }}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.14) }]}>
                <Ionicons name="trending-up-outline" size={16} color={colors.primaryDark} />
              </View>
              <SectionTitle>Khối lượng & nhiệm vụ theo người</SectionTitle>
            </View>

            <View style={styles.legendRow}>
              {TASK_STATUS_ORDER.map((s) => (
                <View key={s} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: TASK_STATUS_COLOR[s] }]} />
                  <Text style={styles.legendLabel}>{TASK_STATUS_LABEL[s]}</Text>
                </View>
              ))}
            </View>

            {stackedBarItems.length === 0 ? (
              <Text style={styles.emptyHint}>Chưa có dữ liệu công việc.</Text>
            ) : (
              <View style={styles.barChartWrap}>
                <StackedBars
                  height={150}
                  width={Math.max(240, stackedBarItems.length * (22 + 14))}
                  items={stackedBarItems}
                />

                <View style={styles.barLabelsRow}>
                  {stackedBarItems.map((it) => (
                    <Text key={it.key} style={styles.barLabel}>
                      {it.label}
                    </Text>
                  ))}
                </View>
              </View>
            )}
          </Card>

          <View style={styles.twoCardsRow}>
            <Card style={[styles.halfCard, { backgroundColor: colors.secondary }]}>
              <View style={styles.sectionHeaderRow}>
                <View style={[styles.sectionIconWrap, { backgroundColor: hexToRgba(colors.teal, 0.16) }]}>
                  <Ionicons name="pie-chart-outline" size={16} color={colors.primaryDark} />
                </View>
                <SectionTitle>Phân bố trạng thái</SectionTitle>
              </View>

              <View style={styles.donutRow}>
                <DonutChart
                  size={110}
                  strokeWidth={14}
                  segments={statusSegments}
                />

                <View style={styles.statusList}>
                  {statusSegments.map((seg) => (
                    <View key={seg.label} style={styles.statusRow}>
                      <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
                      <Text style={styles.statusLabel}>{seg.label}</Text>
                      <Text style={styles.statusValue}>{seg.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>

            <Card style={[styles.halfCard, { backgroundColor: colors.secondary }]}>
              <View style={styles.sectionHeaderRow}>
                <View style={[styles.sectionIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.14) }]}>
                  <Ionicons name="briefcase-outline" size={16} color={colors.primaryDark} />
                </View>
                <SectionTitle>Task theo dự án</SectionTitle>
              </View>

              {topProjects.length === 0 ? (
                <Text style={styles.emptyHint}>Chưa có dữ liệu dự án.</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {topProjects.map((p, index) => {
                    const tint = index === 0 ? colors.purple : index === 1 ? colors.teal : colors.primary;
                    return (
                      <View key={p.id} style={{ gap: 6 }}>
                        <View style={styles.projectRow}>
                          <View style={[styles.projectDot, { backgroundColor: tint }]} />
                          <Text style={styles.projectName} numberOfLines={1}>
                            {p.name}
                          </Text>
                          <Text style={styles.projectCount}>{`${p.done}/${p.total}`}</Text>
                        </View>
                        <ProgressBar value={p.progress} color={tint} />
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          </View>

          <Card style={{ backgroundColor: colors.secondary }}>
            <View style={styles.filtersHeader}>
              <Ionicons name="filter-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.filtersTitle}>Lọc:</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              <Chip label="Tất cả trạng thái" active={statusFilter === 'all'} onPress={() => setStatusFilter('all')} />
              <Chip label="Đang làm việc" active={statusFilter === 'working'} onPress={() => setStatusFilter('working')} color={colors.success} />
              <Chip label="Rảnh rỗi" active={statusFilter === 'idle'} onPress={() => setStatusFilter('idle')} color={colors.info} />
              <Chip label="Trong cuộc họp" active={statusFilter === 'meeting'} onPress={() => setStatusFilter('meeting')} color={colors.purple} />
              <Chip label="Nghỉ phép" active={statusFilter === 'leave'} onPress={() => setStatusFilter('leave')} color={colors.warning} />
              <Chip label="Ngoại tuyến" active={statusFilter === 'offline'} onPress={() => setStatusFilter('offline')} color={colors.muted} />
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {departmentOptions.map((d) => (
                <Chip
                  key={d.key}
                  label={d.label}
                  active={deptFilter === d.key}
                  onPress={() => setDeptFilter(d.key)}
                  color={colors.primary}
                />
              ))}
            </ScrollView>
          </Card>

          <Card style={{ backgroundColor: colors.secondary }}>
            <View style={styles.employeesHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.14) }]}>
                <Ionicons name="people-outline" size={16} color={colors.primaryDark} />
              </View>
              <SectionTitle>Nhân viên</SectionTitle>
              <View style={{ flex: 1 }} />
              {!queryActive && userCards.length > previewLimit ? (
                <TouchableOpacity
                  onPress={() => setShowAllEmployees((v) => !v)}
                  style={[styles.toggleBtn, { borderColor: hexToRgba(colors.primary, 0.35), backgroundColor: hexToRgba(colors.primary, 0.08) }]}
                >
                  <Text style={styles.toggleBtnText}>{showAllEmployees ? 'Thu gọn' : `Xem tất cả (${userCards.length})`}</Text>
                  <Ionicons name={showAllEmployees ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primaryDark} />
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={() => setSearchModalOpen(true)}
              activeOpacity={0.9}
              style={styles.searchButton}
            >
              <Ionicons name="search-outline" size={18} color={hexToRgba(colors.primaryDark, 0.75)} />
              <Text style={[styles.searchButtonText, employeeQuery.trim() ? undefined : styles.searchButtonPlaceholder]} numberOfLines={1}>
                {employeeQuery.trim() ? employeeQuery.trim() : 'Tìm nhân viên...'}
              </Text>
              {employeeQuery.trim().length > 0 ? (
                <TouchableOpacity
                  onPress={() => setEmployeeQuery('')}
                  style={styles.searchClearBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close-circle" size={18} color={hexToRgba(colors.primaryDark, 0.6)} />
                </TouchableOpacity>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={hexToRgba(colors.primaryDark, 0.55)} />
              )}
            </TouchableOpacity>
          </Card>

          <Modal
            visible={searchModalOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setSearchModalOpen(false)}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setSearchModalOpen(false)}
              style={styles.modalBackdrop}
            >
              <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modalCard, { backgroundColor: colors.card }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Tìm nhân viên</Text>
                  <TouchableOpacity onPress={() => setSearchModalOpen(false)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={18} color={hexToRgba(colors.primaryDark, 0.75)} />
                  </TouchableOpacity>
                </View>

                <View style={styles.modalSearchRow}>
                  <Ionicons name="search-outline" size={18} color={hexToRgba(colors.primaryDark, 0.75)} />
                  <TextInput
                    value={employeeQuery}
                    onChangeText={setEmployeeQuery}
                    placeholder="Nhập tên hoặc chức vụ..."
                    placeholderTextColor={hexToRgba(colors.muted, 0.9)}
                    style={styles.modalSearchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                  />
                  {employeeQuery.trim().length > 0 ? (
                    <TouchableOpacity onPress={() => setEmployeeQuery('')} style={styles.searchClearBtn}>
                      <Ionicons name="close-circle" size={18} color={hexToRgba(colors.primaryDark, 0.6)} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setEmployeeQuery('');
                      setSearchModalOpen(false);
                    }}
                    style={[styles.modalActionBtn, { borderColor: hexToRgba(colors.border, 0.8) }]}
                  >
                    <Text style={styles.modalActionText}>Xóa</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setSearchModalOpen(false)}
                    style={[styles.modalActionBtn, { borderColor: hexToRgba(colors.primary, 0.45), backgroundColor: hexToRgba(colors.primary, 0.12) }]}
                  >
                    <Text style={styles.modalActionText}>Xong</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

          <View style={styles.grid}>
            {userCards.length === 0 ? (
              <Card style={{ backgroundColor: colors.secondary }}>
                <Text style={styles.emptyHint}>Không có nhân viên phù hợp bộ lọc.</Text>
              </Card>
            ) : (
              displayedUserCards.map((c) => {
                const isExpanded = expandedUserId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    activeOpacity={0.9}
                    style={styles.userCard}
                    onPress={() => setExpandedUserId((prev) => (prev === c.id ? null : c.id))}
                  >
                    <Card style={[styles.userCardInner, c.status === 'leave' ? styles.userCardSoft : undefined]}>
                      <View style={styles.userCardTop}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>{initials(c.user.name)}</Text>
                        </View>

                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.userNameRow}>
                            <Text style={styles.userName} numberOfLines={1}>
                              {c.user.name}
                            </Text>
                            <Ionicons
                              name="star"
                              size={12}
                              color={hexToRgba(colors.warning, 0.9)}
                              style={{ opacity: c.user.role === 'admin' ? 1 : 0 }}
                            />
                          </View>
                          <Text style={styles.userRole} numberOfLines={1}>
                            {c.user.position || 'Nhân viên'}
                          </Text>
                        </View>

                        <View style={styles.moreBtn}>
                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={hexToRgba(colors.primaryDark, 0.75)}
                          />
                        </View>
                      </View>

                      <View
                        style={[
                          styles.statusPill,
                          { backgroundColor: hexToRgba(c.statusTint, 0.14), borderColor: hexToRgba(c.statusTint, 0.4) },
                        ]}
                      >
                        <Ionicons name={c.statusIcon} size={14} color={c.statusTint} />
                        <Text style={styles.statusPillText}>{c.statusLabel}</Text>
                      </View>

                      {!isExpanded ? (
                        <Text style={styles.userTaskPreview} numberOfLines={1}>
                          {c.currentTaskTitle}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.userMetaLabel}>Công việc hiện tại</Text>
                          <Text style={styles.userTask} numberOfLines={2}>
                            {c.currentTaskTitle}
                          </Text>

                          <View style={{ gap: 8, marginTop: 6 }}>
                            <View style={styles.progressRow}>
                              <Text style={styles.progressLabel}>Tiến độ</Text>
                              <Text style={styles.progressValue}>{formatPercent(c.currentTaskProgress)}</Text>
                            </View>
                            <ProgressBar value={c.currentTaskProgress} color={c.statusTint} />

                            <View style={styles.progressRow}>
                              <Text style={styles.progressLabel}>Khối lượng</Text>
                              <Text style={styles.progressValue}>{formatPercent(c.workload)}</Text>
                            </View>
                            <ProgressBar value={c.workload} color={hexToRgba(colors.primaryDark, 0.65)} />

                            <View style={styles.userFooterRow}>
                              <Text style={styles.userFooterText}>{`${c.doneCount} hoàn thành`}</Text>
                              <Text style={styles.userFooterText}>{`${Math.max(0, c.totalCount - c.doneCount)} đang làm`}</Text>
                            </View>
                          </View>
                        </>
                      )}
                    </Card>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {refreshing ? (
            <View style={styles.bottomLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pageTitleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 26,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  pageSubtitle: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    marginTop: 2,
  },

  lockTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  lockDesc: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    marginTop: 6,
  },

  summaryRow: {
    paddingVertical: 6,
    gap: 8,
    paddingRight: 8,
  },
  summaryCard: {
    width: 132,
    padding: 10,
    gap: 6,
  },
  summaryIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 20,
  },
  summaryLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: hexToRgba(colors.border, 0.8),
    alignItems: 'center',
    justifyContent: 'center',
  },

  legendRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  legendLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },

  barChartWrap: {
    marginTop: 8,
  },
  barLabelsRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 14,
    paddingLeft: 1,
  },
  barLabel: {
    width: 22,
    textAlign: 'center',
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },

  twoCardsRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  halfCard: {
    flexGrow: 1,
    flexBasis: 320,
    minWidth: 280,
  },

  donutRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  statusList: {
    flex: 1,
    gap: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusLabel: {
    flex: 1,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  statusValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },

  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  projectName: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  projectCount: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },

  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: hexToRgba(colors.border, 0.65),
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },

  filtersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filtersTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },

  chipsRow: {
    paddingVertical: 10,
    gap: 10,
    paddingRight: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 2,
  },
  chipText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  chipTextActive: {
    color: colors.primaryDark,
  },

  grid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  userCard: {
    flexGrow: 1,
    flexBasis: 340,
    minWidth: 280,
  },
  userCardInner: {
    flex: 1,
  },
  userCardSoft: {
    backgroundColor: hexToRgba(colors.warning, 0.06),
  },
  userCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: hexToRgba(colors.primary, 0.10),
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_900Black',
  },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: hexToRgba(colors.border, 0.8),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hexToRgba(colors.card, 0.6),
  },
    employeesHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    toggleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 2,
    },
    toggleBtnText: {
      color: colors.primaryDark,
      fontFamily: 'BeVietnamPro_800ExtraBold',
      fontSize: 12,
    },
    searchButton: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: hexToRgba(colors.border, 0.8),
      backgroundColor: hexToRgba(colors.card, 0.55),
    },
    searchButtonText: {
      flex: 1,
      color: colors.text,
      fontFamily: 'BeVietnamPro_700Bold',
    },
    searchButtonPlaceholder: {
      color: hexToRgba(colors.muted, 0.95),
    },
    searchClearBtn: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },

    modalBackdrop: {
      flex: 1,
      backgroundColor: hexToRgba('#000', 0.35),
      padding: 16,
      justifyContent: 'center',
    },
    modalCard: {
      borderRadius: 18,
      borderWidth: 2,
      borderColor: colors.border,
      padding: 14,
      gap: 10,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modalTitle: {
      color: colors.text,
      fontFamily: 'BeVietnamPro_900Black',
      fontSize: 16,
    },
    modalCloseBtn: {
      width: 34,
      height: 34,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: hexToRgba(colors.border, 0.8),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: hexToRgba(colors.card, 0.65),
    },
    modalSearchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: hexToRgba(colors.border, 0.8),
      backgroundColor: hexToRgba(colors.card, 0.55),
    },
    modalSearchInput: {
      flex: 1,
      color: colors.text,
      fontFamily: 'BeVietnamPro_700Bold',
      paddingVertical: 0,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'flex-end',
    },
    modalActionBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 2,
    },
    modalActionText: {
      color: colors.primaryDark,
      fontFamily: 'BeVietnamPro_800ExtraBold',
    },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    flex: 1,
  },
  userRole: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
    marginTop: 2,
  },

  statusPill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
  },
  statusPillText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },

  userMetaLabel: {
    marginTop: 10,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  userTaskPreview: {
    marginTop: 10,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  userTask: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    marginTop: 4,
  },

  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  progressValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },

  userFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  userFooterText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },

  emptyHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },

  bottomLoading: {
    paddingVertical: 8,
    alignItems: 'center',
  },
});

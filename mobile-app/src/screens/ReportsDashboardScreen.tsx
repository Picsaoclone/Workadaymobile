import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
// expo-print is installed via expo; keep import here for PDF export
import * as Print from 'expo-print';

import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { SectionTitle } from '../components/SectionTitle';
import { colors } from '../theme/colors';
import { attendanceApi, taskApi } from '../services/api';
import { AttendanceCompanyDay, AttendanceCompanyRangeSummary, Task } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { hexToRgba } from '../utils/color';

type PeriodKey = 'week' | 'month' | 'quarter';

type StatCard = {
  key: 'tasks_done' | 'performance' | 'on_time' | 'avg_hours';
  label: string;
  value: string;
  deltaLabel: string;
  deltaTone: 'up' | 'down' | 'flat';
  tint: string;
  icon: keyof typeof Ionicons.glyphMap;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string) {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  return { r, g, b };
}

function isDarkColor(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.55;
}

type AndroidFileEncoding = 'utf8' | 'base64';

async function saveToAndroidFolder(opts: { fileName: string; mimeType: string; data: string; encoding: AndroidFileEncoding }) {
  if (Platform.OS !== 'android') return null;

  try {
    const saf = (FileSystem as any).StorageAccessFramework;
    if (!saf?.requestDirectoryPermissionsAsync || !saf?.createFileAsync) return null;

    const perm = await saf.requestDirectoryPermissionsAsync();
    if (!perm?.granted) return null;

    const uri = await saf.createFileAsync(perm.directoryUri, opts.fileName, opts.mimeType);
    await FileSystem.writeAsStringAsync(uri, opts.data, { encoding: opts.encoding as any });
    return uri;
  } catch {
    return null;
  }
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function diffDaysInclusive(from: Date, to: Date) {
  const a = dayStart(from).getTime();
  const b = dayStart(to).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function startOfWeekMonday(now: Date) {
  const d = dayStart(now);
  const day = d.getDay(); // 0 Sun
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(d, delta);
}

function getPeriodRange(period: PeriodKey, now: Date) {
  const today = dayStart(now);

  if (period === 'week') {
    const from = startOfWeekMonday(today);
    const to = addDays(from, 6);
    return { from, to: to.getTime() > today.getTime() ? today : to };
  }

  if (period === 'month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: dayStart(from), to: today };
  }

  const quarterIndex = Math.floor(today.getMonth() / 3);
  const from = new Date(today.getFullYear(), quarterIndex * 3, 1);
  return { from: dayStart(from), to: today };
}

function getPreviousRange(from: Date, to: Date) {
  const len = diffDaysInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  return { from: prevFrom, to: prevTo };
}

function parseWorkingHoursTarget(workingHours?: { start: string; end: string }) {
  const start = workingHours?.start || '09:00';
  const end = workingHours?.end || '18:00';

  const toMinutes = (hhmm: string) => {
    const [h, m] = String(hhmm).split(':').map((x) => Number(x || 0));
    return h * 60 + m;
  };

  const minutes = Math.max(0, toMinutes(end) - toMinutes(start));
  return Math.round((minutes / 60) * 10) / 10;
}

function formatPercent(v: number) {
  const n = Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 100));
  return `${n}%`;
}

function getAttendanceDistribution(summary: AttendanceCompanyRangeSummary | null) {
  const o = summary?.overall;
  const present = Number(o?.presentDays || 0);
  const late = Number(o?.lateDays || 0);
  const leave = Number(o?.leaveDays || 0);
  const absent = Number(o?.absentDays || 0);
  const total = Math.max(0, present + late + leave + absent);

  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return {
    present,
    late,
    leave,
    absent,
    pctPresent: pct(present),
    pctLate: pct(late),
    pctLeave: pct(leave),
    pctAbsent: pct(absent),
  };
}

function formatDelta(current: number, prev: number) {
  if (!Number.isFinite(prev) || prev <= 0) return { label: '—', tone: 'flat' as const };
  const pct = ((current - prev) / prev) * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return { label: '→ 0%', tone: 'flat' as const };
  if (rounded > 0) return { label: `↑ ${rounded}%`, tone: 'up' as const };
  return { label: `↓ ${Math.abs(rounded)}%`, tone: 'down' as const };
}

function CardTabs({ value, onChange }: { value: PeriodKey; onChange: (v: PeriodKey) => void }) {
  const tabs: Array<{ key: PeriodKey; label: string }> = [
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
    { key: 'quarter', label: 'Quý này' },
  ];

  return (
    <View style={styles.tabsRow}>
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[
              styles.tabPill,
              {
                backgroundColor: hexToRgba(colors.teal, active ? 0.18 : 0.06),
                borderColor: hexToRgba(colors.teal, active ? 0.55 : 0.22),
              },
            ]}
          >
            <Text style={styles.tabText}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function StatBox({ data }: { data: StatCard }) {
  const deltaColor =
    data.deltaTone === 'up'
      ? colors.success
      : data.deltaTone === 'down'
        ? colors.danger
        : hexToRgba(colors.muted, 0.85);

  const dark = isDarkColor(data.tint);
  const iconColor = dark ? colors.white : colors.primaryDark;

  return (
    <Card style={[styles.statCard, { backgroundColor: hexToRgba(data.tint, 0.14) }]}>
      <View style={styles.statTopRow}>
        <View style={[styles.statIconWrap, { backgroundColor: hexToRgba(data.tint, 0.95), borderColor: hexToRgba(data.tint, 0.75) }]}>
          <Ionicons name={data.icon} size={20} color={iconColor} />
        </View>
        <Text style={[styles.statDelta, { color: deltaColor }]}>{data.deltaLabel}</Text>
      </View>

      <Text style={styles.statValue}>{data.value}</Text>
      <Text style={styles.statLabel}>{data.label}</Text>
    </Card>
  );
}

function DonutChart({ size, strokeWidth, segments }: { size: number; strokeWidth: number; segments: Array<{ label: string; value: number; color: string }> }) {
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

function StackedBars({ width, height, items }: { width: number; height: number; items: Array<{ label: string; done: number; doing: number }> }) {
  const barWidth = 22;
  const gap = 14;
  const chartHeight = height;
  const maxValue = Math.max(1, ...items.map((it) => Math.max(0, it.done) + Math.max(0, it.doing)));

  return (
    <Svg width={width} height={height}>
      {items.map((it, index) => {
        const x = index * (barWidth + gap);
        const doneH = (chartHeight * Math.max(0, it.done)) / maxValue;
        const doingH = (chartHeight * Math.max(0, it.doing)) / maxValue;
        const yDoing = chartHeight - doingH;
        const yDone = yDoing - doneH;

        return (
          <G key={it.label}>
            <Rect x={x} y={yDone} width={barWidth} height={doneH} rx={6} ry={6} fill={colors.success} />
            <Rect x={x} y={yDoing} width={barWidth} height={doingH} rx={6} ry={6} fill={colors.warning} />
          </G>
        );
      })}
    </Svg>
  );
}

function LineChart({ width, height, points, target }: { width: number; height: number; points: Array<{ label: string; value: number }>; target: number }) {
  const maxY = Math.max(target, ...points.map((p) => p.value), 1);
  const minY = Math.min(...points.map((p) => p.value), target, 0);
  const padX = 10;
  const padY = 10;
  const innerW = Math.max(1, width - padX * 2);
  const innerH = Math.max(1, height - padY * 2);

  const toX = (i: number) => (points.length <= 1 ? padX : padX + (innerW * i) / (points.length - 1));
  const toY = (v: number) => {
    const t = maxY === minY ? 0 : (v - minY) / (maxY - minY);
    return padY + innerH - innerH * t;
  };

  const path = points
    .map((p, i) => {
      const x = toX(i);
      const y = toY(p.value);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const yTarget = toY(target);

  return (
    <Svg width={width} height={height}>
      <Line x1={padX} y1={yTarget} x2={width - padX} y2={yTarget} stroke={hexToRgba(colors.border, 0.85)} strokeWidth={2} />
      <Path d={path} stroke={colors.primary} strokeWidth={3} fill="none" />
      {points.map((p, i) => {
        const x = toX(i);
        const y = toY(p.value);
        return <Circle key={p.label} cx={x} cy={y} r={5} fill={colors.primary} />;
      })}
    </Svg>
  );
}

function toCsv(rows: Array<Array<string | number>>) {
  const escapeCell = (cell: string | number) => {
    const s = String(cell ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(escapeCell).join(',')).join('\n');
}

export function ReportsDashboardScreen() {
  const me = useAuthStore((s) => s.user);

  const [period, setPeriod] = useState<PeriodKey>('week');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [attendance, setAttendance] = useState<AttendanceCompanyRangeSummary | null>(null);
  const [attendancePrev, setAttendancePrev] = useState<AttendanceCompanyRangeSummary | null>(null);

  const [trendLoading, setTrendLoading] = useState(false);
  const [trendPoints, setTrendPoints] = useState<Array<{ label: string; value: number }>>([]);

  const isAllowed = me?.role === 'admin' || me?.role === 'manager';

  const range = useMemo(() => getPeriodRange(period, new Date()), [period]);
  const prevRange = useMemo(() => getPreviousRange(range.from, range.to), [range.from, range.to]);

  const loadAll = useCallback(async () => {
    if (!me) return;
    if (!isAllowed) {
      setLoading(false);
      return;
    }

    setRefreshing(true);
    try {
      const [tasksRes, attendanceRes, attendancePrevRes] = await Promise.all([
        taskApi.getAll(),
        attendanceApi.getCompanyRange({ from: toISODate(range.from), to: toISODate(range.to) }),
        attendanceApi.getCompanyRange({ from: toISODate(prevRange.from), to: toISODate(prevRange.to) }),
      ]);

      setTasks(tasksRes.data.data || []);
      setAttendance(attendanceRes.data.data || null);
      setAttendancePrev(attendancePrevRes.data.data || null);
    } catch {
      // keep stable
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [isAllowed, me, prevRange.from, prevRange.to, range.from, range.to]);

  const loadTrend = useCallback(async () => {
    if (!me || !isAllowed) return;

    setTrendLoading(true);
    try {
      const pointsToFetch: Array<{ label: string; date: string }> = [];

      if (period === 'week') {
        // Mon-Fri
        const start = startOfWeekMonday(range.from);
        const labels = ['T2', 'T3', 'T4', 'T5', 'T6'];
        for (let i = 0; i < 5; i++) {
          pointsToFetch.push({ label: labels[i], date: toISODate(addDays(start, i)) });
        }
      } else if (period === 'month') {
        // 4 points: week starts
        const start = dayStart(range.from);
        for (let i = 0; i < 4; i++) {
          pointsToFetch.push({ label: `W${i + 1}`, date: toISODate(addDays(start, i * 7)) });
        }
      } else {
        // quarter: 3 points: month starts
        const start = dayStart(range.from);
        for (let i = 0; i < 3; i++) {
          const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
          pointsToFetch.push({ label: `Th${d.getMonth() + 1}`, date: toISODate(d) });
        }
      }

      const results = await Promise.all(
        pointsToFetch.map(async (p) => {
          try {
            const res = await attendanceApi.getCompanyDay({ date: p.date });
            const data: AttendanceCompanyDay | undefined = res.data.data;
            const rows = data?.rows || [];
            const worked = rows
              .map((r) => Number(r.day?.hoursWorked || 0))
              .filter((x) => Number.isFinite(x) && x > 0);
            const avg = worked.length ? worked.reduce((s, x) => s + x, 0) / worked.length : 0;
            return { label: p.label, value: Math.round(avg * 10) / 10 };
          } catch {
            return { label: p.label, value: 0 };
          }
        })
      );

      setTrendPoints(results);
    } finally {
      setTrendLoading(false);
    }
  }, [isAllowed, me, period, range.from, range.to]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAll();
      loadTrend();
    }, [loadAll, loadTrend])
  );

  const metrics = useMemo(() => {
    const fromMs = range.from.getTime();
    const toMs = addDays(range.to, 1).getTime();

    const prevFromMs = prevRange.from.getTime();
    const prevToMs = addDays(prevRange.to, 1).getTime();

    const completedAtMs = (t: Task) => {
      const d = t.completedAt || t.createdAt;
      return new Date(d).getTime();
    };
    const createdAtMs = (t: Task) => new Date(t.createdAt).getTime();

    const tasksInRange = tasks.filter((t) => {
      const ms = createdAtMs(t);
      return ms >= fromMs && ms < toMs;
    });

    const doneInRange = tasks.filter((t) => {
      if (t.status !== 'done') return false;
      const ms = completedAtMs(t);
      return ms >= fromMs && ms < toMs;
    });

    const tasksInPrev = tasks.filter((t) => {
      const ms = createdAtMs(t);
      return ms >= prevFromMs && ms < prevToMs;
    });

    const doneInPrev = tasks.filter((t) => {
      if (t.status !== 'done') return false;
      const ms = completedAtMs(t);
      return ms >= prevFromMs && ms < prevToMs;
    });

    const performance = tasksInRange.length ? (doneInRange.length / tasksInRange.length) * 100 : 0;
    const performancePrev = tasksInPrev.length ? (doneInPrev.length / tasksInPrev.length) * 100 : 0;

    const onTime = (() => {
      const o = attendance?.overall;
      const denom = Math.max(0, Number(o?.presentDays || 0) + Number(o?.lateDays || 0));
      return denom > 0 ? (Number(o?.presentDays || 0) / denom) * 100 : 0;
    })();

    const onTimePrev = (() => {
      const o = attendancePrev?.overall;
      const denom = Math.max(0, Number(o?.presentDays || 0) + Number(o?.lateDays || 0));
      return denom > 0 ? (Number(o?.presentDays || 0) / denom) * 100 : 0;
    })();

    const avgHours = Number(attendance?.overall?.avgHoursPerDay || 0);
    const avgHoursPrev = Number(attendancePrev?.overall?.avgHoursPerDay || 0);

    return {
      tasksDone: { current: doneInRange.length, prev: doneInPrev.length },
      performance: { current: performance, prev: performancePrev },
      onTime: { current: onTime, prev: onTimePrev },
      avgHours: { current: avgHours, prev: avgHoursPrev },
    };
  }, [attendance?.overall, attendancePrev?.overall, prevRange.from, prevRange.to, range.from, range.to, tasks]);

  const statCards: StatCard[] = useMemo(() => {
    const d1 = formatDelta(metrics.tasksDone.current, metrics.tasksDone.prev);
    const d2 = formatDelta(metrics.performance.current, metrics.performance.prev);
    const d3 = formatDelta(metrics.onTime.current, metrics.onTime.prev);
    const d4 = formatDelta(metrics.avgHours.current, metrics.avgHours.prev);

    return [
      {
        key: 'tasks_done',
        label: 'Công việc hoàn thành',
        value: String(metrics.tasksDone.current),
        deltaLabel: d1.label,
        deltaTone: d1.tone,
        tint: colors.primary,
        icon: 'bar-chart-outline',
      },
      {
        key: 'performance',
        label: 'Hiệu suất trung bình',
        value: formatPercent(metrics.performance.current),
        deltaLabel: d2.label,
        deltaTone: d2.tone,
        tint: colors.success,
        icon: 'trending-up-outline',
      },
      {
        key: 'on_time',
        label: 'Tỷ lệ chấm công đúng giờ',
        value: formatPercent(metrics.onTime.current),
        deltaLabel: d3.label,
        deltaTone: d3.tone,
        tint: colors.purple,
        icon: 'people-outline',
      },
      {
        key: 'avg_hours',
        label: 'Giờ làm trung bình/ngày',
        value: `${Math.round(metrics.avgHours.current * 10) / 10}h`,
        deltaLabel: d4.label,
        deltaTone: d4.tone,
        tint: colors.warning,
        icon: 'time-outline',
      },
    ];
  }, [metrics.avgHours.current, metrics.avgHours.prev, metrics.onTime.current, metrics.onTime.prev, metrics.performance.current, metrics.performance.prev, metrics.tasksDone.current, metrics.tasksDone.prev]);

  const attendanceSegments = useMemo(() => {
    const d = getAttendanceDistribution(attendance);
    return [
      { rawLabel: 'Đúng giờ', value: d.pctPresent, color: colors.success },
      { rawLabel: 'Đi muộn', value: d.pctLate, color: colors.warning },
      { rawLabel: 'Nghỉ phép', value: d.pctLeave, color: colors.primary },
      { rawLabel: 'Vắng', value: d.pctAbsent, color: colors.muted },
    ];
  }, [attendance?.overall]);

  const bars = useMemo(() => {
    const fromMs = range.from.getTime();
    const toMs = addDays(range.to, 1).getTime();

    const taskInBucket = (t: Task, a: number, b: number) => {
      const created = new Date(t.createdAt).getTime();
      return created >= a && created < b;
    };

    const doneInBucket = (t: Task, a: number, b: number) => {
      if (t.status !== 'done') return false;
      const ms = new Date(t.completedAt || t.createdAt).getTime();
      return ms >= a && ms < b;
    };

    if (period === 'week') {
      const start = startOfWeekMonday(range.from);
      const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
      return labels.map((label, i) => {
        const a = addDays(start, i).getTime();
        const b = addDays(start, i + 1).getTime();
        const done = tasks.filter((t) => doneInBucket(t, a, b)).length;
        const doing = tasks.filter((t) => t.status === 'in-progress' && taskInBucket(t, a, b)).length;
        return { label, done, doing };
      });
    }

    if (period === 'month') {
      const start = dayStart(range.from);
      return [0, 1, 2, 3].map((i) => {
        const a = addDays(start, i * 7).getTime();
        const b = i === 3 ? toMs : addDays(start, (i + 1) * 7).getTime();
        const done = tasks.filter((t) => doneInBucket(t, a, b)).length;
        const doing = tasks.filter((t) => t.status === 'in-progress' && taskInBucket(t, a, b)).length;
        return { label: `W${i + 1}`, done, doing };
      });
    }

    // quarter
    const start = dayStart(range.from);
    return [0, 1, 2].map((i) => {
      const aDate = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const bDate = new Date(start.getFullYear(), start.getMonth() + i + 1, 1);
      const a = aDate.getTime();
      const b = Math.min(bDate.getTime(), toMs);
      const done = tasks.filter((t) => doneInBucket(t, a, b)).length;
      const doing = tasks.filter((t) => t.status === 'in-progress' && taskInBucket(t, a, b)).length;
      return { label: `Th${aDate.getMonth() + 1}`, done, doing };
    });
  }, [period, range.from, range.to, tasks]);

  const exportModalTitle = useMemo(() => {
    const label = period === 'week' ? 'Tuần này' : period === 'month' ? 'Tháng này' : 'Quý này';
    return `Báo cáo & Thống kê · ${label}`;
  }, [period]);

  const exportReport = useCallback(
    async (format: 'pdf' | 'excel', action: 'share' | 'download' = 'share') => {
      if (!attendance) {
        Alert.alert('Chưa có dữ liệu', 'Vui lòng đợi dữ liệu tải xong rồi thử lại.');
        return;
      }

      const from = toISODate(range.from);
      const to = toISODate(range.to);
      const targetHours = parseWorkingHoursTarget(attendance.workingHours);

      const summaryRows: Array<Array<string | number>> = [
        ['Báo cáo & Thống kê', exportModalTitle],
        ['Từ', from],
        ['Đến', to],
        ['Công việc hoàn thành', metrics.tasksDone.current],
        ['Hiệu suất trung bình (%)', Math.round(metrics.performance.current)],
        ['Tỷ lệ đúng giờ (%)', Math.round(metrics.onTime.current)],
        ['Giờ làm trung bình/ngày (h)', Math.round(metrics.avgHours.current * 10) / 10],
        ['Mục tiêu giờ/ngày (h)', targetHours],
      ];

      const attendanceRows: Array<Array<string | number>> = [
        ['Chấm công', 'Giá trị'],
        ['Đúng giờ (ngày)', attendance.overall.presentDays],
        ['Đi muộn (ngày)', attendance.overall.lateDays],
        ['Nghỉ phép (ngày)', attendance.overall.leaveDays],
        ['Vắng (ngày)', attendance.overall.absentDays],
      ];

      const chartRows: Array<Array<string | number>> = [
        ['Bucket', 'Hoàn thành', 'Đang làm'],
        ...bars.map((b) => [b.label, b.done, b.doing]),
      ];

      const trendRows: Array<Array<string | number>> = [
        ['Mốc', 'Giờ làm TB (h)'],
        ...trendPoints.map((p) => [p.label, p.value]),
      ];

      if (format === 'excel') {
        const csv = [
          toCsv(summaryRows),
          '',
          toCsv(attendanceRows),
          '',
          toCsv(chartRows),
          '',
          toCsv(trendRows),
        ].join('\n');

        const baseName = `reports-${from}-to-${to}`;
        const fileName = `${baseName}.csv`;

        if (action === 'download' && Platform.OS === 'android') {
          const savedUri = await saveToAndroidFolder({ fileName, mimeType: 'text/csv', data: csv, encoding: 'utf8' });
          if (!savedUri) {
            Alert.alert('Không thể lưu', 'Thiết bị không hỗ trợ lưu trực tiếp. Bạn có thể dùng “Chia sẻ” để tải về qua ứng dụng khác.');
            return;
          }
          Alert.alert('Đã lưu', 'File CSV đã được lưu trong thư mục bạn chọn.');
          return;
        }

        const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (!baseDir) {
          Alert.alert('Không hỗ trợ', 'Không thể xác định thư mục lưu file trên thiết bị.');
          return;
        }
        const uri = `${baseDir}${fileName}`;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: 'utf8' as any });

        if (!(await Sharing.isAvailableAsync())) {
          Alert.alert('Không hỗ trợ', 'Thiết bị hiện không hỗ trợ chia sẻ file.');
          return;
        }

        await Sharing.shareAsync(uri, {
          dialogTitle: 'Xuất báo cáo (Excel/CSV)',
          mimeType: 'text/csv',
        });

        return;
      }

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: -apple-system, system-ui, Segoe UI, Roboto, Arial; padding: 18px; }
              h1 { font-size: 18px; margin: 0 0 6px; }
              .sub { color: #555; margin: 0 0 14px; }
              table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
              th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
              th { background: #f5f5f5; text-align: left; }
            </style>
          </head>
          <body>
            <h1>${exportModalTitle}</h1>
            <p class="sub">Từ ${from} đến ${to}</p>

            <table>
              <tr><th>Chỉ số</th><th>Giá trị</th></tr>
              <tr><td>Công việc hoàn thành</td><td>${metrics.tasksDone.current}</td></tr>
              <tr><td>Hiệu suất trung bình</td><td>${Math.round(metrics.performance.current)}%</td></tr>
              <tr><td>Tỷ lệ chấm công đúng giờ</td><td>${Math.round(metrics.onTime.current)}%</td></tr>
              <tr><td>Giờ làm trung bình/ngày</td><td>${Math.round(metrics.avgHours.current * 10) / 10}h</td></tr>
              <tr><td>Mục tiêu giờ/ngày</td><td>${targetHours}h</td></tr>
            </table>

            <table>
              <tr><th>Chấm công</th><th>Số ngày</th></tr>
              <tr><td>Đúng giờ</td><td>${attendance.overall.presentDays}</td></tr>
              <tr><td>Đi muộn</td><td>${attendance.overall.lateDays}</td></tr>
              <tr><td>Nghỉ phép</td><td>${attendance.overall.leaveDays}</td></tr>
              <tr><td>Vắng</td><td>${attendance.overall.absentDays}</td></tr>
            </table>

            <table>
              <tr><th>Bucket</th><th>Hoàn thành</th><th>Đang làm</th></tr>
              ${bars
                .map((b) => `<tr><td>${b.label}</td><td>${b.done}</td><td>${b.doing}</td></tr>`)
                .join('')}
            </table>

            <table>
              <tr><th>Mốc</th><th>Giờ làm TB (h)</th></tr>
              ${trendPoints.map((p) => `<tr><td>${p.label}</td><td>${p.value}</td></tr>`).join('')}
            </table>
          </body>
        </html>
      `;

      const file = await Print.printToFileAsync({ html });

      if (action === 'download' && Platform.OS === 'android') {
        const baseName = `reports-${from}-to-${to}`;
        const fileName = `${baseName}.pdf`;
        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' as any });

        const savedUri = await saveToAndroidFolder({ fileName, mimeType: 'application/pdf', data: base64, encoding: 'base64' });
        if (!savedUri) {
          Alert.alert('Không thể lưu', 'Thiết bị không hỗ trợ lưu trực tiếp. Bạn có thể dùng “Chia sẻ” để tải về qua ứng dụng khác.');
          return;
        }

        Alert.alert('Đã lưu', 'File PDF đã được lưu trong thư mục bạn chọn.');
        return;
      }

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Không hỗ trợ', 'Thiết bị hiện không hỗ trợ chia sẻ file.');
        return;
      }
      await Sharing.shareAsync(file.uri, { dialogTitle: 'Xuất báo cáo (PDF)' });
    },
    [attendance, bars, exportModalTitle, metrics.avgHours.current, metrics.onTime.current, metrics.performance.current, metrics.tasksDone.current, period, range.from, range.to, trendPoints]
  );

  const showExportPicker = useCallback(() => {
    if (Platform.OS === 'android') {
      Alert.alert('Xuất báo cáo', 'Android sẽ hỏi bạn chọn thư mục để lưu file.', [
        { text: 'PDF (Tải về máy)', onPress: () => exportReport('pdf', 'download') },
        { text: 'Excel/CSV (Tải về máy)', onPress: () => exportReport('excel', 'download') },
        { text: 'Hủy', style: 'cancel' },
      ]);
      return;
    }

    Alert.alert('Xuất báo cáo', 'Chọn định dạng bạn muốn xuất', [
      { text: 'PDF', onPress: () => exportReport('pdf', 'share') },
      { text: 'Excel (CSV)', onPress: () => exportReport('excel', 'share') },
      { text: 'Hủy', style: 'cancel' },
    ]);
  }, [exportReport]);

  const targetHours = useMemo(() => parseWorkingHoursTarget(attendance?.workingHours), [attendance?.workingHours]);

  if (!me) {
    return (
      <Screen safeEdges={['top', 'left', 'right']} loading>
        <View />
      </Screen>
    );
  }

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      loading={loading}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { loadAll(); loadTrend(); }} tintColor={colors.primary} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.teal, 0.16) }]}>
          <Ionicons name="stats-chart-outline" size={18} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle}>Báo cáo & Thống kê</Text>
          <Text style={styles.pageSubtitle}>Tổng quan về hiệu suất làm việc và chấm công</Text>
        </View>
      </View>

      {!isAllowed ? (
        <Card style={{ backgroundColor: colors.secondary }}>
          <Text style={styles.lockTitle}>Chỉ dành cho Admin/Manager</Text>
          <Text style={styles.lockDesc}>Trang “Báo cáo” chỉ cho phép tài khoản Admin hoặc Manager truy cập.</Text>
        </Card>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topControlsRow}>
            <CardTabs value={period} onChange={(v) => { setPeriod(v); }} />

            <TouchableOpacity
              onPress={showExportPicker}
              style={[styles.exportBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.9}
            >
              <Ionicons name="download-outline" size={16} color={colors.card} />
              <Text style={styles.exportBtnText}>Xuất</Text>
            </TouchableOpacity>
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
            {statCards.map((c) => (
              <StatBox key={c.key} data={c} />
            ))}
          </ScrollView>

          <Card style={{ backgroundColor: colors.secondary }}>
            <View style={styles.sectionHeaderRow}>
              <SectionTitle>Tiến độ công việc</SectionTitle>
              <View style={{ flex: 1 }} />
              <Ionicons name="calendar-outline" size={16} color={hexToRgba(colors.primaryDark, 0.6)} />
            </View>

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={styles.legendLabel}>Hoàn thành</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
                <Text style={styles.legendLabel}>Đang làm</Text>
              </View>
            </View>

            <View style={styles.barChartWrap}>
              <StackedBars
                height={150}
                width={Math.max(260, bars.length * (22 + 14))}
                items={bars}
              />
              <View style={styles.barLabelsRow}>
                {bars.map((it) => (
                  <Text key={it.label} style={styles.barLabel}>{it.label}</Text>
                ))}
              </View>
            </View>
          </Card>

          <View style={styles.twoCardsRow}>
            <Card style={[styles.halfCard, { backgroundColor: colors.secondary }]}>
              <View style={styles.sectionHeaderRow}>
                <SectionTitle>Phân bố chấm công</SectionTitle>
                <View style={{ flex: 1 }} />
                <Ionicons name="time-outline" size={16} color={hexToRgba(colors.primaryDark, 0.6)} />
              </View>

              <View style={styles.donutRow}>
                <DonutChart
                  size={120}
                  strokeWidth={16}
                  segments={attendanceSegments.map((s) => ({ label: s.rawLabel, value: s.value, color: s.color }))}
                />

                <View style={styles.statusList}>
                  {attendanceSegments.map((seg) => (
                    <View key={seg.rawLabel} style={styles.statusRow}>
                      <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
                      <Text style={styles.statusLabel}>{seg.rawLabel}</Text>
                        <Text style={styles.statusValue}>{formatPercent(seg.value)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>

            <Card style={[styles.halfCard, { backgroundColor: colors.secondary }]}>
              <View style={styles.sectionHeaderRow}>
                <SectionTitle>Xu hướng giờ làm việc</SectionTitle>
                <View style={{ flex: 1 }} />
                <Ionicons name="trending-up-outline" size={16} color={hexToRgba(colors.primaryDark, 0.6)} />
              </View>

              {trendLoading ? (
                <View style={styles.trendLoading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                <>
                  <View style={{ marginTop: 8 }}>
                    <LineChart width={320} height={150} points={trendPoints.length ? trendPoints : [{ label: '—', value: 0 }]} target={targetHours} />
                  </View>

                  <View style={styles.trendLabelsRow}>
                    {trendPoints.map((p) => (
                      <Text key={p.label} style={styles.trendLabel}>{p.label}</Text>
                    ))}
                  </View>

                  <Text style={styles.trendHint}>{`Mục tiêu: ${targetHours}h/ngày`}</Text>
                </>
              )}
            </Card>
          </View>
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

  topControlsRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'nowrap',
  },
  tabPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 2,
  },
  tabText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },

  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: hexToRgba(colors.primaryDark, 0.15),
  },
  exportBtnText: {
    color: colors.card,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },

  statsRow: {
    paddingVertical: 12,
    gap: 10,
    paddingRight: 10,
  },
  statCard: {
    width: 210,
    gap: 8,
  },
  statTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statDelta: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  statValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 26,
  },
  statLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  legendRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    marginTop: 10,
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

  trendLoading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendLabelsRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  trendHint: {
    marginTop: 10,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    textAlign: 'center',
  },

});

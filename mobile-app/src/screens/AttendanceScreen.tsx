import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { colors } from '../theme/colors';
import { attendanceApi, companyApi } from '../services/api';
import { AttendanceCompanyDay, AttendanceCompanyRangeSummary, AttendanceDay, AttendanceRangeSummary, CompanyWorkSettings } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { hexToRgba } from '../utils/color';

type TabKey = 'today' | 'history' | 'monitor' | 'settings';

const pad2 = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoToDate = (iso: string) => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - diff);
  return x;
};

const isoToVNDate = (iso: string) => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || '').trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
};

type PickerField = 'monitorDate' | 'monitorFrom' | 'monitorTo';

function formatHM(dateLike?: string) {
  if (!dateLike) return '--';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatDayLabel(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(' thg', '');
}

function statusLabel(status: AttendanceDay['status']) {
  if (status === 'present') return 'Đúng giờ';
  if (status === 'late') return 'Đi muộn';
  if (status === 'leave') return 'Nghỉ phép';
  return 'Vắng mặt';
}

function statusPillStyle(status: AttendanceDay['status']) {
  if (status === 'present') return { bg: hexToRgba(colors.success, 0.16), border: hexToRgba(colors.success, 0.5), text: colors.success };
  if (status === 'late') return { bg: hexToRgba(colors.warning, 0.14), border: hexToRgba(colors.warning, 0.5), text: colors.warning };
  if (status === 'leave') return { bg: hexToRgba(colors.info, 0.12), border: hexToRgba(colors.info, 0.45), text: colors.info };
  return { bg: hexToRgba(colors.danger, 0.12), border: hexToRgba(colors.danger, 0.45), text: colors.danger };
}

function formatHours(hours?: number) {
  if (typeof hours !== 'number' || Number.isNaN(hours)) return '--';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

export function AttendanceScreen() {
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'admin';

  const initialTodayISO = useMemo(() => toISODate(new Date()), []);
  const initialWeekISO = useMemo(() => toISODate(startOfWeek(new Date())), []);

  const [activeTab, setActiveTab] = useState<TabKey>('today');
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [summary, setSummary] = useState<AttendanceRangeSummary | null>(null);
  const [companySummary, setCompanySummary] = useState<AttendanceCompanyRangeSummary | null>(null);
  const [monitor, setMonitor] = useState<AttendanceCompanyDay | null>(null);
  const [monitorRange, setMonitorRange] = useState<AttendanceCompanyRangeSummary | null>(null);
  const [workSettings, setWorkSettings] = useState<CompanyWorkSettings | null>(null);

  const [monitorDate, setMonitorDate] = useState<string>(initialTodayISO);
  const [monitorDateText, setMonitorDateText] = useState<string>(isoToVNDate(initialTodayISO));
  const [monitorMode, setMonitorMode] = useState<'day' | 'week' | 'month'>('day');
  const [monitorFrom, setMonitorFrom] = useState<string>(initialWeekISO);
  const [monitorFromText, setMonitorFromText] = useState<string>(isoToVNDate(initialWeekISO));
  const [monitorTo, setMonitorTo] = useState<string>(initialTodayISO);
  const [monitorToText, setMonitorToText] = useState<string>(isoToVNDate(initialTodayISO));
  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [pickerTemp, setPickerTemp] = useState<Date>(new Date());
  const [workStart, setWorkStart] = useState('');
  const [savingWork, setSavingWork] = useState(false);

  const openPicker = useCallback((field: PickerField) => {
    setPickerField(field);
    const currentISO = field === 'monitorDate' ? monitorDate : field === 'monitorFrom' ? monitorFrom : monitorTo;
    setPickerTemp(isoToDate(currentISO));
  }, [monitorDate, monitorFrom, monitorTo]);

  const closePicker = useCallback(() => {
    setPickerField(null);
  }, []);

  const applyPickedISO = useCallback((field: PickerField, iso: string) => {
    if (field === 'monitorDate') {
      setMonitorDate(iso);
      setMonitorDateText(isoToVNDate(iso));
      return;
    }
    if (field === 'monitorFrom') {
      setMonitorFrom(iso);
      setMonitorFromText(isoToVNDate(iso));
      return;
    }
    setMonitorTo(iso);
    setMonitorToText(isoToVNDate(iso));
  }, []);

  const commitPicker = useCallback((field: PickerField, pickedDate: Date) => {
    const iso = toISODate(pickedDate);
    applyPickedISO(field, iso);
    closePicker();
  }, [applyPickedISO, closePicker]);

  const loadSummary = useCallback(async () => {
    setRefreshing(true);
    try {
      const now = new Date();
      const from = toISODate(startOfMonth(now));
      const to = toISODate(now);
      if (isAdmin) {
        const response = await attendanceApi.getCompanyRange({ from, to });
        setCompanySummary(response.data.data);
      } else {
        const response = await attendanceApi.getMyRange({ from, to });
        setSummary(response.data.data);
      }
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin]);

  const loadWorkSettings = useCallback(async () => {
    try {
      const response = await companyApi.getWorkSettings();
      setWorkSettings(response.data.data);
      setWorkStart(response.data.data?.workingHours?.start || '08:00');
    } catch {
      setWorkSettings(null);
    }
  }, []);

  const loadMonitorDay = useCallback(async (date: string) => {
    if (!isAdmin) return;
    try {
      const response = await attendanceApi.getCompanyDay({ date });
      setMonitor(response.data.data);
    } catch {
      setMonitor(null);
    }
  }, [isAdmin]);

  const loadMonitorRange = useCallback(async (from: string, to: string) => {
    if (!isAdmin) return;
    try {
      const response = await attendanceApi.getCompanyRange({ from, to });
      setMonitorRange(response.data.data);
    } catch {
      setMonitorRange(null);
    }
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      loadSummary();
      if (isAdmin) {
        loadWorkSettings();
        if (monitorMode === 'day') {
          loadMonitorDay(monitorDate);
        } else {
          loadMonitorRange(monitorFrom, monitorTo);
        }
      }
    }, [isAdmin, loadMonitorDay, loadMonitorRange, loadSummary, loadWorkSettings, monitorDate, monitorFrom, monitorMode, monitorTo])
  );

  useEffect(() => {
    if (!me) return;
    if (me.role !== 'admin') {
      if (activeTab === 'monitor' || activeTab === 'settings') setActiveTab('today');
      return;
    }
    // admin default tab
    if (activeTab === 'history') setActiveTab('today');
  }, [activeTab, me]);

  const days = summary?.days || [];
  const todayISO = toISODate(new Date());
  const todayRecord = useMemo(() => days.find((d) => d.date === todayISO), [days, todayISO]);

  const checkedIn = Boolean(todayRecord?.clockIn && !todayRecord?.clockOut);

  const onTimeStreak = useMemo(() => {
    if (!days.length) return 0;
    const byDate = new Map(days.map((d) => [d.date, d]));
    let cur = new Date(`${todayISO}T00:00:00`);
    let streak = 0;
    for (let i = 0; i < 40; i++) {
      const iso = toISODate(cur);
      const d = byDate.get(iso);
      if (!d || d.status !== 'present') break;
      streak += 1;
      cur.setDate(cur.getDate() - 1);
    }
    return streak;
  }, [days, todayISO]);

  const streakAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (onTimeStreak < 3) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(streakAnim, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(streakAnim, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [onTimeStreak, streakAnim]);

  const handleClockIn = async () => {
    setActionLoading(true);
    try {
      await attendanceApi.clockIn();
      await loadSummary();
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    setActionLoading(true);
    try {
      await attendanceApi.clockOut();
      await loadSummary();
    } finally {
      setActionLoading(false);
    }
  };

  const tabs: Array<{ key: TabKey; label: string; show: boolean }> = useMemo(() => {
    const base: Array<{ key: TabKey; label: string; show: boolean }> = [
      { key: 'today', label: isAdmin ? 'Thống kê' : 'Hôm nay', show: true },
      { key: 'history', label: 'Lịch sử', show: !isAdmin },
      { key: 'monitor', label: 'Theo dõi', show: isAdmin },
      { key: 'settings', label: 'Cài đặt', show: isAdmin },
    ];
    return base.filter((t) => t.show);
  }, [me?.role]);

  const saveWorkTime = async () => {
    if (!me || me.role !== 'admin') return;
    const v = String(workStart || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      return;
    }
    try {
      setSavingWork(true);
      const response = await companyApi.updateWorkSettings({ start: v });
      setWorkSettings(response.data.data);
    } finally {
      setSavingWork(false);
    }
  };

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadSummary} tintColor={colors.primary} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <Ionicons name="time-outline" size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.pageTitle}>Chấm công</Text>
      </View>

      <View style={styles.tabRow}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[styles.tab, active ? styles.tabActive : undefined]}
            >
              <Text style={[styles.tabText, active ? styles.tabTextActive : undefined]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'today' ? (
        <>
          {!isAdmin ? (
            <Card>
              <Text style={styles.nowText}>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</Text>
              <Text style={styles.timeText}>{new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</Text>

              {checkedIn ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.meta}>Bạn đã check-in lúc {formatHM(todayRecord?.clockIn)}</Text>
                  <AppButton label="Check-out" onPress={handleClockOut} loading={actionLoading} />
                </View>
              ) : (
                <AppButton label="Check-in" onPress={handleClockIn} loading={actionLoading} />
              )}
            </Card>
          ) : null}

          <Card style={{ backgroundColor: colors.secondary }}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsTitle}>Thống kê</Text>
              <Text style={styles.statsSub}>Giờ vào làm: {(isAdmin ? companySummary?.workingHours?.start : summary?.workingHours?.start) || '--'}</Text>
            </View>

            {isAdmin && companySummary?.range ? (
              <Text style={[styles.sectionHint, { marginBottom: 8 }]}>Phạm vi: {companySummary.range.from} → {companySummary.range.to}</Text>
            ) : null}

            {!isAdmin && onTimeStreak >= 3 ? (
              <Animated.View
                style={[
                  styles.streakPill,
                  {
                    transform: [
                      {
                        scale: streakAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.05],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.streakText}>Streak đúng giờ: {onTimeStreak} ngày</Text>
              </Animated.View>
            ) : null}

            <View style={styles.statsGridTop}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Tháng này</Text>
                <Text style={styles.statValue}>{(isAdmin ? companySummary?.overall?.workedDays : summary?.stats?.workedDays) ?? 0}</Text>
                <Text style={styles.statHint}>{isAdmin ? 'Tổng ngày công' : 'Tổng ngày làm việc'}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>TB giờ làm</Text>
                <Text style={styles.statValue}>{formatHours(isAdmin ? companySummary?.overall?.avgHoursPerDay : summary?.stats?.avgHoursPerDay)}</Text>
                <Text style={styles.statHint}>Trung bình mỗi ngày</Text>
              </View>
            </View>

            <View style={styles.statsGridBottom}>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{(isAdmin ? companySummary?.overall?.presentDays : summary?.stats?.presentDays) ?? 0}</Text>
                <Text style={styles.miniStatLabel}>Đúng giờ</Text>
              </View>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{(isAdmin ? companySummary?.overall?.lateDays : summary?.stats?.lateDays) ?? 0}</Text>
                <Text style={styles.miniStatLabel}>Đi muộn</Text>
              </View>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{(isAdmin ? companySummary?.overall?.absentDays : summary?.stats?.absentDays) ?? 0}</Text>
                <Text style={styles.miniStatLabel}>Vắng mặt</Text>
              </View>
              <View style={styles.miniStat}>
                <Text style={styles.miniStatValue}>{(isAdmin ? companySummary?.overall?.leaveDays : summary?.stats?.leaveDays) ?? 0}</Text>
                <Text style={styles.miniStatLabel}>Nghỉ phép</Text>
              </View>
            </View>
          </Card>
        </>
      ) : null}

      {activeTab === 'history' ? (
        <Card style={{ backgroundColor: colors.secondary }}>
          <Text style={styles.sectionTitle}>Lịch sử chấm công</Text>
          <Text style={styles.sectionHint}>Chi tiết chấm công 7 ngày gần nhất</Text>

          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 1.2 }]}>Ngày</Text>
            <Text style={[styles.th, { flex: 0.9, textAlign: 'center' }]}>In</Text>
            <Text style={[styles.th, { flex: 0.9, textAlign: 'center' }]}>Out</Text>
            <Text style={[styles.th, { flex: 1.1, textAlign: 'center' }]}>Giờ</Text>
            <Text style={[styles.th, { flex: 1.2, textAlign: 'center' }]}>Trạng thái</Text>
          </View>

          {(days.slice(-7).reverse() || []).map((d) => {
            const pill = statusPillStyle(d.status);
            return (
              <View key={d.date} style={styles.tableRow}>
                <Text style={[styles.td, { flex: 1.2 }]} numberOfLines={1}>{isoToVNDate(d.date)}</Text>
                <Text style={[styles.td, { flex: 0.9, textAlign: 'center' }]}>{formatHM(d.clockIn)}</Text>
                <Text style={[styles.td, { flex: 0.9, textAlign: 'center' }]}>{formatHM(d.clockOut)}</Text>
                <Text style={[styles.td, { flex: 1.1, textAlign: 'center' }]}>{formatHours(d.hoursWorked)}</Text>
                <View style={[styles.statusPill, { backgroundColor: pill.bg, borderColor: pill.border }]}
                >
                  <Text style={[styles.statusPillText, { color: pill.text }]}>{statusLabel(d.status)}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {activeTab === 'monitor' ? (
        <>
          <Card style={{ backgroundColor: colors.secondary }}>
            <Text style={styles.sectionTitle}>Theo dõi</Text>
            <Text style={styles.sectionHint}>Giờ vào làm: {monitor?.workingHours?.start || monitorRange?.workingHours?.start || workSettings?.workingHours?.start || '--'}</Text>
            <Text style={styles.dateNote}>Chọn ngày bằng lịch</Text>

            <View style={styles.modeRow}>
              {([
                { key: 'day' as const, label: 'Ngày' },
                { key: 'week' as const, label: 'Tuần' },
                { key: 'month' as const, label: 'Tháng' },
              ]).map((m) => {
                const active = monitorMode === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => {
                      setMonitorMode(m.key);
                      if (m.key === 'day') {
                        loadMonitorDay(monitorDate);
                        return;
                      }
                      const now = new Date();
                      const from = m.key === 'week' ? toISODate(startOfWeek(now)) : toISODate(startOfMonth(now));
                      const to = toISODate(now);
                      setMonitorFrom(from);
                      setMonitorTo(to);
                      setMonitorFromText(isoToVNDate(from));
                      setMonitorToText(isoToVNDate(to));
                      loadMonitorRange(from, to);
                    }}
                    style={[styles.modeChip, active ? styles.modeChipActive : undefined]}
                  >
                    <Text style={[styles.modeChipText, active ? styles.modeChipTextActive : undefined]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {monitorMode === 'day' ? (
              <View style={styles.monitorBlock}>
                <View style={styles.monitorRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable onPress={() => openPicker('monitorDate')} style={{ flex: 1 }}>
                      <View pointerEvents="none">
                        <AppInput label="Ngày" value={monitorDateText} placeholder="06/04/2026" editable={false} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.monitorActionsRow}>
                  <AppButton
                    label="Hôm nay"
                    variant="outline"
                    style={{ flex: 1 }}
                    onPress={() => {
                      const v = toISODate(new Date());
                      setMonitorDate(v);
                      setMonitorDateText(isoToVNDate(v));
                      loadMonitorDay(v);
                    }}
                  />
                  <AppButton
                    label="Xem"
                    style={{ flex: 1 }}
                    onPress={() => {
                      loadMonitorDay(monitorDate);
                    }}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.monitorBlock}>
                <View style={styles.monitorRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable onPress={() => openPicker('monitorFrom')} style={{ flex: 1 }}>
                      <View pointerEvents="none">
                        <AppInput label="Từ" value={monitorFromText} placeholder="01/04/2026" editable={false} />
                      </View>
                    </Pressable>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable onPress={() => openPicker('monitorTo')} style={{ flex: 1 }}>
                      <View pointerEvents="none">
                        <AppInput label="Đến" value={monitorToText} placeholder="06/04/2026" editable={false} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.monitorActionsRow}>
                  <AppButton
                    label={monitorMode === 'week' ? 'Tuần này' : 'Tháng này'}
                    variant="outline"
                    style={{ flex: 1 }}
                    onPress={() => {
                      const now = new Date();
                      const from = monitorMode === 'week' ? toISODate(startOfWeek(now)) : toISODate(startOfMonth(now));
                      const to = toISODate(now);
                      setMonitorFrom(from);
                      setMonitorTo(to);
                      setMonitorFromText(isoToVNDate(from));
                      setMonitorToText(isoToVNDate(to));
                      loadMonitorRange(from, to);
                    }}
                  />
                  <AppButton
                    label="Xem"
                    style={{ flex: 1 }}
                    onPress={() => {
                      const fromISO = monitorFrom;
                      const toISO = monitorTo;
                      if (!fromISO || !toISO) return;
                      if (fromISO > toISO) {
                        setMonitorFrom(toISO);
                        setMonitorTo(fromISO);
                        setMonitorFromText(isoToVNDate(toISO));
                        setMonitorToText(isoToVNDate(fromISO));
                        loadMonitorRange(toISO, fromISO);
                        return;
                      }
                      loadMonitorRange(fromISO, toISO);
                    }}
                  />
                </View>
              </View>
            )}
          </Card>

          {pickerField ? (
            Platform.OS === 'android' ? (
              <DateTimePicker
                value={pickerTemp}
                mode="date"
                display="calendar"
                onChange={(event: DateTimePickerEvent, date?: Date) => {
                  if (event.type === 'dismissed') {
                    closePicker();
                    return;
                  }
                  if (date) commitPicker(pickerField, date);
                }}
              />
            ) : (
              <Modal transparent animationType="fade" onRequestClose={closePicker}>
                <View style={styles.pickerOverlay}>
                  <View style={styles.pickerCard}>
                    <DateTimePicker
                      value={pickerTemp}
                      mode="date"
                      display="inline"
                      onChange={(_, date) => {
                        if (date) setPickerTemp(date);
                      }}
                    />
                    <View style={styles.pickerActions}>
                      <View style={{ flex: 1 }}>
                        <AppButton label="Hủy" variant="outline" onPress={closePicker} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppButton label="Chọn" onPress={() => commitPicker(pickerField, pickerTemp)} />
                      </View>
                    </View>
                  </View>
                </View>
              </Modal>
            )
          ) : null}

          <Card style={{ backgroundColor: colors.secondary }}>
            {monitorMode === 'day' ? (
              monitor?.rows?.length ? (
                <>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.th, { flex: 1.4 }]}>Nhân viên</Text>
                    <Text style={[styles.th, { flex: 0.9, textAlign: 'center' }]}>In</Text>
                    <Text style={[styles.th, { flex: 0.9, textAlign: 'center' }]}>Out</Text>
                    <Text style={[styles.th, { flex: 1.2, textAlign: 'center' }]}>Trạng thái</Text>
                  </View>
                  {monitor.rows.map((row) => {
                    const pill = statusPillStyle(row.day.status);
                    return (
                      <View key={row.user._id} style={styles.tableRowTop}>
                        <View style={{ flex: 1.4 }}>
                          <Text style={styles.td}>{row.user.name}</Text>
                          <Text style={styles.subTd} numberOfLines={1}>{row.user.email}</Text>
                        </View>
                        <Text style={[styles.td, { flex: 0.9, textAlign: 'center' }]}>{formatHM(row.day.clockIn)}</Text>
                        <Text style={[styles.td, { flex: 0.9, textAlign: 'center' }]}>{formatHM(row.day.clockOut)}</Text>
                        <View style={[styles.statusPill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
                          <Text style={[styles.statusPillText, { color: pill.text }]}>{statusLabel(row.day.status)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </>
              ) : (
                <Text style={styles.emptyText}>Chưa có dữ liệu cho ngày này.</Text>
              )
            ) : (
              monitorRange?.rows?.length ? (
                <>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.th, { flex: 1.6 }]}>Nhân viên</Text>
                    <Text style={[styles.th, { flex: 0.65, textAlign: 'center' }]}>Đi làm</Text>
                    <Text style={[styles.th, { flex: 0.65, textAlign: 'center' }]}>Muộn</Text>
                    <Text style={[styles.th, { flex: 0.65, textAlign: 'center' }]}>Nghỉ</Text>
                    <Text style={[styles.th, { flex: 0.65, textAlign: 'center' }]}>Vắng</Text>
                  </View>
                  {monitorRange.rows.map((row) => (
                    <View key={row.user._id} style={styles.tableRowTop}>
                      <View style={{ flex: 1.6 }}>
                        <Text style={styles.td}>{row.user.name}</Text>
                        <Text style={styles.subTd} numberOfLines={1}>{row.user.email}</Text>
                      </View>
                      <Text style={[styles.td, { flex: 0.65, textAlign: 'center' }]}>{row.stats.workedDays}</Text>
                      <Text style={[styles.td, { flex: 0.65, textAlign: 'center' }]}>{row.stats.lateDays}</Text>
                      <Text style={[styles.td, { flex: 0.65, textAlign: 'center' }]}>{row.stats.leaveDays}</Text>
                      <Text style={[styles.td, { flex: 0.65, textAlign: 'center' }]}>{row.stats.absentDays}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.emptyText}>Chưa có dữ liệu cho khoảng này.</Text>
              )
            )}
          </Card>
        </>
      ) : null}

      {activeTab === 'settings' ? (
        <Card style={{ backgroundColor: colors.secondary }}>
          <Text style={styles.sectionTitle}>Cài đặt giờ làm</Text>
          <Text style={styles.sectionHint}>Admin thiết lập giờ vào làm (HH:mm), dùng để tính đúng giờ/đi muộn.</Text>

          <AppInput label="Giờ bắt đầu" value={workStart} onChangeText={setWorkStart} placeholder="07:30" />

          <View style={styles.quickRow}>
            {['07:30', '08:00', '08:30'].map((t) => (
              <TouchableOpacity key={t} onPress={() => setWorkStart(t)} style={styles.quickChip}>
                <Text style={styles.quickChipText}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <AppButton label="Lưu" onPress={saveWorkTime} loading={savingWork} />
        </Card>
      ) : null}
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
    fontSize: 28,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: hexToRgba(colors.primary, 0.12),
    borderColor: hexToRgba(colors.primary, 0.5),
  },
  tabText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  tabTextActive: {
    color: colors.primaryDark,
  },
  nowText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    textTransform: 'capitalize',
  },
  timeText: {
    fontSize: 36,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statsTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 16,
  },
  statsSub: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
  },
  streakPill: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: hexToRgba(colors.success, 0.4),
    backgroundColor: hexToRgba(colors.success, 0.12),
    marginBottom: 10,
  },
  streakText: {
    color: colors.success,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  statsGridTop: {
    flexDirection: 'row',
    gap: 10,
  },
  statBox: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 2,
  },
  statLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  statValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 22,
  },
  statHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 11,
  },
  statsGridBottom: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  miniStat: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 2,
  },
  miniStatValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 20,
  },
  miniStatLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 16,
  },
  sectionHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    marginBottom: 10,
  },
  dateNote: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    marginTop: -6,
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    marginTop: 8,
    gap: 6,
  },
  th: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: hexToRgba(colors.border, 0.7),
    borderStyle: 'dashed',
    gap: 6,
  },
  tableRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: hexToRgba(colors.border, 0.7),
    borderStyle: 'dashed',
    gap: 6,
  },
  td: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
  },
  subTd: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 11,
    marginTop: 2,
  },
  statusPill: {
    flex: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 2,
  },
  statusPillText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  monitorBlock: {
    gap: 10,
  },
  monitorRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  modeChipActive: {
    backgroundColor: hexToRgba(colors.primary, 0.12),
    borderColor: hexToRgba(colors.primary, 0.5),
  },
  modeChipText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  modeChipTextActive: {
    color: colors.primaryDark,
  },
  monitorActionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 14,
    backgroundColor: hexToRgba(colors.text, 0.32),
  },
  pickerCard: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 10,
  },
  pickerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 13,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  quickChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  quickChipText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
});
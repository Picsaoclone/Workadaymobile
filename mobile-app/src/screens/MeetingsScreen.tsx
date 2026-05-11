import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { SectionTitle } from '../components/SectionTitle';
import { colors } from '../theme/colors';
import { hexToRgba } from '../utils/color';
import { meetingApi, projectApi, userApi } from '../services/api';
import { AuthUser, Meeting, Project } from '../types/models';
import { getApiErrorMessage } from '../services/error';
import { useAuthStore } from '../store/authStore';

const tabs = [
  { key: 'today' as const, label: 'Hôm nay', range: 'today' as const },
  { key: 'upcoming' as const, label: 'Sắp tới', range: 'upcoming' as const },
  { key: 'past' as const, label: 'Đã qua', range: 'past' as const },
];

type TabKey = (typeof tabs)[number]['key'];

type PickerField = 'startDate' | 'startTime';

type CreateState = {
  title: string;
  description: string;
  startAt: Date;
  durationMinutes: string;
  reminderMinutesBefore: string;
  callMode: 'voice' | 'video';
  projectId: string | null;
  participantIds: string[];
};

const mergeDate = (base: Date, nextDate: Date) =>
  new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate(), base.getHours(), base.getMinutes(), 0, 0);

const mergeTime = (base: Date, nextTime: Date) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate(), nextTime.getHours(), nextTime.getMinutes(), 0, 0);

const formatDateTime = (d: string | Date) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN');
};

function myParticipant(meeting: Meeting, userId: string | undefined) {
  if (!userId) return null;
  return (meeting.participants || []).find((p) => String(p.userId) === String(userId)) || null;
}

function statusPill(status: Meeting['status']) {
  if (status === 'cancelled') {
    return { bg: hexToRgba(colors.danger, 0.12), border: hexToRgba(colors.danger, 0.5), text: colors.danger, label: 'Đã hủy' };
  }
  return { bg: hexToRgba(colors.success, 0.14), border: hexToRgba(colors.success, 0.5), text: colors.success, label: 'Đã lên lịch' };
}

export function MeetingsScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<TabKey>('today');
  const activeRange = useMemo(() => tabs.find((t) => t.key === tab)?.range || 'today', [tab]);

  const [refreshing, setRefreshing] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [pickerField, setPickerField] = useState<PickerField | null>(null);

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [create, setCreate] = useState<CreateState>(() => ({
    title: '',
    description: '',
    startAt: new Date(Date.now() + 30 * 60 * 1000),
    durationMinutes: '30',
    reminderMinutesBefore: '10',
    callMode: 'video',
    projectId: null,
    participantIds: [],
  }));

  const loadMeetings = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await meetingApi.getAll({ range: activeRange });
      setMeetings(res.data?.data || []);
    } catch (err) {
      Alert.alert('Không tải được lịch họp', getApiErrorMessage(err) || 'Vui lòng thử lại.');
    } finally {
      setRefreshing(false);
    }
  }, [activeRange]);

  const loadLookups = useCallback(async () => {
    try {
      const [uRes, pRes] = await Promise.all([userApi.getAll().catch(() => null), projectApi.getAll().catch(() => null)]);
      setUsers(uRes?.data?.data || []);
      setProjects(pRes?.data?.data || []);
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMeetings();
      if (projects.length === 0 || users.length === 0) {
        loadLookups();
      }
    }, [loadMeetings])
  );

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p._id), String(p.name));
    return map;
  }, [projects]);

  const openCreate = async () => {
    setCreateVisible(true);
    if (users.length === 0 || projects.length === 0) {
      await loadLookups();
    }
  };

  const toggleParticipant = (userId: string) => {
    setCreate((prev) => {
      const exists = prev.participantIds.includes(userId);
      const next = exists ? prev.participantIds.filter((id) => id !== userId) : [...prev.participantIds, userId];
      return { ...prev, participantIds: next };
    });
  };

  const selectableUsers = useMemo(() => users.filter((u) => String(u._id) !== String(user?._id)), [users, user?._id]);

  const submitCreate = async () => {
    const title = String(create.title || '').trim();
    const durationMinutes = Number(create.durationMinutes);
    const reminderMinutesBefore = Number(create.reminderMinutesBefore);

    if (!title) {
      Alert.alert('Thiếu tiêu đề', 'Vui lòng nhập tiêu đề cuộc họp.');
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5) {
      Alert.alert('Thời lượng không hợp lệ', 'Thời lượng tối thiểu là 5 phút.');
      return;
    }
    if (create.participantIds.length === 0) {
      Alert.alert('Thiếu người tham gia', 'Vui lòng chọn ít nhất 1 người để thông báo.');
      return;
    }

    setCreateLoading(true);
    try {
      await meetingApi.create({
        title,
        description: String(create.description || '').trim() || undefined,
        startAt: create.startAt.toISOString(),
        durationMinutes,
        participantIds: create.participantIds,
        projectId: create.projectId || undefined,
        reminderMinutesBefore: Number.isFinite(reminderMinutesBefore) ? reminderMinutesBefore : 10,
        callMode: create.callMode,
      });
      setCreateVisible(false);
      setCreate((prev) => ({ ...prev, title: '', description: '', participantIds: [] }));
      await loadMeetings();
    } catch (err) {
      Alert.alert('Không tạo được cuộc họp', getApiErrorMessage(err) || 'Vui lòng thử lại.');
    } finally {
      setCreateLoading(false);
    }
  };

  const respond = async (meetingId: string, status: 'accepted' | 'declined') => {
    try {
      await meetingApi.respond(meetingId, status);
      await loadMeetings();
    } catch (err) {
      Alert.alert('Không gửi được phản hồi', getApiErrorMessage(err) || 'Vui lòng thử lại.');
    }
  };

  const startMeeting = async (meeting: Meeting) => {
    try {
      const res = await meetingApi.start(meeting._id);
      const call = res.data?.data;
      if (!call?.agoraChannelName) throw new Error('Thiếu dữ liệu cuộc gọi.');

      navigation.navigate('Call', {
        agoraChannelName: call.agoraChannelName,
        mode: call.mode,
        title: call.title || `Họp: ${meeting.title}`,
        callRole: 'caller',
        channelId: `meeting:${meeting._id}`,
      });
    } catch (err: any) {
      Alert.alert('Không thể bắt đầu cuộc họp', getApiErrorMessage(err) || String(err?.message || err));
    }
  };

  const onPickerChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS !== 'ios') {
      setPickerField(null);
    }
    if (event.type === 'dismissed') return;
    if (!selectedDate) return;

    setCreate((prev) => {
      if (pickerField === 'startDate') return { ...prev, startAt: mergeDate(prev.startAt, selectedDate) };
      if (pickerField === 'startTime') return { ...prev, startAt: mergeTime(prev.startAt, selectedDate) };
      return prev;
    });
  };

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadMeetings} tintColor={colors.primary} />}
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.pageTitleRow}>
            <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
              <Ionicons name="calendar-outline" size={18} color={colors.primaryDark} />
            </View>
            <Text style={styles.title}>Lịch họp</Text>
          </View>
          <Text style={styles.sub}>Tạo lịch và thông báo người tham gia</Text>
        </View>

        <TouchableOpacity style={styles.iconBtn} onPress={openCreate}>
          <Ionicons name="add" size={22} color={colors.primaryDark} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabsRow}>
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabPill, active ? styles.tabPillActive : styles.tabPillInactive]}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : styles.tabLabelInactive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Danh sách</SectionTitle>
      <Card style={{ backgroundColor: colors.secondary }}>
        {meetings.length === 0 ? (
          <Text style={styles.emptyText}>Chưa có cuộc họp.</Text>
        ) : (
          meetings.map((m, idx) => {
            const pill = statusPill(m.status);
            const projectName = m.projectId ? projectNameById.get(String(m.projectId)) : null;
            const my = myParticipant(m, user?._id);
            const myStatus = my?.status || null;

            const showDivider = idx !== meetings.length - 1;
            const showRespond = myStatus === 'invited';
            const canStart =
              String(m.createdBy) === String(user?._id) || user?.role === 'admin' || user?.role === 'manager';

            return (
              <View key={m._id} style={[styles.meetingItem, showDivider ? styles.itemDivider : null]}>
                <View style={styles.meetingTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.meetingTitle}>{m.title}</Text>
                    <Text style={styles.meetingMeta}>
                      {formatDateTime(m.startAt)} · {m.durationMinutes} phút
                      {projectName ? ` · ${projectName}` : ''}
                    </Text>
                  </View>

                  <View style={[styles.statusPill, { backgroundColor: pill.bg, borderColor: pill.border }]}> 
                    <Text style={[styles.statusText, { color: pill.text }]}>{pill.label}</Text>
                  </View>
                </View>

                {showRespond ? (
                  <View style={styles.actionsRow}>
                    <AppButton
                      label="Từ chối"
                      variant="outline"
                      onPress={() => respond(m._id, 'declined')}
                      style={styles.smallBtn}
                    />
                    <AppButton
                      label="Nhận lời"
                      onPress={() => respond(m._id, 'accepted')}
                      style={styles.smallBtn}
                    />
                  </View>
                ) : null}

                {m.callInvitedAt ? (
                  <Text style={styles.hint}>Cuộc gọi đã được mời lúc {formatDateTime(m.callInvitedAt)}.</Text>
                ) : null}

                {canStart ? (
                  <View style={styles.actionsRow}>
                    <AppButton label="Bắt đầu" onPress={() => startMeeting(m)} style={styles.smallBtn} />
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </Card>

      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Tạo lịch họp</Text>
              <Pressable onPress={() => setCreateVisible(false)} style={styles.iconBtnSmall}>
                <Ionicons name="close" size={20} color={colors.primaryDark} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 14 }} showsVerticalScrollIndicator={false}>
              <AppInput label="Tiêu đề" value={create.title} onChangeText={(v) => setCreate((p) => ({ ...p, title: v }))} />
              <AppInput
                label="Mô tả (tuỳ chọn)"
                value={create.description}
                onChangeText={(v) => setCreate((p) => ({ ...p, description: v }))}
              />

              <View style={styles.row2}>
                <Pressable
                  onPress={() => setPickerField('startDate')}
                  style={[styles.pickerBox, { backgroundColor: colors.white }]}
                >
                  <Text style={styles.pickerLabel}>Ngày</Text>
                  <Text style={styles.pickerValue}>{create.startAt.toLocaleDateString('vi-VN')}</Text>
                </Pressable>

                <Pressable
                  onPress={() => setPickerField('startTime')}
                  style={[styles.pickerBox, { backgroundColor: colors.white }]}
                >
                  <Text style={styles.pickerLabel}>Giờ</Text>
                  <Text style={styles.pickerValue}>
                    {create.startAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Pressable>
              </View>

              {pickerField ? (
                <DateTimePicker
                  value={create.startAt}
                  mode={pickerField === 'startDate' ? 'date' : 'time'}
                  is24Hour
                  onChange={onPickerChange}
                />
              ) : null}

              <View style={styles.row2}>
                <AppInput
                  label="Thời lượng (phút)"
                  value={create.durationMinutes}
                  keyboardType="numeric"
                  onChangeText={(v) => setCreate((p) => ({ ...p, durationMinutes: v }))}
                  style={{ flex: 1 }}
                />
                <AppInput
                  label="Nhắc trước (phút)"
                  value={create.reminderMinutesBefore}
                  keyboardType="numeric"
                  onChangeText={(v) => setCreate((p) => ({ ...p, reminderMinutesBefore: v }))}
                  style={{ flex: 1 }}
                />
              </View>

              <SectionTitle>Hình thức</SectionTitle>
              <View style={styles.row2}>
                <Pressable
                  onPress={() => setCreate((p) => ({ ...p, callMode: 'video' }))}
                  style={[styles.modePill, create.callMode === 'video' ? styles.modeActive : styles.modeInactive]}
                >
                  <Text style={[styles.modeText, create.callMode === 'video' ? styles.modeTextActive : styles.modeTextInactive]}>
                    Video
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setCreate((p) => ({ ...p, callMode: 'voice' }))}
                  style={[styles.modePill, create.callMode === 'voice' ? styles.modeActive : styles.modeInactive]}
                >
                  <Text style={[styles.modeText, create.callMode === 'voice' ? styles.modeTextActive : styles.modeTextInactive]}>
                    Voice
                  </Text>
                </Pressable>
              </View>

              <SectionTitle>Dự án (tuỳ chọn)</SectionTitle>
              <View style={styles.optionList}>
                <Pressable onPress={() => setCreate((p) => ({ ...p, projectId: null }))} style={styles.optionRow}>
                  <Ionicons
                    name={create.projectId ? 'radio-button-off' : 'radio-button-on'}
                    size={18}
                    color={colors.primaryDark}
                  />
                  <Text style={styles.optionText}>Không chọn dự án</Text>
                </Pressable>
                {projects.map((p) => (
                  <Pressable key={p._id} onPress={() => setCreate((s) => ({ ...s, projectId: p._id }))} style={styles.optionRow}>
                    <Ionicons
                      name={create.projectId === p._id ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={colors.primaryDark}
                    />
                    <Text style={styles.optionText}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>

              <SectionTitle>Sẽ thông báo tới ai</SectionTitle>
              <View style={styles.optionList}>
                {selectableUsers.map((u) => {
                  const checked = create.participantIds.includes(u._id);
                  return (
                    <Pressable key={u._id} onPress={() => toggleParticipant(u._id)} style={styles.optionRow}>
                      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18} color={colors.primaryDark} />
                      <Text style={styles.optionText}>{u.name || u.email}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.actionsRow}>
                <AppButton
                  label="Hủy"
                  variant="outline"
                  onPress={() => setCreateVisible(false)}
                  style={StyleSheet.flatten([styles.smallBtn, { flex: 1 }])}
                />
                <AppButton
                  label="Tạo"
                  onPress={submitCreate}
                  loading={createLoading}
                  style={StyleSheet.flatten([styles.smallBtn, { flex: 1 }])}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 2,
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tabPill: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 2,
  },
  tabPillActive: {
    backgroundColor: hexToRgba(colors.primary, 0.16),
    borderColor: hexToRgba(colors.primary, 0.5),
  },
  tabPillInactive: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  tabLabel: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  tabLabelActive: { color: colors.primaryDark },
  tabLabelInactive: { color: colors.text },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  meetingItem: {
    paddingVertical: 12,
  },
  itemDivider: {
    borderBottomWidth: 2,
    borderBottomColor: hexToRgba(colors.primaryDark, 0.08),
  },
  meetingTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  meetingTitle: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
    fontSize: 15,
  },
  meetingMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 2,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 12,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  smallBtn: {
    minHeight: 44,
    paddingVertical: 9,
    borderRadius: 14,
    flex: 1,
  },
  hint: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: hexToRgba(colors.primaryDark, 0.35),
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: '90%',
    borderWidth: 2,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  iconBtnSmall: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  pickerBox: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pickerLabel: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  pickerValue: {
    marginTop: 4,
    fontSize: 14,
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  modePill: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeActive: {
    backgroundColor: hexToRgba(colors.primary, 0.16),
    borderColor: hexToRgba(colors.primary, 0.5),
  },
  modeInactive: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  modeText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  modeTextActive: {
    color: colors.primaryDark,
  },
  modeTextInactive: {
    color: colors.text,
  },
  optionList: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  optionText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
});

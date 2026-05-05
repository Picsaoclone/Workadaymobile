import React, { useCallback, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
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
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { colors } from '../theme/colors';
import { authApi, companyApi, leaveApi, userApi } from '../services/api';
import { AuthUser, CompanyWorkSettings, LeaveRecord } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { hexToRgba } from '../utils/color';

const leaveTypes = [
  { label: 'Nghỉ phép năm', value: 'annual' as const },
  { label: 'Nghỉ ốm', value: 'sick' as const },
  { label: 'Nghỉ việc riêng', value: 'other' as const },
  { label: 'Nghỉ không lương', value: 'unpaid' as const },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoToDate = (iso: string) => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const isoToVNDate = (iso: string) => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || '').trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const sameYear = (iso: string, year: number) => {
  const m = String(iso || '').trim().match(/^(\d{4})-/);
  if (!m) return false;
  return Number(m[1]) === year;
};

const daysBetweenInclusive = (fromISO: string, toISO: string) => {
  if (!fromISO || !toISO) return 0;
  const from = isoToDate(fromISO);
  const to = isoToDate(toISO);
  const diff = to.getTime() - from.getTime();
  if (Number.isNaN(diff)) return 0;
  return Math.max(1, Math.floor(diff / 86400000) + 1);
};

function statusPillStyle(status: LeaveRecord['status']) {
  if (status === 'approved') return { bg: hexToRgba(colors.success, 0.16), border: hexToRgba(colors.success, 0.5), text: colors.success };
  if (status === 'rejected') return { bg: hexToRgba(colors.danger, 0.12), border: hexToRgba(colors.danger, 0.45), text: colors.danger };
  return { bg: hexToRgba(colors.warning, 0.14), border: hexToRgba(colors.warning, 0.5), text: colors.warning };
}

type PickerField = 'start' | 'end';
type Reviewer = Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>;
type ReviewMode = 'approve' | 'reject';

export function LeaveScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const isAdmin = user?.role === 'admin';
  const isReviewer = user?.role === 'admin' || user?.role === 'manager';
  const isEmployee = user?.role === 'employee';

  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [workSettings, setWorkSettings] = useState<CompanyWorkSettings | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [showReviewerModal, setShowReviewerModal] = useState(false);

  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [selectedReviewer, setSelectedReviewer] = useState<Reviewer | null>(null);

  const initialTodayISO = useMemo(() => toISODate(new Date()), []);
  const [leaveType, setLeaveType] = useState<(typeof leaveTypes)[number]>(leaveTypes[0]);
  const [startISO, setStartISO] = useState<string>(initialTodayISO);
  const [endISO, setEndISO] = useState<string>(initialTodayISO);
  const [startText, setStartText] = useState<string>(isoToVNDate(initialTodayISO));
  const [endText, setEndText] = useState<string>(isoToVNDate(initialTodayISO));
  const [reason, setReason] = useState('');

  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [pickerTemp, setPickerTemp] = useState<Date>(new Date());

  const [annualLeaveText, setAnnualLeaveText] = useState('');

  const [reviewing, setReviewing] = useState<{ leave: LeaveRecord; mode: ReviewMode } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const openPicker = useCallback(
    (field: PickerField) => {
      setPickerField(field);
      setPickerTemp(isoToDate(field === 'start' ? startISO : endISO));
    },
    [endISO, startISO]
  );

  const closePicker = useCallback(() => {
    setPickerField(null);
  }, []);

  const commitPicker = useCallback(
    (field: PickerField, date: Date) => {
      const iso = toISODate(date);
      if (field === 'start') {
        setStartISO(iso);
        setStartText(isoToVNDate(iso));
      } else {
        setEndISO(iso);
        setEndText(isoToVNDate(iso));
      }
      closePicker();
    },
    [closePicker]
  );

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [leaves, settings, reviewersResponse, meResponse] = await Promise.all([
        leaveApi.getAll(),
        companyApi.getWorkSettings().catch(() => null),
        isEmployee ? userApi.getReviewers().catch(() => null) : Promise.resolve(null),
        authApi.me().catch(() => null),
      ]);

      setRecords(leaves.data.data || []);

      if (settings?.data?.data) {
        setWorkSettings(settings.data.data);
        setAnnualLeaveText(String(settings.data.data.annualLeave ?? ''));
      }

      if (reviewersResponse?.data?.data) {
        const list = reviewersResponse.data.data || [];
        setReviewers(list);
        setSelectedReviewer((prev) => {
          if (prev?._id && list.some((u: Reviewer) => u._id === prev._id)) return prev;
          return list[0] ?? null;
        });
      } else if (isEmployee) {
        setReviewers([]);
        setSelectedReviewer(null);
      }

      if (meResponse?.data?.data) {
        setUser(meResponse.data.data);
      }
    } finally {
      setRefreshing(false);
    }
  }, [isEmployee, isEmployee, setUser]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const year = useMemo(() => new Date().getFullYear(), []);
  const totalAnnual = workSettings?.annualLeave ?? 12;

  const pending = useMemo(() => records.filter((r) => r.status === 'pending').length, [records]);
  const usedAnnual = useMemo(() => {
    return records
      .filter((r) => r.status === 'approved')
      .filter((r) => r.type === 'annual')
      .filter((r) => sameYear(String(r.startDate || '').slice(0, 10), year))
      .reduce((sum, r) => sum + (Number(r.days) || 0), 0);
  }, [records, year]);
  const remainingAnnual = useMemo(() => Math.max(0, totalAnnual - usedAnnual), [totalAnnual, usedAnnual]);

  const requestDays = useMemo(() => daysBetweenInclusive(startISO, endISO), [endISO, startISO]);

  const resetCreateForm = useCallback(() => {
    setLeaveType(leaveTypes[0]);
    setStartISO(initialTodayISO);
    setEndISO(initialTodayISO);
    setStartText(isoToVNDate(initialTodayISO));
    setEndText(isoToVNDate(initialTodayISO));
    setReason('');
  }, [initialTodayISO]);

  const handleCreate = useCallback(async () => {
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) return;
    if (!selectedReviewer?._id) return;

    let fromISO = startISO;
    let toISO = endISO;
    if (fromISO > toISO) {
      const tmp = fromISO;
      fromISO = toISO;
      toISO = tmp;
    }

    const days = daysBetweenInclusive(fromISO, toISO);
    if (!days) return;

    setSubmitting(true);
    try {
      await leaveApi.create({
        type: leaveType.value,
        leaveType: leaveType.label,
        assignedTo: selectedReviewer._id,
        startDate: fromISO,
        endDate: toISO,
        days,
        reason: trimmedReason,
      });
      setShowCreate(false);
      resetCreateForm();
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  }, [endISO, leaveType.label, leaveType.value, loadAll, reason, resetCreateForm, selectedReviewer?._id, startISO]);

  const openReviewModal = useCallback((leave: LeaveRecord, mode: ReviewMode) => {
    setReviewing({ leave, mode });
    setReviewNotes('');
  }, []);

  const closeReviewModal = useCallback(() => {
    setReviewing(null);
    setReviewNotes('');
  }, []);

  const submitReview = useCallback(async () => {
    if (!reviewing) return;

    const leaveId = reviewing.leave._id;
    setReviewSubmitting(true);
    try {
      if (reviewing.mode === 'approve') {
        await leaveApi.review(leaveId, 'approved');
      } else {
        const notes = String(reviewNotes || '').trim();
        if (!notes) return;
        await leaveApi.review(leaveId, 'rejected', notes);
      }
      closeReviewModal();
      await loadAll();
    } finally {
      setReviewSubmitting(false);
    }
  }, [closeReviewModal, loadAll, reviewNotes, reviewing]);

  const handleSaveAnnualLeave = useCallback(async () => {
    if (!isAdmin) return;
    const n = Number(String(annualLeaveText || '').trim());
    if (!Number.isFinite(n) || n < 0 || n > 365) return;

    setSavingSettings(true);
    try {
      const response = await companyApi.updateWorkSettings({ annualLeave: n });
      setWorkSettings(response.data.data);
      setAnnualLeaveText(String(response.data.data?.annualLeave ?? n));
    } finally {
      setSavingSettings(false);
    }
  }, [annualLeaveText, isAdmin]);

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor={colors.primary} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <Ionicons name="calendar-clear-outline" size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.pageTitle}>Nghỉ phép</Text>
      </View>

      {isEmployee ? (
        <View style={styles.statsGrid}>
          <Card style={[styles.statCard, styles.statPrimary]}>
            <Text style={[styles.statLabel, styles.statPrimaryLabel]}>Tổng ngày phép</Text>
            <Text style={[styles.statValue, styles.statPrimaryValue]}>{totalAnnual}</Text>
            <Text style={[styles.statSub, styles.statPrimarySub]}>Phép năm {year}</Text>
          </Card>

          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>Đã sử dụng</Text>
            <Text style={[styles.statValue, { color: colors.warning }]}>{usedAnnual}</Text>
            <Text style={styles.statSub}>Từ đầu năm</Text>
          </Card>

          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>Còn lại</Text>
            <Text style={[styles.statValue, { color: colors.success }]}>{remainingAnnual}</Text>
            <Text style={styles.statSub}>Có thể sử dụng</Text>
          </Card>

          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>Chờ duyệt</Text>
            <Text style={[styles.statValue, { color: colors.warning }]}>{pending}</Text>
            <Text style={styles.statSub}>Đơn đang xử lý</Text>
          </Card>
        </View>
      ) : (
        <Card style={{ backgroundColor: colors.secondary }}>
          <Text style={styles.sectionTitle}>Đơn xin nghỉ</Text>
          <Text style={styles.sectionHint}>Chờ duyệt: {pending}</Text>
        </Card>
      )}

      {isEmployee ? (
        <View style={{ marginTop: 10 }}>
          <AppButton label="＋ Tạo đơn xin nghỉ phép" onPress={() => setShowCreate(true)} />
        </View>
      ) : null}

      {isAdmin ? (
        <Card style={{ backgroundColor: colors.secondary }}>
          <Text style={styles.sectionTitle}>Cài đặt phép năm</Text>
          <Text style={styles.sectionHint}>Thiết lập số ngày phép tối đa trong 1 năm.</Text>
          <AppInput
            label="Số ngày phép năm"
            value={annualLeaveText}
            onChangeText={setAnnualLeaveText}
            keyboardType="numeric"
            placeholder="12"
          />
          <AppButton label="Lưu" onPress={handleSaveAnnualLeave} loading={savingSettings} />
        </Card>
      ) : null}

      <View style={{ gap: 10, marginTop: 10 }}>
        {records.map((r) => {
          const pill = statusPillStyle(r.status);
          const start = String(r.startDate || '').slice(0, 10);
          const end = String(r.endDate || '').slice(0, 10);
          const created = String(r.createdAt || '').slice(0, 10);
          const requester = r.user;
          const assignedTo = r.assignedTo;
          const reviewedByUser = r.reviewedByUser;

          return (
            <Card key={r._id}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.recordTitle} numberOfLines={1}>{r.leaveType}</Text>
                  {isReviewer && requester ? (
                    <Text style={styles.meta} numberOfLines={1}>{requester.name} • {requester.email}</Text>
                  ) : (
                    <Text style={styles.meta} numberOfLines={1}>{r.reason}</Text>
                  )}
                </View>

                <View style={[styles.statusPill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
                  <Text style={[styles.statusPillText, { color: pill.text }]}>{r.status === 'pending' ? 'Chờ duyệt' : r.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}</Text>
                </View>
              </View>

              <Text style={styles.meta}>⏱ {isoToVNDate(start)} - {isoToVNDate(end)} • {r.days} ngày</Text>
              <Text style={styles.meta}>Nộp: {isoToVNDate(created)}</Text>

              {assignedTo ? <Text style={styles.meta}>Gửi đến: {assignedTo.name} • {assignedTo.email}</Text> : null}
              {reviewedByUser ? <Text style={styles.meta}>Duyệt bởi: {reviewedByUser.name}</Text> : null}

              {r.reviewNotes ? <Text style={styles.reviewNotes}>Phản hồi: {r.reviewNotes}</Text> : null}

              {isReviewer && r.status === 'pending' ? (
                <View style={styles.actionsRow}>
                  <AppButton label="Duyệt" variant="outline" style={{ flex: 1 }} onPress={() => openReviewModal(r, 'approve')} />
                  <AppButton label="Từ chối" style={{ flex: 1 }} onPress={() => openReviewModal(r, 'reject')} />
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>

      {showCreate ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.modalTitle}>Tạo đơn xin nghỉ phép</Text>
                  <Text style={styles.modalSub}>Điền thông tin và gửi đơn để xin phép</Text>
                  <Text style={styles.modalSub}>Bạn sẽ chọn 1 người duyệt (Manager/Admin).</Text>
                </View>
                <TouchableOpacity onPress={() => setShowCreate(false)} style={styles.modalClose}>
                  <Text style={styles.modalCloseText}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
                <Pressable onPress={() => setShowTypeModal(true)}>
                  <View pointerEvents="none">
                    <AppInput label="Loại nghỉ phép" value={leaveType.label} editable={false} />
                  </View>
                </Pressable>

                <Pressable onPress={() => setShowReviewerModal(true)} style={{ marginTop: 10 }}>
                  <View pointerEvents="none">
                    <AppInput
                      label="Gửi cho"
                      value={selectedReviewer ? `${selectedReviewer.name} • ${selectedReviewer.email}` : ''}
                      placeholder={reviewers.length ? 'Chọn người duyệt...' : 'Chưa có Manager/Admin'}
                      editable={false}
                    />
                  </View>
                </Pressable>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable onPress={() => openPicker('start')}>
                      <View pointerEvents="none">
                        <AppInput label="Từ" value={startText} editable={false} />
                      </View>
                    </Pressable>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable onPress={() => openPicker('end')}>
                      <View pointerEvents="none">
                        <AppInput label="Đến" value={endText} editable={false} />
                      </View>
                    </Pressable>
                  </View>
                </View>

                <Text style={styles.tip}>Tổng số ngày: {requestDays}</Text>

                <View style={{ marginTop: 10 }}>
                  <AppInput
                    label="Lý do nghỉ phép"
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Nhập lý do xin nghỉ phép..."
                    multiline
                    style={{ minHeight: 90, textAlignVertical: 'top' }}
                  />
                </View>

                <View style={styles.noteBox}>
                  <Text style={styles.noteTitle}>Lưu ý:</Text>
                  <Text style={styles.noteItem}>• Đơn sẽ được gửi trực tiếp đến 1 người duyệt bạn đã chọn</Text>
                  <Text style={styles.noteItem}>• Đơn nghỉ phép cần được gửi trước ít nhất 3 ngày</Text>
                  <Text style={styles.noteItem}>• Đơn sẽ được xét duyệt trong vòng 24-48 giờ</Text>
                  <Text style={styles.noteItem}>• Bạn còn {remainingAnnual} ngày phép chưa sử dụng</Text>
                </View>

                <View style={[styles.actionsRow, { marginTop: 12 }]}>
                  <AppButton label="Hủy" variant="outline" style={{ flex: 1 }} onPress={() => { setShowCreate(false); resetCreateForm(); }} />
                  <AppButton
                    label="Gửi đơn"
                    style={{ flex: 1 }}
                    onPress={handleCreate}
                    loading={submitting}
                    disabled={!selectedReviewer?._id}
                  />
                </View>
              </ScrollView>
            </View>

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

            {showTypeModal ? (
              <Modal transparent animationType="fade" onRequestClose={() => setShowTypeModal(false)}>
                <View style={styles.pickerOverlay}>
                  <View style={styles.typeCard}>
                    <Text style={styles.typeTitle}>Chọn loại nghỉ phép</Text>
                    <View style={{ gap: 8 }}>
                      {leaveTypes.map((t) => {
                        const active = t.value === leaveType.value;
                        return (
                          <TouchableOpacity
                            key={t.value}
                            onPress={() => {
                              setLeaveType(t);
                              setShowTypeModal(false);
                            }}
                            style={[styles.typeOption, active ? styles.typeOptionActive : undefined]}
                          >
                            <Text style={[styles.typeOptionText, active ? styles.typeOptionTextActive : undefined]}>{t.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={{ marginTop: 10 }}>
                      <AppButton label="Đóng" variant="outline" onPress={() => setShowTypeModal(false)} />
                    </View>
                  </View>
                </View>
              </Modal>
            ) : null}

            {showReviewerModal ? (
              <Modal transparent animationType="fade" onRequestClose={() => setShowReviewerModal(false)}>
                <View style={styles.pickerOverlay}>
                  <View style={styles.typeCard}>
                    <Text style={styles.typeTitle}>Chọn người duyệt</Text>
                    {reviewers.length ? (
                      <View style={{ gap: 8 }}>
                        {reviewers.map((rv) => {
                          const active = rv._id === selectedReviewer?._id;
                          const roleLabel = rv.role === 'manager' ? 'Manager' : rv.role === 'admin' ? 'Admin' : rv.role;
                          return (
                            <TouchableOpacity
                              key={rv._id}
                              onPress={() => {
                                setSelectedReviewer(rv);
                                setShowReviewerModal(false);
                              }}
                              style={[styles.typeOption, active ? styles.typeOptionActive : undefined]}
                            >
                              <Text style={[styles.typeOptionText, active ? styles.typeOptionTextActive : undefined]} numberOfLines={1}>
                                {rv.name} ({roleLabel})
                              </Text>
                              <Text style={styles.meta} numberOfLines={1}>{rv.email}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.sectionHint}>Chưa có Manager/Admin để nhận đơn.</Text>
                    )}
                    <View style={{ marginTop: 10 }}>
                      <AppButton label="Đóng" variant="outline" onPress={() => setShowReviewerModal(false)} />
                    </View>
                  </View>
                </View>
              </Modal>
            ) : null}
          </View>
        </Modal>
      ) : null}

      {reviewing ? (
        <Modal transparent animationType="fade" onRequestClose={closeReviewModal}>
          <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView
              style={{ flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 44 : 0}
            >
              <Pressable style={[styles.modalCard, { width: '100%' }]} onPress={() => {}}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.modalTitle}>{reviewing.mode === 'approve' ? 'Duyệt đơn nghỉ' : 'Từ chối đơn nghỉ'}</Text>
                    <Text style={styles.modalSub} numberOfLines={2}>
                      {reviewing.leave.user ? `${reviewing.leave.user.name} • ${reviewing.leave.user.email}` : 'Đơn nghỉ phép'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={closeReviewModal} style={styles.modalClose}>
                    <Text style={styles.modalCloseText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 14 }}>
                  <Text style={styles.meta}>⏱ {isoToVNDate(String(reviewing.leave.startDate || '').slice(0, 10))} - {isoToVNDate(String(reviewing.leave.endDate || '').slice(0, 10))} • {reviewing.leave.days} ngày</Text>
                  <Text style={styles.meta}>Lý do: {reviewing.leave.reason}</Text>

                  {reviewing.mode === 'reject' ? (
                    <View style={{ marginTop: 10 }}>
                      <AppInput
                        label="Phản hồi (bắt buộc)"
                        value={reviewNotes}
                        onChangeText={setReviewNotes}
                        placeholder="Nhập lý do từ chối..."
                        multiline
                        autoFocus
                        style={{ minHeight: 110, textAlignVertical: 'top' }}
                      />
                    </View>
                  ) : null}

                  <View style={[styles.actionsRow, { marginTop: 12 }]}>
                    <AppButton label="Hủy" variant="outline" style={{ flex: 1 }} onPress={closeReviewModal} />
                    <AppButton
                      label={reviewing.mode === 'approve' ? 'Xác nhận duyệt' : 'Gửi từ chối'}
                      style={{ flex: 1 }}
                      onPress={submitReview}
                      loading={reviewSubmitting}
                      disabled={reviewing.mode === 'reject' && !String(reviewNotes || '').trim()}
                    />
                  </View>
                </ScrollView>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  pageTitle: {
    fontSize: 28,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  statPrimary: {
    backgroundColor: colors.primary,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  statPrimaryLabel: {
    color: colors.white,
  },
  statValue: {
    fontSize: 28,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
    marginTop: 2,
  },
  statPrimaryValue: {
    color: colors.white,
  },
  statSub: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
    marginTop: 2,
  },
  statPrimarySub: {
    color: hexToRgba(colors.white, 0.92),
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
    marginTop: 2,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  recordTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 15,
  },
  meta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    marginTop: 4,
  },
  reviewNotes: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    marginTop: 6,
  },
  statusPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  modalOverlay: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    backgroundColor: hexToRgba(colors.text, 0.32),
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  modalTitle: {
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 18,
    color: colors.text,
  },
  modalSub: {
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 18,
    color: colors.text,
    marginTop: -2,
  },
  tip: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    marginTop: 6,
  },
  noteBox: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: hexToRgba(colors.info, 0.35),
    backgroundColor: hexToRgba(colors.info, 0.1),
    padding: 12,
    gap: 6,
  },
  noteTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  noteItem: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
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
  },
  typeCard: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  typeTitle: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 16,
    color: colors.text,
    marginBottom: 10,
  },
  typeOption: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  typeOptionActive: {
    borderColor: hexToRgba(colors.primary, 0.5),
    backgroundColor: hexToRgba(colors.primary, 0.12),
  },
  typeOptionText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 13,
  },
  typeOptionTextActive: {
    color: colors.primaryDark,
  },
});

import React, { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Keyboard, Modal, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { colors } from '../theme/colors';
import { projectApi, userApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { AuthUser, Project } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { AppStackParamList } from '../navigation/types';
import { hexToRgba } from '../utils/color';
import { FolderIcon } from '../components/SvgIcons';

const statusLabels: Record<Project['status'], string> = {
  planning: 'Lên kế hoạch',
  active: 'Đang thực hiện',
  'on-hold': 'Tạm dừng',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const statusStyles: Record<Project['status'], { bg: string; dot: string }> = {
  planning: { bg: colors.accent, dot: '#B45309' },
  active: { bg: colors.info, dot: '#2B6CB0' },
  'on-hold': { bg: '#E2E8F0', dot: '#475569' },
  completed: { bg: colors.success, dot: '#2F855A' },
  cancelled: { bg: colors.danger, dot: '#C53030' },
};

const formatISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseISODate = (value: string) => {
  if (!value) return null;
  const normalized = value.trim();
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export function ProjectsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const user = useAuthStore((state) => state.user);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [deadline, setDeadline] = useState('');
  const [status, setStatus] = useState<Project['status']>('planning');
  const [priority, setPriority] = useState<Project['priority']>('medium');
  const [projectColor, setProjectColor] = useState<string>(colors.primary);
  const [leadId, setLeadId] = useState<string>('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [iosPendingDate, setIosPendingDate] = useState<Date | null>(null);
  const [iosDateTarget, setIosDateTarget] = useState<'start' | 'deadline' | null>(null);

  const canCreate = user?.role === 'admin' || user?.role === 'manager';

  const projectColorOptions = useMemo(
    () => [colors.primary, colors.info, colors.success, colors.warning, colors.purple, colors.teal],
    []
  );

  const companyUsers = useMemo(() => {
    if (!user?.companyId) return users;
    return users.filter((candidate) => candidate.companyId === user.companyId);
  }, [users, user?.companyId]);

  const leadCandidates = useMemo(
    () => companyUsers.filter((candidate) => candidate.role === 'admin' || candidate.role === 'manager'),
    [companyUsers]
  );

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [projectRes, userRes] = await Promise.all([
        projectApi.getAll(),
        canCreate ? userApi.getAll().catch(() => null) : Promise.resolve(null),
      ]);
      setProjects(projectRes.data.data || []);
      if (userRes?.data?.data) {
        setUsers(userRes.data.data);
      }
    } catch (error) {
      Alert.alert('Không tải được dự án', getApiErrorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, [canCreate]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const stats = useMemo(
    () => ({
      total: projects.length,
      active: projects.filter((project) => project.status === 'active').length,
      done: projects.filter((project) => project.status === 'completed').length,
    }),
    [projects]
  );

  const resetCreateForm = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    setCreateStep(1);
    setName('');
    setDescription('');
    setStartDate(today);
    setDeadline('');
    setStatus('planning');
    setPriority('medium');
    setProjectColor(colors.primary);
    setLeadId(user?._id || '');
    setTeamIds(user?._id ? [user._id] : []);
    setShowStartDatePicker(false);
    setShowDeadlinePicker(false);
    setIosPendingDate(null);
    setIosDateTarget(null);
  }, [user?._id]);

  const openDatePicker = useCallback(
    (target: 'start' | 'deadline') => {
      Keyboard.dismiss();
      if (Platform.OS === 'ios') {
        const currentValue = target === 'start' ? startDate : deadline;
        setIosPendingDate(parseISODate(currentValue) || new Date());
        setIosDateTarget(target);
        return;
      }
      if (target === 'start') setShowStartDatePicker(true);
      else setShowDeadlinePicker(true);
    },
    [deadline, startDate]
  );

  const commitIosDate = useCallback(() => {
    if (!iosDateTarget || !iosPendingDate) {
      setIosDateTarget(null);
      setIosPendingDate(null);
      return;
    }
    const value = formatISODate(iosPendingDate);
    if (iosDateTarget === 'start') setStartDate(value);
    else setDeadline(value);
    setIosDateTarget(null);
    setIosPendingDate(null);
  }, [iosDateTarget, iosPendingDate]);

  const toggleTeamMember = useCallback(
    (memberId: string) => {
      setTeamIds((current) => {
        const mustKeepIds = new Set([leadId].filter(Boolean));
        const isSelected = current.includes(memberId);
        if (isSelected) {
          if (mustKeepIds.has(memberId)) return current;
          return current.filter((id) => id !== memberId);
        }
        return [...current, memberId];
      });
    },
    [leadId]
  );

  const handleCreateWizard = useCallback(async () => {
    if (!user?._id) return;
    if (!name.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên dự án.');
      return;
    }
    if (!deadline.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập deadline.');
      return;
    }

    const start = parseISODate(startDate);
    const end = parseISODate(deadline);
    if (start && end && end.getTime() <= start.getTime()) {
      Alert.alert('Sai thời gian', 'Deadline phải lớn hơn ngày bắt đầu.');
      return;
    }

    const resolvedLeadId = (user.role === 'admin' ? leadId : user._id) || user._id;
    if (!resolvedLeadId) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn trưởng dự án.');
      return;
    }

    const resolvedTeamIds = Array.from(new Set([resolvedLeadId, ...teamIds].filter(Boolean)));
    if (resolvedTeamIds.length === 0) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn ít nhất một thành viên.');
      return;
    }

    try {
      setSubmitting(true);
      await projectApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        leadId: resolvedLeadId,
        teamIds: resolvedTeamIds,
        startDate: startDate.trim() || undefined,
        endDate: deadline.trim() || undefined,
        progress: 0,
        color: projectColor,
      });

      resetCreateForm();
      setShowCreate(false);
      await loadData();
    } catch (error) {
      Alert.alert('Tạo dự án thất bại', getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [
    deadline,
    description,
    leadId,
    loadData,
    name,
    priority,
    projectColor,
    resetCreateForm,
    startDate,
    status,
    teamIds,
    user,
  ]);

  const openCreateWizard = useCallback(() => {
    if (!canCreate) return;
    resetCreateForm();
    setShowCreate(true);
  }, [canCreate, resetCreateForm]);

  const createStep1Valid = useMemo(() => {
    if (!user) return false;
    if (!name.trim()) return false;
    if (!deadline.trim()) return false;
    const start = parseISODate(startDate);
    const end = parseISODate(deadline);
    if (start && end && end.getTime() <= start.getTime()) return false;
    if (user.role === 'admin' && !leadId) return false;
    return true;
  }, [deadline, leadId, name, startDate, user]);

  const selectedTeamUsers = useMemo(() => {
    const ids = new Set(teamIds);
    if (leadId) ids.add(leadId);
    return companyUsers.filter((candidate) => ids.has(candidate._id));
  }, [companyUsers, leadId, teamIds]);

  const formatDate = (value?: string) => {
    if (!value) return 'Chưa đặt';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN');
  };

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.primary} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <FolderIcon size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.title}>Dự án</Text>
      </View>
      <Text style={styles.subtitle}>Nhấn vào card dự án để mở tab chi tiết</Text>

      <View style={styles.statsRow}>
        <Card style={[styles.statCard, { backgroundColor: colors.secondary }]}>
          <Text style={styles.statLabel}>Tổng</Text>
          <Text style={styles.statValue}>{stats.total}</Text>
        </Card>
        <Card style={[styles.statCard, { backgroundColor: hexToRgba(colors.info, 0.14) }]}>
          <Text style={styles.statLabel}>Đang làm</Text>
          <Text style={[styles.statValue, { color: '#2B6CB0' }]}>{stats.active}</Text>
        </Card>
        <Card style={[styles.statCard, { backgroundColor: hexToRgba(colors.success, 0.16) }]}>
          <Text style={styles.statLabel}>Hoàn thành</Text>
          <Text style={[styles.statValue, { color: colors.success }]}>{stats.done}</Text>
        </Card>
      </View>

      {canCreate ? (
        <Card>
          <TouchableOpacity onPress={() => (showCreate ? setShowCreate(false) : openCreateWizard())}>
            <Text style={styles.createToggle}>{showCreate ? 'Ẩn tạo dự án' : '＋ Tạo dự án mới'}</Text>
          </TouchableOpacity>

          {showCreate ? (
            <View style={styles.formWrap}>
              <View style={styles.stepHeaderRow}>
                <Text style={styles.stepTitle}>Tạo dự án mới</Text>
                <Text style={styles.stepSubtitle}>Bước {createStep} / 2</Text>
              </View>

              <View style={styles.stepTrackRow}>
                <View style={[styles.stepTrack, createStep >= 1 ? styles.stepTrackActive : undefined]} />
                <View style={[styles.stepTrack, createStep >= 2 ? styles.stepTrackActive : undefined]} />
              </View>

              {createStep === 1 ? (
                <>
                  <AppInput
                    label="Tên dự án *"
                    placeholder="Nhập tên dự án"
                    value={name}
                    onChangeText={setName}
                  />
                  <AppInput
                    label="Mô tả"
                    placeholder="Mô tả ngắn"
                    value={description}
                    onChangeText={setDescription}
                    style={styles.descriptionInput}
                    multiline
                  />

                  <View style={styles.grid2}>
                    <View style={styles.gridItem}>
                      <Text style={styles.sectionLabel}>Ngày bắt đầu</Text>
                      <TouchableOpacity onPress={() => openDatePicker('start')} style={styles.dateField}>
                        <Text style={[styles.dateFieldText, !startDate ? styles.dateFieldTextMuted : undefined]}>
                          {startDate || 'YYYY-MM-DD'}
                        </Text>
                        <Ionicons name="calendar-outline" size={16} color={colors.muted} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.gridItem}>
                      <Text style={styles.sectionLabel}>Deadline *</Text>
                      <TouchableOpacity onPress={() => openDatePicker('deadline')} style={styles.dateField}>
                        <Text style={[styles.dateFieldText, !deadline ? styles.dateFieldTextMuted : undefined]}>
                          {deadline || 'YYYY-MM-DD'}
                        </Text>
                        <Ionicons name="calendar-outline" size={16} color={colors.muted} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {Platform.OS !== 'ios' && showStartDatePicker ? (
                    <DateTimePicker
                      value={parseISODate(startDate) || new Date()}
                      mode="date"
                      display="default"
                      onChange={(event, date) => {
                        setShowStartDatePicker(false);
                        if (!date || event.type === 'dismissed') return;
                        setStartDate(formatISODate(date));
                      }}
                    />
                  ) : null}

                  {Platform.OS !== 'ios' && showDeadlinePicker ? (
                    <DateTimePicker
                      value={parseISODate(deadline) || new Date()}
                      mode="date"
                      display="default"
                      onChange={(event, date) => {
                        setShowDeadlinePicker(false);
                        if (!date || event.type === 'dismissed') return;
                        setDeadline(formatISODate(date));
                      }}
                    />
                  ) : null}

                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Trạng thái</Text>
                    <View style={styles.chipsRow}>
                      {(['planning', 'active', 'on-hold', 'completed', 'cancelled'] as const).map((item) => (
                        <TouchableOpacity
                          key={item}
                          onPress={() => setStatus(item)}
                          style={[styles.chip, status === item ? styles.chipActive : undefined]}
                        >
                          <Text style={[styles.chipText, status === item ? styles.chipTextActive : undefined]}>
                            {statusLabels[item]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Độ ưu tiên</Text>
                    <View style={styles.chipsRow}>
                      {(['low', 'medium', 'high', 'urgent'] as const).map((item) => (
                        <TouchableOpacity
                          key={item}
                          onPress={() => setPriority(item)}
                          style={[styles.chip, priority === item ? styles.chipActive : undefined]}
                        >
                          <Text style={[styles.chipText, priority === item ? styles.chipTextActive : undefined]}>
                            {item.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Màu dự án</Text>
                    <View style={styles.colorRow}>
                      {projectColorOptions.map((value) => {
                        const selected = projectColor === value;
                        return (
                          <TouchableOpacity
                            key={value}
                            onPress={() => setProjectColor(value)}
                            style={[
                              styles.colorDot,
                              { backgroundColor: value },
                              selected ? styles.colorDotSelected : undefined,
                            ]}
                          />
                        );
                      })}
                    </View>
                  </View>

                  {user?.role === 'admin' ? (
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionLabel}>Trưởng dự án</Text>
                      {leadCandidates.length === 0 ? (
                        <Text style={styles.helperText}>Chưa có manager/admin để chọn.</Text>
                      ) : (
                        <View style={styles.memberList}>
                          {leadCandidates.map((candidate) => {
                            const selected = candidate._id === leadId;
                            return (
                              <TouchableOpacity
                                key={candidate._id}
                                onPress={() => {
                                  setLeadId(candidate._id);
                                  setTeamIds((current) => Array.from(new Set([candidate._id, ...current])));
                                }}
                                style={[styles.memberRow, selected ? styles.memberRowSelected : undefined]}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.memberName}>{candidate.name}</Text>
                                  <Text style={styles.memberMeta}>{candidate.role}</Text>
                                </View>
                                <View style={[styles.checkWrap, selected ? styles.checkWrapSelected : undefined]}>
                                  {selected ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.footerRow}>
                    <AppButton label="Huỷ" onPress={() => setShowCreate(false)} variant="outline" style={styles.footerBtn} />
                    <AppButton
                      label="Tiếp theo →"
                      onPress={() => {
                        if (!createStep1Valid) {
                          const start = parseISODate(startDate);
                          const end = parseISODate(deadline);
                          if (start && end && end.getTime() <= start.getTime()) {
                            Alert.alert('Sai thời gian', 'Deadline phải lớn hơn ngày bắt đầu.');
                            return;
                          }
                          Alert.alert('Thiếu thông tin', 'Vui lòng nhập đủ tên dự án và deadline.');
                          return;
                        }
                        setCreateStep(2);
                        if (user?.role === 'admin' && leadId) {
                          setTeamIds((current) => Array.from(new Set([leadId, ...current])));
                        }
                      }}
                      disabled={!createStep1Valid}
                      style={styles.footerBtn}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Thành viên ({teamIds.length} đã chọn)</Text>
                    <Text style={styles.helperText}>Chọn người tham gia dự án</Text>
                    {companyUsers.length === 0 ? (
                      <Text style={styles.helperText}>Không có danh sách nhân viên.</Text>
                    ) : (
                      <View style={styles.memberList}>
                        {companyUsers
                          .filter((candidate) => candidate.isActive)
                          .map((candidate) => {
                            const selected = teamIds.includes(candidate._id) || candidate._id === leadId;
                            const locked = candidate._id === leadId;
                            return (
                              <TouchableOpacity
                                key={candidate._id}
                                onPress={() => toggleTeamMember(candidate._id)}
                                style={[styles.memberRow, selected ? styles.memberRowSelected : undefined, locked ? styles.memberRowLocked : undefined]}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.memberName}>{candidate.name}</Text>
                                  <Text style={styles.memberMeta}>{candidate.position || candidate.role}</Text>
                                </View>
                                <View style={[styles.checkWrap, selected ? styles.checkWrapSelected : undefined]}>
                                  {selected ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                      </View>
                    )}
                  </View>

                  <View style={styles.footerRow}>
                    <AppButton
                      label="← Quay lại"
                      onPress={() => setCreateStep(1)}
                      variant="outline"
                      style={styles.footerBtn}
                      disabled={submitting}
                    />
                    <TouchableOpacity
                      onPress={handleCreateWizard}
                      disabled={submitting}
                      style={[styles.primaryCreateBtn, submitting ? styles.primaryCreateBtnDisabled : undefined]}
                    >
                      {submitting ? (
                        <ActivityIndicator color={colors.white} />
                      ) : (
                        <Text style={styles.primaryCreateBtnText}>＋ Tạo dự án</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          ) : null}
        </Card>
      ) : null}

      {projects.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>Chưa có dự án nào.</Text>
        </Card>
      ) : (
        projects.map((project) => {
          const style = statusStyles[project.status];

          return (
            <TouchableOpacity key={project._id} onPress={() => navigation.navigate('ProjectDetail', { projectId: project._id })}>
              <Card>
                <View style={styles.rowBetween}>
                  <View style={styles.statusWrap}>
                    <View style={[styles.dot, { backgroundColor: style.dot }]} />
                    <Text style={styles.statusText}>{statusLabels[project.status]}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: style.bg }]}>
                    <Text style={styles.priorityText}>Ưu tiên {project.priority}</Text>
                  </View>
                </View>

                <Text style={styles.projectName}>{project.name}</Text>
                <Text numberOfLines={2} style={styles.meta}>{project.description || 'Chưa có mô tả'}</Text>

                <View style={styles.metaRow}>
                  <View style={styles.inlineItem}>
                    <Ionicons name="people-outline" size={14} color={colors.muted} />
                    <Text style={styles.meta}>Thành viên: {project.teamIds?.length || 0}</Text>
                  </View>
                  <View style={styles.inlineItem}>
                    <Ionicons name="calendar-outline" size={14} color={colors.muted} />
                    <Text style={styles.meta}>{formatDate(project.endDate)}</Text>
                  </View>
                </View>

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${project.progress}%` }]} />
                </View>

                <View style={styles.rowBetween}>
                  <Text style={styles.progressText}>Tiến độ {project.progress}%</Text>
                  <View style={styles.detailChip}>
                    <Text style={styles.detailText}>Xem chi tiết</Text>
                    <Ionicons name="arrow-forward" size={13} color={colors.text} />
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      <Modal visible={Platform.OS === 'ios' && !!iosDateTarget} transparent animationType="fade">
        <TouchableOpacity
          activeOpacity={1}
          style={styles.pickerBackdrop}
          onPress={() => {
            setIosDateTarget(null);
            setIosPendingDate(null);
          }}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerCard} onPress={() => {}}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity
                onPress={() => {
                  setIosDateTarget(null);
                  setIosPendingDate(null);
                }}
              >
                <Text style={styles.pickerAction}>Huỷ</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>Chọn ngày</Text>
              <TouchableOpacity onPress={commitIosDate}>
                <Text style={styles.pickerActionPrimary}>Xong</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={iosPendingDate || new Date()}
              mode="date"
              display="spinner"
              onChange={(_, date) => {
                if (date) setIosPendingDate(date);
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  title: {
    fontSize: 28,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  subtitle: {
    marginTop: -4,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  statCard: {
    width: '31.5%',
    minHeight: 86,
    justifyContent: 'space-between',
  },
  statLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  statValue: {
    color: colors.text,
    fontSize: 28,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  createToggle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  formWrap: {
    gap: 10,
    marginTop: 8,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  stepSubtitle: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  stepTrackRow: {
    flexDirection: 'row',
    gap: 8,
  },
  stepTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  stepTrackActive: {
    backgroundColor: colors.primary,
  },
  grid2: {
    flexDirection: 'row',
    gap: 10,
  },
  gridItem: {
    flex: 1,
    minWidth: 140,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dateFieldText: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  dateFieldTextMuted: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  pickerCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 12,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pickerTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
  },
  pickerAction: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  pickerActionPrimary: {
    color: colors.primary,
    fontFamily: 'BeVietnamPro_900Black',
  },
  sectionBlock: {
    gap: 8,
  },
  sectionBlockCompact: {
    gap: 6,
  },
  sectionLabel: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  helperText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  chipTextSmall: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  chipTextActive: {
    color: colors.white,
  },
  memberList: {
    gap: 8,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: colors.border,
  },
  colorDotSelected: {
    borderColor: colors.primaryDark,
    transform: [{ scale: 1.06 }],
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  memberRowSelected: {
    backgroundColor: hexToRgba(colors.primary, 0.12),
    borderColor: colors.primary,
  },
  memberRowLocked: {
    opacity: 0.92,
  },
  memberName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  memberMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  checkWrap: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkWrapSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  footerBtn: {
    flex: 1,
  },
  primaryCreateBtn: {
    flex: 1,
    minHeight: 50,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.primary,
    shadowColor: colors.shadow,
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 0,
    elevation: 3,
  },
  primaryCreateBtnDisabled: {
    opacity: 0.6,
  },
  primaryCreateBtnText: {
    color: colors.white,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  descriptionInput: {
    height: 90,
    textAlignVertical: 'top',
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  projectName: {
    flex: 1,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
    fontSize: 21,
    lineHeight: 25,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  priorityText: {
    color: colors.text,
    fontSize: 11,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_700Bold',
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  inlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressTrack: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    height: 10,
    backgroundColor: '#E2E8F0',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  progressText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.secondary,
  },
  detailText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
});

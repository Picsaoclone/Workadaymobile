import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { AppButton } from '../components/AppButton';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppStackParamList } from '../navigation/types';
import { getApiErrorMessage } from '../services/error';
import { projectApi, taskApi, userApi } from '../services/api';
import { colors } from '../theme/colors';
import { AuthUser, Project, Task } from '../types/models';
import { getEffectiveTaskStatus, normalizeTaskPatch } from '../utils/taskStatus';
import { hexToRgba } from '../utils/color';

const statusLabel: Record<Task['status'], string> = {
  todo: 'Chưa làm',
  'in-progress': 'Đang làm',
  review: 'Review',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const statusStyle: Record<Task['status'], { bg: string; dot: string }> = {
  todo: { bg: '#EDF2F7', dot: '#64748B' },
  'in-progress': { bg: colors.info, dot: '#2B6CB0' },
  review: { bg: colors.purple, dot: '#6B46C1' },
  done: { bg: colors.success, dot: '#2F855A' },
  cancelled: { bg: colors.danger, dot: '#C53030' },
};

const priorityLabel: Record<Task['priority'], string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  urgent: 'Khẩn cấp',
};

const routeStatusOrder: Task['status'][] = ['todo', 'in-progress', 'review', 'done', 'cancelled'];

const isSubtaskChecked = (value: string): boolean => /^\[x\]\s+/i.test(value.trim());
const subtaskLabel = (value: string): string => value.replace(/^\[(x| )\]\s+/i, '').trim();
const toSubtaskValue = (label: string, checked: boolean): string => `[${checked ? 'x' : ' '}] ${label.trim()}`;

export function TaskDetailScreen() {
  const route = useRoute<RouteProp<AppStackParamList, 'TaskDetail'>>();
  const { taskId } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [progressDraft, setProgressDraft] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [taskRes, projectRes, userRes] = await Promise.all([taskApi.getAll(), projectApi.getAll(), userApi.getAll()]);
      const fetchedTasks = taskRes.data.data || [];
      const fetchedProjects = projectRes.data.data || [];
      const fetchedUsers = userRes.data.data || [];

      const selectedTask = fetchedTasks.find((item) => item._id === taskId) || null;
      setAllTasks(fetchedTasks);
      setTask(selectedTask);
      setUsers(fetchedUsers);

      if (selectedTask?.projectId) {
        const matchedProject = fetchedProjects.find((item) => item._id === selectedTask.projectId) || null;
        setProject(matchedProject);
      } else {
        setProject(null);
      }
    } catch (error) {
      Alert.alert('Không tải được chi tiết công việc', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const assignee = useMemo(
    () => users.find((item) => item._id === task?.assignedTo) || null,
    [users, task?.assignedTo]
  );

  const blockers = useMemo(() => {
    if (!task?.dependencies?.length) return [];

    return task.dependencies
      .map((dependencyId) => allTasks.find((item) => item._id === dependencyId))
      .filter((item): item is Task => !!item)
      .filter((item) => item.status !== 'done');
  }, [task, allTasks]);

  const subtasks = task?.subtasks || [];
  const checkedSubtasks = subtasks.filter(isSubtaskChecked).length;

  useEffect(() => {
    setProgressDraft(task?.progress || 0);
  }, [task?.progress]);

  const patchTask = useCallback(
    async (patch: Partial<Task>) => {
      if (!task) return;

      const normalizedPatch = normalizeTaskPatch(task, patch);

      try {
        setSaving(true);
        const response = await taskApi.update(task._id, normalizedPatch);
        const updatedTask = response.data.data || { ...task, ...normalizedPatch };

        setTask(updatedTask);
        setAllTasks((current) => current.map((item) => (item._id === updatedTask._id ? updatedTask : item)));
      } catch (error) {
        Alert.alert('Không thể cập nhật công việc', getApiErrorMessage(error));
      } finally {
        setSaving(false);
      }
    },
    [task]
  );

  const onChangeStatus = async (nextStatus: Task['status']) => {
    if (!task) return;

    if (blockers.length > 0 && nextStatus !== 'todo' && nextStatus !== 'cancelled') {
      Alert.alert('Công việc đang bị chặn', `Task này đang phụ thuộc: ${blockers.map((item) => item.title).join(', ')}`);
      return;
    }

    const patch: Partial<Task> = { status: nextStatus };

    if (nextStatus === 'done') {
      patch.completedAt = new Date().toISOString();
      patch.progress = 100;
    }

    if (nextStatus !== 'done' && task.completedAt) {
      patch.completedAt = undefined;
    }

    await patchTask(patch);
  };

  const onSaveProgress = async () => {
    if (!task) return;

    const normalizedPatch = normalizeTaskPatch(task, { progress: progressDraft });
    const nextStatus = normalizedPatch.status ?? task.status;
    const nextProgress = typeof normalizedPatch.progress === 'number' ? normalizedPatch.progress : task.progress;

    if (nextStatus === task.status && nextProgress === task.progress) return;
    await patchTask(normalizedPatch);
  };

  const onToggleSubtask = async (index: number) => {
    if (!task) return;

    const updatedSubtasks = subtasks.map((item, idx) => {
      if (idx !== index) return item;
      return toSubtaskValue(subtaskLabel(item), !isSubtaskChecked(item));
    });

    const doneCount = updatedSubtasks.filter(isSubtaskChecked).length;
    const autoProgress = updatedSubtasks.length > 0 ? Math.round((doneCount / updatedSubtasks.length) * 100) : task.progress;

    await patchTask({ subtasks: updatedSubtasks, progress: autoProgress });
  };

  const onAddSubtask = async () => {
    if (!task) return;
    const label = newSubtask.trim();
    if (!label) return;

    const updatedSubtasks = [...subtasks, toSubtaskValue(label, false)];
    await patchTask({ subtasks: updatedSubtasks });
    setNewSubtask('');
  };

  const formatDate = (value?: string) => {
    if (!value) return 'Chưa có';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN');
  };

  if (loading) {
    return <Screen scroll={false} loading loadingLabel="Đang tải chi tiết công việc..." />;
  }

  if (!task) {
    return (
      <Screen>
        <Card>
          <Text style={styles.loadingText}>Không tìm thấy công việc.</Text>
          <AppButton label="Tải lại" onPress={loadData} />
        </Card>
      </Screen>
    );
  }

  const effectiveStatus = getEffectiveTaskStatus(task);
  const overdue =
    !!task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    effectiveStatus !== 'done' &&
    effectiveStatus !== 'cancelled';

  return (
    <Screen>
      <Card style={[styles.heroCard, { backgroundColor: hexToRgba(colors.primary, 0.1) }]}>
        <View style={styles.rowBetween}>
          <View style={styles.statusWrap}>
            <View style={[styles.dot, { backgroundColor: statusStyle[effectiveStatus].dot }]} />
            <Text style={styles.projectName}>{project?.name || 'Không thuộc dự án'}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: statusStyle[effectiveStatus].bg }]}>
            <Text style={styles.badgeText}>{statusLabel[effectiveStatus]}</Text>
          </View>
        </View>

        <Text style={styles.taskTitle}>{task.title}</Text>
        <Text style={styles.description}>{task.description || 'Chưa có mô tả cho công việc này.'}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>Ưu tiên: {priorityLabel[task.priority]}</Text>
          <Text style={styles.meta}>Người làm: {assignee?.name || 'Chưa phân công'}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${task.progress}%` }]} />
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.meta}>Tiến độ: {task.progress}%</Text>
          {overdue ? <Text style={styles.overdue}>Quá hạn</Text> : <Text style={styles.meta}>Deadline: {formatDate(task.dueDate)}</Text>}
        </View>
      </Card>

      <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
        <Text style={styles.sectionTitle}>Cập nhật trạng thái</Text>
        <View style={styles.wrapRow}>
          {routeStatusOrder.map((status) => {
            const isActive = effectiveStatus === status;

            return (
              <TouchableOpacity
                key={status}
                style={[
                  styles.statusOption,
                  { backgroundColor: isActive ? statusStyle[status].bg : colors.white },
                ]}
                onPress={() => void onChangeStatus(status)}
                disabled={saving}
              >
                <Text style={styles.statusOptionText}>{statusLabel[status]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
        <Text style={styles.sectionTitle}>Điều chỉnh tiến độ</Text>
        <View style={styles.sliderContainer}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={progressDraft}
            onValueChange={(value) => setProgressDraft(Math.round(value))}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor="#E2E8F0"
            thumbTintColor={colors.primaryDark}
          />
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Giá trị mới: {progressDraft}%</Text>
            <TouchableOpacity
              style={[styles.saveProgressBtn, (saving || progressDraft === task.progress) ? styles.disabledBtn : undefined]}
              onPress={() => void onSaveProgress()}
              disabled={saving || progressDraft === task.progress}
            >
              <Text style={styles.saveProgressText}>{saving ? 'Đang lưu...' : 'Lưu tiến độ'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Card>

      <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Subtasks</Text>
          <Text style={styles.meta}>{checkedSubtasks}/{subtasks.length}</Text>
        </View>

        {subtasks.length === 0 ? (
          <Text style={styles.emptyText}>Chưa có subtask.</Text>
        ) : (
          subtasks.map((subtask, index) => {
            const checked = isSubtaskChecked(subtask);
            return (
              <TouchableOpacity key={`${task._id}-sub-${index}`} style={styles.subtaskRow} onPress={() => void onToggleSubtask(index)}>
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18} color={checked ? '#2F855A' : colors.muted} />
                <Text style={[styles.subtaskText, checked ? styles.subtaskDone : undefined]}>{subtaskLabel(subtask)}</Text>
              </TouchableOpacity>
            );
          })
        )}

        <View style={styles.subtaskComposer}>
          <TextInput
            value={newSubtask}
            onChangeText={setNewSubtask}
            placeholder="Thêm subtask..."
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TouchableOpacity style={styles.addBtn} onPress={() => void onAddSubtask()}>
            <Ionicons name="add" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>
      </Card>

      <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
        <Text style={styles.sectionTitle}>Thông tin thêm</Text>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Ngày giao</Text>
          <Text style={styles.metaValue}>{formatDate(task.createdAt)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Ngày bắt đầu</Text>
          <Text style={styles.metaValue}>{formatDate(task.startDate)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Ngày hoàn thành</Text>
          <Text style={styles.metaValue}>{formatDate(task.completedAt)}</Text>
        </View>
      </Card>

      <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
        <Text style={styles.sectionTitle}>Phụ thuộc</Text>
        {task.dependencies?.length ? (
          task.dependencies.map((dependencyId) => {
            const dependencyTask = allTasks.find((item) => item._id === dependencyId);
            if (!dependencyTask) {
              return (
                <Text key={dependencyId} style={styles.emptyText}>Task không tồn tại ({dependencyId})</Text>
              );
            }

            const dependencyStatus = getEffectiveTaskStatus(dependencyTask);

            return (
              <View key={dependencyId} style={styles.dependencyRow}>
                <View style={[styles.dot, { backgroundColor: statusStyle[dependencyStatus].dot }]} />
                <Text style={styles.dependencyText}>{dependencyTask.title}</Text>
                <Text style={styles.dependencyStatus}>{statusLabel[dependencyStatus]}</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.emptyText}>Không có phụ thuộc.</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  heroCard: {
    gap: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectName: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
  },
  badgeText: {
    color: colors.text,
    fontSize: 11,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  taskTitle: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 28,
    fontFamily: 'BeVietnamPro_900Black',
  },
  description: {
    color: colors.muted,
    lineHeight: 20,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  meta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  overdue: {
    color: '#C53030',
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
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
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: 'BeVietnamPro_900Black',
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOption: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusOptionText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  sliderContainer: {
    gap: 8,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  saveProgressBtn: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveProgressText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  subtaskText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    flex: 1,
  },
  subtaskDone: {
    textDecorationLine: 'line-through',
    color: colors.muted,
  },
  subtaskComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaItem: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  dependencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dependencyText: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  dependencyStatus: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
});

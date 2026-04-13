import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { useAuthStore } from '../store/authStore';
import { getApiErrorMessage } from '../services/error';
import { projectApi, taskApi, userApi } from '../services/api';
import { colors } from '../theme/colors';
import { AppStackParamList } from '../navigation/types';
import { AuthUser, Project, Task } from '../types/models';
import { getEffectiveTaskStatus } from '../utils/taskStatus';
import { hexToRgba } from '../utils/color';

type ProjectTabKey = 'overview' | 'tasks' | 'team' | 'timeline' | 'notes' | 'documents';
type ProjectTaskChartMode = 'status' | 'priority';
type TimelineFilterMode = 'all' | 'project' | 'task';
type ProjectTaskVisualMode = 'kanban' | 'list';
type ProjectTimelineVisualMode = 'chart' | 'list';

type TaskView = Task & { effectiveStatus: Task['status'] };

const projectTabs: Array<{ key: ProjectTabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'overview', label: 'Tổng quan', icon: 'apps-outline' },
  { key: 'tasks', label: 'Công việc', icon: 'checkbox-outline' },
  { key: 'team', label: 'Nhóm', icon: 'people-outline' },
  { key: 'timeline', label: 'Timeline', icon: 'git-network-outline' },
  { key: 'notes', label: 'Ghi chú', icon: 'document-text-outline' },
  { key: 'documents', label: 'Tài liệu', icon: 'attach-outline' },
];

const projectStatusLabel: Record<Project['status'], string> = {
  planning: 'Lên kế hoạch',
  active: 'Đang thực hiện',
  'on-hold': 'Tạm dừng',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const projectStatusStyle: Record<Project['status'], { bg: string; dot: string }> = {
  planning: { bg: colors.accent, dot: '#B45309' },
  active: { bg: colors.info, dot: '#2B6CB0' },
  'on-hold': { bg: '#E2E8F0', dot: '#475569' },
  completed: { bg: colors.success, dot: '#2F855A' },
  cancelled: { bg: colors.danger, dot: '#C53030' },
};

const taskStatusLabel: Record<Task['status'], string> = {
  todo: 'Chưa làm',
  'in-progress': 'Đang làm',
  review: 'Review',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const taskStatusColor: Record<Task['status'], string> = {
  todo: '#64748B',
  'in-progress': '#2B6CB0',
  review: '#8B5CF6',
  done: '#2F855A',
  cancelled: '#C53030',
};

const taskStatusOrder: Task['status'][] = ['todo', 'in-progress', 'review', 'done', 'cancelled'];
const taskPriorityOrder: Task['priority'][] = ['low', 'medium', 'high', 'urgent'];

const KANBAN_COLUMN_WIDTH = 260;
const KANBAN_GAP = 10;

const taskPriorityLabel: Record<Task['priority'], string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  urgent: 'Khẩn cấp',
};

const taskPriorityColor: Record<Task['priority'], string> = {
  low: '#64748B',
  medium: '#2563EB',
  high: '#D97706',
  urgent: '#DC2626',
};

const kanbanColumnBackground: Record<Task['status'], string> = {
  todo: hexToRgba(colors.secondary, 0.22),
  'in-progress': hexToRgba(colors.info, 0.18),
  review: hexToRgba(colors.purple, 0.18),
  done: hexToRgba(colors.success, 0.18),
  cancelled: hexToRgba(colors.danger, 0.16),
};

const toSubtaskValue = (label: string) => `[ ] ${label.trim()}`;

const toSubtasksFromText = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.replace(/^[-*\u2022]\s+/, '').trim())
    .filter(Boolean)
    .map(toSubtaskValue);

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

export function ProjectDetailScreen() {
  const route = useRoute<RouteProp<AppStackParamList, 'ProjectDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const user = useAuthStore((state) => state.user);

  const { projectId } = route.params;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ProjectTabKey>('overview');
  const [taskChartMode, setTaskChartMode] = useState<ProjectTaskChartMode>('status');
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilterMode>('all');
  const [taskVisualMode, setTaskVisualMode] = useState<ProjectTaskVisualMode>('kanban');
  const [timelineVisualMode, setTimelineVisualMode] = useState<ProjectTimelineVisualMode>('chart');
  const [progressDraft, setProgressDraft] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [openCreateTask, setOpenCreateTask] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskTitleDraft, setTaskTitleDraft] = useState('');
  const [taskDescriptionDraft, setTaskDescriptionDraft] = useState('');
  const [taskAssigneeDraft, setTaskAssigneeDraft] = useState('');
  const [taskPriorityDraft, setTaskPriorityDraft] = useState<Task['priority']>('medium');
  const [taskStartDateDraft, setTaskStartDateDraft] = useState('');
  const [taskDueDateDraft, setTaskDueDateDraft] = useState('');
  const [taskDependencyDraft, setTaskDependencyDraft] = useState<string[]>([]);
  const [taskSubtasksDraft, setTaskSubtasksDraft] = useState('');
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [iosInlinePickerTarget, setIosInlinePickerTarget] = useState<'start' | 'due' | null>(null);
  const [iosPendingDate, setIosPendingDate] = useState<Date>(new Date());
  const [modalFooterHeight, setModalFooterHeight] = useState(0);
  const [openSubtasksEditor, setOpenSubtasksEditor] = useState(false);
  const [subtasksDraftTemp, setSubtasksDraftTemp] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [projectRes, taskRes, userRes] = await Promise.all([
        projectApi.getById(projectId),
        taskApi.getAll({ projectId }),
        userApi.getAll(),
      ]);

      setProject(projectRes.data.data || null);
      setTasks(taskRes.data.data || []);
      setUsers(userRes.data.data || []);
    } catch (error) {
      Alert.alert('Không tải được dự án', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setProgressDraft(project?.progress || 0);
  }, [project?.progress]);

  const teamMembers = useMemo(() => {
    if (!project) return [];
    return users.filter((member) => project.teamIds.includes(member._id));
  }, [project, users]);

  const assignableMembers = useMemo(() => teamMembers.filter((member) => member.isActive), [teamMembers]);

  const lead = useMemo(() => {
    if (!project) return null;
    return users.find((member) => member._id === project.leadId) || null;
  }, [project, users]);

  const canManageProject = useMemo(() => {
    if (!user || !project) return false;
    return user.role === 'admin' || user.role === 'manager' || user._id === project.leadId;
  }, [user, project]);

  const resetCreateTaskForm = useCallback(() => {
    setTaskTitleDraft('');
    setTaskDescriptionDraft('');
    setTaskAssigneeDraft(assignableMembers[0]?._id || '');
    setTaskPriorityDraft('medium');
    setTaskStartDateDraft('');
    setTaskDueDateDraft('');
    setTaskDependencyDraft([]);
    setTaskSubtasksDraft('');
    setShowAssigneePicker(false);
    setShowStartDatePicker(false);
    setShowDueDatePicker(false);
    setIosInlinePickerTarget(null);
    setIosPendingDate(new Date());
  }, [assignableMembers]);

  const openDatePicker = useCallback(
    (target: 'start' | 'due') => {
      Keyboard.dismiss();
      if (Platform.OS === 'ios') {
        const currentValue = target === 'start' ? taskStartDateDraft : taskDueDateDraft;
        setIosPendingDate(parseISODate(currentValue) || new Date());
        setIosInlinePickerTarget(target);
        return;
      }
      if (target === 'start') setShowStartDatePicker(true);
      else setShowDueDatePicker(true);
    },
    [taskDueDateDraft, taskStartDateDraft]
  );

  const commitIosInlineDate = useCallback(() => {
    if (!iosInlinePickerTarget) return;
    const value = formatISODate(iosPendingDate);
    if (iosInlinePickerTarget === 'start') setTaskStartDateDraft(value);
    else setTaskDueDateDraft(value);
    setIosInlinePickerTarget(null);
  }, [iosInlinePickerTarget, iosPendingDate]);

  const cancelIosInlineDate = useCallback(() => {
    setIosInlinePickerTarget(null);
  }, []);

  const toggleDependency = useCallback((dependencyId: string) => {
    setTaskDependencyDraft((current) =>
      current.includes(dependencyId) ? current.filter((id) => id !== dependencyId) : [...current, dependencyId]
    );
  }, []);

  const createTask = useCallback(async () => {
    if (!project) return;
    if (!canManageProject) return;
    if (!taskTitleDraft.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên task.');
      return;
    }
    if (!taskAssigneeDraft) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn người thực hiện.');
      return;
    }
    if (!taskDueDateDraft.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập deadline.');
      return;
    }

    const start = parseISODate(taskStartDateDraft);
    const due = parseISODate(taskDueDateDraft);
    if (start && due && due.getTime() <= start.getTime()) {
      Alert.alert('Sai thời gian', 'Deadline phải lớn hơn ngày bắt đầu.');
      return;
    }

    try {
      setCreatingTask(true);
      await taskApi.create({
        projectId: project._id,
        title: taskTitleDraft.trim(),
        description: taskDescriptionDraft.trim() || undefined,
        assignedTo: taskAssigneeDraft,
        priority: taskPriorityDraft,
        status: 'todo',
        startDate: taskStartDateDraft.trim() || undefined,
        dueDate: taskDueDateDraft.trim() || undefined,
        dependencies: taskDependencyDraft.length ? taskDependencyDraft : undefined,
        subtasks: taskSubtasksDraft.trim() ? toSubtasksFromText(taskSubtasksDraft) : undefined,
        progress: 0,
      });

      setOpenCreateTask(false);
      resetCreateTaskForm();
      await loadData();
    } catch (error) {
      Alert.alert('Không thể tạo task', getApiErrorMessage(error));
    } finally {
      setCreatingTask(false);
    }
  }, [
    canManageProject,
    loadData,
    project,
    resetCreateTaskForm,
    taskAssigneeDraft,
    taskDependencyDraft,
    taskDescriptionDraft,
    taskDueDateDraft,
    taskPriorityDraft,
    taskStartDateDraft,
    taskSubtasksDraft,
    taskTitleDraft,
  ]);

  const taskViews = useMemo<TaskView[]>(
    () => tasks.map((task) => ({ ...task, effectiveStatus: getEffectiveTaskStatus(task) })),
    [tasks]
  );

  const tasksByStatus = useMemo(
    () =>
      taskStatusOrder.reduce<Record<Task['status'], TaskView[]>>(
        (bucket, status) => ({
          ...bucket,
          [status]: taskViews.filter((task) => task.effectiveStatus === status),
        }),
        {
          todo: [],
          'in-progress': [],
          review: [],
          done: [],
          cancelled: [],
        }
      ),
    [taskViews]
  );

  const tasksByPriority = useMemo(
    () =>
      taskPriorityOrder.reduce<Record<Task['priority'], Task[]>>(
        (bucket, priority) => ({
          ...bucket,
          [priority]: tasks.filter((task) => task.priority === priority),
        }),
        {
          low: [],
          medium: [],
          high: [],
          urgent: [],
        }
      ),
    [tasks]
  );

  const completionRate = useMemo(
    () => (tasks.length > 0 ? Math.round((tasksByStatus.done.length / tasks.length) * 100) : 0),
    [tasks.length, tasksByStatus.done.length]
  );

  const overdueTasks = useMemo(
    () =>
      taskViews.filter((task) => {
        if (!task.dueDate) return false;
        const due = new Date(task.dueDate);
        if (Number.isNaN(due.getTime())) return false;
        return due < new Date() && task.effectiveStatus !== 'done' && task.effectiveStatus !== 'cancelled';
      }),
    [taskViews]
  );

  const timelineItems = useMemo(() => {
    if (!project) return [];

    const items: Array<{
      id: string;
      title: string;
      note: string;
      date: string;
      icon: keyof typeof Ionicons.glyphMap;
      color: string;
      type: 'project' | 'task';
    }> = [];

    if (project.createdAt) {
      items.push({
        id: `project-created-${project._id}`,
        title: 'Tạo dự án',
        note: project.name,
        date: project.createdAt,
        icon: 'briefcase-outline',
        color: colors.primary,
        type: 'project',
      });
    }

    if (project.startDate) {
      items.push({
        id: `project-start-${project._id}`,
        title: 'Ngày bắt đầu dự án',
        note: project.name,
        date: project.startDate,
        icon: 'play-outline',
        color: '#2B6CB0',
        type: 'project',
      });
    }

    if (project.endDate) {
      items.push({
        id: `project-end-${project._id}`,
        title: 'Deadline dự án',
        note: project.name,
        date: project.endDate,
        icon: 'flag-outline',
        color: '#B45309',
        type: 'project',
      });
    }

    tasks.forEach((task) => {
      if (task.startDate) {
        items.push({
          id: `task-start-${task._id}`,
          title: 'Bắt đầu task',
          note: task.title,
          date: task.startDate,
          icon: 'rocket-outline',
          color: '#0EA5E9',
          type: 'task',
        });
      }

      if (task.completedAt) {
        items.push({
          id: `task-done-${task._id}`,
          title: 'Task hoàn thành',
          note: task.title,
          date: task.completedAt,
          icon: 'checkmark-done-outline',
          color: '#10B981',
          type: 'task',
        });
      } else if (task.dueDate) {
        items.push({
          id: `task-deadline-${task._id}`,
          title: 'Deadline task',
          note: task.title,
          date: task.dueDate,
          icon: 'time-outline',
          color: '#F59E0B',
          type: 'task',
        });
      }
    });

    return items
      .filter((item) => !Number.isNaN(new Date(item.date).getTime()))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 20);
  }, [project, tasks]);

  const filteredTimelineItems = useMemo(() => {
    if (timelineFilter === 'all') return timelineItems;
    return timelineItems.filter((item) => item.type === timelineFilter);
  }, [timelineFilter, timelineItems]);

  const projectTaskChartItems = useMemo(() => {
    if (taskChartMode === 'status') {
      return taskStatusOrder.map((status) => ({
        key: status,
        label: taskStatusLabel[status],
        value: tasksByStatus[status].length,
        color: taskStatusColor[status],
      }));
    }

    return taskPriorityOrder.map((priority) => ({
      key: priority,
      label: taskPriorityLabel[priority],
      value: tasksByPriority[priority].length,
      color: taskPriorityColor[priority],
    }));
  }, [taskChartMode, tasksByPriority, tasksByStatus]);

  const projectTaskChartBars = useMemo(() => {
    const maxValue = Math.max(...projectTaskChartItems.map((item) => item.value), 1);
    return projectTaskChartItems.map((item) => {
      const ratio = item.value / maxValue;
      return {
        ...item,
        heightPercent: item.value > 0 ? Math.max(Math.round(ratio * 100), 14) : 6,
      };
    });
  }, [projectTaskChartItems]);

  const timelineDateRange = useMemo(() => {
    const timestamps: number[] = [];

    const pushDate = (value?: string) => {
      if (!value) return;
      const timestamp = new Date(value).getTime();
      if (!Number.isNaN(timestamp)) timestamps.push(timestamp);
    };

    pushDate(project?.startDate);
    pushDate(project?.endDate);
    pushDate(project?.createdAt);

    tasks.forEach((task) => {
      pushDate(task.startDate);
      pushDate(task.dueDate);
      pushDate(task.completedAt);
      pushDate(task.createdAt);
    });

    if (timestamps.length === 0) return null;

    return {
      start: Math.min(...timestamps),
      end: Math.max(...timestamps),
    };
  }, [project?.createdAt, project?.endDate, project?.startDate, tasks]);

  const timelineTaskBars = useMemo(() => {
    if (!timelineDateRange) return [];

    const totalMs = Math.max(timelineDateRange.end - timelineDateRange.start, 1);

    return taskViews
      .map((task) => {
        const startRaw = task.startDate || task.createdAt;
        const endRaw = task.completedAt || task.dueDate || task.startDate || task.createdAt;

        const startMs = new Date(startRaw).getTime();
        const endMs = new Date(endRaw).getTime();

        if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;

        const normalizedStart = Math.max(timelineDateRange.start, Math.min(startMs, timelineDateRange.end));
        const normalizedEnd = Math.max(normalizedStart, Math.min(endMs, timelineDateRange.end));

        const leftPercent = ((normalizedStart - timelineDateRange.start) / totalMs) * 100;
        const widthPercent = Math.max(((normalizedEnd - normalizedStart) / totalMs) * 100, 5);

        return {
          id: `timeline-bar-${task._id}`,
          title: task.title,
          status: task.effectiveStatus,
          leftPercent,
          widthPercent,
          startRaw,
          endRaw,
        };
      })
      .filter((item): item is {
        id: string;
        title: string;
        status: Task['status'];
        leftPercent: number;
        widthPercent: number;
        startRaw: string;
        endRaw: string;
      } => !!item)
      .sort((a, b) => b.widthPercent - a.widthPercent)
      .slice(0, 8);
  }, [taskViews, timelineDateRange]);

  const taskKanbanColumns = useMemo(
    () =>
      taskStatusOrder.map((status) => ({
        status,
        tasks: tasksByStatus[status],
      })),
    [tasksByStatus]
  );

  const noteItems = useMemo(() => {
    if (!project) return [];

    const items: Array<{ id: string; title: string; content: string }> = [];

    if (project.description?.trim()) {
      items.push({
        id: `project-note-${project._id}`,
        title: 'Mô tả dự án',
        content: project.description,
      });
    }

    tasks
      .filter((task) => task.description?.trim())
      .slice(0, 10)
      .forEach((task) => {
        items.push({
          id: `task-note-${task._id}`,
          title: task.title,
          content: task.description || '',
        });
      });

    return items;
  }, [project, tasks]);

  const attachmentItems = useMemo(() => {
    const toFileName = (url: string, fallback: string) => {
      const cleaned = url.split('?')[0];
      const parts = cleaned.split('/').filter(Boolean);
      const tail = parts[parts.length - 1];
      return tail ? decodeURIComponent(tail) : fallback;
    };

    return tasks.flatMap((task) =>
      (task.attachments || []).map((url, index) => ({
        id: `${task._id}-file-${index}`,
        taskId: task._id,
        taskTitle: task.title,
        url,
        fileName: toFileName(url, `Attachment ${index + 1}`),
      }))
    );
  }, [tasks]);

  const patchProject = useCallback(
    async (patch: Partial<Project>) => {
      if (!project || !canManageProject) return;

      try {
        setSaving(true);
        const response = await projectApi.update(project._id, patch);
        const updatedProject = response.data.data || { ...project, ...patch };
        setProject(updatedProject);
      } catch (error) {
        Alert.alert('Không thể cập nhật dự án', getApiErrorMessage(error));
      } finally {
        setSaving(false);
      }
    },
    [project, canManageProject]
  );

  const onSaveProjectProgress = async () => {
    if (!project) return;
    if (progressDraft === project.progress) return;
    await patchProject({ progress: progressDraft });
  };

  const formatDate = (value?: string) => {
    if (!value) return 'Chưa đặt';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN');
  };

  const formatDateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return <Screen scroll={false} loading loadingLabel="Đang tải chi tiết dự án..." />;
  }

  if (!project) {
    return (
      <Screen>
        <Card>
          <Text style={styles.loadingText}>Không tìm thấy dự án.</Text>
        </Card>
      </Screen>
    );
  }

  const style = projectStatusStyle[project.status];

  return (
    <Screen>
      <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.1) }}>
        <View style={styles.rowBetween}>
          <View style={styles.inlineCenter}>
            <View style={[styles.dot, { backgroundColor: style.dot }]} />
            <Text style={styles.projectState}>{projectStatusLabel[project.status]}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: style.bg }]}>
            <Text style={styles.badgeText}>Ưu tiên {project.priority}</Text>
          </View>
        </View>

        <Text style={styles.projectName}>{project.name}</Text>
        <Text style={styles.description}>{project.description || 'Chưa có mô tả dự án.'}</Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${project.progress}%` }]} />
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.meta}>Tiến độ {project.progress}%</Text>
          <Text style={styles.meta}>Deadline: {formatDate(project.endDate)}</Text>
        </View>
      </Card>

      <Card style={[styles.tabsCard, { backgroundColor: hexToRgba(colors.primary, 0.08) }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {projectTabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tabChip, active ? styles.tabChipActive : undefined]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Ionicons name={tab.icon} size={14} color={active ? colors.primaryDark : colors.muted} />
                <Text style={[styles.tabChipText, active ? styles.tabChipTextActive : undefined]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Card>

      {activeTab === 'overview' ? (
        <>
          <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
            <Text style={styles.sectionTitle}>Tổng quan tiến độ</Text>

            <View style={styles.overviewStatsRow}>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatLabel}>Tổng task</Text>
                <Text style={styles.overviewStatValue}>{tasks.length}</Text>
              </View>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatLabel}>Hoàn thành</Text>
                <Text style={[styles.overviewStatValue, { color: '#2F855A' }]}>{tasksByStatus.done.length}</Text>
              </View>
              <View style={styles.overviewStatCard}>
                <Text style={styles.overviewStatLabel}>Quá hạn</Text>
                <Text style={[styles.overviewStatValue, { color: '#C53030' }]}>{overdueTasks.length}</Text>
              </View>
            </View>

            <View style={styles.metricRow}>
              <Text style={styles.meta}>Tỷ lệ task hoàn thành</Text>
              <Text style={styles.metaStrong}>{completionRate}%</Text>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${completionRate}%`, backgroundColor: '#2F855A' }]} />
            </View>

            {taskStatusOrder.map((status) => {
              const count = tasksByStatus[status].length;
              const percent = tasks.length > 0 ? Math.round((count / tasks.length) * 100) : 0;

              return (
                <View key={`overview-${status}`} style={styles.distributionBlock}>
                  <View style={styles.metricRow}>
                    <Text style={styles.meta}>{taskStatusLabel[status]}</Text>
                    <Text style={styles.meta}>{count} ({percent}%)</Text>
                  </View>
                  <View style={styles.progressTrackMini}>
                    <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: taskStatusColor[status] }]} />
                  </View>
                </View>
              );
            })}
          </Card>

          {canManageProject ? (
            <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
              <Text style={styles.sectionTitle}>Quản lý dự án</Text>

              <Text style={styles.sectionHint}>Trạng thái</Text>
              <View style={styles.wrapRow}>
                {(Object.keys(projectStatusLabel) as Project['status'][]).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusBtn,
                      project.status === status ? { backgroundColor: projectStatusStyle[status].bg } : undefined,
                    ]}
                    onPress={() => void patchProject({ status })}
                    disabled={saving}
                  >
                    <Text style={styles.statusText}>{projectStatusLabel[status]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionHint}>Tiến độ bằng thanh kéo</Text>
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
                    style={[
                      styles.saveProgressBtn,
                      (saving || progressDraft === project.progress) ? styles.disabledBtn : undefined,
                    ]}
                    onPress={() => void onSaveProjectProgress()}
                    disabled={saving || progressDraft === project.progress}
                  >
                    <Text style={styles.saveProgressText}>{saving ? 'Đang lưu...' : 'Lưu tiến độ'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      {activeTab === 'tasks' ? (
        <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
          {canManageProject ? (
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Tạo task mới & chia việc</Text>
              <TouchableOpacity
                style={styles.createTaskBtn}
                onPress={() => {
                  resetCreateTaskForm();
                  setOpenCreateTask(true);
                }}
              >
                <Ionicons name="add" size={16} color={colors.white} />
                <Text style={styles.createTaskBtnText}>Tạo task</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.rowBetween}>
            <Text style={styles.chartTitle}>Biểu đồ công việc dự án</Text>
            <Text style={styles.chartHint}>{taskChartMode === 'status' ? 'Theo trạng thái' : 'Theo mức ưu tiên'}</Text>
          </View>

          <View style={styles.chartModeRow}>
            <TouchableOpacity
              style={[styles.chartModeBtn, taskChartMode === 'status' ? styles.chartModeBtnActive : undefined]}
              onPress={() => setTaskChartMode('status')}
            >
              <Text style={[styles.chartModeText, taskChartMode === 'status' ? styles.chartModeTextActive : undefined]}>
                Trạng thái
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chartModeBtn, taskChartMode === 'priority' ? styles.chartModeBtnActive : undefined]}
              onPress={() => setTaskChartMode('priority')}
            >
              <Text style={[styles.chartModeText, taskChartMode === 'priority' ? styles.chartModeTextActive : undefined]}>
                Ưu tiên
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.chartColumns}>
            {projectTaskChartBars.map((item) => (
              <View key={`project-task-chart-${item.key}`} style={styles.chartColumn}>
                <Text style={styles.chartValue}>{item.value}</Text>
                <View style={styles.chartTrack}>
                  <View style={[styles.chartFill, { height: `${item.heightPercent}%`, backgroundColor: item.color }]} />
                </View>
                <Text numberOfLines={1} style={styles.chartLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.visualModeRow}>
            <TouchableOpacity
              style={[styles.visualModeBtn, taskVisualMode === 'kanban' ? styles.visualModeBtnActive : undefined]}
              onPress={() => setTaskVisualMode('kanban')}
            >
              <Ionicons name="grid-outline" size={14} color={taskVisualMode === 'kanban' ? colors.primaryDark : colors.muted} />
              <Text style={[styles.visualModeText, taskVisualMode === 'kanban' ? styles.visualModeTextActive : undefined]}>
                Kanban
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.visualModeBtn, taskVisualMode === 'list' ? styles.visualModeBtnActive : undefined]}
              onPress={() => setTaskVisualMode('list')}
            >
              <Ionicons name="list-outline" size={14} color={taskVisualMode === 'list' ? colors.primaryDark : colors.muted} />
              <Text style={[styles.visualModeText, taskVisualMode === 'list' ? styles.visualModeTextActive : undefined]}>
                Danh sách
              </Text>
            </TouchableOpacity>
          </View>

          {taskVisualMode === 'kanban' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.kanbanScrollRow}
              snapToInterval={KANBAN_COLUMN_WIDTH + KANBAN_GAP}
              decelerationRate="fast"
              snapToAlignment="start"
              disableIntervalMomentum
            >
              {taskKanbanColumns.map((column) => (
                <View
                  key={`project-kanban-${column.status}`}
                  style={[
                    styles.kanbanColumnCard,
                    { width: KANBAN_COLUMN_WIDTH, backgroundColor: kanbanColumnBackground[column.status] },
                  ]}
                >
                  <View style={styles.rowBetween}>
                    <View style={styles.kanbanHeaderLeft}>
                      <View style={[styles.dot, { backgroundColor: taskStatusColor[column.status] }]} />
                      <Text style={styles.kanbanHeaderText}>{taskStatusLabel[column.status]}</Text>
                    </View>
                    <View style={styles.kanbanCountChip}>
                      <Text style={styles.kanbanCountText}>{column.tasks.length}</Text>
                    </View>
                  </View>

                  {column.tasks.length === 0 ? (
                    <View style={styles.kanbanEmptyWrap}>
                      <Text style={styles.kanbanEmptyText}>Không có task</Text>
                    </View>
                  ) : (
                    column.tasks.map((task) => (
                      <TouchableOpacity
                        key={`project-kanban-task-${task._id}`}
                        style={styles.kanbanTaskCard}
                        onPress={() => navigation.navigate('TaskDetail', { taskId: task._id })}
                      >
                        <Text numberOfLines={2} style={styles.kanbanTaskTitle}>{task.title}</Text>
                        <Text style={styles.kanbanTaskMeta}>Tiến độ {task.progress}% · {formatDate(task.dueDate)}</Text>
                        <View style={styles.progressTrackMini}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${task.progress}%`, backgroundColor: taskStatusColor[task.effectiveStatus] },
                            ]}
                          />
                        </View>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Bảng công việc theo trạng thái</Text>

              {taskStatusOrder.map((status) => {
                const list = tasksByStatus[status];

                return (
                  <View key={status} style={styles.taskSection}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.taskSectionTitle}>{taskStatusLabel[status]}</Text>
                      <Text style={styles.meta}>{list.length}</Text>
                    </View>

                    {list.length === 0 ? (
                      <Text style={styles.emptyText}>Chưa có công việc ở trạng thái này.</Text>
                    ) : (
                      list.map((task) => (
                        <TouchableOpacity
                          key={task._id}
                          style={styles.taskRow}
                          onPress={() => navigation.navigate('TaskDetail', { taskId: task._id })}
                        >
                          <View style={[styles.dot, { backgroundColor: taskStatusColor[task.effectiveStatus] }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.taskTitle}>{task.title}</Text>
                            <Text style={styles.taskMeta}>Tiến độ {task.progress}% · {formatDate(task.dueDate)}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                );
              })}
            </>
          )}
        </Card>
      ) : null}

      {activeTab === 'team' ? (
        <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
          <Text style={styles.sectionTitle}>Nhóm dự án ({teamMembers.length})</Text>

          {lead ? (
            <View style={[styles.memberRow, { backgroundColor: hexToRgba(colors.primary, 0.06) }]}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>{lead.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{lead.name}</Text>
                <Text style={styles.memberRole}>Trưởng dự án</Text>
              </View>
              <Ionicons name="star" size={16} color="#B45309" />
            </View>
          ) : null}

          {teamMembers.filter((member) => member._id !== project.leadId).map((member) => (
            <View key={member._id} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>{member.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{member.name}</Text>
                <Text style={styles.memberRole}>{member.position || member.role}</Text>
              </View>
            </View>
          ))}

          {teamMembers.length === 0 ? <Text style={styles.emptyText}>Chưa có thành viên.</Text> : null}
        </Card>
      ) : null}

      {activeTab === 'timeline' ? (
        <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
          <Text style={styles.sectionTitle}>Timeline dự án</Text>

          <View style={styles.visualModeRow}>
            <TouchableOpacity
              style={[styles.visualModeBtn, timelineVisualMode === 'chart' ? styles.visualModeBtnActive : undefined]}
              onPress={() => setTimelineVisualMode('chart')}
            >
              <Ionicons name="analytics-outline" size={14} color={timelineVisualMode === 'chart' ? colors.primaryDark : colors.muted} />
              <Text style={[styles.visualModeText, timelineVisualMode === 'chart' ? styles.visualModeTextActive : undefined]}>
                Timeline chart
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.visualModeBtn, timelineVisualMode === 'list' ? styles.visualModeBtnActive : undefined]}
              onPress={() => setTimelineVisualMode('list')}
            >
              <Ionicons name="list-outline" size={14} color={timelineVisualMode === 'list' ? colors.primaryDark : colors.muted} />
              <Text style={[styles.visualModeText, timelineVisualMode === 'list' ? styles.visualModeTextActive : undefined]}>
                Danh sách
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.chartModeRow}>
            <TouchableOpacity
              style={[styles.chartModeBtn, timelineFilter === 'all' ? styles.chartModeBtnActive : undefined]}
              onPress={() => setTimelineFilter('all')}
            >
              <Text style={[styles.chartModeText, timelineFilter === 'all' ? styles.chartModeTextActive : undefined]}>
                Tất cả
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chartModeBtn, timelineFilter === 'project' ? styles.chartModeBtnActive : undefined]}
              onPress={() => setTimelineFilter('project')}
            >
              <Text style={[styles.chartModeText, timelineFilter === 'project' ? styles.chartModeTextActive : undefined]}>
                Mốc dự án
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chartModeBtn, timelineFilter === 'task' ? styles.chartModeBtnActive : undefined]}
              onPress={() => setTimelineFilter('task')}
            >
              <Text style={[styles.chartModeText, timelineFilter === 'task' ? styles.chartModeTextActive : undefined]}>
                Mốc task
              </Text>
            </TouchableOpacity>
          </View>

          {timelineVisualMode === 'chart' ? (
            <View style={styles.timelineChartWrap}>
              <View style={styles.rowBetween}>
                <Text style={styles.chartTitle}>Timeline chart theo task</Text>
                <Text style={styles.chartHint}>
                  {timelineDateRange
                    ? `${formatDate(new Date(timelineDateRange.start).toISOString())} → ${formatDate(new Date(timelineDateRange.end).toISOString())}`
                    : 'Chưa có dữ liệu'}
                </Text>
              </View>

              {timelineTaskBars.length === 0 ? (
                <Text style={styles.emptyText}>Chưa đủ dữ liệu ngày để dựng chart timeline.</Text>
              ) : (
                timelineTaskBars.map((row) => (
                  <View key={row.id} style={styles.timelineChartRow}>
                    <Text numberOfLines={1} style={styles.timelineChartTask}>{row.title}</Text>
                    <View style={styles.timelineBarTrack}>
                      <View
                        style={[
                          styles.timelineBarFill,
                          {
                            left: `${row.leftPercent}%`,
                            width: `${row.widthPercent}%`,
                            backgroundColor: taskStatusColor[row.status],
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.timelineChartMeta}>{`${formatDate(row.startRaw)} • ${formatDate(row.endRaw)}`}</Text>
                  </View>
                ))
              )}
            </View>
          ) : filteredTimelineItems.length === 0 ? (
            <Text style={styles.emptyText}>Chưa có mốc thời gian.</Text>
          ) : (
            filteredTimelineItems.map((item) => (
              <View key={item.id} style={styles.timelineRow}>
                <View style={[styles.timelineIcon, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineTitle}>{item.title}</Text>
                  <Text style={styles.timelineNote}>{item.note}</Text>
                </View>
                <Text style={styles.timelineDate}>{formatDateTime(item.date)}</Text>
              </View>
            ))
          )}
        </Card>
      ) : null}

      {activeTab === 'notes' ? (
        <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
          <Text style={styles.sectionTitle}>Ghi chú theo dự án & task</Text>

          {noteItems.length === 0 ? (
            <Text style={styles.emptyText}>Chưa có ghi chú nào từ mô tả dự án hoặc mô tả task.</Text>
          ) : (
            noteItems.map((note) => (
              <View key={note.id} style={styles.noteCard}>
                <Text style={styles.noteTitle}>{note.title}</Text>
                <Text style={styles.noteContent}>{note.content}</Text>
              </View>
            ))
          )}
        </Card>
      ) : null}

      {activeTab === 'documents' ? (
        <Card style={{ backgroundColor: hexToRgba(colors.primary, 0.08) }}>
          <Text style={styles.sectionTitle}>Tài liệu đính kèm từ task</Text>

          {attachmentItems.length === 0 ? (
            <Text style={styles.emptyText}>Chưa có file đính kèm trong các task của dự án.</Text>
          ) : (
            attachmentItems.map((file) => (
              <View key={file.id} style={styles.documentRow}>
                <Ionicons name="document-outline" size={16} color={colors.text} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.documentName}>{file.fileName}</Text>
                  <Text numberOfLines={1} style={styles.documentMeta}>Task: {file.taskTitle}</Text>
                </View>
              </View>
            ))
          )}
        </Card>
      ) : null}

      <Modal
        visible={openCreateTask}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenCreateTask(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Tạo task mới & chia việc</Text>
              <TouchableOpacity onPress={() => setOpenCreateTask(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={18} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              contentContainerStyle={{ paddingBottom: modalFooterHeight + 16 }}
            >
              <AppInput
                label="Tên task *"
                placeholder="VD: Xây dựng Frontend"
                value={taskTitleDraft}
                onChangeText={setTaskTitleDraft}
              />

              <AppInput
                label="Mô tả"
                placeholder="Mô tả công việc..."
                value={taskDescriptionDraft}
                onChangeText={setTaskDescriptionDraft}
                multiline
                style={styles.modalTextArea}
              />

              <View style={styles.modalGrid2}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.modalLabel}>Người thực hiện *</Text>
                  <TouchableOpacity
                    onPress={() => setShowAssigneePicker((current) => !current)}
                    style={styles.selectField}
                    disabled={assignableMembers.length === 0}
                  >
                    <Text numberOfLines={1} style={styles.selectFieldText}>
                      {assignableMembers.length === 0
                        ? 'Chưa có thành viên'
                        : assignableMembers.find((m) => m._id === taskAssigneeDraft)?.name || 'Chọn người thực hiện'}
                    </Text>
                    <Ionicons name={showAssigneePicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
                  </TouchableOpacity>

                  {showAssigneePicker && assignableMembers.length > 0 ? (
                    <View style={styles.selectList}>
                      {assignableMembers.map((member) => {
                        const selected = member._id === taskAssigneeDraft;
                        return (
                          <TouchableOpacity
                            key={`assignee-${member._id}`}
                            onPress={() => {
                              setTaskAssigneeDraft(member._id);
                              setShowAssigneePicker(false);
                            }}
                            style={[styles.selectOptionRow, selected ? styles.selectOptionRowSelected : undefined]}
                          >
                            <Text numberOfLines={1} style={styles.selectOptionText}>{member.name}</Text>
                            {selected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>

                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.modalLabel}>Mức ưu tiên</Text>
                  <View style={styles.priorityRow}>
                    {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                      <TouchableOpacity
                        key={p}
                        onPress={() => setTaskPriorityDraft(p)}
                        style={[styles.priorityChip, taskPriorityDraft === p ? styles.priorityChipActive : undefined]}
                      >
                        <Text style={[styles.priorityChipText, taskPriorityDraft === p ? styles.priorityChipTextActive : undefined]}>
                          {taskPriorityLabel[p]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.modalGrid2}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.modalLabel}>Ngày bắt đầu</Text>
                  <TouchableOpacity onPress={() => openDatePicker('start')} style={styles.dateField}>
                    <Text style={[styles.dateFieldText, !taskStartDateDraft ? styles.dateFieldTextMuted : undefined]}>
                      {taskStartDateDraft || 'YYYY-MM-DD'}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>

                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.modalLabel}>Deadline *</Text>
                  <TouchableOpacity onPress={() => openDatePicker('due')} style={styles.dateField}>
                    <Text style={[styles.dateFieldText, !taskDueDateDraft ? styles.dateFieldTextMuted : undefined]}>
                      {taskDueDateDraft || 'YYYY-MM-DD'}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>
              </View>

              {Platform.OS === 'ios' && iosInlinePickerTarget ? (
                <View style={styles.iosInlinePickerWrap}>
                  <View style={styles.iosInlinePickerHeader}>
                    <TouchableOpacity onPress={cancelIosInlineDate}>
                      <Text style={styles.pickerAction}>Huỷ</Text>
                    </TouchableOpacity>
                    <Text style={styles.pickerTitle}>Chọn ngày</Text>
                    <TouchableOpacity onPress={commitIosInlineDate}>
                      <Text style={styles.pickerActionPrimary}>Xong</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={iosPendingDate}
                    mode="date"
                    display="spinner"
                    onChange={(_, date) => {
                      if (date) setIosPendingDate(date);
                    }}
                  />
                </View>
              ) : null}

              {Platform.OS !== 'ios' && showStartDatePicker ? (
                <DateTimePicker
                  value={parseISODate(taskStartDateDraft) || new Date()}
                  mode="date"
                  display="default"
                  onChange={(event, date) => {
                    setShowStartDatePicker(false);
                    if (!date || event.type === 'dismissed') return;
                    setTaskStartDateDraft(formatISODate(date));
                  }}
                />
              ) : null}
              {Platform.OS !== 'ios' && showDueDatePicker ? (
                <DateTimePicker
                  value={parseISODate(taskDueDateDraft) || new Date()}
                  mode="date"
                  display="default"
                  onChange={(event, date) => {
                    setShowDueDatePicker(false);
                    if (!date || event.type === 'dismissed') return;
                    setTaskDueDateDraft(formatISODate(date));
                  }}
                />
              ) : null}

              {tasks.length > 0 ? (
              <View style={styles.modalBlock}>
                <Text style={styles.modalLabel}>Task phụ thuộc (phải hoàn thành trước)</Text>
                <View style={styles.dependencyList}>
                    {tasks.map((task) => {
                      const selected = taskDependencyDraft.includes(task._id);
                      return (
                        <TouchableOpacity
                          key={`dep-${task._id}`}
                          onPress={() => toggleDependency(task._id)}
                          style={[styles.dependencyRow, selected ? styles.dependencyRowSelected : undefined]}
                        >
                          <View style={[styles.dependencyDot, { backgroundColor: selected ? colors.primary : colors.border }]} />
                          <Text numberOfLines={1} style={styles.dependencyText}>{task.title}</Text>
                        </TouchableOpacity>
                      );
                    })}
                </View>
              </View>
              ) : null}

              <View style={styles.modalBlock}>
                <Text style={styles.modalLabel}>Subtasks (mỗi dòng 1 subtask)</Text>
                <TouchableOpacity
                  onPress={() => {
                    setSubtasksDraftTemp(taskSubtasksDraft);
                    setOpenSubtasksEditor(true);
                  }}
                  activeOpacity={0.8}
                  style={styles.subtasksPreviewField}
                >
                  <Text style={[styles.subtasksPreviewText, !taskSubtasksDraft ? styles.subtasksPreviewTextMuted : undefined]}>
                    {taskSubtasksDraft
                      ? taskSubtasksDraft
                      : '- Xây dựng Figma\n- Thiết kế UI\n- ...'}
                  </Text>
                </TouchableOpacity>
              </View>

            </ScrollView>

            <View
              style={styles.modalFooter}
              onLayout={(event) => {
                setModalFooterHeight(event.nativeEvent.layout.height);
              }}
            >
              <View style={styles.modalActionsRow}>
                <AppButton
                  label="Huỷ"
                  variant="outline"
                  onPress={() => setOpenCreateTask(false)}
                  disabled={creatingTask}
                  style={{ flex: 1 }}
                />
                <AppButton
                  label={creatingTask ? 'Đang tạo...' : 'Tạo task'}
                  onPress={createTask}
                  loading={creatingTask}
                  disabled={creatingTask}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={openSubtasksEditor}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenSubtasksEditor(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <View style={styles.subtasksModalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Subtasks</Text>
                <TouchableOpacity onPress={() => setOpenSubtasksEditor(false)} style={styles.modalCloseBtn}>
                  <Ionicons name="close" size={18} color={colors.muted} />
                </TouchableOpacity>
              </View>

              <TextInput
                value={subtasksDraftTemp}
                onChangeText={setSubtasksDraftTemp}
                placeholder={'- Xây dựng Figma\n- Thiết kế UI\n- ...'}
                placeholderTextColor={colors.muted}
                multiline
                style={styles.subtasksEditorInput}
              />

              <View style={styles.modalFooter}>
                <View style={styles.modalActionsRow}>
                  <AppButton
                    label="Huỷ"
                    variant="outline"
                    onPress={() => {
                      setOpenSubtasksEditor(false);
                      setSubtasksDraftTemp('');
                    }}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    label="Xong"
                    onPress={() => {
                      setTaskSubtasksDraft(subtasksDraftTemp);
                      setOpenSubtasksEditor(false);
                      setSubtasksDraftTemp('');
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inlineCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectState: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
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
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  projectName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 25,
    lineHeight: 29,
  },
  description: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    lineHeight: 20,
  },
  progressTrack: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    height: 10,
    backgroundColor: '#E2E8F0',
  },
  progressTrackMini: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    height: 8,
    backgroundColor: '#E2E8F0',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  meta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  createTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  createTaskBtnText: {
    color: colors.white,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 16,
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 14,
    maxHeight: '86%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
  },
  modalTitle: {
    flex: 1,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
    fontSize: 16,
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  modalTextArea: {
    height: 90,
    textAlignVertical: 'top',
  },
  modalLabel: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  modalHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  modalBlock: {
    gap: 8,
    marginTop: 10,
  },
  modalGrid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  memberChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  memberChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  memberChipActive: {
    backgroundColor: colors.primary,
  },
  memberChipText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  memberChipTextActive: {
    color: colors.white,
  },
  priorityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priorityChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  priorityChipActive: {
    backgroundColor: colors.primary,
  },
  priorityChipText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  priorityChipTextActive: {
    color: colors.white,
  },
  dependencyList: {
    gap: 8,
    marginTop: 2,
  },
  dependencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dependencyRowSelected: {
    backgroundColor: hexToRgba(colors.primary, 0.12),
    borderColor: colors.primary,
  },
  dependencyDot: {
    width: 10,
    height: 10,
    borderRadius: 99,
  },
  dependencyText: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  subtasksPreviewField: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 90,
  },
  subtasksPreviewText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
    lineHeight: 20,
  },
  subtasksPreviewTextMuted: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  subtasksModalCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 14,
    maxHeight: '86%',
  },
  subtasksEditorInput: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
    minHeight: 140,
    textAlignVertical: 'top',
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
  iosInlinePickerWrap: {
    marginTop: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.card,
    padding: 10,
  },
  iosInlinePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  selectField: {
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
  selectFieldText: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  selectList: {
    marginTop: 8,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  selectOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  selectOptionRowSelected: {
    backgroundColor: hexToRgba(colors.primary, 0.12),
  },
  selectOptionText: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    marginRight: 8,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  metaStrong: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  tabsCard: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tabsRow: {
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.white,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  tabChipActive: {
    backgroundColor: colors.accent,
  },
  tabChipText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  tabChipTextActive: {
    color: colors.primaryDark,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  chartTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 14,
  },
  chartHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  chartModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chartModeBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    alignItems: 'center',
    paddingVertical: 8,
  },
  chartModeBtnActive: {
    backgroundColor: colors.accent,
  },
  chartModeText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  chartModeTextActive: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  chartColumns: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  chartValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 13,
  },
  chartTrack: {
    width: 24,
    height: 94,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: '#EEF2F7',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chartFill: {
    width: '100%',
    borderRadius: 999,
  },
  chartLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 10,
    textAlign: 'center',
  },
  visualModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  visualModeBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  visualModeBtnActive: {
    backgroundColor: colors.accent,
  },
  visualModeText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  visualModeTextActive: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  sectionHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  overviewStatsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  overviewStatCard: {
    flex: 1,
    minWidth: 92,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  overviewStatLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  overviewStatValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 22,
    lineHeight: 24,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  distributionBlock: {
    gap: 5,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusBtn: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
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
  memberRow: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },
  memberName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  memberRole: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  taskSection: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    padding: 10,
    gap: 8,
  },
  taskSectionTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  taskRow: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  taskMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  kanbanScrollRow: {
    gap: 10,
    paddingRight: 4,
  },
  kanbanColumnCard: {
    width: 260,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    padding: 9,
    gap: 7,
  },
  kanbanHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kanbanHeaderText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  kanbanCountChip: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  kanbanCountText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  kanbanEmptyWrap: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingVertical: 14,
    alignItems: 'center',
  },
  kanbanEmptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  kanbanTaskCard: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 9,
    paddingVertical: 7,
    gap: 5,
  },
  kanbanTaskTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 15,
    lineHeight: 19,
  },
  kanbanTaskMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  timelineChartWrap: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  timelineChartRow: {
    gap: 4,
  },
  timelineChartTask: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  timelineBarTrack: {
    height: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: '#EEF2F7',
    position: 'relative',
    overflow: 'hidden',
  },
  timelineBarFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  timelineChartMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 10,
  },
  timelineRow: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  timelineNote: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  timelineDate: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 10,
    maxWidth: 110,
    textAlign: 'right',
  },
  noteCard: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  noteTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 13,
  },
  noteContent: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    lineHeight: 18,
  },
  documentRow: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  documentName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  documentMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
});

import React, { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors } from '../theme/colors';
import { projectApi, taskApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { Project, Task } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { AppStackParamList } from '../navigation/types';
import { getEffectiveTaskStatus } from '../utils/taskStatus';
import { hexToRgba } from '../utils/color';
import { ClipboardIcon } from '../components/SvgIcons';

type ViewStatus = 'all' | 'todo' | 'in-progress' | 'review' | 'done';
type RealTaskStatus = 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled';
type TaskChartMode = 'status' | 'progress';
type TaskVisualMode = 'kanban' | 'list';

const taskStatusLabel: Record<RealTaskStatus, string> = {
  todo: 'Chưa làm',
  'in-progress': 'Đang làm',
  review: 'Review',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

const statusLabel: Record<ViewStatus, string> = {
  all: 'Tất cả',
  ...taskStatusLabel,
};

const statusCard: Record<RealTaskStatus, { bg: string; text: string; dot: string }> = {
  todo: { bg: '#EDF2F7', text: colors.text, dot: colors.muted },
  'in-progress': { bg: colors.info, text: colors.text, dot: '#4A5568' },
  review: { bg: colors.purple, text: colors.text, dot: '#6B46C1' },
  done: { bg: colors.success, text: colors.text, dot: '#2F855A' },
  cancelled: { bg: colors.danger, text: colors.text, dot: '#C53030' },
};

const nextStatus: Record<'todo' | 'in-progress' | 'review' | 'done' | 'cancelled', 'todo' | 'in-progress' | 'review' | 'done'> = {
  todo: 'in-progress',
  'in-progress': 'review',
  review: 'done',
  done: 'todo',
  cancelled: 'todo',
};

const KANBAN_COLUMN_WIDTH = 260;
const KANBAN_GAP = 10;

type TaskView = Task & { effectiveStatus: RealTaskStatus };

const sectionBackground = {
  summary: hexToRgba(colors.primary, 0.1),
  chart: hexToRgba(colors.primary, 0.08),
  empty: hexToRgba(colors.primary, 0.08),
};

const kanbanColumnBackground: Record<RealTaskStatus, string> = {
  todo: hexToRgba(colors.primary, 0.08),
  'in-progress': hexToRgba(colors.primary, 0.08),
  review: hexToRgba(colors.primary, 0.08),
  done: hexToRgba(colors.primary, 0.08),
  cancelled: hexToRgba(colors.primary, 0.06),
};

export function TasksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const user = useAuthStore((state) => state.user);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ViewStatus>('all');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [chartMode, setChartMode] = useState<TaskChartMode>('status');
  const [visualMode, setVisualMode] = useState<TaskVisualMode>('kanban');

  const canViewAll = user?.role === 'admin' || user?.role === 'manager';

  const taskViews = useMemo<TaskView[]>(
    () => tasks.map((task) => ({ ...task, effectiveStatus: getEffectiveTaskStatus(task) })),
    [tasks]
  );

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [taskRes, projectRes] = await Promise.all([taskApi.getAll(), projectApi.getAll()]);
      setTasks(taskRes.data.data || []);
      setProjects(projectRes.data.data || []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (canViewAll) setScope('all');
      loadData();
    }, [loadData, canViewAll])
  );

  const visibleTasks = useMemo(() => {
    const source = canViewAll && scope === 'all' ? taskViews : taskViews.filter((task) => task.assignedTo === user?._id);
    if (statusFilter === 'all') return source;
    return source.filter((task) => task.effectiveStatus === statusFilter);
  }, [taskViews, canViewAll, scope, user?._id, statusFilter]);

  const stats = useMemo(
    () => ({
      total: visibleTasks.length,
      todo: visibleTasks.filter((task) => task.effectiveStatus === 'todo').length,
      doing: visibleTasks.filter((task) => task.effectiveStatus === 'in-progress').length,
      review: visibleTasks.filter((task) => task.effectiveStatus === 'review').length,
      done: visibleTasks.filter((task) => task.effectiveStatus === 'done').length,
    }),
    [visibleTasks]
  );

  const summaryRows = useMemo(() => {
    const statuses: RealTaskStatus[] = ['todo', 'in-progress', 'review', 'done', 'cancelled'];
    const total = visibleTasks.length;

    return statuses.map((status) => {
      const value = visibleTasks.filter((task) => task.effectiveStatus === status).length;
      const percent = total > 0 ? Math.round((value / total) * 100) : 0;
      return {
        status,
        label: taskStatusLabel[status],
        value,
        percent,
        color: statusCard[status].dot,
      };
    });
  }, [visibleTasks]);

  const chartItems = useMemo(() => {
    if (chartMode === 'status') {
      const statuses: RealTaskStatus[] = ['todo', 'in-progress', 'review', 'done', 'cancelled'];
      return statuses.map((status) => ({
        key: status,
        label: taskStatusLabel[status],
        value: visibleTasks.filter((task) => task.effectiveStatus === status).length,
        color: statusCard[status].dot,
      }));
    }

    return [
      {
        key: 'p0-25',
        label: '0-25%',
        value: visibleTasks.filter((task) => task.progress <= 25).length,
        color: '#64748B',
      },
      {
        key: 'p26-50',
        label: '26-50%',
        value: visibleTasks.filter((task) => task.progress > 25 && task.progress <= 50).length,
        color: '#2563EB',
      },
      {
        key: 'p51-75',
        label: '51-75%',
        value: visibleTasks.filter((task) => task.progress > 50 && task.progress <= 75).length,
        color: '#8B5CF6',
      },
      {
        key: 'p76-100',
        label: '76-100%',
        value: visibleTasks.filter((task) => task.progress > 75).length,
        color: '#16A34A',
      },
    ];
  }, [chartMode, visibleTasks]);

  const chartRows = useMemo(() => {
    const maxValue = Math.max(...chartItems.map((item) => item.value), 1);
    const total = visibleTasks.length;

    return chartItems.map((item) => {
      const ratio = item.value / maxValue;
      return {
        ...item,
        widthPercent: item.value > 0 ? Math.max(Math.round(ratio * 100), 8) : 0,
        percentTotal: total > 0 ? Math.round((item.value / total) * 100) : 0,
      };
    });
  }, [chartItems, visibleTasks.length]);

  const kanbanColumns = useMemo(
    () =>
      (['todo', 'in-progress', 'review', 'done', 'cancelled'] as RealTaskStatus[]).map((status) => ({
        status,
        tasks: visibleTasks.filter((task) => task.effectiveStatus === status),
      })),
    [visibleTasks]
  );

  const projectName = useMemo(() => {
    const map: Record<string, string> = {};
    projects.forEach((project) => {
      map[project._id] = project.name;
    });
    return map;
  }, [projects]);

  const handleCycleStatus = async (task: TaskView) => {
    const currentStatus = task.effectiveStatus;
    const next = nextStatus[currentStatus];

    const patch: Partial<Task> = { status: next };
    if (next === 'todo') patch.progress = 0;
    if (next === 'in-progress' && task.progress <= 0) patch.progress = 1;

    try {
      await taskApi.update(task._id, patch);
      setTasks((current) =>
        current.map((item) => (item._id === task._id ? { ...item, ...patch } : item))
      );
    } catch (error: any) {
      Alert.alert('Không thể cập nhật', getApiErrorMessage(error));
    }
  };

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
          <ClipboardIcon size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.title}>Công việc</Text>
      </View>
      <Text style={styles.subtitle}>Nhấn vào task để mở chi tiết như web</Text>

      <Card style={[styles.sectionCard, { backgroundColor: sectionBackground.summary }]}>
        <Text style={styles.sectionTitle}>Chỉ số theo trạng thái</Text>
        <View style={styles.summaryTotalRow}>
          <Text style={styles.summaryTotalLabel}>Tổng task đang hiển thị</Text>
          <Text style={styles.summaryTotalValue}>{stats.total}</Text>
        </View>

        {summaryRows.map((item) => (
          <View key={`summary-${item.status}`} style={styles.summaryRow}>
            <View style={styles.summaryHead}>
              <View style={styles.summaryLabelWrap}>
                <View style={[styles.summaryDot, { backgroundColor: item.color }]} />
                <Text style={styles.summaryLabel}>{item.label}</Text>
              </View>
              <Text style={styles.summaryMeta}>{item.value} · {item.percent}%</Text>
            </View>
            <View style={styles.summaryTrack}>
              <View style={[styles.summaryFill, { width: `${item.percent}%`, backgroundColor: item.color }]} />
            </View>
          </View>
        ))}
      </Card>

      {canViewAll ? (
        <View style={styles.scopeRow}>
          <TouchableOpacity
            style={[styles.scopeBtn, scope === 'all' ? styles.scopeBtnActive : undefined]}
            onPress={() => setScope('all')}
          >
            <Text style={[styles.scopeText, scope === 'all' ? styles.scopeTextActive : undefined]}>Toàn công ty</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scopeBtn, scope === 'mine' ? styles.scopeBtnActive : undefined]}
            onPress={() => setScope('mine')}
          >
            <Text style={[styles.scopeText, scope === 'mine' ? styles.scopeTextActive : undefined]}>Của tôi</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.filterRow}>
        {(['all', 'todo', 'in-progress', 'review', 'done'] as ViewStatus[]).map((status) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterBtn, statusFilter === status ? styles.filterBtnActive : undefined]}
            onPress={() => setStatusFilter(status)}
          >
            <Text style={[styles.filterText, statusFilter === status ? styles.filterTextActive : undefined]}>{statusLabel[status]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Card style={[styles.sectionCard, { backgroundColor: sectionBackground.chart }]}>
        <View style={styles.rowBetween}>
          <Text style={styles.chartTitle}>Biểu đồ công việc</Text>
          <Text style={styles.chartHint}>{chartMode === 'status' ? 'Theo trạng thái' : 'Theo tiến độ'}</Text>
        </View>

        <View style={styles.chartModeRow}>
          <TouchableOpacity
            style={[styles.chartModeBtn, chartMode === 'status' ? styles.chartModeBtnActive : undefined]}
            onPress={() => setChartMode('status')}
          >
            <Text style={[styles.chartModeText, chartMode === 'status' ? styles.chartModeTextActive : undefined]}>
              Trạng thái
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chartModeBtn, chartMode === 'progress' ? styles.chartModeBtnActive : undefined]}
            onPress={() => setChartMode('progress')}
          >
            <Text style={[styles.chartModeText, chartMode === 'progress' ? styles.chartModeTextActive : undefined]}>
              Tiến độ
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.chartRows}>
          {chartRows.map((item) => (
            <View key={item.key} style={styles.chartRowItem}>
              <View style={styles.chartRowHead}>
                <Text numberOfLines={1} style={styles.chartRowLabel}>{item.label}</Text>
                <Text style={styles.chartRowMeta}>{item.value} · {item.percentTotal}%</Text>
              </View>
              <View style={styles.chartRowTrack}>
                <View style={[styles.chartRowFill, { width: `${item.widthPercent}%`, backgroundColor: item.color }]} />
              </View>
            </View>
          ))}
        </View>
      </Card>

      <View style={styles.visualModeRow}>
        <TouchableOpacity
          style={[styles.visualModeBtn, visualMode === 'kanban' ? styles.visualModeBtnActive : undefined]}
          onPress={() => setVisualMode('kanban')}
        >
          <Ionicons name="grid-outline" size={14} color={visualMode === 'kanban' ? colors.primaryDark : colors.muted} />
          <Text style={[styles.visualModeText, visualMode === 'kanban' ? styles.visualModeTextActive : undefined]}>Kanban</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.visualModeBtn, visualMode === 'list' ? styles.visualModeBtnActive : undefined]}
          onPress={() => setVisualMode('list')}
        >
          <Ionicons name="list-outline" size={14} color={visualMode === 'list' ? colors.primaryDark : colors.muted} />
          <Text style={[styles.visualModeText, visualMode === 'list' ? styles.visualModeTextActive : undefined]}>Danh sách</Text>
        </TouchableOpacity>
      </View>

      {visibleTasks.length === 0 ? (
        <Card style={[styles.sectionCard, { backgroundColor: sectionBackground.empty }]}>
          <Text style={styles.emptyText}>Không có công việc phù hợp bộ lọc.</Text>
        </Card>
      ) : visualMode === 'kanban' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kanbanScrollRow}
          snapToInterval={KANBAN_COLUMN_WIDTH + KANBAN_GAP}
          decelerationRate="fast"
          snapToAlignment="start"
          disableIntervalMomentum
        >
          {kanbanColumns.map((column) => (
            <Card
              key={`kanban-${column.status}`}
              style={[
                styles.kanbanColumnCard,
                { width: KANBAN_COLUMN_WIDTH, backgroundColor: kanbanColumnBackground[column.status] },
              ]}
            >
              <View style={styles.rowBetween}>
                <View style={styles.kanbanHeaderLeft}>
                  <View style={[styles.dot, { backgroundColor: statusCard[column.status].dot }]} />
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
                column.tasks.map((task) => {
                  const style = statusCard[task.effectiveStatus];
                  const currentStatus = task.effectiveStatus;
                  const next = nextStatus[currentStatus];

                  return (
                    <TouchableOpacity
                      key={`kanban-item-${task._id}`}
                      style={styles.kanbanTaskCard}
                      onPress={() => navigation.navigate('TaskDetail', { taskId: task._id })}
                    >
                      <View style={styles.rowBetween}>
                        <Text numberOfLines={1} style={styles.kanbanProjectText}>
                          {task.projectId ? projectName[task.projectId] || 'Không rõ dự án' : 'Không thuộc dự án'}
                        </Text>
                        <View style={[styles.badge, { backgroundColor: style.bg }]}>
                          <Text style={[styles.badgeText, { color: style.text }]}>{task.priority}</Text>
                        </View>
                      </View>

                      <Text numberOfLines={2} style={styles.kanbanTaskTitle}>{task.title}</Text>
                      <Text style={styles.kanbanTaskMeta}>Hạn: {formatDate(task.dueDate)}</Text>

                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${task.progress}%` }]} />
                      </View>

                      <View style={styles.footerRow}>
                        <Text style={styles.progressLabel}>{task.progress}%</Text>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={(event) => {
                            event.stopPropagation();
                            handleCycleStatus(task);
                          }}
                        >
                          <Ionicons name="swap-horizontal" size={14} color={colors.text} />
                          <Text style={styles.actionText}>{taskStatusLabel[next]}</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </Card>
          ))}
        </ScrollView>
      ) : (
        visibleTasks.map((task) => {
          const style = statusCard[task.effectiveStatus];
          const currentStatus = task.effectiveStatus;
          const next = nextStatus[currentStatus];

          return (
            <TouchableOpacity key={task._id} onPress={() => navigation.navigate('TaskDetail', { taskId: task._id })}>
              <Card style={[styles.sectionCard, { backgroundColor: kanbanColumnBackground[currentStatus] }]}>
                <View style={styles.rowBetween}>
                  <View style={styles.projectDotWrap}>
                    <View style={[styles.dot, { backgroundColor: style.dot }]} />
                    <Text numberOfLines={1} style={styles.projectText}>{task.projectId ? projectName[task.projectId] || 'Không rõ dự án' : 'Không thuộc dự án'}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: style.bg }]}>
                    <Text style={[styles.badgeText, { color: style.text }]}>{taskStatusLabel[currentStatus]}</Text>
                  </View>
                </View>

                <Text style={styles.taskTitle}>{task.title}</Text>
                {task.description ? <Text numberOfLines={2} style={styles.description}>{task.description}</Text> : null}

                <View style={styles.metaRow}>
                  <Text style={styles.meta}>Ưu tiên: {task.priority}</Text>
                  <Text style={styles.meta}>Hạn: {formatDate(task.dueDate)}</Text>
                </View>

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${task.progress}%` }]} />
                </View>

                <View style={styles.footerRow}>
                  <Text style={styles.progressLabel}>Tiến độ {task.progress}%</Text>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={(event) => {
                      event.stopPropagation();
                      handleCycleStatus(task);
                    }}
                  >
                    <Ionicons name="swap-horizontal" size={14} color={colors.text} />
                    <Text style={styles.actionText}>{taskStatusLabel[next]}</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionCard: {},
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
    color: colors.muted,
    marginTop: -4,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  summaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  summaryTotalLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  summaryTotalValue: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 20,
  },
  summaryRow: {
    gap: 5,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryLabel: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  summaryMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  summaryTrack: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    height: 8,
    backgroundColor: '#EEF2F7',
  },
  summaryFill: {
    height: '100%',
    borderRadius: 999,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  scopeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  scopeBtnActive: {
    backgroundColor: colors.secondary,
  },
  scopeText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  scopeTextActive: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  filterBtnActive: {
    backgroundColor: colors.accent,
  },
  filterText: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  filterTextActive: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  chartTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
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
  chartRows: {
    gap: 8,
  },
  chartRowItem: {
    gap: 4,
  },
  chartRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chartRowLabel: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
    flex: 1,
  },
  chartRowMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  chartRowTrack: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    height: 10,
    backgroundColor: '#EEF2F7',
  },
  chartRowFill: {
    height: '100%',
    borderRadius: 999,
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
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  projectDotWrap: {
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
  projectText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_700Bold',
    flex: 1,
  },
  taskTitle: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 21,
    lineHeight: 25,
  },
  description: {
    color: colors.muted,
    lineHeight: 19,
    fontFamily: 'BeVietnamPro_600SemiBold',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  progressTrack: {
    marginTop: 2,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    height: 9,
    backgroundColor: '#E2E8F0',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  footerRow: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  progressLabel: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  actionBtn: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  actionText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  kanbanScrollRow: {
    gap: 10,
    paddingRight: 4,
  },
  kanbanColumnCard: {
    width: 260,
    alignSelf: 'flex-start',
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
  kanbanProjectText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
    flex: 1,
    marginRight: 8,
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
    fontSize: 12,
  },
});

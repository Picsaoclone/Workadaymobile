import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { SectionTitle } from '../components/SectionTitle';
import { colors } from '../theme/colors';
import { companyApi, meetingApi, projectApi, taskApi } from '../services/api';
import { Meeting, Project, Task } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { getEffectiveTaskStatus } from '../utils/taskStatus';
import { hexToRgba } from '../utils/color';
import { CalendarIcon, ChatIcon, ClipboardIcon, ClockIcon, FolderIcon } from '../components/SvgIcons';

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((state) => state.user);

  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const companyPromise = user?.companyId ? companyApi.getById(user.companyId).catch(() => null) : Promise.resolve(null);
      const meetingsPromise = meetingApi.getAll({ range: 'upcoming' }).catch(() => ({ data: { data: [] as Meeting[] } } as any));
      const [taskRes, projectRes, meetingRes, companyRes] = await Promise.all([
        taskApi.getAll(),
        projectApi.getAll(),
        meetingsPromise,
        companyPromise,
      ]);
      setTasks(taskRes.data.data || []);
      setProjects(projectRes.data.data || []);
      setMeetings(meetingRes?.data?.data || []);
      setCompanyName(companyRes?.data?.data?.name || null);
    } finally {
      setRefreshing(false);
    }
  }, [user?.companyId, user?.role]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const myTasks = useMemo(() => tasks.filter((task) => task.assignedTo === user?._id), [tasks, user?._id]);

  const taskViews = useMemo(
    () => tasks.map((task) => ({ ...task, effectiveStatus: getEffectiveTaskStatus(task) })),
    [tasks]
  );

  const myTaskViews = useMemo(
    () => taskViews.filter((task) => task.assignedTo === user?._id),
    [taskViews, user?._id]
  );

  const stats = useMemo(() => {
    const source = user?.role === 'employee' ? myTaskViews : taskViews;
    return {
      totalTasks: source.length,
      inProgress: source.filter((task) => task.effectiveStatus === 'in-progress').length,
      done: source.filter((task) => task.effectiveStatus === 'done').length,
      totalProjects: projects.length,
    };
  }, [myTaskViews, taskViews, projects.length, user?.role]);

  const upcomingTasks = useMemo(
    () =>
      (user?.role === 'employee' ? myTaskViews : taskViews)
        .filter((task) => task.effectiveStatus !== 'done' && task.effectiveStatus !== 'cancelled')
        .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
        .slice(0, 4),
    [taskViews, myTaskViews, user?.role]
  );

  const upcomingMeetings = useMemo(
    () =>
      (meetings || [])
        .filter((m) => m.status !== 'cancelled')
        .sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || '')))
        .slice(0, 2),
    [meetings]
  );

  const openStackRoute = (routeName: 'Attendance' | 'Leave' | 'Reports') => {
    navigation.getParent()?.navigate(routeName);
  };

  const openMeetings = () => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) parent.navigate('Meetings');
    else navigation.navigate('Meetings');
  };

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.primary} />}
    >
      <View style={styles.headerWrap}>
        <Text style={styles.greeting}>Xin chào, {user?.name}</Text>
        {companyName ? <Text style={styles.company}>Công ty · {companyName}</Text> : null}
        <Text style={styles.sub}>Theo dõi công việc công ty theo thời gian thực</Text>
      </View>

      <View style={styles.grid2}>
        <Card style={[styles.statCard, { backgroundColor: colors.secondary }]}>
          <View style={styles.statHead}>
            <View style={[styles.statIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
              <ClipboardIcon size={18} color={colors.primaryDark} />
            </View>
          </View>
          <Text style={styles.statValue}>{stats.totalTasks}</Text>
          <Text style={styles.statLabel}>Tổng công việc</Text>
        </Card>
        <Card style={[styles.statCard, { backgroundColor: hexToRgba(colors.info, 0.16) }]}>
          <View style={styles.statHead}>
            <View style={[styles.statIconWrap, { backgroundColor: hexToRgba(colors.info, 0.22) }]}>
              <ClockIcon size={18} color={colors.primaryDark} />
            </View>
          </View>
          <Text style={[styles.statValue, { color: colors.primaryDark }]}>{stats.inProgress}</Text>
          <Text style={styles.statLabel}>Đang làm</Text>
        </Card>
        <Card style={[styles.statCard, { backgroundColor: hexToRgba(colors.success, 0.18) }]}>
          <View style={styles.statHead}>
            <View style={[styles.statIconWrap, { backgroundColor: hexToRgba(colors.success, 0.22) }]}>
              <CalendarIcon size={18} color={colors.primaryDark} />
            </View>
          </View>
          <Text style={[styles.statValue, { color: colors.primaryDark }]}>{stats.done}</Text>
          <Text style={styles.statLabel}>Hoàn thành</Text>
        </Card>
        <Card style={[styles.statCard, { backgroundColor: hexToRgba(colors.teal, 0.18) }]}>
          <View style={styles.statHead}>
            <View style={[styles.statIconWrap, { backgroundColor: hexToRgba(colors.teal, 0.22) }]}>
              <FolderIcon size={18} color={colors.primaryDark} />
            </View>
          </View>
          <Text style={styles.statValue}>{stats.totalProjects}</Text>
          <Text style={styles.statLabel}>Tổng dự án</Text>
        </Card>
      </View>

      <SectionTitle>Truy cập nhanh</SectionTitle>
      <View style={styles.grid2}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => openStackRoute('Attendance')}>
          <View style={[styles.quickIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
            <ClockIcon size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle}>Chấm công</Text>
            <Text style={styles.quickSub}>Check in/out hôm nay</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => openStackRoute('Leave')}>
          <View style={[styles.quickIconWrap, { backgroundColor: colors.secondary }]}>
            <CalendarIcon size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle}>Nghỉ phép</Text>
            <Text style={styles.quickSub}>Gửi hoặc duyệt đơn</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => openStackRoute('Reports')}>
          <View style={[styles.quickIconWrap, { backgroundColor: hexToRgba(colors.teal, 0.22) }]}>
            <ClipboardIcon size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle}>Báo cáo NV</Text>
            <Text style={styles.quickSub}>Gửi/feedback báo cáo</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => navigation.navigate('Chat')}>
          <View style={[styles.quickIconWrap, { backgroundColor: hexToRgba(colors.info, 0.22) }]}>
            <ChatIcon size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickTitle}>Giao tiếp</Text>
            <Text style={styles.quickSub}>Kênh nội bộ realtime</Text>
          </View>
        </TouchableOpacity>
      </View>

      <SectionTitle>Việc sắp tới</SectionTitle>
      <Card style={{ backgroundColor: colors.secondary }}>
        {upcomingMeetings.length === 0 && upcomingTasks.length === 0 ? (
          <Text style={styles.emptyText}>Không có việc sắp tới.</Text>
        ) : (
          <>
            {upcomingMeetings.map((m) => (
              <TouchableOpacity key={m._id} style={styles.taskItem} onPress={openMeetings}>
                <View style={[styles.taskDot, styles.meetingDot]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskTitle}>Họp: {m.title}</Text>
                  <Text style={styles.taskMeta}>Bắt đầu: {new Date(m.startAt).toLocaleString('vi-VN')}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {upcomingTasks.map((task) => (
              <View key={task._id} style={styles.taskItem}>
                <View style={styles.taskDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskMeta}>
                    Hạn: {task.dueDate ? new Date(task.dueDate).toLocaleDateString('vi-VN') : 'Chưa đặt'}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    marginTop: 2,
    marginBottom: 4,
    gap: 2,
  },
  company: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  greeting: {
    fontSize: 24,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
  },
  grid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '48.6%',
    minHeight: 92,
    justifyContent: 'space-between',
  },
  statHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  statValue: {
    color: colors.text,
    fontSize: 28,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  quickBtn: {
    width: '48.6%',
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitle: {
    fontFamily: 'BeVietnamPro_700Bold',
    color: colors.text,
  },
  quickSub: {
    color: colors.muted,
    fontSize: 12,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  taskDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.primary,
  },
  meetingDot: {
    backgroundColor: colors.teal,
  },
  taskTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  taskMeta: {
    color: colors.muted,
    fontSize: 12,
  },
});

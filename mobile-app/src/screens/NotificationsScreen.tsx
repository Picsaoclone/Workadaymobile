import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { AppButton } from '../components/AppButton';
import { notificationApi } from '../services/api';
import { AppStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { hexToRgba } from '../utils/color';
import type { Notification } from '../types/models';
import { useBadgeStore } from '../store/badgeStore';

type Nav = NativeStackNavigationProp<AppStackParamList>;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractTaskId(link?: string) {
  if (!link) return null;
  const match = link.match(/\/dashboard\/tasks\/([^/]+)/);
  return match?.[1] ?? null;
}

function extractProjectId(link?: string) {
  if (!link) return null;
  const match = link.match(/\/dashboard\/projects\/([^/]+)/);
  return match?.[1] ?? null;
}

function extractChatChannelId(link?: string) {
  if (!link) return null;
  const match = link.match(/\/dashboard\/chat\/channel\/([^/]+)/);
  return match?.[1] ?? null;
}

function extractChatDmContactId(link?: string) {
  if (!link) return null;
  const match = link.match(/\/dashboard\/chat\/dm\/([^/]+)/);
  return match?.[1] ?? null;
}

export function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const setFromNotifications = useBadgeStore((s) => s.setFromNotifications);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await notificationApi.getAll();
      const list = response.data.data || [];
      setNotifications(list);
      setUnreadCount(response.data.unreadCount || 0);
      setFromNotifications(list);
    } catch (error: any) {
      Alert.alert('Không tải được thông báo', error?.response?.data?.message || 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [setFromNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await notificationApi.getAll();
      const list = response.data.data || [];
      setNotifications(list);
      setUnreadCount(response.data.unreadCount || 0);
      setFromNotifications(list);
    } catch (error: any) {
      Alert.alert('Không tải được thông báo', error?.response?.data?.message || 'Vui lòng thử lại.');
    } finally {
      setRefreshing(false);
    }
  }, [setFromNotifications]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleReadAll = useCallback(async () => {
    if (unreadCount <= 0) return;

    try {
      await notificationApi.readAll();
      setNotifications((prev) => {
        const next = prev.map((item) => (item.isRead ? item : { ...item, isRead: true, readAt: new Date().toISOString() }));
        setFromNotifications(next);
        return next;
      });
      setUnreadCount(0);
    } catch (error: any) {
      Alert.alert('Không thể cập nhật', error?.response?.data?.message || 'Vui lòng thử lại.');
    }
  }, [setFromNotifications, unreadCount]);

  const handlePressItem = useCallback(
    async (item: Notification) => {
      if (!item.isRead) {
        setNotifications((prev) => {
          const next = prev.map((n) => (n._id === item._id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n));
          setFromNotifications(next);
          return next;
        });
        setUnreadCount((prev) => Math.max(0, prev - 1));

        try {
          await notificationApi.markRead(item._id);
        } catch {
          // Keep UX responsive; next refresh will reconcile.
        }
      }

      const taskId = extractTaskId(item.link);
      if (taskId) {
        navigation.navigate('TaskDetail', { taskId });
        return;
      }

      const projectId = extractProjectId(item.link);
      if (projectId) {
        navigation.navigate('ProjectDetail', { projectId });
        return;
      }

      const channelId = extractChatChannelId(item.link);
      if (channelId) {
        navigation.navigate('ChatRoom', { channelId });
        return;
      }

      const contactId = extractChatDmContactId(item.link);
      if (contactId) {
        navigation.navigate('ChatRoom', { contactId });
      }
    },
    [navigation, setFromNotifications]
  );

  const unreadLabel = useMemo(() => {
    if (unreadCount <= 0) return 'Không có thông báo chưa đọc';
    return `${unreadCount} chưa đọc`;
  }, [unreadCount]);

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      loading={loading}
      loadingLabel="Đang tải thông báo..."
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <Ionicons name="notifications-outline" size={18} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Thông báo</Text>
          <Text style={styles.subTitle}>{unreadLabel}</Text>
        </View>
      </View>

      <Card style={styles.actionsCard}>
        <AppButton label="Đọc tất cả" onPress={handleReadAll} disabled={unreadCount <= 0} />
      </Card>

      <Card>
        {notifications.length === 0 ? (
          <Text style={styles.empty}>Chưa có thông báo.</Text>
        ) : (
          notifications.map((item, index) => {
            const showDivider = index !== notifications.length - 1;
            const isUnread = !item.isRead;

            return (
              <Pressable
                key={item._id}
                onPress={() => void handlePressItem(item)}
                style={[styles.row, isUnread && styles.rowUnread]}
              >
                <View style={styles.rowLeft}>
                  <View style={[styles.dot, { opacity: isUnread ? 1 : 0 }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={1} style={[styles.rowTitle, isUnread && styles.rowTitleUnread]}>
                      {item.title}
                    </Text>
                    <Text numberOfLines={2} style={styles.rowMessage}>
                      {item.message}
                    </Text>
                    <Text style={styles.rowTime}>{formatDateTime(item.createdAt)}</Text>
                  </View>
                </View>

                <Ionicons name="chevron-forward" size={18} color={colors.muted} />

                {showDivider ? <View style={styles.divider} /> : null}
              </Pressable>
            );
          })
        )}
      </Card>
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
  subTitle: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  actionsCard: {
    paddingBottom: 10,
  },
  empty: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    textAlign: 'center',
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    position: 'relative',
  },
  rowUnread: {
    backgroundColor: hexToRgba(colors.primary, 0.08),
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 14,
  },
  rowTitleUnread: {
    color: colors.primaryDark,
  },
  rowMessage: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  rowTime: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
  },
  divider: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: hexToRgba(colors.border, 0.12),
  },
});

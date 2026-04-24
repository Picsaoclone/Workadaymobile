import React, { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { colors } from '../theme/colors';
import { channelApi, userApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { AppStackParamList } from '../navigation/types';
import { AuthUser, Channel } from '../types/models';
import { permissionRoleLabel } from '../utils/role';

export function ChannelMembersScreen() {
  const route = useRoute<RouteProp<AppStackParamList, 'ChannelMembers'>>();
  const channelId = route.params?.channelId;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);

  const load = useCallback(async () => {
    if (!channelId) return;

    setRefreshing(true);
    try {
      const [channelRes, userRes] = await Promise.all([channelApi.getAll(), userApi.getAll()]);
      const channels = channelRes.data.data || [];
      const found = channels.find((c) => c._id === channelId) || null;

      setChannel(found);
      setUsers(userRes.data.data || []);
    } catch (error) {
      Alert.alert('Không tải được thành viên', getApiErrorMessage(error));
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [channelId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const memberIdSet = useMemo(() => {
    const raw = channel?.memberIds || [];
    return new Set(raw.map((id) => String(id)));
  }, [channel?.memberIds]);

  const members = useMemo(() => {
    const list = (users || []).filter((u) => memberIdSet.has(u._id));
    return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  }, [memberIdSet, users]);

  const getInitials = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[parts.length - 2][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  };

  const subtitle = channel?.type === 'dm' ? 'Chat riêng' : channel?.type === 'private' ? 'Nhóm riêng tư' : 'Nhóm công khai';

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      loading={loading}
      loadingLabel="Đang tải danh sách thành viên..."
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primaryDark} />}
    >
      <Card>
        <Text style={styles.title}>{channel?.name ? `# ${channel.name}` : 'Thành viên nhóm'}</Text>
        <Text style={styles.meta}>
          {subtitle} · {members.length} thành viên
        </Text>
      </Card>

      <Card>
        {members.length === 0 ? (
          <Text style={styles.emptyText}>Chưa có thành viên.</Text>
        ) : (
          <View style={styles.list}>
            {members.map((member) => (
              <View key={member._id} style={styles.row}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{getInitials(member.name || 'NA')}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{member.name}</Text>
                  <Text style={styles.subline}>
                    {member.position || permissionRoleLabel(member.role) || member.email}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  meta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
  },
  name: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
  },
  subline: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    marginTop: 2,
  },
});

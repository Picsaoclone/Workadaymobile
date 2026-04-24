import React, { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppStackParamList } from '../navigation/types';
import { channelApi, messageApi, userApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { AuthUser, Channel, MessageAttachment } from '../types/models';
import { hexToRgba } from '../utils/color';

export function ForwardMessageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppStackParamList, 'ForwardMessage'>>();
  const params: any = route.params;
  const forwardMessage = params?.message as { content: string; type: 'text' | 'file' | 'image' | 'system'; attachments?: MessageAttachment[] };

  const user = useAuthStore((state) => state.user);

  const [viewMode, setViewMode] = useState<'groups' | 'contacts'>('groups');
  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [searchText, setSearchText] = useState('');
  const [sending, setSending] = useState(false);

  const keyword = searchText.trim().toLowerCase();

  const userMap = useMemo(() => {
    const map: Record<string, AuthUser> = {};
    (users || []).forEach((u) => {
      map[u._id] = u;
    });
    return map;
  }, [users]);

  const groupChannels = useMemo(() => {
    return (channels || [])
      .filter((c) => c.type !== 'dm')
      .filter((c) => {
        if (!keyword) return true;
        return String(c.name || '').toLowerCase().includes(keyword);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  }, [channels, keyword]);

  const contacts = useMemo(() => {
    const myId = user?._id;
    return (users || [])
      .filter((u) => u._id !== myId)
      .filter((u) => {
        if (!keyword) return true;
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const phone = (u.phone || '').toLowerCase();
        const position = (u.position || '').toLowerCase();
        return name.includes(keyword) || email.includes(keyword) || phone.includes(keyword) || position.includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [keyword, user?._id, users]);

  const loadTargets = useCallback(async () => {
    setRefreshing(true);
    try {
      const [channelRes, userRes] = await Promise.all([channelApi.getAll(), userApi.getAll()]);
      setChannels(channelRes.data.data || []);
      setUsers(userRes.data.data || []);
    } catch (error) {
      Alert.alert('Không tải được danh sách', getApiErrorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadTargets();
    }, [loadTargets])
  );

  const getInitials = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[parts.length - 2][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  };

  const resolveDmChannelId = async (contactId: string, contactName: string) => {
    const myId = user?._id;
    if (!myId) throw new Error('Thiếu thông tin người dùng');

    const existed = (channels || []).find((c) => {
      if (c.type !== 'dm') return false;
      const candidates: string[] = Array.isArray(c.dmUserIds) ? (c.dmUserIds as any) : c.memberIds;
      if (candidates.length === 2) {
        return candidates.includes(myId) && candidates.includes(contactId);
      }
      return c.memberIds.includes(myId) && c.memberIds.includes(contactId);
    });
    if (existed) return existed._id;

    const createRes = await channelApi.create({
      name: `DM · ${contactName}`,
      type: 'dm',
      memberIds: [contactId],
      dmUserIds: [myId, contactId],
    });
    const created = createRes.data.data;
    setChannels((prev) => {
      const list = prev || [];
      if (list.some((c) => c._id === created._id)) return list;
      return [created, ...list];
    });
    return created._id;
  };

  const sendForwardToChannel = async (channelId: string) => {
    if (!forwardMessage) return;
    if (forwardMessage.type === 'system') {
      Alert.alert('Không thể chuyển tiếp', 'Tin nhắn hệ thống không hỗ trợ chuyển tiếp.');
      return;
    }

    try {
      setSending(true);
      const response = await messageApi.send({
        channelId,
        content: forwardMessage.content,
        type: forwardMessage.type,
        attachments: forwardMessage.attachments || [],
      });
      return response.data.data;
    } finally {
      setSending(false);
    }
  };

  const forwardPreview = useMemo(() => {
    if (!forwardMessage) return null;
    const attachCount = forwardMessage.attachments?.length || 0;
    const attachLabel = attachCount > 0 ? `${attachCount} đính kèm` : null;
    const typeLabel = forwardMessage.type === 'image' ? 'Ảnh' : forwardMessage.type === 'file' ? 'Tệp' : 'Tin nhắn';
    return { typeLabel, attachLabel, text: forwardMessage.content };
  }, [forwardMessage]);

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadTargets} tintColor={colors.primaryDark} />}
    >
      <Card>
        <View style={styles.pageTitleRow}>
          <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
            <Ionicons name="arrow-redo-outline" size={18} color={colors.primaryDark} />
          </View>
          <Text style={styles.title}>Chuyển tiếp</Text>
        </View>
        {forwardPreview ? (
          <View style={styles.previewWrap}>
            <Text style={styles.previewMeta}>
              {forwardPreview.typeLabel}
              {forwardPreview.attachLabel ? ` · ${forwardPreview.attachLabel}` : ''}
            </Text>
            <Text numberOfLines={3} style={styles.previewText}>
              {forwardPreview.text}
            </Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Tìm kiếm</Text>
          <TouchableOpacity onPress={() => void loadTargets()} style={styles.refreshBtn}>
            <Ionicons name="refresh" size={15} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Tìm kênh hoặc đồng nghiệp..."
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
        </View>
      </Card>

      <Card>
        <View style={styles.switchWrap}>
          <Pressable
            onPress={() => setViewMode('groups')}
            style={[styles.switchBtn, viewMode === 'groups' ? styles.switchActive : undefined]}
          >
            <Text style={[styles.switchText, viewMode === 'groups' ? styles.switchTextActive : undefined]}>Nhóm</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode('contacts')}
            style={[styles.switchBtn, viewMode === 'contacts' ? styles.switchActive : undefined]}
          >
            <Text style={[styles.switchText, viewMode === 'contacts' ? styles.switchTextActive : undefined]}>Danh bạ</Text>
          </Pressable>
        </View>
      </Card>

      {viewMode === 'groups' ? (
        <Card>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Kênh nhóm</Text>
          </View>

          {groupChannels.length === 0 ? (
            <Text style={styles.empty}>Không có kênh nào.</Text>
          ) : (
            groupChannels.map((channel) => (
              <Pressable
                key={channel._id}
                onPress={async () => {
                  if (sending) return;
                  try {
                    const sent = await sendForwardToChannel(channel._id);
                    if (!sent) return;
                    Alert.alert('Đã chuyển tiếp', `Đã gửi tới #${channel.name}`);
                    navigation.navigate('ChatRoom', { channelId: channel._id, channelName: channel.name });
                  } catch (error: any) {
                    Alert.alert('Chuyển tiếp thất bại', getApiErrorMessage(error));
                  }
                }}
                style={styles.channelRow}
              >
                <View style={[styles.channelIcon, { backgroundColor: hexToRgba(colors.primary, 0.16) }]}>
                  <Text style={styles.channelIconText}>#</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
                  <Text style={styles.channelMeta}>{(channel.memberIds?.length || 0)} thành viên</Text>
                </View>

                <Ionicons name="chevron-forward" size={17} color={colors.muted} />
              </Pressable>
            ))
          )}
        </Card>
      ) : null}

      {viewMode === 'contacts' ? (
        <Card>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Danh bạ</Text>
          </View>

          {contacts.length === 0 ? (
            <Text style={styles.empty}>Không có nhân sự phù hợp.</Text>
          ) : (
            contacts.map((contact) => (
              <Pressable
                key={contact._id}
                onPress={async () => {
                  if (sending) return;
                  try {
                    const dmChannelId = await resolveDmChannelId(contact._id, contact.name);
                    const sent = await sendForwardToChannel(dmChannelId);
                    if (!sent) return;
                    Alert.alert('Đã chuyển tiếp', `Đã gửi tới ${contact.name}`);
                    navigation.navigate('ChatRoom', { contactId: contact._id, contactName: contact.name });
                  } catch (error: any) {
                    Alert.alert('Chuyển tiếp thất bại', getApiErrorMessage(error));
                  }
                }}
                style={styles.dmRow}
              >
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{getInitials(contact.name)}</Text>
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text numberOfLines={1} style={styles.contactName}>{contact.name}</Text>
                  <Text numberOfLines={1} style={styles.contactEmail}>{contact.email}</Text>
                </View>

                <Ionicons name="chevron-forward" size={17} color={colors.muted} />
              </Pressable>
            ))
          )}
        </Card>
      ) : null}

      {sending ? (
        <Card>
          <Text style={styles.sendingText}>Đang chuyển tiếp...</Text>
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
  title: {
    fontSize: 24,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  previewWrap: {
    marginTop: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.white,
    gap: 6,
  },
  previewMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  previewText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 16,
  },
  refreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  searchWrap: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
    paddingVertical: 8,
  },
  switchWrap: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  switchBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  switchActive: {
    backgroundColor: colors.secondary,
  },
  switchText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  switchTextActive: {
    color: colors.primaryDark,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelIconText: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  channelName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 15,
  },
  channelMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  dmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },
  contactName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 15,
  },
  contactEmail: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  sendingText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
});

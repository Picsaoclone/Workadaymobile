import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { Screen } from '../components/Screen';
import { colors } from '../theme/colors';
import { channelApi, friendApi, notificationApi, userApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { AppStackParamList } from '../navigation/types';
import { AuthUser, Channel } from '../types/models';
import { useAuthStore } from '../store/authStore';
import { useBadgeStore } from '../store/badgeStore';
import { hexToRgba } from '../utils/color';
import { ChatIcon } from '../components/SvgIcons';
import { getRealtimeSocket } from '../services/realtimeSingleton';
import type { Message } from '../types/models';

export function CommunicationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  const unreadChatLinks = useBadgeStore((s) => s.unreadChatLinks);
  const setBadgesFromNotifications = useBadgeStore((s) => s.setFromNotifications);

  const [viewMode, setViewMode] = useState<'groups' | 'contacts'>('groups');

  const [refreshing, setRefreshing] = useState(false);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [searchText, setSearchText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [createMemberPickerOpen, setCreateMemberPickerOpen] = useState(false);
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [addMembersChannelId, setAddMembersChannelId] = useState<string | null>(null);
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);

  const [friendPhone, setFriendPhone] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupUser, setLookupUser] = useState<AuthUser | null>(null);
  const [friendIncoming, setFriendIncoming] = useState<Array<{ _id: string; createdAt?: string; fromUser: AuthUser }>>([]);
  const [friendOutgoing, setFriendOutgoing] = useState<Array<{ _id: string; createdAt?: string; toUser: AuthUser }>>([]);
  const [friends, setFriends] = useState<AuthUser[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // unreadChatLinks is sourced from badgeStore so it updates immediately after read/unread events.

  const keyword = searchText.trim().toLowerCase();

  const userMap = useMemo(() => {
    const map: Record<string, AuthUser> = {};
    users.forEach((u) => {
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

  const dmChannels = useMemo(() => {
    const myId = user?._id;
    if (!myId) return [];
    const list = (channels || [])
      .filter((c) => c.type === 'dm')
      .map((c) => {
        const candidates: string[] = Array.isArray(c.dmUserIds) ? c.dmUserIds : c.memberIds;
        const otherUserId = (candidates || []).find((id: string) => id && id !== myId) || null;
        const otherUser = otherUserId ? userMap[otherUserId] : null;
        return { channel: c, otherUserId, otherUser };
      })
      .filter((item) => {
        if (!keyword) return true;
        const name = (item.otherUser?.name || '').toLowerCase();
        const email = (item.otherUser?.email || '').toLowerCase();
        return name.includes(keyword) || email.includes(keyword);
      })
      .sort((a, b) => (a.otherUser?.name || '').localeCompare((b.otherUser?.name || ''), 'vi'));

    // Defensive de-duplication in case legacy data still contains multiple DM channels for the same user pair.
    const bestByOther = new Map<string, any>();
    for (const item of list) {
      const key = String(item.otherUserId || '');
      if (!key) continue;
      const existing = bestByOther.get(key);
      if (!existing) {
        bestByOther.set(key, item);
        continue;
      }
      const aTime = item.channel?.lastMessageAt ? new Date(item.channel.lastMessageAt).getTime() : 0;
      const bTime = existing.channel?.lastMessageAt ? new Date(existing.channel.lastMessageAt).getTime() : 0;
      if (aTime >= bTime) bestByOther.set(key, item);
    }
    return Array.from(bestByOther.values());
  }, [channels, keyword, user?._id, userMap]);

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

  const loadConversations = useCallback(async () => {
    setRefreshing(true);
    try {
      const [channelRes, userRes, notifRes] = await Promise.all([
        channelApi.getAll(),
        userApi.getAll(),
        notificationApi.getAll().catch(() => null as any),
      ]);
      setChannels(channelRes.data.data || []);
      setUsers(userRes.data.data || []);

      const notifs = notifRes?.data?.data || [];
      setBadgesFromNotifications(notifs);

      try {
        const [reqRes, friendsRes] = await Promise.all([friendApi.getRequests(), friendApi.getFriends()]);
        setFriendIncoming(reqRes.data.data?.incoming || []);
        setFriendOutgoing(reqRes.data.data?.outgoing || []);
        setFriends(friendsRes.data.data || []);
      } catch {
        // ignore; friend system is optional for company-only use
      }
    } catch (error) {
      Alert.alert('Không tải được cuộc trò chuyện', getApiErrorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket = getRealtimeSocket(token);

    const truncate = (value: string, maxLen: number) => {
      const clean = String(value || '').trim();
      if (clean.length <= maxLen) return clean;
      return `${clean.slice(0, Math.max(0, maxLen - 1))}…`;
    };

    const onNewMessage = (incoming: Message) => {
      const channelId = String(incoming?.channelId || '').trim();
      if (!channelId) return;

      const attachments = Array.isArray(incoming.attachments) ? incoming.attachments : [];
      const msgType = String(incoming.type || 'text');
      const previewText = attachments.length > 0
        ? (msgType === 'image' ? '(Ảnh)' : '(Tệp)')
        : (truncate(String(incoming.content || ''), 140) || '(Tin nhắn mới)');

      setChannels((prev) => {
        const idx = (prev || []).findIndex((c) => String((c as any)?._id || '') === channelId);
        if (idx < 0) return prev;
        const current = prev[idx] as any;
        const nextItem = {
          ...current,
          lastMessageText: previewText,
          lastMessageAt: String((incoming as any)?.createdAt || new Date().toISOString()),
          lastMessageSenderId: String((incoming as any)?.senderId || ''),
          lastMessageType: msgType,
        };
        const next = [...prev];
        next[idx] = nextItem;
        return next;
      });
    };

    socket.off('new_message', onNewMessage);
    socket.on('new_message', onNewMessage);

    return () => {
      socket.off('new_message', onNewMessage);
    };
  }, [token]);

  const handleLookupFriend = useCallback(async () => {
    const phone = friendPhone.trim();
    if (!phone) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập số điện thoại.');
      return;
    }

    setLookupLoading(true);
    try {
      const res = await friendApi.lookup(phone);
      setLookupUser(res.data.data || null);
    } catch (error) {
      setLookupUser(null);
      Alert.alert('Không tìm thấy', getApiErrorMessage(error));
    } finally {
      setLookupLoading(false);
    }
  }, [friendPhone]);

  const refreshFriendData = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const [reqRes, friendsRes] = await Promise.all([friendApi.getRequests(), friendApi.getFriends()]);
      setFriendIncoming(reqRes.data.data?.incoming || []);
      setFriendOutgoing(reqRes.data.data?.outgoing || []);
      setFriends(friendsRes.data.data || []);
    } catch (error) {
      Alert.alert('Không tải được danh sách bạn', getApiErrorMessage(error));
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const handleSendFriendRequest = useCallback(async () => {
    const phone = friendPhone.trim();
    if (!phone) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập số điện thoại.');
      return;
    }

    try {
      setFriendsLoading(true);
      await friendApi.sendRequest(phone);
      Alert.alert('Thành công', 'Đã gửi yêu cầu kết bạn.');
      await refreshFriendData();
    } catch (error) {
      Alert.alert('Gửi yêu cầu thất bại', getApiErrorMessage(error));
    } finally {
      setFriendsLoading(false);
    }
  }, [friendPhone, refreshFriendData]);

  const handleAcceptFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        setFriendsLoading(true);
        await friendApi.accept(requestId);
        await refreshFriendData();
      } catch (error) {
        Alert.alert('Không thể chấp nhận', getApiErrorMessage(error));
      } finally {
        setFriendsLoading(false);
      }
    },
    [refreshFriendData]
  );

  const handleRejectFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        setFriendsLoading(true);
        await friendApi.reject(requestId);
        await refreshFriendData();
      } catch (error) {
        Alert.alert('Không thể từ chối', getApiErrorMessage(error));
      } finally {
        setFriendsLoading(false);
      }
    },
    [refreshFriendData]
  );

  useFocusEffect(
    useCallback(() => {
      void loadConversations();
    }, [loadConversations])
  );

  const getInitials = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[parts.length - 2][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  };

  const startPhoneCall = async (contact: AuthUser) => {
    const rawPhone = (contact.phone || '').trim();
    const phone = rawPhone.replace(/\s+/g, '');
    if (!phone) {
      Alert.alert('Không thể gọi', 'Liên hệ này chưa có số điện thoại.');
      return;
    }

    const url = `tel:${phone}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Không thể gọi', 'Thiết bị không hỗ trợ mở ứng dụng điện thoại.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Không thể gọi', 'Vui lòng thử lại.');
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên nhóm.');
      return;
    }
    try {
      setCreatingGroup(true);
      const response = await channelApi.create({
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || undefined,
        type: 'public',
        memberIds: newGroupMemberIds,
      });
      const created = response.data.data;
      setChannels((prev) => {
        const list = prev || [];
        if (list.some((c: any) => c._id === created._id)) return list;
        return [created, ...list];
      });
      setNewGroupName('');
      setNewGroupDesc('');
      setNewGroupMemberIds([]);
      setCreateMemberPickerOpen(false);
      setShowCreateGroup(false);
    } catch (error: any) {
      Alert.alert('Tạo nhóm thất bại', getApiErrorMessage(error));
    } finally {
      setCreatingGroup(false);
    }
  };

  const toggleIdInList = (list: string[], id: string) => {
    if (list.includes(id)) return list.filter((x) => x !== id);
    return [...list, id];
  };

  const selectedAddChannel = useMemo(() => {
    if (!addMembersChannelId) return null;
    return (channels || []).find((c) => c._id === addMembersChannelId) || null;
  }, [addMembersChannelId, channels]);

  const addMemberCandidates = useMemo(() => {
    const myId = user?._id;
    const existing = new Set((selectedAddChannel?.memberIds || []).map((id) => String(id)));
    return (users || [])
      .filter((u) => u._id !== myId)
      .filter((u) => !existing.has(u._id))
      .filter((u) => {
        if (!keyword) return true;
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const phone = (u.phone || '').toLowerCase();
        const position = (u.position || '').toLowerCase();
        return name.includes(keyword) || email.includes(keyword) || phone.includes(keyword) || position.includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [keyword, selectedAddChannel?.memberIds, user?._id, users]);

  const handleAddMembers = async () => {
    if (!addMembersChannelId) return;
    if (addMemberIds.length === 0) {
      Alert.alert('Chưa chọn thành viên', 'Vui lòng chọn ít nhất 1 người để thêm vào nhóm.');
      return;
    }

    try {
      setAddingMembers(true);
      const response = await channelApi.addMembers(addMembersChannelId, addMemberIds);
      const updated = response.data.data;
      setChannels((prev) => (prev || []).map((c) => (c._id === updated._id ? updated : c)));
      setAddMemberIds([]);
      setAddMembersChannelId(null);
    } catch (error: any) {
      Alert.alert('Thêm thành viên thất bại', getApiErrorMessage(error));
    } finally {
      setAddingMembers(false);
    }
  };

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadConversations} tintColor={colors.primaryDark} />}
    >
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <ChatIcon size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.title}>Cuộc trò chuyện</Text>
      </View>
      <Text style={styles.subtitle}>Kênh nhóm theo công ty/dự án và chat riêng 1-1.</Text>

      <Card>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Tìm kiếm</Text>
          <TouchableOpacity onPress={() => void loadConversations()} style={styles.refreshBtn}>
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
        <>
          <Card>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Kênh nhóm</Text>
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={() => setShowCreateGroup((v) => !v)} style={styles.refreshBtn}>
                  <Ionicons name={showCreateGroup ? 'close' : 'add'} size={16} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {showCreateGroup ? (
              <View style={styles.createGroupWrap}>
                <AppInput label="Tên nhóm" value={newGroupName} onChangeText={setNewGroupName} placeholder="VD: Quảng cáo marketing" />
                <AppInput label="Mô tả (tuỳ chọn)" value={newGroupDesc} onChangeText={setNewGroupDesc} placeholder="VD: Bàn về chiến lược" />

                <View style={styles.memberHeaderRow}>
                  <Text style={styles.memberHeaderLabel}>Thành viên</Text>
                  <TouchableOpacity
                    onPress={() => setCreateMemberPickerOpen((v) => !v)}
                    style={styles.memberHeaderBtn}
                  >
                    <Ionicons name={createMemberPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text} />
                    <Text style={styles.memberHeaderBtnText}>{newGroupMemberIds.length} đã chọn</Text>
                  </TouchableOpacity>
                </View>

                {createMemberPickerOpen ? (
                  <View style={styles.memberPickerWrap}>
                    <ScrollView style={styles.memberPickerScroll}>
                      {(users || []).filter((u) => u._id !== user?._id).map((u) => {
                        const checked = newGroupMemberIds.includes(u._id);
                        return (
                          <Pressable
                            key={`new-member-${u._id}`}
                            onPress={() => setNewGroupMemberIds((prev) => toggleIdInList(prev, u._id))}
                            style={styles.memberRow}
                          >
                            <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18} color={colors.primaryDark} />
                            <View style={{ flex: 1 }}>
                              <Text numberOfLines={1} style={styles.memberName}>{u.name}</Text>
                              <Text numberOfLines={1} style={styles.memberSub}>{u.email}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}

                <AppButton label={creatingGroup ? 'Đang tạo...' : 'Tạo nhóm'} onPress={handleCreateGroup} loading={creatingGroup} />
              </View>
            ) : null}

            {groupChannels.length === 0 ? (
              <Text style={styles.empty}>Chưa có kênh nhóm nào.</Text>
            ) : (
              groupChannels.map((channel: any) => {
                const isAdmin = !!user?._id && Array.isArray(channel.adminIds) && channel.adminIds.includes(user._id);
                const addOpen = addMembersChannelId === channel._id;

                const groupUnreadLink = `/dashboard/chat/channel/${String(channel._id)}`;
                const groupHasUnread = unreadChatLinks.has(groupUnreadLink);
                const previewSenderId = String(channel?.lastMessageSenderId || '');
                const previewSenderName = previewSenderId
                  ? (previewSenderId === user?._id ? 'Bạn' : (userMap[previewSenderId]?.name || 'Thành viên'))
                  : '';
                const rawPreviewText = String(channel?.lastMessageText || '').trim();
                const previewText = rawPreviewText ? `${previewSenderName ? `${previewSenderName}: ` : ''}${rawPreviewText}` : 'Chưa có tin nhắn.';

                return (
                  <View key={channel._id}>
                    <Pressable
                      onPress={() => navigation.navigate('ChatRoom', { channelId: channel._id, channelName: channel.name })}
                      style={styles.channelRow}
                    >
                      <View style={[styles.channelIcon, { backgroundColor: hexToRgba(colors.primary, 0.16) }]}>
                        <Text style={styles.channelIconText}>#</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text numberOfLines={1} style={styles.channelName}>{channel.name}</Text>
                        <Text numberOfLines={1} style={[styles.previewText, groupHasUnread ? styles.previewTextUnread : null]}>{previewText}</Text>
                      </View>

                      <View style={styles.channelActions}>
                        {isAdmin ? (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              if (addOpen) {
                                setAddMembersChannelId(null);
                                setAddMemberIds([]);
                              } else {
                                setAddMembersChannelId(channel._id);
                                setAddMemberIds([]);
                              }
                            }}
                            style={styles.actionBtn}
                          >
                            <Ionicons name="person-add-outline" size={16} color={colors.primaryDark} />
                          </Pressable>
                        ) : null}
                        <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                      </View>
                    </Pressable>

                    {addOpen ? (
                      <View style={styles.addMembersWrap}>
                        <Text style={styles.addMembersTitle}>Thêm thành viên</Text>
                        {addMemberCandidates.length === 0 ? (
                          <Text style={styles.empty}>Không còn ai để thêm.</Text>
                        ) : (
                          <View style={styles.memberPickerWrap}>
                            <ScrollView style={styles.memberPickerScroll}>
                              {addMemberCandidates.map((u) => {
                                const checked = addMemberIds.includes(u._id);
                                return (
                                  <Pressable
                                    key={`add-member-${channel._id}-${u._id}`}
                                    onPress={() => setAddMemberIds((prev) => toggleIdInList(prev, u._id))}
                                    style={styles.memberRow}
                                  >
                                    <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={18} color={colors.primaryDark} />
                                    <View style={{ flex: 1 }}>
                                      <Text numberOfLines={1} style={styles.memberName}>{u.name}</Text>
                                      <Text numberOfLines={1} style={styles.memberSub}>{u.email}</Text>
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}

                        <View style={styles.addMembersBtnRow}>
                          <AppButton
                            label={addingMembers ? 'Đang thêm...' : 'Thêm vào nhóm'}
                            onPress={handleAddMembers}
                            loading={addingMembers}
                          />
                          <AppButton
                            label="Hủy"
                            variant="outline"
                            onPress={() => {
                              setAddMembersChannelId(null);
                              setAddMemberIds([]);
                            }}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </Card>

          <Card>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Tin nhắn riêng</Text>
            </View>

            {dmChannels.length === 0 ? (
              <Text style={styles.empty}>Chưa có cuộc trò chuyện riêng.</Text>
            ) : (
              dmChannels.map((item: any) => {
                const contact: AuthUser | null = item.otherUser || null;
                if (!item.otherUserId) return null;

                const dmUnreadLink = `/dashboard/chat/dm/${String(item.otherUserId)}`;
                const dmChannelLink = item.channel?._id ? `/dashboard/chat/channel/${String(item.channel._id)}` : '';
                const dmHasUnread = unreadChatLinks.has(dmUnreadLink) || (dmChannelLink ? unreadChatLinks.has(dmChannelLink) : false);
                const dmPreview = String(item.channel?.lastMessageText || '').trim() || '';
                const dmPreviewText = dmPreview || (contact?.email || 'Chưa có tin nhắn.');
                return (
                  <Pressable
                    key={item.channel._id}
                    onPress={() => navigation.navigate('ChatRoom', {
                      channelId: item.channel._id,
                      channelName: item.channel?.name,
                      contactId: item.otherUserId,
                      contactName: contact?.name,
                    })}
                    style={styles.dmRow}
                  >
                    <View style={styles.avatarCircle}>
                      <Text style={styles.avatarText}>{getInitials(contact?.name || 'NA')}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text numberOfLines={1} style={styles.contactName}>{contact?.name || 'Tin nhắn riêng'}</Text>
                      <Text numberOfLines={1} style={[styles.previewText, dmHasUnread ? styles.previewTextUnread : null]}>{dmPreviewText}</Text>
                    </View>

                    {contact ? (
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            void startPhoneCall(contact);
                          }}
                          style={styles.actionBtn}
                        >
                          <Ionicons name="call-outline" size={16} color={colors.primaryDark} />
                        </Pressable>
                      </View>
                    ) : null}

                    <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                  </Pressable>
                );
              })
            )}
          </Card>
        </>
      ) : null}

      {viewMode === 'contacts' ? (
        <>
          <Card>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Kết bạn ngoài công ty</Text>
              <TouchableOpacity onPress={() => void refreshFriendData()} style={styles.refreshBtn}>
                <Ionicons name="refresh" size={15} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.helperText}>Nhập số điện thoại để gửi yêu cầu kết bạn (giống Zalo).</Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              <AppInput
                label="Số điện thoại"
                value={friendPhone}
                onChangeText={(text) => {
                  setFriendPhone(text);
                  setLookupUser(null);
                }}
                placeholder="VD: 0912345678"
              />
              <View style={styles.actionInlineRow}>
                <AppButton label={lookupLoading ? 'Đang tìm...' : 'Tìm'} onPress={() => void handleLookupFriend()} loading={lookupLoading} style={styles.flexBtn} />
                <AppButton
                  label={friendsLoading ? 'Đang gửi...' : 'Gửi lời mời'}
                  onPress={() => void handleSendFriendRequest()}
                  loading={friendsLoading}
                  variant="outline"
                  style={styles.flexBtn}
                />
              </View>
            </View>

            {lookupUser ? (
              <View style={styles.lookupResult}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{getInitials(lookupUser.name || 'NA')}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={styles.contactName}>{lookupUser.name}</Text>
                  <Text numberOfLines={1} style={styles.contactEmail}>{lookupUser.phone || ''}</Text>
                  <Text style={styles.lookupHint}>
                    {lookupUser.companyId && user?.companyId && String(lookupUser.companyId) === String(user.companyId)
                      ? 'Cùng công ty'
                      : 'Ngoài công ty'}
                  </Text>
                </View>
              </View>
            ) : null}
          </Card>

          <Card>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Yêu cầu kết bạn</Text>
            </View>

            {friendIncoming.length === 0 && friendOutgoing.length === 0 ? (
              <Text style={styles.empty}>Chưa có yêu cầu nào.</Text>
            ) : (
              <>
                {friendIncoming.length > 0 ? (
                  <>
                    <Text style={styles.subSectionTitle}>Đến</Text>
                    {friendIncoming.map((r) => {
                      const from = r.fromUser;
                      return (
                        <View key={r._id} style={styles.friendReqRow}>
                          <View style={styles.avatarCircle}>
                            <Text style={styles.avatarText}>{getInitials(from?.name || 'NA')}</Text>
                          </View>
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text numberOfLines={1} style={styles.contactName}>{from?.name || 'Người dùng'}</Text>
                            <Text numberOfLines={1} style={styles.contactEmail}>{from?.phone || from?.email || ''}</Text>
                          </View>
                          <View style={styles.reqActionsRow}>
                            <Pressable
                              onPress={() => void handleAcceptFriendRequest(r._id)}
                              style={styles.smallActionBtn}
                            >
                              <Ionicons name="checkmark" size={18} color={colors.primaryDark} />
                            </Pressable>
                            <Pressable
                              onPress={() => void handleRejectFriendRequest(r._id)}
                              style={styles.smallActionBtn}
                            >
                              <Ionicons name="close" size={18} color={colors.danger || colors.primaryDark} />
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </>
                ) : null}

                {friendOutgoing.length > 0 ? (
                  <>
                    <Text style={styles.subSectionTitle}>Đã gửi</Text>
                    {friendOutgoing.map((r) => {
                      const to = r.toUser;
                      return (
                        <View key={r._id} style={styles.friendReqRow}>
                          <View style={styles.avatarCircle}>
                            <Text style={styles.avatarText}>{getInitials(to?.name || 'NA')}</Text>
                          </View>
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text numberOfLines={1} style={styles.contactName}>{to?.name || 'Người dùng'}</Text>
                            <Text numberOfLines={1} style={styles.contactEmail}>{to?.phone || to?.email || ''}</Text>
                          </View>
                          <Text style={styles.pendingPill}>Đang chờ</Text>
                        </View>
                      );
                    })}
                  </>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Bạn bè</Text>
            </View>

            {friends.length === 0 ? (
              <Text style={styles.empty}>Chưa có bạn bè nào.</Text>
            ) : (
              friends.map((f) => (
                <Pressable
                  key={f._id}
                  onPress={() => navigation.navigate('ChatRoom', { contactId: f._id, contactName: f.name })}
                  style={styles.dmRow}
                >
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{getInitials(f.name || 'NA')}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text numberOfLines={1} style={styles.contactName}>{f.name}</Text>
                    <Text numberOfLines={1} style={styles.contactEmail}>{f.phone || f.email}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                </Pressable>
              ))
            )}
          </Card>

          <Card>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Danh bạ công ty</Text>
            </View>

            {contacts.length === 0 ? (
              <Text style={styles.empty}>Không có nhân sự phù hợp.</Text>
            ) : (
              contacts.map((contact) => (
                <Pressable
                  key={contact._id}
                  onPress={() => navigation.navigate('ChatRoom', { contactId: contact._id, contactName: contact.name })}
                  style={styles.dmRow}
                >
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>{getInitials(contact.name)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text numberOfLines={1} style={styles.contactName}>{contact.name}</Text>
                    <Text numberOfLines={1} style={styles.contactRole}>{contact.position || contact.role}</Text>
                    <Text numberOfLines={1} style={styles.contactEmail}>{contact.email}</Text>
                    {contact.phone ? <Text numberOfLines={1} style={styles.contactPhone}>{contact.phone}</Text> : null}
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        void startPhoneCall(contact);
                      }}
                      style={styles.actionBtn}
                    >
                      <Ionicons name="call-outline" size={16} color={colors.primaryDark} />
                    </Pressable>
                  </View>

                  <Ionicons name="chevron-forward" size={17} color={colors.muted} />
                </Pressable>
              ))
            )}
          </Card>
        </>
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
    fontSize: 27,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  subtitle: {
    color: colors.muted,
    marginTop: -4,
    marginBottom: 2,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  helperText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
    marginTop: 4,
  },
  actionInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flexBtn: {
    flex: 1,
  },
  lookupResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lookupHint: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  subSectionTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 13,
    marginTop: 10,
    marginBottom: 4,
  },
  friendReqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reqActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  pendingPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  headerActions: {
    flexDirection: 'row',
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
  createGroupWrap: {
    marginTop: 10,
    gap: 12,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberHeaderLabel: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  memberHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
  memberHeaderBtnText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  memberPickerWrap: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  memberPickerScroll: {
    maxHeight: 220,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberName: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  memberSub: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    marginTop: 1,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  channelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addMembersWrap: {
    paddingTop: 4,
    paddingBottom: 8,
    gap: 10,
  },
  addMembersTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    paddingTop: 6,
  },
  addMembersBtnRow: {
    gap: 10,
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
  contactRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 6,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
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
  contactRole: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  contactEmail: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  previewText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  previewTextUnread: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
  },
  contactPhone: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  teamCallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  teamCallTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 15,
  },
  teamCallSub: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
});

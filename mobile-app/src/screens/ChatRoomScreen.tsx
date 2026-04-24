import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import {
  Alert,
  Dimensions,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Socket } from 'socket.io-client';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppStackParamList } from '../navigation/types';
import { channelApi, messageApi, notificationApi, uploadApi, userApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { getRealtimeSocket } from '../services/realtimeSingleton';
import { useAuthStore } from '../store/authStore';
import { useBadgeStore } from '../store/badgeStore';
import { colors } from '../theme/colors';
import { AuthUser, Channel, Message, MessageAttachment } from '../types/models';
import { hexToRgba } from '../utils/color';

export function ChatRoomScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppStackParamList, 'ChatRoom'>>();
  const params: any = route.params;
  const contactId: string | undefined = params?.contactId;
  const contactName: string | undefined = params?.contactName;
  const channelIdFromRoute: string | undefined = params?.channelId;
  const channelNameFromRoute: string | undefined = params?.channelName;
  const insets = useSafeAreaInsets();

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const refreshBadges = useBadgeStore((s) => s.refreshFromServer);
  const markChatLinksRead = useBadgeStore((s) => s.markChatLinksRead);

  const [deliveredIds, setDeliveredIds] = useState<Set<string>>(new Set());

  const lastReadByLinkAtRef = useRef(0);

  const socketRef = useRef<Socket | null>(null);
  const selectedChannelRef = useRef<string | null>(null);
  const messageScrollRef = useRef<ScrollView | null>(null);

  const [loading, setLoading] = useState(true);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [contact, setContact] = useState<AuthUser | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [composer, setComposer] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<(MessageAttachment & { resourceType?: 'image' | 'file'; localUri?: string })[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

  const normalizeId = (value: any) => String(value ?? '');

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      messageScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const startPhoneCall = useCallback(async () => {
    if (!contactId) return;

    const rawPhone = String(contact?.phone || '').trim();
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
  }, [contact?.phone, contactId]);

  useLayoutEffect(() => {
    // Only show Call in 1-1 chats (DM).
    if (!contactId) {
      navigation.setOptions({ headerRight: undefined });
      return;
    }

    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => void startPhoneCall()}
          accessibilityRole="button"
          accessibilityLabel="Gọi điện"
          hitSlop={10}
          style={{ paddingHorizontal: 8, paddingVertical: 6 }}
        >
          <Ionicons name="call-outline" size={20} color={colors.primaryDark} />
        </Pressable>
      ),
    });
  }, [colors.primaryDark, contactId, navigation, startPhoneCall]);

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel._id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );

  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((item) => {
      map[item._id] = item.name;
    });
    return map;
  }, [users]);

  useEffect(() => {
    selectedChannelRef.current = selectedChannelId;
  }, [selectedChannelId]);

  const resolveChannelForContact = useCallback(
    (channelList: Channel[]) => {
      const currentUserId = user?._id;
      if (!currentUserId || !contactId) return null;

      return (
        channelList.find((channel) => {
          if (channel.type !== 'dm') return false;
          const dmUserIds = (channel.dmUserIds || []) as unknown as string[];
          if (dmUserIds.length === 2) {
            return dmUserIds.includes(currentUserId) && dmUserIds.includes(contactId);
          }
          // Backward-compat: some dm channels may not have dmUserIds yet.
          return channel.memberIds.includes(currentUserId) && channel.memberIds.includes(contactId);
        }) || null
      );
    },
    [contactId, user?._id]
  );

  const loadMessages = useCallback(async (channelId: string) => {
    try {
      const response = await messageApi.getByChannel(channelId);
      setMessages(response.data.data || []);
    } catch (error: any) {
      Alert.alert('Không tải được hội thoại', getApiErrorMessage(error));
    }
  }, []);

  const initializeRoom = useCallback(async () => {
    if (!user?._id) return;

    setLoading(true);
    try {
      const [channelRes, userRes] = await Promise.all([channelApi.getAll(), userApi.getAll()]);
      const channelData = channelRes.data.data || [];
      const userData = userRes.data.data || [];

      setChannels(channelData);
      setUsers(userData);

      if (channelIdFromRoute) {
        // If navigation provides contactId/contactName (common for DM), preserve it for header.
        if (contactId) {
          const foundContact = userData.find((item) => item._id === contactId) || null;
          setContact(foundContact);

          if (!foundContact) {
            void userApi
              .getById(contactId)
              .then((resp) => setContact(resp.data.data || null))
              .catch(() => undefined);
          }
        } else {
          setContact(null);
        }
        setSelectedChannelId(channelIdFromRoute);
        return;
      }

      if (!contactId) {
        Alert.alert('Không thể mở cuộc trò chuyện', 'Thiếu thông tin liên hệ hoặc kênh chat.');
        setSelectedChannelId(null);
        return;
      }

      let foundContact = userData.find((item) => item._id === contactId) || null;
      setContact(foundContact);

      // If the contact isn't in the company-scoped list (e.g., cross-company friend), fetch it by id.
      if (!foundContact) {
        try {
          const resp = await userApi.getById(contactId);
          foundContact = resp.data.data || null;
          setContact(foundContact);
        } catch {
          // ignore
        }
      }

      const existed = resolveChannelForContact(channelData);
      if (existed) {
        setSelectedChannelId(existed._id);
        return;
      }

      if (!foundContact) {
        Alert.alert('Không tìm thấy liên hệ', 'Liên hệ này không còn trong danh bạ.');
        setSelectedChannelId(null);
        return;
      }

      setCreatingChannel(true);
      const response = await channelApi.create({
        name: `DM · ${foundContact.name}`,
        type: 'dm',
        memberIds: [contactId],
        dmUserIds: [user._id, contactId],
      });

      const nextChannel = response.data.data;
      setChannels((prev) => {
        if (prev.some((item) => item._id === nextChannel._id)) return prev;
        return [nextChannel, ...prev];
      });
      setSelectedChannelId(nextChannel._id);
    } catch (error: any) {
      Alert.alert('Không thể mở cuộc trò chuyện', getApiErrorMessage(error));
    } finally {
      setCreatingChannel(false);
      setLoading(false);
    }
  }, [channelIdFromRoute, contactId, resolveChannelForContact, user?._id]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        await initializeRoom();
        if (cancelled) return;

        // Ensure history is fetched when returning to this screen, even if state
        // (selectedChannelId) doesn't change due to navigation reusing the route.
        const effectiveChannelId = channelIdFromRoute || selectedChannelRef.current;
        if (effectiveChannelId) {
          await loadMessages(effectiveChannelId);
        }
      })();

      // DM backward-compat:
      // - New DM notifications use `/dashboard/chat/dm/<contactId>`
      // - Older builds may have created `/dashboard/chat/channel/<channelId>` even for DM channels
      // Mark both as read when possible so the DM row stops being bold.
      const dmLink = contactId ? `/dashboard/chat/dm/${contactId}` : null;
      const channelLink = channelIdFromRoute ? `/dashboard/chat/channel/${channelIdFromRoute}` : null;

      const linksToRead = [dmLink, channelLink].filter(Boolean) as string[];
      if (linksToRead.length > 0) {
        markChatLinksRead(linksToRead);
        Promise.all(linksToRead.map((link) => notificationApi.readByLink({ link })))
          .then(() => refreshBadges())
          .catch(() => undefined);
      }

      return () => {
        cancelled = true;
      };
    }, [channelIdFromRoute, contactId, initializeRoom, loadMessages, markChatLinksRead, refreshBadges])
  );

  useEffect(() => {
    if (!token) return;

    const socket = getRealtimeSocket(token);
    socketRef.current = socket;

    const onNewMessage = (incoming: Message) => {
      if (incoming.channelId !== selectedChannelRef.current) return;
      const incomingId = normalizeId((incoming as any)?._id);
      setMessages((prev) => {
        if (!incomingId) return prev;
        if (prev.some((item) => normalizeId((item as any)?._id) === incomingId)) return prev;
        return [...prev, incoming];
      });

      // DM delivery receipt: ack receiving messages from the other user.
      const me = String(user?._id || '');
      if (contactId && me && incomingId && String(incoming.senderId || '') !== me) {
        socket.emit('message_received', { messageId: incomingId }, () => undefined);
      }

      // If user is already viewing this chat, immediately mark message notifications as read.
      const now = Date.now();
      if (now - lastReadByLinkAtRef.current < 800) return;
      lastReadByLinkAtRef.current = now;

      const dmLink = contactId ? `/dashboard/chat/dm/${contactId}` : null;
      const channelLink = selectedChannelRef.current ? `/dashboard/chat/channel/${selectedChannelRef.current}` : null;
      const linksToRead = [dmLink, channelLink].filter(Boolean) as string[];

      if (linksToRead.length > 0) {
        markChatLinksRead(linksToRead);
        Promise.all(linksToRead.map((link) => notificationApi.readByLink({ link })))
          .then(() => refreshBadges())
          .catch(() => undefined);
      }
    };

    const onMessageReceived = (evt: any) => {
      if (!contactId) return;
      const messageId = normalizeId(evt?.messageId);
      const channelId = String(evt?.channelId || '');
      if (!messageId) return;
      if (channelId && channelId !== selectedChannelRef.current) return;
      setDeliveredIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
    };

    // Avoid registering duplicate listeners in development/hot reload scenarios.
    socket.off('new_message', onNewMessage);
    socket.on('new_message', onNewMessage);

    socket.off('message_received', onMessageReceived);
    socket.on('message_received', onMessageReceived);

    return () => {
      socket.off('new_message', onNewMessage);
      socket.off('message_received', onMessageReceived);
      socketRef.current = null;
    };
  }, [contactId, token, user?._id]);

  useEffect(() => {
    if (!selectedChannelId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedChannelId);
    socketRef.current?.emit('join_channel', selectedChannelId);

    return () => {
      socketRef.current?.emit('leave_channel', selectedChannelId);
    };
  }, [selectedChannelId, loadMessages]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      scrollToLatest(true);
    }, 80);

    return () => clearTimeout(timeout);
  }, [messages.length, scrollToLatest]);

  useEffect(() => {
    if (keyboardHeight <= 0) return;

    const timeout = setTimeout(() => {
      scrollToLatest(true);
    }, 120);

    return () => clearTimeout(timeout);
  }, [keyboardHeight, scrollToLatest]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const end = event.endCoordinates;
      const reported = end?.height ?? 0;
      const screenY = end?.screenY;
      const screenHeight = Dimensions.get('screen').height;
      const overlap = typeof screenY === 'number' ? Math.max(screenHeight - screenY, 0) : 0;
      setKeyboardHeight(Math.max(reported, overlap));
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const safeDecode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const guessFileName = (uriOrUrl: string, fallback: string) => {
    const clean = String(uriOrUrl || '').split('?')[0];
    const parts = clean.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const decoded = safeDecode(last);
    if (decoded && decoded.includes('.')) return decoded;
    return fallback;
  };

  const getAttachmentDisplayName = (
    att: Partial<MessageAttachment> & { localUri?: string },
    fallback: string
  ) => {
    const name = String(att?.name || '').trim();
    if (name) return name;
    const source = att?.url || att?.localUri || '';
    return guessFileName(source, fallback);
  };

  const openUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Không thể mở file', 'Thiết bị không hỗ trợ mở liên kết này.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Không thể mở file', 'Vui lòng thử lại.');
    }
  };

  const buildCloudinaryDownloadUrl = (url: string, filename: string) => {
    const cleanUrl = String(url || '').split('?')[0];
    const cleanName = String(filename || '').trim() || 'download';
    // For Cloudinary raw uploads, force download and set filename to preserve extension.
    if (!cleanUrl.includes('/raw/upload/')) return url;
    const encodedName = encodeURIComponent(cleanName);
    const [prefix, rest] = cleanUrl.split('/raw/upload/');
    if (!prefix || !rest) return url;
    if (rest.startsWith('fl_attachment')) return cleanUrl;
    return `${prefix}/raw/upload/fl_attachment:${encodedName}/${rest}`;
  };

  const sanitizeFileName = (name: string) => {
    const trimmed = String(name || '').trim();
    // Keep it simple and cross-platform.
    return (trimmed || 'download').replace(/[\\/:*?"<>|]/g, '_');
  };

  const saveLocalFileToAndroid = async (opts: { localUri: string; fileName: string; mimeType: string }) => {
    if (Platform.OS !== 'android') return null;
    try {
      const saf = (LegacyFileSystem as any).StorageAccessFramework;
      if (!saf?.requestDirectoryPermissionsAsync || !saf?.createFileAsync) return null;

      const perm = await saf.requestDirectoryPermissionsAsync();
      if (!perm?.granted) return null;

      const destUri = await saf.createFileAsync(perm.directoryUri, opts.fileName, opts.mimeType || 'application/octet-stream');
      const base64 = await (LegacyFileSystem as any).readAsStringAsync(opts.localUri, { encoding: 'base64' });
      await (LegacyFileSystem as any).writeAsStringAsync(destUri, base64, { encoding: 'base64' });
      return destUri;
    } catch {
      return null;
    }
  };

  const openAttachment = async (
    att: Partial<MessageAttachment> & { resourceType?: string },
    isImage: boolean
  ) => {
    const url = String(att?.url || '').trim();
    if (!url) return;
    if (isImage) {
      await openUrl(url);
      return;
    }

    try {
      const filename = sanitizeFileName(getAttachmentDisplayName(att as any, 'Tệp đính kèm'));
      // When we download ourselves, we should use the original URL for bytes.
      // Some Cloudinary "fl_attachment" URLs may return a response that iOS treats oddly.
      const primaryUrl = url;
      const secondaryUrl = buildCloudinaryDownloadUrl(url, filename) || url;

      const downloadToLocal = async (sourceUrl: string) => {
        // 1) Try new SDK 54 API
        try {
          const baseDir = FileSystem.Paths.cache || FileSystem.Paths.document;
          const destination = new FileSystem.File(baseDir, `${Date.now()}-${filename}`);
          const downloaded = await FileSystem.File.downloadFileAsync(sourceUrl, destination, { idempotent: true });
          return downloaded.uri;
        } catch {
          // 2) Fallback to legacy API (often more reliable in Expo Go)
          const cacheDir = (LegacyFileSystem as any).cacheDirectory || (LegacyFileSystem as any).documentDirectory;
          if (!cacheDir) return null;
          const legacyTarget = `${cacheDir}${Date.now()}-${filename}`;
          const legacyResult = await (LegacyFileSystem as any).downloadAsync(sourceUrl, legacyTarget);
          return legacyResult?.uri || null;
        }
      };

      const verifyNotEmpty = async (fileUri: string | null) => {
        if (!fileUri) return false;
        try {
          const info = await (LegacyFileSystem as any).getInfoAsync(fileUri);
          const size = Number(info?.size || 0);
          return size > 0;
        } catch {
          // If we can't inspect, assume it's ok.
          return true;
        }
      };

      let localUri: string | null = await downloadToLocal(primaryUrl);
      if (!(await verifyNotEmpty(localUri))) {
        localUri = await downloadToLocal(secondaryUrl);
      }

      if (!(await verifyNotEmpty(localUri))) {
        await openUrl(secondaryUrl);
        return;
      }

      if (!localUri) {
        await openUrl(secondaryUrl);
        return;
      }

      if (Platform.OS === 'android') {
        Alert.alert('Tệp đính kèm', filename, [
          {
            text: 'Tải về máy',
            onPress: () => {
              void (async () => {
                const mimeType = String((att as any)?.type || '').trim() || 'application/octet-stream';
                const saved = await saveLocalFileToAndroid({ localUri, fileName: filename, mimeType });
                if (!saved) {
                  Alert.alert('Không thể lưu', 'Thiết bị không hỗ trợ lưu trực tiếp.');
                  return;
                }
                Alert.alert('Đã lưu', 'File đã được lưu trong thư mục bạn chọn.');
              })();
            },
          },
          {
            text: 'Chia sẻ',
            onPress: () => {
              void (async () => {
                const canShare = await Sharing.isAvailableAsync();
                if (canShare) {
                  await Sharing.shareAsync(localUri);
                  return;
                }
                await openUrl(localUri);
              })();
            },
          },
          { text: 'Hủy', style: 'cancel' },
        ]);
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(localUri);
        return;
      }

      await openUrl(localUri);
    } catch (err: any) {
      const detail = String(err?.message || err || '').trim();
      Alert.alert('Không thể tải file', detail || 'Vui lòng thử lại.');
    }
  };

  const handlePickImage = async () => {
    if (!selectedChannelId || loading) return;
    try {
      setUploadingAttachment(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Thiếu quyền truy cập', 'Vui lòng cho phép truy cập thư viện ảnh để gửi ảnh.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 0.85,
      });
      if (result.canceled) return;
      const assets = result.assets || [];
      if (assets.length === 0) return;

      const nextAttachments: (MessageAttachment & { resourceType?: 'image' | 'file'; localUri?: string })[] = [];
      for (const asset of assets.slice(0, 5)) {
        if (!asset?.uri) continue;
        const name =
          (asset as any).fileName ||
          (asset as any).name ||
          guessFileName(asset.uri, `image-${Date.now()}.jpg`);
        const type = (asset as any).mimeType || 'image/jpeg';
        const uploadRes = await uploadApi.uploadImage({ uri: asset.uri, name, type });
        const uploaded = uploadRes.data.data;
        nextAttachments.push({
          url: uploaded.url,
          name: getAttachmentDisplayName({ name: uploaded.name || name, url: uploaded.url, localUri: asset.uri }, 'Ảnh'),
          type: uploaded.type || type,
          size: uploaded.size || 0,
          resourceType: 'image',
          localUri: asset.uri,
        });
      }

      if (nextAttachments.length > 0) {
        setPendingAttachments((prev) => [...prev, ...nextAttachments]);
      }
    } catch (error: any) {
      Alert.alert('Upload ảnh thất bại', getApiErrorMessage(error));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handlePickFile = async () => {
    if (!selectedChannelId || loading) return;
    try {
      setUploadingAttachment(true);
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const assets = result.assets || [];
      if (assets.length === 0) return;

      const nextAttachments: (MessageAttachment & { resourceType?: 'image' | 'file'; localUri?: string })[] = [];
      for (const asset of assets.slice(0, 5)) {
        if (!asset?.uri) continue;
        const name = asset.name || guessFileName(asset.uri, `file-${Date.now()}`);
        const type = asset.mimeType || 'application/octet-stream';
        const uploadRes = await uploadApi.uploadFile({ uri: asset.uri, name, type });
        const uploaded = uploadRes.data.data;
        nextAttachments.push({
          url: uploaded.url,
          name: getAttachmentDisplayName({ name: uploaded.name || name, url: uploaded.url, localUri: asset.uri }, 'Tệp đính kèm'),
          type: uploaded.type || type,
          size: uploaded.size || asset.size || 0,
          resourceType: 'file',
          localUri: asset.uri,
        });
      }

      if (nextAttachments.length > 0) {
        setPendingAttachments((prev) => [...prev, ...nextAttachments]);
      }
    } catch (error: any) {
      Alert.alert('Upload file thất bại', getApiErrorMessage(error));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleSend = async () => {
    if (!selectedChannelId) return;

    const text = composer.trim();
    const attachmentsToSend = pendingAttachments.map(({ localUri: _localUri, ...rest }) => rest);
    const hasAttachments = attachmentsToSend.length > 0;
    if (!text && !hasAttachments) return;

    // For attachment-only messages, keep content empty to avoid showing filenames like IMG_1234.jpg.
    const content = text || '';
    const type: Message['type'] = hasAttachments
      ? (attachmentsToSend.every((a) => (a as any).resourceType === 'image') ? 'image' : 'file')
      : 'text';

    const replyTo = replyToMessage?._id;

    setComposer('');
    setPendingAttachments([]);
    setReplyToMessage(null);

    try {
      const response = await messageApi.send({
        channelId: selectedChannelId,
        content,
        type,
        attachments: attachmentsToSend,
        replyTo,
      });
      const created = response.data.data;
      const createdId = normalizeId((created as any)?._id);
      // If socket is connected, the backend will also emit `new_message`.
      // Dedup by _id to avoid rendering duplicate keys.
      setMessages((prev) => {
        if (!createdId) return prev;
        if (prev.some((m) => normalizeId((m as any)?._id) === createdId)) return prev;
        return [...prev, created];
      });
    } catch (error: any) {
      Alert.alert('Gửi tin nhắn thất bại', getApiErrorMessage(error));
      setComposer(text);
      setPendingAttachments(pendingAttachments);
      setReplyToMessage(replyToMessage);
    }
  };

  const dedupedMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: Message[] = [];
    for (const m of messages) {
      const id = normalizeId((m as any)?._id);
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(m);
    }
    return out;
  }, [messages]);

  const lastMineMessageId = useMemo(() => {
    if (!contactId) return null;
    const me = user?._id;
    if (!me) return null;
    for (let i = dedupedMessages.length - 1; i >= 0; i--) {
      const m = dedupedMessages[i];
      if (m.senderId === me) return normalizeId((m as any)?._id);
    }
    return null;
  }, [contactId, dedupedMessages, user?._id]);

  const handleLongPressMessage = (message: Message) => {
    Alert.alert('Tùy chọn', 'Bạn muốn làm gì với tin nhắn này?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Phản hồi',
        onPress: () => {
          setReplyToMessage(message);
          scrollToLatest(true);
        },
      },
      {
        text: 'Chuyển tiếp',
        onPress: () => {
          if (message.type === 'system') {
            Alert.alert('Không thể chuyển tiếp', 'Tin nhắn hệ thống không hỗ trợ chuyển tiếp.');
            return;
          }
          navigation.navigate('ForwardMessage', {
            message: {
              content: message.content,
              type: message.type,
              attachments: message.attachments || [],
            },
          });
        },
      },
    ]);
  };

  const getInitials = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[parts.length - 2][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  };

  const overlayLoading = loading || creatingChannel;
  const overlayLabel = creatingChannel ? 'Đang khởi tạo kênh chat...' : 'Đang tải hội thoại...';
  const avoidPadding = Math.max(keyboardHeight - (Platform.OS === 'ios' ? insets.bottom : 0), 0);

  const headerTitle = useMemo(() => {
    if (selectedChannel && selectedChannel.type !== 'dm') return selectedChannel.name;
    return contact?.name || contactName || 'Liên hệ';
  }, [contact?.name, contactName, selectedChannel]);

  const headerMeta = useMemo(() => {
    if (selectedChannel && selectedChannel.type !== 'dm') {
      const memberCount = selectedChannel.memberIds?.length || 0;
      return `${memberCount} thành viên · Nhóm`;
    }
    const roleLabel = (role?: string) => {
      const r = String(role || '').toLowerCase();
      if (r === 'admin') return 'Admin';
      if (r === 'manager') return 'Manager';
      if (r === 'employee') return 'Employee';
      return '';
    };

    const prefix = String(contact?.position || '').trim() || roleLabel((contact as any)?.role) || (contact ? 'Đồng nghiệp' : '');
    return `${prefix ? `${prefix} · ` : ''}Chat riêng`;
  }, [contact, selectedChannel]);

  const openGroupMembers = useCallback(() => {
    if (!selectedChannelId) return;
    if (!selectedChannel || selectedChannel.type === 'dm') return;
    navigation.navigate('ChannelMembers', { channelId: selectedChannelId });
  }, [navigation, selectedChannel, selectedChannelId]);

  const startCall = (mode: 'voice' | 'video') => {
    if (!selectedChannelId || !user?.companyId) return;
    if (!contactId || !token) {
      Alert.alert('Không thể gọi', 'Cuộc gọi chỉ hỗ trợ chat riêng (DM).');
      return;
    }
    const kind = selectedChannel?.type === 'dm' ? 'dm' : 'ch';
    const agoraChannelName = `c_${user.companyId}_${kind}_${selectedChannelId}`;
    const callTitlePrefix = mode === 'video' ? 'Video call' : 'Cuộc gọi';

    const callId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
      const socket = getRealtimeSocket(token);
      socket.emit(
        'call_invite',
        {
          callId,
          recipientId: contactId,
          channelId: selectedChannelId,
          mode,
          agoraChannelName,
          title: `${callTitlePrefix} · ${headerTitle}`,
        },
        (ack: any) => {
          if (!ack?.ok) {
            console.warn('[call_invite] not acked', ack);
          }
        }
      );
    } catch {
      // ignore; still navigate so caller can retry
    }

    navigation.navigate('Call', {
      agoraChannelName,
      mode,
      title: `${callTitlePrefix} · ${headerTitle}`,
      callId,
      callRole: 'caller',
      otherUserId: contactId,
    });
  };

  return (
    <Screen
      scroll={false}
      style={styles.screenRoot}
      loading={overlayLoading}
      loadingLabel={overlayLabel}
    >
      <View style={[styles.keyboardRoot, { paddingBottom: avoidPadding }]}>
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{getInitials(headerTitle || 'NA')}</Text>
            </View>
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={openGroupMembers}
              activeOpacity={0.7}
              disabled={!selectedChannel || selectedChannel.type === 'dm'}
            >
              <Text style={styles.contactName}>
                {selectedChannel && selectedChannel.type !== 'dm' ? `# ${headerTitle}` : headerTitle}
              </Text>
              <Text style={styles.contactMeta}>{headerMeta}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => startCall('voice')}>
              <Ionicons name="call-outline" size={16} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => startCall('video')}>
              <Ionicons name="videocam-outline" size={16} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshBtn} onPress={() => void initializeRoom()}>
              <Ionicons name="refresh" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
        </Card>

        <Card style={styles.messagesCard}>
          <ScrollView
            ref={messageScrollRef}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            onContentSizeChange={() => scrollToLatest(true)}
          >
            {messages.length === 0 ? (
              <Text style={styles.empty}>Chưa có tin nhắn. Hãy bắt đầu cuộc trò chuyện.</Text>
            ) : (
              dedupedMessages.map((message) => {
                const isMine = message.senderId === user?._id;
                const messageId = normalizeId((message as any)?._id);
                const attachments = (message.attachments || []) as (MessageAttachment & { resourceType?: string })[];
                const contentText = String(message.content || '').trim();
                const isFilenameOnlyContent =
                  attachments.length > 0 &&
                  !!contentText &&
                  attachments.some((att) => String((att as any)?.name || '').trim() === contentText);
                const replied = message.replyTo
                  ? dedupedMessages.find((m) => normalizeId((m as any)?._id) === normalizeId(message.replyTo)) || null
                  : null;
                const repliedSender = replied ? (userNameMap[replied.senderId] || (replied.senderId === user?._id ? 'Bạn' : 'Thành viên')) : null;
                const repliedSnippet = replied
                  ? (replied.content || (replied.attachments?.length ? `Đính kèm: ${replied.attachments.length} tệp` : ''))
                  : '';
                return (
                  <View key={messageId} style={[styles.messageWrap, isMine ? styles.mineWrap : styles.theirWrap]}>
                    <Pressable
                      onLongPress={() => handleLongPressMessage(message)}
                      style={[styles.messageBubble, isMine ? styles.mineBubble : styles.theirBubble]}
                    >
                      {!isMine ? <Text style={styles.sender}>{userNameMap[message.senderId] || 'Thành viên'}</Text> : null}

                      {replied ? (
                        <View style={[styles.replyPreview, isMine ? styles.replyPreviewMine : styles.replyPreviewTheirs]}>
                          <Text numberOfLines={1} style={[styles.replyAuthor, isMine ? styles.mineText : styles.theirText]}>{repliedSender}</Text>
                          <Text numberOfLines={2} style={[styles.replySnippet, isMine ? styles.mineText : styles.theirText]}>{repliedSnippet}</Text>
                        </View>
                      ) : null}

                      {contentText.length > 0 && !isFilenameOnlyContent ? (
                        <Text style={[styles.messageText, isMine ? styles.mineText : styles.theirText]}>{contentText}</Text>
                      ) : null}

                      {attachments.length > 0 ? (
                        <View style={styles.attachmentList}>
                          {attachments.map((att) => {
                            const isImage = (att.resourceType || '').toLowerCase() === 'image' || (att.type || '').startsWith('image/');
                            if (isImage) {
                              return (
                                    <Pressable key={`${message._id}-${att.url}`} onPress={() => void openAttachment(att as any, true)} style={styles.attachmentImageWrap}>
                                      <Image source={{ uri: att.url }} style={styles.attachmentImage} resizeMode="cover" />
                                    </Pressable>
                              );
                            }
                            return (
                              <Pressable
                                key={`${message._id}-${att.url}`}
                                onPress={() => void openAttachment(att as any, false)}
                                style={[styles.attachmentFileRow, isMine ? styles.attachmentFileRowMine : undefined]}
                              >
                                <Ionicons name="document-outline" size={16} color={colors.text} />
                                <Text numberOfLines={1} style={[styles.attachmentFileName, styles.attachmentFileNameText]}>
                                  {getAttachmentDisplayName(att as any, 'Tệp đính kèm')}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}

                      <Text style={[styles.time, isMine ? styles.mineText : styles.theirTime]}>
                        {new Date(message.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      </Text>

                      {contactId && isMine && messageId && lastMineMessageId === messageId ? (
                        <Text style={[styles.receiptText, isMine ? styles.mineText : styles.theirTime]}>
                          {deliveredIds.has(messageId) ? 'Đã nhận' : 'Đã gửi'}
                        </Text>
                      ) : null}
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Card>

        <Card style={styles.composeDock}>
          {replyToMessage ? (
            <View style={styles.replyBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarTitle}>Đang phản hồi</Text>
                <Text numberOfLines={2} style={styles.replyBarSnippet}>{replyToMessage.content || (replyToMessage.attachments?.length ? `Đính kèm: ${replyToMessage.attachments.length} tệp` : '')}</Text>
              </View>
              <Pressable onPress={() => setReplyToMessage(null)} style={styles.replyBarClose}>
                <Ionicons name="close" size={16} color={colors.text} />
              </Pressable>
            </View>
          ) : null}

          {pendingAttachments.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pendingScroll} contentContainerStyle={styles.pendingRow}>
              {pendingAttachments.map((att, idx) => {
                const isImage = att.resourceType === 'image' || (att.type || '').startsWith('image/');
                const displayName = isImage ? 'Ảnh' : getAttachmentDisplayName(att as any, 'Tệp');
                return (
                  <View key={`${att.url}-${idx}`} style={styles.pendingChip}>
                    {isImage ? (
                      <Image source={{ uri: att.localUri || att.url }} style={styles.pendingThumb} resizeMode="cover" />
                    ) : (
                      <Ionicons name="document-outline" size={16} color={colors.text} />
                    )}
                    <Text numberOfLines={1} style={styles.pendingName}>{displayName}</Text>
                    <Pressable
                      onPress={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      style={styles.pendingRemove}
                    >
                      <Ionicons name="close" size={14} color={colors.text} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}

          <View style={styles.composeRow}>
            <TouchableOpacity
              style={[styles.toolBtn, (!selectedChannelId || loading || uploadingAttachment) ? styles.sendBtnDisabled : undefined]}
              onPress={() => void handlePickImage()}
              disabled={!selectedChannelId || loading || uploadingAttachment}
            >
              <Ionicons name="image-outline" size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, (!selectedChannelId || loading || uploadingAttachment) ? styles.sendBtnDisabled : undefined]}
              onPress={() => void handlePickFile()}
              disabled={!selectedChannelId || loading || uploadingAttachment}
            >
              <Ionicons name="attach" size={18} color={colors.text} />
            </TouchableOpacity>
            <TextInput
              value={composer}
              onChangeText={setComposer}
              placeholder={uploadingAttachment ? 'Đang upload...' : (selectedChannel ? 'Nhắn tin...' : 'Chưa sẵn sàng để gửi')}
              placeholderTextColor={colors.muted}
              style={styles.input}
              editable={!loading && !!selectedChannelId}
              onFocus={() => scrollToLatest(true)}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!selectedChannelId || loading || uploadingAttachment) ? styles.sendBtnDisabled : undefined]}
              onPress={handleSend}
              disabled={!selectedChannelId || loading || uploadingAttachment}
            >
              <Ionicons name="send" size={15} color={colors.text} />
              <Text style={styles.sendText}>Gửi</Text>
            </TouchableOpacity>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  keyboardRoot: {
    flex: 1,
    gap: 10,
  },
  headerCard: {
    gap: 8,
  },
  messagesCard: {
    flex: 1,
    minHeight: 0,
  },
  composeDock: {
    gap: 0,
    paddingTop: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
  },
  contactMeta: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
  },
  messageList: {
    gap: 8,
    paddingBottom: 8,
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  messageWrap: {
    width: '100%',
    flexDirection: 'row',
  },
  mineWrap: {
    justifyContent: 'flex-end',
  },
  theirWrap: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  mineBubble: {
    backgroundColor: colors.primary,
  },
  theirBubble: {
    backgroundColor: colors.secondary,
  },
  sender: {
    color: '#334155',
    fontSize: 11,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  messageText: {
    fontSize: 14,
  },
  mineText: {
    color: '#fff',
  },
  theirText: {
    color: colors.text,
  },
  time: {
    fontSize: 11,
    alignSelf: 'flex-end',
  },
  receiptText: {
    fontSize: 11,
    alignSelf: 'flex-end',
    marginTop: 2,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  theirTime: {
    color: '#64748B',
  },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.white,
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  sendBtn: {
    backgroundColor: colors.secondary,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  replyPreview: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  replyPreviewMine: {
    backgroundColor: hexToRgba('#ffffff', 0.12),
  },
  replyPreviewTheirs: {
    backgroundColor: hexToRgba(colors.primary, 0.10),
  },
  replyAuthor: {
    fontSize: 11,
    fontFamily: 'BeVietnamPro_900Black',
  },
  replySnippet: {
    fontSize: 12,
    fontFamily: 'BeVietnamPro_700Bold',
    opacity: 0.95,
  },
  attachmentList: {
    gap: 8,
    marginTop: 6,
  },
  attachmentImageWrap: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  attachmentImage: {
    width: 220,
    height: 140,
  },
  attachmentImageName: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  attachmentFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.white,
    maxWidth: 240,
  },
  attachmentFileRowMine: {
    backgroundColor: hexToRgba(colors.primary, 0.35),
  },
  attachmentFileName: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  attachmentFileNameText: {
    color: colors.text,
  },
  pendingScroll: {
    marginBottom: 10,
  },
  pendingRow: {
    gap: 8,
  },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.white,
    maxWidth: 280,
  },
  pendingThumb: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  pendingName: {
    flex: 1,
    color: colors.text,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 12,
  },
  pendingRemove: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.white,
    marginBottom: 10,
  },
  replyBarTitle: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 12,
  },
  replyBarSnippet: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
    marginTop: 2,
  },
  replyBarClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
});

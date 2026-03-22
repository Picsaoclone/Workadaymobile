import React, { useEffect, useRef } from 'react';
import { Alert, AppState, Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useAuthStore } from '../store/authStore';
import { disconnectRealtimeSocket, getRealtimeSocket } from '../services/realtimeSingleton';
import { navigate, navigationRef } from '../navigation/navigationRef';
import { startIncomingRingtone, stopIncomingRingtone } from '../utils/ringtone';
import { showAndroidIncomingCallNotification } from '../services/androidIncomingCall';
import type { Message } from '../types/models';
import { useBadgeStore } from '../store/badgeStore';
import { channelApi, userApi } from '../services/api';

type CallInvitePayload = {
  callId: string;
  callerId: string;
  callerName?: string;
  recipientId: string;
  channelId: string;
  mode: 'voice' | 'video';
  agoraChannelName: string;
  title?: string;
  createdAt?: string;
};

type CallRejectPayload = {
  callId: string;
  callerId: string;
  rejectedByUserId?: string;
  rejectedByName?: string;
  reason?: string;
};

type CallCancelPayload = {
  callId: string;
  callerId: string;
};

export const RealtimeBootstrap = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const bumpChatUnread = useBadgeStore((s) => s.bumpChatUnread);
  const markChatLinkUnread = useBadgeStore((s) => s.markChatLinkUnread);

  const ringingCallIdRef = useRef<string | null>(null);
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const userNameByIdRef = useRef<Record<string, string>>({});
  const channelNameByIdRef = useRef<Record<string, string>>({});
  const channelTypeByIdRef = useRef<Record<string, string>>({});
  const lastLookupAtRef = useRef<number>(0);

  const stopRinging = () => {
    try {
      Vibration.cancel();
    } catch {
      // ignore
    }
    stopIncomingRingtone();
    ringingCallIdRef.current = null;
  };

  useEffect(() => {
    if (!isAuthenticated || !token) {
      stopRinging();
      disconnectRealtimeSocket();
      return;
    }

    const socket = getRealtimeSocket(token);

    const ensureDefaultChannel = async () => {
      if (Platform.OS !== 'android') return;
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      } catch {
        // ignore
      }
    };

    const truncate = (value: string, maxLen: number) => {
      const clean = String(value || '').trim();
      if (clean.length <= maxLen) return clean;
      return `${clean.slice(0, Math.max(0, maxLen - 1))}…`;
    };

    const maybeNotifyNewMessage = async (incoming: Message) => {
      // Pixel launcher (and many Android launchers) only show an icon dot when there is an active notification.
      // In dev builds, we may receive messages via realtime without any push notification.
      const id = String(incoming?._id || '').trim();
      if (!id) return;
      if (notifiedMessageIdsRef.current.has(id)) return;
      notifiedMessageIdsRef.current.add(id);

      const channelId = String(incoming?.channelId || '').trim();
      if (!channelId) return;

      const attachments = Array.isArray(incoming.attachments) ? incoming.attachments : [];
      const msgType = String(incoming.type || 'text');
      const body = attachments.length > 0
        ? (msgType === 'image' ? '(Ảnh)' : '(Tệp)')
        : (truncate(String(incoming.content || ''), 120) || '(Tin nhắn mới)');

      // Best-effort lookup for nicer titles + correct navigation params.
      // Keep it lightweight: refresh maps at most once every ~15s.
      const now = Date.now();
      if (now - lastLookupAtRef.current > 15_000) {
        lastLookupAtRef.current = now;
        try {
          const [usersRes, channelsRes] = await Promise.all([
            userApi.getAll(),
            channelApi.getAll(),
          ]);
          const users = usersRes?.data?.data || [];
          const channels = channelsRes?.data?.data || [];

          const nextUserMap: Record<string, string> = { ...userNameByIdRef.current };
          for (const u of users) {
            const id = String((u as any)?._id || '').trim();
            if (!id) continue;
            const name = String((u as any)?.name || '').trim();
            if (name) nextUserMap[id] = name;
          }
          userNameByIdRef.current = nextUserMap;

          const nextChannelMap: Record<string, string> = { ...channelNameByIdRef.current };
          const nextChannelTypeMap: Record<string, string> = { ...channelTypeByIdRef.current };
          for (const ch of channels) {
            const id = String((ch as any)?._id || '').trim();
            if (!id) continue;
            const name = String((ch as any)?.name || '').trim();
            if (name) nextChannelMap[id] = name;

            const type = String((ch as any)?.type || '').trim();
            if (type) nextChannelTypeMap[id] = type;
          }
          channelNameByIdRef.current = nextChannelMap;
          channelTypeByIdRef.current = nextChannelTypeMap;
        } catch {
          // ignore
        }
      }

      const senderId = String(incoming?.senderId || '').trim();
      const senderName = senderId ? (userNameByIdRef.current[senderId] || '') : '';
      const channelName = channelNameByIdRef.current[channelId] || '';

      // Prefer channel type (DM vs group). Fallback to heuristic for legacy/missing channel cache.
      const channelType = String(channelTypeByIdRef.current[channelId] || '').toLowerCase();
      const isDm = channelType ? channelType === 'dm' : !!String((incoming as any)?.recipientId || '').trim();
      const title = isDm
        ? (senderName || 'Tin nhắn mới')
        : (channelName ? `#${channelName}` : 'Tin nhắn mới');

      await ensureDefaultChannel();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: {
            ...(isDm
              ? {
                  kind: 'chat_dm',
                  contactId: senderId,
                  contactName: senderName || undefined,
                }
              : {
                  kind: 'chat_channel',
                  channelId,
                  channelName: channelName || undefined,
                }),
          },
        },
        trigger: null,
      });
    };

    const onNewMessage = (incoming: Message) => {
      const me = String(user?._id || '');
      if (!me) return;
      if (!incoming) return;
      if (String(incoming.senderId || '') === me) return;

      // If user is currently inside the same ChatRoom, ChatRoomScreen will mark notifications read.
      // Otherwise, bump immediately so the tab badge updates even if push doesn't arrive in dev.
      const route = navigationRef.getCurrentRoute();
      const routeParams: any = route?.params || {};
      const isChatRoom = route?.name === 'ChatRoom';
      const sameChannel = isChatRoom && String(routeParams?.channelId || '') && String(routeParams?.channelId || '') === String(incoming.channelId || '');
      if (sameChannel) return;

      bumpChatUnread(1);

      const channelId = String(incoming.channelId || '').trim();
      if (channelId) {
        markChatLinkUnread(`/dashboard/chat/channel/${channelId}`);
      }

      // Best-effort local notification so Android launcher can show a dot.
      // (Without an active notification, Pixel often shows nothing on the home-screen icon.)
      void maybeNotifyNewMessage(incoming).catch(() => undefined);
    };

    const ensureCallChannel = async () => {
      if (Platform.OS !== 'android') return;
      try {
        await Notifications.setNotificationChannelAsync('calls_incoming_v2', {
          name: 'Incoming calls',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 700, 300, 700],
          sound: 'default',
        });
      } catch {
        // ignore
      }
    };

    void ensureCallChannel();

    const onInvite = async (payload: CallInvitePayload) => {
      const me = String(user?._id || '');
      if (!me) return;
      if (!payload?.callId || !payload?.callerId) return;

      // Ignore if we are the caller.
      if (String(payload.callerId) === me) return;

      // If already ringing for a call, auto-decline new invites (simple busy behavior).
      // However, avoid false-busy if the previous call is already ended/cancelled/rejected.
      if (ringingCallIdRef.current && ringingCallIdRef.current !== payload.callId) {
        const previousCallId = ringingCallIdRef.current;
        try {
          const stillActive: boolean = await new Promise((resolve) => {
            socket.emit('call_get', { callId: previousCallId }, (resp: any) => {
              const status = String(resp?.state?.status || '');
              // If server doesn't know, treat as inactive.
              if (!status) return resolve(false);
              resolve(status === 'invited' || status === 'accepted');
            });
          });

          if (stillActive) {
            console.log('[calls] auto-reject busy', { previousCallId, newCallId: payload.callId });
            socket.emit('call_reject', {
              callId: payload.callId,
              callerId: payload.callerId,
              reason: 'busy',
            });
            return;
          }

          // Previous call is stale => stop old ring and allow the new invite.
          console.log('[calls] stale ringing cleared', { previousCallId, newCallId: payload.callId });
          stopRinging();
        } catch {
          socket.emit('call_reject', {
            callId: payload.callId,
            callerId: payload.callerId,
            reason: 'busy',
          });
          return;
        }
      }

      ringingCallIdRef.current = payload.callId;

      // Ringing feedback.
      Vibration.vibrate([0, 700, 300, 700], true);

      const callerName = String(payload.callerName || 'Đồng nghiệp');
      const title = payload.title || (payload.mode === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi');

      // Start a real ringtone loop when JS is running (foreground OR background).
      void startIncomingRingtone({
        title,
        body: `${callerName} đang gọi...`,
        data: {
          kind: 'incoming_call',
          callId: payload.callId,
          callerId: payload.callerId,
          callerName: payload.callerName,
          channelId: payload.channelId,
          mode: payload.mode,
          agoraChannelName: payload.agoraChannelName,
          title: payload.title,
        },
      });

      // If app is in background (but still running), show a heads-up local notification too.
      if (AppState.currentState !== 'active') {
        if (Platform.OS === 'android') {
          // Use Notifee so the notification has Accept/Decline actions.
          void showAndroidIncomingCallNotification({
            kind: 'incoming_call',
            callId: payload.callId,
            callerId: payload.callerId,
            callerName: payload.callerName,
            channelId: payload.channelId,
            mode: payload.mode,
            agoraChannelName: payload.agoraChannelName,
            title: payload.title,
          }).catch(() => undefined);
        } else {
          // iOS: keep Expo local notification.
          void Notifications.scheduleNotificationAsync({
            content: {
              title,
              body: `${callerName} đang gọi...`,
              sound: 'default',
              data: {
                kind: 'incoming_call',
                callId: payload.callId,
                callerId: payload.callerId,
                callerName: payload.callerName,
                channelId: payload.channelId,
                mode: payload.mode,
                agoraChannelName: payload.agoraChannelName,
                title: payload.title,
              },
            },
            trigger: null,
          }).catch(() => undefined);
        }
      }

      Alert.alert(title, `${callerName} đang gọi. Bạn có muốn nhận cuộc gọi không?`, [
        {
          text: 'Từ chối',
          style: 'destructive',
          onPress: () => {
            stopRinging();
            socket.emit('call_reject', {
              callId: payload.callId,
              callerId: payload.callerId,
              reason: 'declined',
            });
          },
        },
        {
          text: 'Nhận',
          onPress: () => {
            stopRinging();
            navigate('Call', {
              agoraChannelName: payload.agoraChannelName,
              mode: payload.mode,
              title: payload.title,
              callId: payload.callId,
              callRole: 'callee',
              otherUserId: payload.callerId,
              channelId: payload.channelId,
              autoAccept: true,
            });
          },
        },
      ]);
    };

    const onCancel = (payload: CallCancelPayload) => {
      if (!payload?.callId) return;
      if (ringingCallIdRef.current !== payload.callId) return;
      stopRinging();
      Alert.alert('Cuộc gọi đã bị hủy', 'Người gọi đã hủy cuộc gọi.');
    };

    const onReject = (payload: CallRejectPayload) => {
      if (!payload?.callId) return;
      const route = navigationRef.getCurrentRoute();
      if (route?.name !== 'Call') return;

      const params: any = route.params;
      if (String(params?.callId || '') !== String(payload.callId)) return;

      const who = String(payload.rejectedByName || 'Người nhận');
      Alert.alert('Cuộc gọi bị từ chối', `${who} đã từ chối cuộc gọi.`);

      if (navigationRef.canGoBack()) {
        navigationRef.goBack();
      }
    };

    socket.off('call_invite');
    socket.off('call_cancel');
    socket.off('call_reject');
    socket.off('new_message');

    socket.on('call_invite', onInvite);
    socket.on('call_cancel', onCancel);
    socket.on('call_reject', onReject);
    socket.on('new_message', onNewMessage);

    return () => {
      socket.off('call_invite', onInvite);
      socket.off('call_cancel', onCancel);
      socket.off('call_reject', onReject);
      socket.off('new_message', onNewMessage);
    };
  }, [bumpChatUnread, isAuthenticated, token, user?._id]);

  return null;
};

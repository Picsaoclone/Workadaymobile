import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  EventType,
  type Event,
  type Notification,
} from '@notifee/react-native';

const PENDING_ACTION_KEY = 'pending_incoming_call_action_v1';
const AUTH_STORAGE_KEY = 'workaday-mobile-auth';

// Use a versioned channel ID because Android channel sound/importance are effectively immutable
// once the channel is created on a device.
const INCOMING_CALL_CHANNEL_ID = 'calls_incoming_v2';
const ANDROID_MAIN_ACTIVITY = 'com.puda.workadaymobile.MainActivity';

const BASE_API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

type IncomingCallData = {
  kind: 'incoming_call';
  callId: string;
  callerId: string;
  callerName?: string;
  channelId: string;
  mode: 'voice' | 'video';
  agoraChannelName: string;
  title?: string;
};

type PendingAction =
  | { action: 'accept'; data: IncomingCallData; acceptedOnServer?: boolean }
  | { action: 'open'; data: IncomingCallData }
  | { action: 'decline'; data: IncomingCallData };

const getAuthTokenFromStorage = async (): Promise<string | null> => {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = parsed?.state?.token ?? parsed?.token;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
};

const postCallAction = async (
  endpoint: '/calls/accept' | '/calls/reject',
  payload: { callId: string; reason?: string },
  token: string
): Promise<boolean> => {
  try {
    const resp = await fetch(`${BASE_API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    return resp.ok;
  } catch {
    return false;
  }
};

const asIncomingCallData = (raw: any): IncomingCallData | null => {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'incoming_call') return null;
  if (typeof raw.callId !== 'string') return null;
  if (typeof raw.callerId !== 'string') return null;
  if (typeof raw.channelId !== 'string') return null;
  if (raw.mode !== 'voice' && raw.mode !== 'video') return null;
  if (typeof raw.agoraChannelName !== 'string') return null;
  return raw as IncomingCallData;
};

const ensureCallChannel = async () => {
  await notifee.createChannel({
    id: INCOMING_CALL_CHANNEL_ID,
    name: 'Incoming calls',
    sound: 'default',
    vibration: true,
    importance: AndroidImportance.HIGH,
  });
};

const displayFullScreenIncomingCall = async (data: IncomingCallData) => {
  await ensureCallChannel();

  const title = data.title || (data.mode === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi');
  const callerName = data.callerName || 'Đồng nghiệp';

  await notifee.displayNotification({
    title,
    body: `${callerName} đang gọi...`,
    data,
    android: {
      channelId: INCOMING_CALL_CHANNEL_ID,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 700, 300, 700],
      pressAction: { id: 'open', launchActivity: ANDROID_MAIN_ACTIVITY },
      fullScreenAction: { id: 'open', launchActivity: ANDROID_MAIN_ACTIVITY },
      actions: [
        { title: 'Từ chối', pressAction: { id: 'decline' } },
        { title: 'Nhận', pressAction: { id: 'accept', launchActivity: ANDROID_MAIN_ACTIVITY } },
      ],
      ongoing: true,
      autoCancel: false,
      timeoutAfter: 35_000,
      showTimestamp: true,
    },
  });
};

let registered = false;

const registerHandlersOnce = () => {
  if (registered) return;
  registered = true;

  if (Platform.OS !== 'android') return;

  // FCM data-only => show full-screen call UI even when app is killed.
  messaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
    try {
      const data = asIncomingCallData(remoteMessage?.data);
      if (!data) return;
      console.log('[calls] bg fcm incoming_call', { callId: data.callId });
      await displayFullScreenIncomingCall(data);
    } catch (err) {
      console.warn('[calls] bg fcm handler failed', err);
    }
  });

  const handleNotifeePress = async (evt: Event) => {
    try {
      const isActionPress = evt.type === EventType.ACTION_PRESS;
      const isBodyPress = evt.type === EventType.PRESS;
      if (!isActionPress && !isBodyPress) return;

      const pressId = isBodyPress ? 'open' : evt.detail?.pressAction?.id;
      const notif: Notification | undefined = evt.detail?.notification;
      const data = asIncomingCallData((notif as any)?.data);
      if (!data) return;

      if (pressId === 'accept' || pressId === 'open' || pressId === 'decline') {
        const action: PendingAction['action'] = pressId === 'open' ? 'open' : pressId;

        // Best-effort: send accept/reject to backend even when the app is killed.
        // This lets the caller receive call_accept/call_reject via Socket.IO.
        let acceptedOnServer = false;
        if (action === 'accept' || action === 'decline') {
          const token = await getAuthTokenFromStorage();
          if (token) {
            if (action === 'accept') {
              acceptedOnServer = await postCallAction('/calls/accept', { callId: data.callId }, token);
              console.log('[calls] bg accept REST', { ok: acceptedOnServer, callId: data.callId });
            } else {
              const ok = await postCallAction('/calls/reject', { callId: data.callId, reason: 'declined' }, token);
              console.log('[calls] bg decline REST', { ok, callId: data.callId });
            }
          } else {
            console.log('[calls] bg action: missing auth token', { action, callId: data.callId });
          }
        }

        const payload: PendingAction =
          action === 'accept'
            ? { action, data, acceptedOnServer }
            : { action, data };

        await AsyncStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(payload));
        console.log('[calls] notifee press stored', { action, callId: data.callId, acceptedOnServer });
      }

      if (pressId === 'decline' || pressId === 'accept') {
        try {
          if (notif?.id) {
            await notifee.cancelNotification(notif.id);
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('[calls] notifee press handler failed', err);
    }
  };

  notifee.onBackgroundEvent(handleNotifeePress);
  notifee.onForegroundEvent(handleNotifeePress);
};

registerHandlersOnce();

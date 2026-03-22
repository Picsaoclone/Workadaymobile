import { Platform } from 'react-native';
import { navigate } from '../navigation/navigationRef';

// This module is Android-only and relies on native libraries.
// It is safe to import on other platforms (no-ops).

// Use a versioned channel ID because Android channel sound/importance are immutable once created.
const INCOMING_CALL_CHANNEL_ID = 'calls_incoming_v2';
const ANDROID_MAIN_ACTIVITY = 'com.puda.workadaymobile.MainActivity';

const PENDING_ACTION_KEY = 'pending_incoming_call_action_v1';

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

export type { IncomingCallData };

type PendingAction =
  | { action: 'accept'; data: IncomingCallData; acceptedOnServer?: boolean }
  | { action: 'open'; data: IncomingCallData }
  | { action: 'decline'; data: IncomingCallData };

const lazyImports = async () => {
  const [messagingModule, notifeeModule, storageModule] = await Promise.all([
    import('@react-native-firebase/messaging'),
    import('@notifee/react-native'),
    import('@react-native-async-storage/async-storage'),
  ]);

  return {
    messaging: messagingModule.default,
    notifee: notifeeModule.default,
    notifeeTypes: notifeeModule,
    AsyncStorage: storageModule.default,
  };
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
  const { notifee, notifeeTypes } = await lazyImports();
  await notifee.createChannel({
    id: INCOMING_CALL_CHANNEL_ID,
    name: 'Incoming calls',
    sound: 'default',
    vibration: true,
    importance: notifeeTypes.AndroidImportance.HIGH,
  });
};

const displayFullScreenIncomingCall = async (data: IncomingCallData) => {
  const { notifee, notifeeTypes } = await lazyImports();

  await ensureCallChannel();

  const title = data.title || (data.mode === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi');
  const callerName = data.callerName || 'Đồng nghiệp';

  await notifee.displayNotification({
    title,
    body: `${callerName} đang gọi...`,
    data,
    android: {
      channelId: INCOMING_CALL_CHANNEL_ID,
      category: notifeeTypes.AndroidCategory.CALL,
      importance: notifeeTypes.AndroidImportance.HIGH,
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
      // Keep it from lingering forever if user ignores.
      timeoutAfter: 35_000,
      showTimestamp: true,
    },
  });
};

export const showAndroidIncomingCallNotification = async (data: IncomingCallData): Promise<void> => {
  if (Platform.OS !== 'android') return;
  await displayFullScreenIncomingCall(data);
};

export const getAndroidFcmTokenAsync = async (): Promise<string | null> => {
  if (Platform.OS !== 'android') return null;

  try {
    const { messaging } = await lazyImports();
    const token = await messaging().getToken();
    if (token) {
      console.log('[push] fcm token obtained', { suffix: token.slice(-12) });
    }
    return token || null;
  } catch (err) {
    console.warn('[push] get fcm token failed', err);
    return null;
  }
};

export const bootstrapAndroidIncomingCallAction = async () => {
  if (Platform.OS !== 'android') return;

  try {
    const { AsyncStorage, notifee } = await lazyImports();
    const raw = await AsyncStorage.getItem(PENDING_ACTION_KEY);

    if (raw) {
      await AsyncStorage.removeItem(PENDING_ACTION_KEY);

      const parsed: PendingAction = JSON.parse(raw);
      const data = parsed?.data;
      if (!data) return;

      console.log('[calls] pending action bootstrapped', { action: parsed.action, callId: data.callId });

      if (parsed.action === 'decline') return;

      const acceptedViaPushAction = parsed.action === 'accept' && parsed.acceptedOnServer === true;

      navigate('Call', {
        agoraChannelName: data.agoraChannelName,
        mode: data.mode,
        title: data.title,
        callId: data.callId,
        callRole: 'callee',
        otherUserId: data.callerId,
        channelId: data.channelId,
        autoAccept: parsed.action === 'accept',
        acceptedViaPushAction,
      });
      return;
    }

    // Cold start: app launched by tapping a Notifee notification.
    const initial = await notifee.getInitialNotification();
    const pressId = initial?.pressAction?.id;
    const data = asIncomingCallData(initial?.notification?.data);
    if (!data) return;

    console.log('[calls] initial notification bootstrapped', { pressId, callId: data.callId });

    const action: PendingAction['action'] = pressId === 'accept' ? 'accept' : pressId === 'decline' ? 'decline' : 'open';
    if (action === 'decline') return;

    navigate('Call', {
      agoraChannelName: data.agoraChannelName,
      mode: data.mode,
      title: data.title,
      callId: data.callId,
      callRole: 'callee',
      otherUserId: data.callerId,
      channelId: data.channelId,
      autoAccept: action === 'accept',
      acceptedViaPushAction: false,
    });
  } catch {
    // ignore
  }
};

// Background / headless handlers are registered from the app entrypoint
// via `src/boot/incomingCallBootstrap.android.ts`.

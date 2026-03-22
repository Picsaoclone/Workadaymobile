import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { pushTokenApi } from './api';
import { navigate } from '../navigation/navigationRef';

// In some runtime contexts, expo-notifications may not expose this API.
// Avoid crashing the app; pushes will still work (we just won't customize foreground handling).
try {
  const setHandler = (Notifications as any)?.setNotificationHandler;
  if (typeof setHandler === 'function') {
    setHandler({
      handleNotification: async (notification: any) => {
        const rawData = notification?.request?.content?.data as any;
        if (rawData?.kind === 'incoming_call') {
          return {
            shouldShowAlert: false,
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: true,
            shouldSetBadge: false,
          };
        }

        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        };
      },
    });
  } else {
    console.warn('[push] expo-notifications setNotificationHandler unavailable');
  }
} catch (err) {
  console.warn('[push] expo-notifications setNotificationHandler failed', err);
}

type MobileNotificationData =
  | { kind: 'task_assigned'; taskId: string }
  | { kind: 'meeting_invite'; meetingId: string }
  | { kind: 'meeting_reminder'; meetingId: string }
  | { kind: 'project_added'; projectId: string }
  | { kind: 'chat_channel'; channelId: string; channelName?: string }
  | { kind: 'chat_dm'; contactId: string; contactName?: string }
  | {
      kind: 'incoming_call';
      callId: string;
      callerId: string;
      callerName?: string;
      channelId: string;
      mode: 'voice' | 'video';
      agoraChannelName: string;
      title?: string;
    };

const asData = (raw: unknown): MobileNotificationData | null => {
  if (!raw) return null;
  const maybeParsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!maybeParsed || typeof maybeParsed !== 'object') return null;

  // Some providers nest under `data`.
  // Notifee (when bridged through other handlers) can nest under `notification.data`.
  const anyObj: any = maybeParsed as any;
  const anyRaw: any =
    anyObj?.data && typeof anyObj.data === 'object'
      ? anyObj.data
      : anyObj?.notification?.data && typeof anyObj.notification.data === 'object'
        ? anyObj.notification.data
        : maybeParsed;

  if (anyRaw.kind === 'task_assigned' && typeof anyRaw.taskId === 'string') return anyRaw;
  if (anyRaw.kind === 'meeting_invite' && typeof anyRaw.meetingId === 'string') return anyRaw;
  if (anyRaw.kind === 'meeting_reminder' && typeof anyRaw.meetingId === 'string') return anyRaw;
  if (anyRaw.kind === 'project_added' && typeof anyRaw.projectId === 'string') return anyRaw;
  if (anyRaw.kind === 'chat_channel' && typeof anyRaw.channelId === 'string') return anyRaw;
  if (anyRaw.kind === 'chat_dm' && typeof anyRaw.contactId === 'string') return anyRaw;
  if (
    anyRaw.kind === 'incoming_call' &&
    typeof anyRaw.callId === 'string' &&
    typeof anyRaw.callerId === 'string' &&
    (anyRaw.mode === 'voice' || anyRaw.mode === 'video') &&
    typeof anyRaw.agoraChannelName === 'string'
  ) {
    // channelId may be missing on some local notifications; allow it so we can still open UI.
    const channelId = typeof anyRaw.channelId === 'string' ? anyRaw.channelId : '';
    return { ...anyRaw, channelId };
  }
  return null;
};

export const handleNotificationTap = (data: MobileNotificationData) => {
  switch (data.kind) {
    case 'task_assigned':
      navigate('TaskDetail', { taskId: data.taskId });
      return;
    case 'meeting_invite':
      navigate('Meetings');
      return;
    case 'meeting_reminder':
      navigate('Meetings');
      return;
    case 'project_added':
      navigate('ProjectDetail', { projectId: data.projectId });
      return;
    case 'chat_channel':
      navigate('ChatRoom', { channelId: data.channelId, channelName: data.channelName });
      return;
    case 'chat_dm':
      navigate('ChatRoom', { contactId: data.contactId, contactName: data.contactName });
      return;

    case 'incoming_call':
      // Tap-to-open: show Accept/Decline inside the app (do NOT auto-accept).
      navigate('Call', {
        agoraChannelName: data.agoraChannelName,
        mode: data.mode,
        title: data.title,
        callId: data.callId,
        callRole: 'callee',
        otherUserId: data.callerId,
        channelId: data.channelId,
        autoAccept: false,
      });
      return;
  }
};

export const registerForPushNotificationsAsync = async (): Promise<string | null> => {
  if (!Device.isDevice && Platform.OS === 'ios') {
    // Expo push tokens require a physical device for iOS.
    return null;
  }

  // Remote push notifications are not supported in Expo Go on Android (SDK 53+).
  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    console.warn(
      'Push notifications are not supported in Expo Go on Android. Install a development build (expo-dev-client / EAS build) to obtain an Expo push token.'
    );
    return null;
  }

  if (Platform.OS === 'android') {
    // Default channel for general notifications.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });

    // Dedicated channel for incoming calls.
    // Use a versioned channel ID because Android channel settings are immutable once created.
    await Notifications.setNotificationChannelAsync('calls_incoming_v2', {
      name: 'Incoming calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 700, 300, 700],
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  console.log('[push] permission status', { existingStatus });
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    finalStatus = status;
    console.log('[push] permission requested', { finalStatus });
  }

  if (finalStatus !== 'granted') {
    console.warn('[push] permission not granted');
    return null;
  }

  try {
    const projectIdFromEnv = String(process.env.EXPO_PUBLIC_EAS_PROJECT_ID || '').trim();
    const projectIdFromExpoConfig = String(
      (Constants.expoConfig as any)?.extra?.eas?.projectId || (Constants as any)?.manifest2?.extra?.eas?.projectId || ''
    ).trim();
    const projectIdFromEasConfig = String((Constants as any)?.easConfig?.projectId || '').trim();

    const projectId = projectIdFromEnv || projectIdFromEasConfig || projectIdFromExpoConfig;
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenResponse.data;
    if (token) {
      console.log('[push] expo token obtained', { suffix: token.slice(-12) });
    }
    return token;
  } catch (err) {
    console.warn(
      'getExpoPushTokenAsync failed. If you are using EAS, ensure a valid projectId is available (EXPO_PUBLIC_EAS_PROJECT_ID or app.json extra.eas.projectId).',
      err
    );
    return null;
  }
};

export const syncPushTokenToBackend = async (expoPushToken: string): Promise<void> => {
  try {
    await pushTokenApi.register({
      token: expoPushToken,
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      provider: 'expo',
    });
    console.log('[push] token synced to backend', { suffix: String(expoPushToken).slice(-12) });
  } catch (err) {
    console.warn('syncPushTokenToBackend failed', err);
  }
};

export const syncFcmTokenToBackend = async (fcmToken: string): Promise<void> => {
  try {
    await pushTokenApi.register({
      token: fcmToken,
      platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      provider: 'fcm',
    });
    console.log('[push] fcm token synced to backend', { suffix: String(fcmToken).slice(-12) });
  } catch (err) {
    console.warn('syncFcmTokenToBackend failed', err);
  }
};

export const setupNotificationTapListener = () => {
  const sub = Notifications.addNotificationResponseReceivedListener((response: Notifications.NotificationResponse) => {
    const rawData = response.notification.request.content.data;
    const data = asData(rawData);
    if (!data) {
      console.warn('[push] tap data not recognized', rawData);
      return;
    }
    handleNotificationTap(data);
  });

  const bootstrap = async () => {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (!last) return;
    const rawData = last.notification.request.content.data;
    const data = asData(rawData);
    if (!data) {
      console.warn('[push] last tap data not recognized', rawData);
      return;
    }
    handleNotificationTap(data);
  };

  void bootstrap();

  return () => sub.remove();
};

export const setupNotificationReceivedListener = (onData: (data: MobileNotificationData) => void) => {
  const sub = Notifications.addNotificationReceivedListener((notification: Notifications.Notification) => {
    const rawData = notification.request.content.data;
    const data = asData(rawData);
    if (!data) return;
    onData(data);
  });

  return () => sub.remove();
};

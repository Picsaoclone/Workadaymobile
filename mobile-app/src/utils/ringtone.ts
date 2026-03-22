import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import InCallManager from 'react-native-incall-manager';

let ringtoneNotificationId: string | null = null;
let ringing = false;

export async function startIncomingRingtone(opts?: {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (ringing || ringtoneNotificationId) return;
  ringing = true;

  try {
    // Prefer a real looping ringtone (works when the JS app is running).
    try {
      // Disable vibrate here because we already handle vibration separately.
      InCallManager.startRingtone('_DEFAULT_', 0, 'playback', 30);
    } catch {
      // ignore
    }

    // Fallback: play a notification sound once.
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: opts?.title || 'Cuộc gọi đến',
        body: opts?.body || '',
        sound: 'default',
        data: opts?.data || { kind: 'incoming_call' },
        ...(Platform.OS === 'android' ? { android: { channelId: 'calls_incoming_v2' } } : {}),
      } as any,
      trigger: null,
    });

    ringtoneNotificationId = id;
  } catch {
    ringtoneNotificationId = null;
    ringing = false;
  }
}

export function stopIncomingRingtone(): void {
  const id = ringtoneNotificationId;
  ringtoneNotificationId = null;
  ringing = false;

  try {
    InCallManager.stopRingtone();
  } catch {
    // ignore
  }

  if (!id) return;

  void (async () => {
    try {
      await Notifications.dismissNotificationAsync(id);
    } catch {
      // ignore
    }
  })();
}

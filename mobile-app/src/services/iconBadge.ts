// Best-effort app icon badge setter.
// Notes:
// - iOS: badge is supported.
// - Android: badge support depends on the device launcher; this may be a no-op.

export async function setAppIconBadgeCount(count: number): Promise<void> {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

  // Prefer Notifee if available (works well in dev-client / bare).
  try {
    const notifeeModule = await import('@notifee/react-native');
    const notifee = notifeeModule.default;
    if (notifee?.setBadgeCount) {
      await notifee.setBadgeCount(safeCount);
      return;
    }
  } catch {
    // ignore
  }

  // Fallback to expo-notifications when present.
  try {
    const expoNotifications = await import('expo-notifications');
    const setBadgeCountAsync = (expoNotifications as any)?.setBadgeCountAsync;
    if (typeof setBadgeCountAsync === 'function') {
      await setBadgeCountAsync(safeCount);
    }
  } catch {
    // ignore
  }
}

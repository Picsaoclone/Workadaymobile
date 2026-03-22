import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../store/authStore';
import {
  registerForPushNotificationsAsync,
  setupNotificationReceivedListener,
  setupNotificationTapListener,
  syncFcmTokenToBackend,
  syncPushTokenToBackend,
} from '../services/pushClient';
import { useBadgeStore } from '../store/badgeStore';
import { getAndroidFcmTokenAsync, bootstrapAndroidIncomingCallAction } from '../services/androidIncomingCall';

export const PushNotificationsBootstrap = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const syncedTokenRef = useRef<string | null>(null);
  const syncedFcmTokenRef = useRef<string | null>(null);
  const warnedNoTokenRef = useRef(false);
  const refreshBadges = useBadgeStore((s) => s.refreshFromServer);

  useEffect(() => {
    return setupNotificationTapListener();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.companyId) return;
    // Handle Notifee (native) accept/decline actions that may have been pressed while the app was killed.
    void bootstrapAndroidIncomingCallAction();
  }, [isAuthenticated, user?.companyId]);

  useEffect(() => {
    return setupNotificationReceivedListener(() => {
      if (!isAuthenticated || !user?.companyId) return;
      void refreshBadges();
    });
  }, [isAuthenticated, refreshBadges, user?.companyId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!isAuthenticated || !user?.companyId) return;
        void refreshBadges();
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, refreshBadges, user?.companyId]);

  useEffect(() => {
    if (!isAuthenticated || !user?.companyId) return;

    void refreshBadges();

    let cancelled = false;
    const run = async () => {
      const token = await registerForPushNotificationsAsync();
      if (cancelled) return;

      if (!token) {
        if (!warnedNoTokenRef.current) {
          warnedNoTokenRef.current = true;
          console.warn('[push] no expo token (cannot receive Expo background push)');
        }
      } else if (syncedTokenRef.current !== token) {
        await syncPushTokenToBackend(token);
        syncedTokenRef.current = token;
      }

      // Android-only: also sync FCM token (used for full-screen incoming call when app is killed).
      const fcm = await getAndroidFcmTokenAsync();
      if (fcm && syncedFcmTokenRef.current !== fcm) {
        await syncFcmTokenToBackend(fcm);
        syncedFcmTokenRef.current = fcm;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.companyId]);

  return null;
};

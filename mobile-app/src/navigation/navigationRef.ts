import { createNavigationContainerRef } from '@react-navigation/native';
import type { AppStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<AppStackParamList>();

let pendingNavigation:
  | {
      name: keyof AppStackParamList;
      params?: any;
    }
  | null = null;

export const setNavigationReady = () => {
  if (!navigationRef.isReady()) return;
  if (!pendingNavigation) return;
  const next = pendingNavigation;
  pendingNavigation = null;
  try {
    navigationRef.navigate(next.name as any, next.params as any);
  } catch {
    // ignore
  }
};

export function navigate<T extends keyof AppStackParamList>(name: T, params: AppStackParamList[T]): void;
export function navigate<T extends keyof AppStackParamList>(name: T): void;
export function navigate<T extends keyof AppStackParamList>(name: T, params?: AppStackParamList[T]) {
  if (!navigationRef.isReady()) {
    pendingNavigation = { name, params };
    // Best-effort retry: notification taps can arrive before NavigationContainer is ready.
    setTimeout(() => {
      try {
        setNavigationReady();
      } catch {
        // ignore
      }
    }, 350);
    return;
  }
  navigationRef.navigate(name as any, params as any);
}

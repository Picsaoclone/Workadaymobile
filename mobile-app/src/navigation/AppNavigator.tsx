import React, { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { useBadgeStore } from '../store/badgeStore';
import { AuthStack } from './AuthStack';
import { MainStackNavigator, OnboardingStackNavigator } from './MainStackNavigator';
import { RootDrawerParamList } from './types';
import { colors } from '../theme/colors';
import { navigationRef, setNavigationReady } from './navigationRef';
import { LinearGradient } from 'expo-linear-gradient';
import { hexToRgba } from '../utils/color';

const Drawer = createDrawerNavigator<RootDrawerParamList>();

type ModuleKey =
  | 'home'
  | 'chat'
  | 'tasks'
  | 'projects'
  | 'attendance'
  | 'leave'
  | 'reports'
  | 'profile'
  | 'hr'
  | 'employees'
  | 'meetings'
  | 'docs'
  | 'reports_all';

const modules: Array<{ key: ModuleKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'home', label: 'Trang chủ', icon: 'home-outline' },
  { key: 'chat', label: 'Giao tiếp', icon: 'chatbubbles-outline' },
  { key: 'tasks', label: 'Công việc', icon: 'checkbox-outline' },
  { key: 'projects', label: 'Dự án', icon: 'briefcase-outline' },
  { key: 'attendance', label: 'Chấm công', icon: 'time-outline' },
  { key: 'leave', label: 'Nghỉ phép', icon: 'calendar-outline' },
  { key: 'reports', label: 'Báo cáo NV', icon: 'bar-chart-outline' },
  { key: 'hr', label: 'Nhân lực', icon: 'people-outline' },
  { key: 'employees', label: 'Nhân sự', icon: 'person-add-outline' },
  { key: 'meetings', label: 'Lịch họp', icon: 'videocam-outline' },
  { key: 'docs', label: 'Tài liệu', icon: 'document-text-outline' },
  { key: 'reports_all', label: 'Báo cáo', icon: 'pie-chart-outline' },
  { key: 'profile', label: 'Hồ sơ', icon: 'person-outline' },
];

function getActiveLeafRouteName(state: any): string | undefined {
  let currentState = state;
  while (currentState?.routes?.length) {
    const index = typeof currentState.index === 'number' ? currentState.index : 0;
    const route = currentState.routes[index];
    if (!route) return undefined;
    if (route.state) {
      currentState = route.state;
      continue;
    }
    return route.name;
  }
  return undefined;
}

function moduleKeyFromRouteName(routeName: string | undefined): ModuleKey | undefined {
  switch (routeName) {
    case 'Home':
      return 'home';
    case 'Chat':
      return 'chat';
    case 'Tasks':
      return 'tasks';
    case 'Projects':
      return 'projects';
    case 'Profile':
      return 'profile';
    case 'Attendance':
      return 'attendance';
    case 'Leave':
      return 'leave';
    case 'Reports':
      return 'reports';
    case 'Workforce':
      return 'hr';
    case 'Employees':
      return 'employees';
    case 'Meetings':
      return 'meetings';
    case 'Documents':
      return 'docs';
    case 'ReportsDashboard':
      return 'reports_all';
    default:
      return undefined;
  }
}

function AppDrawer() {
  const hour = new Date().getHours();
  const isNight = hour >= 18 || hour < 6;
  const drawerGradientColors: [string, string, string] = isNight
    ? [hexToRgba(colors.purple, 0.22), hexToRgba(colors.purple, 0.10), colors.background]
    : [hexToRgba(colors.primary, 0.22), hexToRgba(colors.primary, 0.10), colors.background];

  return (
    <Drawer.Navigator
      screenOptions={{
        headerShown: false,
        drawerStyle: { backgroundColor: 'transparent', width: 310 },
      }}
      drawerContent={(props) => (
        <View style={styles.drawerRoot}>
          <LinearGradient
            colors={drawerGradientColors}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <DrawerContentScrollView
            {...props}
            contentContainerStyle={styles.drawerContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Workaday</Text>
              <Text style={styles.drawerSubtitle}>Modules</Text>
            </View>

            <DrawerModules {...props} />
          </DrawerContentScrollView>
        </View>
      )}
    >
      <Drawer.Screen name="Main" component={MainStackNavigator} />
    </Drawer.Navigator>
  );
}

function DrawerModules(props: any) {
  const tasksDot = useBadgeStore((s) => s.tasksDot);
  const projectsDot = useBadgeStore((s) => s.projectsDot);
  const chatUnreadCount = useBadgeStore((s) => s.chatUnreadCount);
  const user = useAuthStore((s) => s.user);

  const activeLeafRoute = getActiveLeafRouteName(props.state?.routes?.[props.state.index]?.state);
  const activeModuleKey = moduleKeyFromRouteName(activeLeafRoute);

  const visibleModules = useMemo(() => {
    if (user?.role === 'admin') return modules;
    if (user?.role === 'manager') {
      // HR dashboard is admin-only.
      return modules.filter((m) => m.key !== 'hr');
    }
    // Employee: hide admin-only modules.
    return modules.filter((m) => m.key !== 'hr' && m.key !== 'reports_all');
  }, [user?.role]);

  return (
    <View style={styles.modulesWrap}>
      {visibleModules.map((m) => {
        const isActive = activeModuleKey === m.key;
        const showDot = (m.key === 'tasks' && tasksDot) || (m.key === 'projects' && projectsDot);
        const showCount = m.key === 'chat' ? chatUnreadCount : 0;
        const countLabel = showCount > 99 ? '99+' : String(showCount);

        return (
          <Pressable
            key={m.key}
            onPress={() => {
              const nav: any = props.navigation;
              const go = (params: any) => {
                nav.navigate('Main', params);
                nav.closeDrawer();
              };

              switch (m.key) {
                case 'home':
                  go({ screen: 'Tabs', params: { screen: 'Home' } });
                  return;
                case 'chat':
                  go({ screen: 'Tabs', params: { screen: 'Chat' } });
                  return;
                case 'tasks':
                  go({ screen: 'Tabs', params: { screen: 'Tasks' } });
                  return;
                case 'projects':
                  go({ screen: 'Tabs', params: { screen: 'Projects' } });
                  return;
                case 'profile':
                  go({ screen: 'Tabs', params: { screen: 'Profile' } });
                  return;
                case 'attendance':
                  go({ screen: 'Attendance' });
                  return;
                case 'leave':
                  go({ screen: 'Leave' });
                  return;
                case 'reports':
                  go({ screen: 'Reports' });
                  return;
                case 'hr':
                  go({ screen: 'Workforce' });
                  return;
                case 'employees':
                  go({ screen: 'Employees' });
                  return;
                case 'meetings':
                  go({ screen: 'Meetings' });
                  return;
                case 'docs':
                  go({ screen: 'Documents' });
                  return;
                case 'reports_all':
                  go({ screen: 'ReportsDashboard' });
                  return;
                default:
                  Alert.alert('Chưa hỗ trợ trên mobile', 'Module này hiện chưa có màn hình trên mobile.');
                  return;
              }
            }}
            style={styles.moduleRow}
          >
            <View style={[styles.modulePill, isActive ? styles.modulePillActive : styles.modulePillInactive]}>
              {isActive ? (
                <LinearGradient
                  colors={[hexToRgba(colors.primary, 0.34), hexToRgba(colors.primary, 0.12), hexToRgba(colors.primary, 0)]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
              ) : null}

              <View style={styles.iconSlot}>
                <Ionicons
                  name={m.icon}
                  size={20}
                  color={isActive ? colors.primaryDark : hexToRgba(colors.primaryDark, 0.72)}
                />

                {showDot ? <View style={styles.dot} /> : null}
                {showCount > 0 ? (
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{countLabel}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.moduleLabel, isActive ? styles.moduleLabelActive : styles.moduleLabelInactive]}>
                {m.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AppNavigator() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  return (
    <NavigationContainer ref={navigationRef} onReady={setNavigationReady}>
      {!isAuthenticated ? <AuthStack /> : !user?.companyId ? <OnboardingStackNavigator /> : <AppDrawer />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  drawerContent: { paddingTop: 10, paddingBottom: 16 },
  drawerHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: hexToRgba(colors.primaryDark, 0.10),
    marginBottom: 10,
  },
  drawerTitle: { color: colors.primaryDark, fontFamily: 'BeVietnamPro_800ExtraBold', fontSize: 18 },
  drawerSubtitle: { color: colors.muted, fontFamily: 'BeVietnamPro_500Medium', marginTop: 2 },

  modulesWrap: {
    paddingHorizontal: 12,
    gap: 10,
  },
  moduleRow: {
    width: '100%',
  },
  modulePill: {
    minHeight: 46,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  modulePillActive: {
    borderWidth: 2,
    borderColor: hexToRgba(colors.primary, 0.85),
    backgroundColor: hexToRgba(colors.primary, 0.10),
  },
  modulePillInactive: {
    borderWidth: 1,
    borderColor: hexToRgba(colors.primaryDark, 0.14),
    backgroundColor: hexToRgba(colors.card, 0.72),
  },
  iconSlot: {
    width: 28,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleLabel: {
    fontSize: 14,
    includeFontPadding: false,
  },
  moduleLabelActive: {
    color: colors.primaryDark,
    fontFamily: 'BeVietnamPro_700Bold',
  },
  moduleLabelInactive: {
    color: hexToRgba(colors.primaryDark, 0.84),
    fontFamily: 'BeVietnamPro_600SemiBold',
  },

  dot: {
    position: 'absolute',
    top: -1,
    right: -6,
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.card,
  },
  countBadge: {
    position: 'absolute',
    top: -8,
    right: -14,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.card,
  },
  countText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    includeFontPadding: false,
  },
});

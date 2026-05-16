import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme/colors';
import { HomeScreen } from '../screens/HomeScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { CommunicationScreen } from '../screens/CommunicationScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { MainTabParamList } from './types';
import { useBadgeStore } from '../store/badgeStore';

const Tab = createBottomTabNavigator<MainTabParamList>();

const iconByRoute: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Tasks: 'checkbox-outline',
  Projects: 'briefcase-outline',
  Chat: 'chatbubbles-outline',
  Profile: 'person-outline',
};

export function MainTabs() {
  const tasksDot = useBadgeStore((s) => s.tasksDot);
  const projectsDot = useBadgeStore((s) => s.projectsDot);
  const chatUnreadCount = useBadgeStore((s) => s.chatUnreadCount);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 2,
          borderTopColor: colors.border,
          paddingTop: 6,
        },
        tabBarIcon: ({ color, size }) => {
          const name = route.name as keyof MainTabParamList;
          const showDot = (name === 'Tasks' && tasksDot) || (name === 'Projects' && projectsDot);
          const showCount = name === 'Chat' ? chatUnreadCount : 0;
          const countLabel = showCount > 99 ? '99+' : String(showCount);

          return (
            <View style={styles.iconWrap}>
              <Ionicons name={iconByRoute[name]} size={size} color={color} />
              {showDot ? <View style={styles.dot} /> : null}
              {showCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{countLabel}</Text>
                </View>
              ) : null}
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Trang chủ' }} />
      <Tab.Screen name="Tasks" component={TasksScreen} options={{ title: 'Công việc' }} />
      <Tab.Screen name="Projects" component={ProjectsScreen} options={{ title: 'Dự án' }} />
      <Tab.Screen name="Chat" component={CommunicationScreen} options={{ title: 'Giao tiếp' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Hồ sơ' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 28,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
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

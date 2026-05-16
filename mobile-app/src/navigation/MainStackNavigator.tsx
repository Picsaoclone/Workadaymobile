import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainTabs } from './MainTabs';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { LeaveScreen } from '../screens/LeaveScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { ReportsDashboardScreen } from '../screens/ReportsDashboardScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { EmployeesScreen } from '../screens/EmployeesScreen';
import { WorkforceScreen } from '../screens/WorkforceScreen';
import { MeetingsScreen } from '../screens/MeetingsScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
import { ChatRoomScreen } from '../screens/ChatRoomScreen';
import { ForwardMessageScreen } from '../screens/ForwardMessageScreen';
import { CallScreen } from '../screens/CallScreen';
import { ChannelMembersScreen } from '../screens/ChannelMembersScreen';
import { AppStackParamList } from './types';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function OnboardingStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
    </Stack.Navigator>
  );
}

export function MainStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: 'BeVietnamPro_700Bold' },
      }}
    >
      <Stack.Screen
        name="Tabs"
        component={MainTabs}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Leave" component={LeaveScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ReportsDashboard" component={ReportsDashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Workforce" component={WorkforceScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Employees" component={EmployeesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Meetings" component={MeetingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Documents" component={DocumentsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Chi tiết công việc' }} />
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: 'Chi tiết dự án' }} />
      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={({ route }) => {
          const params: any = route.params;
          const channelTitle = params?.channelName ? `Chat · #${params.channelName}` : null;
          const dmTitle = params?.contactName ? `Chat · ${params.contactName}` : null;
          return { title: channelTitle || dmTitle || 'Chat' };
        }}
      />
      <Stack.Screen name="ChannelMembers" component={ChannelMembersScreen} options={{ title: 'Thành viên nhóm' }} />
      <Stack.Screen name="Call" component={CallScreen} options={({ route }) => ({ title: route.params?.title || 'Cuộc gọi' })} />
      <Stack.Screen name="ForwardMessage" component={ForwardMessageScreen} options={{ title: 'Chuyển tiếp' }} />
    </Stack.Navigator>
  );
}

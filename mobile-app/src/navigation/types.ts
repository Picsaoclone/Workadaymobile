import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Tasks: undefined;
  Projects: undefined;
  Chat: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Onboarding: undefined;
  Attendance: undefined;
  Leave: undefined;
  Reports: undefined;
  ReportsDashboard: undefined;
  Workforce: undefined;
  Employees: undefined;
  Meetings: undefined;
  Documents: undefined;
  Notifications: undefined;
  TaskDetail: { taskId: string };
  ProjectDetail: { projectId: string };
  ChannelMembers: { channelId: string };
  Call: {
    agoraChannelName: string;
    mode: 'voice' | 'video';
    title?: string;
    callId?: string;
    callRole?: 'caller' | 'callee';
    otherUserId?: string;
    channelId?: string;
    autoAccept?: boolean;
    acceptedViaPushAction?: boolean;
  };
  ChatRoom:
    | { contactId: string; contactName?: string }
    | { channelId: string; channelName?: string };
  ForwardMessage: {
    message: {
      content: string;
      type: 'text' | 'file' | 'image' | 'system';
      attachments?: { url: string; name: string; type: string; size: number; resourceType?: 'image' | 'file' }[];
    };
  };
};

export type RootDrawerParamList = {
  Main: NavigatorScreenParams<AppStackParamList>;
};

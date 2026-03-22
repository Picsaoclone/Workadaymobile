import { create } from 'zustand';
import type { Notification } from '../types/models';
import { notificationApi } from '../services/api';
import { setAppIconBadgeCount } from '../services/iconBadge';

type BadgeState = {
  tasksDot: boolean;
  projectsDot: boolean;
  chatUnreadCount: number;
  appIconBadgeCount: number;
  unreadChatLinks: Set<string>;

  setFromNotifications: (notifications: Notification[]) => void;
  refreshFromServer: () => Promise<void>;

  markChatLinkUnread: (link: string) => void;
  markChatLinksRead: (links: string[]) => void;

  clearTasksDot: () => void;
  clearProjectsDot: () => void;
  clearChatUnread: () => void;

  bumpTasksDot: () => void;
  bumpProjectsDot: () => void;
  bumpChatUnread: (delta?: number) => void;
};

const computeFromNotifications = (notifications: Notification[]) => {
  const unread = (notifications || []).filter((n) => !n.isRead);
  const tasksDot = unread.some((n) => n.type === 'task_assigned');
  const projectsDot = unread.some((n) => n.type === 'project_update');
  const chatUnreadCount = unread.filter((n) => n.type === 'message').length;
  const appIconBadgeCount = unread.length;
  const unreadChatLinks = new Set<string>();
  unread
    .filter((n) => n.type === 'message')
    .forEach((n) => {
      const link = String(n.link || '').trim();
      if (link) unreadChatLinks.add(link);
    });

  return { tasksDot, projectsDot, chatUnreadCount, appIconBadgeCount, unreadChatLinks };
};

const approximateBadgeCount = (state: Pick<BadgeState, 'tasksDot' | 'projectsDot' | 'chatUnreadCount'>) => {
  return state.chatUnreadCount + (state.tasksDot ? 1 : 0) + (state.projectsDot ? 1 : 0);
};

export const useBadgeStore = create<BadgeState>((set, get) => ({
  tasksDot: false,
  projectsDot: false,
  chatUnreadCount: 0,
  appIconBadgeCount: 0,
  unreadChatLinks: new Set<string>(),

  setFromNotifications: (notifications) => {
    const next = computeFromNotifications(notifications);
    set(next);
    void setAppIconBadgeCount(next.appIconBadgeCount);
  },

  refreshFromServer: async () => {
    try {
      const response = await notificationApi.getAll();
      const notifications = response.data.data || [];
      const next = computeFromNotifications(notifications);
      set(next);
      void setAppIconBadgeCount(next.appIconBadgeCount);
    } catch {
      // Ignore: badges are best-effort.
    }
  },

  markChatLinkUnread: (link) => {
    const clean = String(link || '').trim();
    if (!clean) return;
    const next = new Set(get().unreadChatLinks);
    next.add(clean);
    set({ unreadChatLinks: next });
  },

  markChatLinksRead: (links) => {
    const list = Array.isArray(links) ? links.map((l) => String(l || '').trim()).filter(Boolean) : [];
    if (list.length === 0) return;
    const next = new Set(get().unreadChatLinks);
    for (const l of list) next.delete(l);
    set({ unreadChatLinks: next });
  },

  clearTasksDot: () => {
    set({ tasksDot: false });
    const current = get();
    const nextCount = approximateBadgeCount({
      tasksDot: current.tasksDot,
      projectsDot: current.projectsDot,
      chatUnreadCount: current.chatUnreadCount,
    });
    set({ appIconBadgeCount: nextCount });
    void setAppIconBadgeCount(nextCount);
  },
  clearProjectsDot: () => {
    set({ projectsDot: false });
    const current = get();
    const nextCount = approximateBadgeCount({
      tasksDot: current.tasksDot,
      projectsDot: current.projectsDot,
      chatUnreadCount: current.chatUnreadCount,
    });
    set({ appIconBadgeCount: nextCount });
    void setAppIconBadgeCount(nextCount);
  },
  clearChatUnread: () => {
    set({ chatUnreadCount: 0 });
    const current = get();
    const nextCount = approximateBadgeCount({
      tasksDot: current.tasksDot,
      projectsDot: current.projectsDot,
      chatUnreadCount: current.chatUnreadCount,
    });
    set({ appIconBadgeCount: nextCount });
    void setAppIconBadgeCount(nextCount);
  },

  bumpTasksDot: () => {
    set({ tasksDot: true });
    const current = get();
    const nextCount = approximateBadgeCount({
      tasksDot: current.tasksDot,
      projectsDot: current.projectsDot,
      chatUnreadCount: current.chatUnreadCount,
    });
    set({ appIconBadgeCount: nextCount });
    void setAppIconBadgeCount(nextCount);
  },
  bumpProjectsDot: () => {
    set({ projectsDot: true });
    const current = get();
    const nextCount = approximateBadgeCount({
      tasksDot: current.tasksDot,
      projectsDot: current.projectsDot,
      chatUnreadCount: current.chatUnreadCount,
    });
    set({ appIconBadgeCount: nextCount });
    void setAppIconBadgeCount(nextCount);
  },
  bumpChatUnread: (delta = 1) => {
    set({ chatUnreadCount: Math.max(0, get().chatUnreadCount + delta) });
    const current = get();
    const nextCount = approximateBadgeCount({
      tasksDot: current.tasksDot,
      projectsDot: current.projectsDot,
      chatUnreadCount: current.chatUnreadCount,
    });
    set({ appIconBadgeCount: nextCount });
    void setAppIconBadgeCount(nextCount);
  },
}));

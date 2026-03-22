import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, ViewProps } from 'react-native';
import { ScrollViewProps } from 'react-native';
import { Edge, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { DrawerActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { hexToRgba } from '../utils/color';
import { navigationRef } from '../navigation/navigationRef';
import { useBadgeStore } from '../store/badgeStore';

interface ScreenProps extends ViewProps, ScrollViewProps {
  scroll?: boolean;
  safeEdges?: Edge[];
  loading?: boolean;
  loadingLabel?: string;
  backgroundColor?: string;
  gradient?: boolean;
  gradientVariant?: 'auto' | 'day' | 'night';
  statusBarStyle?: 'auto' | 'light' | 'dark';
}

const FLOATING_BUTTON_SIZE = 44;

let savedDrawerButtonPos: { x: number; y: number } | null = null;
let savedBellButtonPos: { x: number; y: number } | null = null;

export function Screen({
  children,
  style,
  scroll = true,
  safeEdges,
  loading = false,
  loadingLabel = 'Đang tải dữ liệu...',
  backgroundColor = colors.background,
  gradient = true,
  gradientVariant = 'auto',
  statusBarStyle = 'auto',
  ...rest
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const unreadCount = useBadgeStore((s) => s.appIconBadgeCount);

  const currentRouteName = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
  const shouldShowDrawerButton =
    currentRouteName === 'Home' ||
    currentRouteName === 'Tasks' ||
    currentRouteName === 'Projects' ||
    currentRouteName === 'Chat' ||
    currentRouteName === 'Profile';

  const canGoBack = navigationRef.isReady() ? navigationRef.canGoBack() : false;
  const shouldShowBackButton = !shouldShowDrawerButton && canGoBack;
  const shouldShowBell = Boolean(currentRouteName) && currentRouteName !== 'Notifications';
  const bellCount = Math.max(0, Number(unreadCount || 0));
  const bellLabel = bellCount > 99 ? '99+' : String(bellCount);
  const requestedEdges = safeEdges ?? (['left', 'right', 'bottom'] as Edge[]);
  const includeTopEdge = requestedEdges.includes('top');
  const edges = includeTopEdge ? (requestedEdges.filter((edge) => edge !== 'top') as Edge[]) : requestedEdges;

  const hour = new Date().getHours();
  const isNight = hour >= 18 || hour < 6;
  const resolvedVariant = gradientVariant === 'auto' ? (isNight ? 'night' : 'day') : gradientVariant;

  const gradientColors: [string, string, string] =
    resolvedVariant === 'night'
      ? [hexToRgba(colors.purple, 0.42), hexToRgba(colors.purple, 0.18), backgroundColor]
      : [colors.primary, hexToRgba(colors.primary, 0.18), backgroundColor];

  const resolvedStatusBarStyle: 'light' | 'dark' =
    statusBarStyle === 'auto' ? (resolvedVariant === 'night' ? 'light' : 'dark') : statusBarStyle;

  const statusBarFillColor = gradient ? gradientColors[0] : backgroundColor;

  const clamp = useCallback((value: number, min: number, max: number) => Math.max(min, Math.min(max, value)), []);

  const bounds = useMemo(() => {
    const margin = 8;
    const minX = margin;
    const maxX = Math.max(minX, windowWidth - FLOATING_BUTTON_SIZE - margin);
    const minY = insets.top + 6;
    const maxY = Math.max(minY, windowHeight - insets.bottom - FLOATING_BUTTON_SIZE - margin);
    return { minX, maxX, minY, maxY };
  }, [insets.bottom, insets.top, windowHeight, windowWidth]);

  const clampPos = useCallback(
    (pos: { x: number; y: number }) => ({
      x: clamp(pos.x, bounds.minX, bounds.maxX),
      y: clamp(pos.y, bounds.minY, bounds.maxY),
    }),
    [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, clamp]
  );

  const defaultDrawerPos = useMemo(
    () => ({ x: 12, y: insets.top + 10 }),
    [insets.top]
  );

  const defaultBellPos = useMemo(
    () => ({ x: windowWidth - 12 - FLOATING_BUTTON_SIZE, y: insets.top + 10 }),
    [insets.top, windowWidth]
  );

  const drawerPan = useRef(new Animated.ValueXY(clampPos(savedDrawerButtonPos ?? defaultDrawerPos))).current;
  const bellPan = useRef(new Animated.ValueXY(clampPos(savedBellButtonPos ?? defaultBellPos))).current;

  useEffect(() => {
    const next = clampPos(savedDrawerButtonPos ?? defaultDrawerPos);
    drawerPan.setValue(next);
    savedDrawerButtonPos = next;
  }, [clampPos, defaultDrawerPos, drawerPan]);

  useEffect(() => {
    const next = clampPos(savedBellButtonPos ?? defaultBellPos);
    bellPan.setValue(next);
    savedBellButtonPos = next;
  }, [bellPan, clampPos, defaultBellPos]);

  const createPanResponder = useCallback(
    (pan: Animated.ValueXY, onSave: (pos: { x: number; y: number }) => void) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
        onPanResponderGrant: () => {
          const x = (pan.x as any).__getValue?.() ?? 0;
          const y = (pan.y as any).__getValue?.() ?? 0;
          pan.setOffset({ x, y });
          pan.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: () => {
          pan.flattenOffset();
          const x = (pan.x as any).__getValue?.() ?? 0;
          const y = (pan.y as any).__getValue?.() ?? 0;
          const next = clampPos({ x, y });
          pan.setValue(next);
          onSave(next);
        },
      }),
    [clampPos]
  );

  const drawerPanResponder = useMemo(
    () =>
      createPanResponder(drawerPan, (pos) => {
        savedDrawerButtonPos = pos;
      }),
    [createPanResponder, drawerPan]
  );

  const bellPanResponder = useMemo(
    () =>
      createPanResponder(bellPan, (pos) => {
        savedBellButtonPos = pos;
      }),
    [bellPan, createPanResponder]
  );

  return (
    <View style={[styles.safe, { backgroundColor }]}> 
      <StatusBar style={resolvedStatusBarStyle} translucent backgroundColor="transparent" />

      {includeTopEdge ? <View style={[styles.statusBarFill, { height: insets.top, backgroundColor: statusBarFillColor }]} /> : null}

      <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={edges}>
        <View style={styles.root}>
        {gradient ? (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.pageGradient}
            pointerEvents="none"
          />
        ) : null}

        {shouldShowDrawerButton ? (
          <Animated.View style={[styles.drawerButton, drawerPan.getLayout()]} {...drawerPanResponder.panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mở menu"
              onPress={() => {
                if (!navigationRef.isReady()) return;
                try {
                  navigationRef.dispatch(DrawerActions.openDrawer());
                } catch {
                  // ignore
                }
              }}
              style={styles.floatingPressable}
            >
              <Ionicons name="menu" size={22} color={colors.primaryDark} />
            </Pressable>
          </Animated.View>
        ) : shouldShowBackButton ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={() => {
              if (!navigationRef.isReady()) return;
              try {
                navigationRef.goBack();
              } catch {
                // ignore
              }
            }}
              style={[styles.drawerButton, { top: insets.top + 10 }]}
          >
            <Ionicons name="arrow-back" size={22} color={colors.primaryDark} />
          </Pressable>
        ) : null}

        {shouldShowBell ? (
          <Animated.View style={[styles.bellButton, bellPan.getLayout()]} {...bellPanResponder.panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Thông báo"
              onPress={() => {
                if (!navigationRef.isReady()) return;
                try {
                  navigationRef.navigate('Notifications' as never);
                } catch {
                  // ignore
                }
              }}
              style={styles.floatingPressable}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.primaryDark} />
              {bellCount > 0 ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{bellLabel}</Text>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        ) : null}

        {scroll ? (
          <ScrollView contentContainerStyle={[styles.content, style]} {...rest}>
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, style]} {...rest}>
            {children}
          </View>
        )}

        {loading ? (
          <View style={[styles.loadingOverlay, { backgroundColor }]} pointerEvents="auto">
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>{loadingLabel}</Text>
            </View>
          </View>
        ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statusBarFill: {
    width: '100%',
  },
  root: {
    flex: 1,
    position: 'relative',
  },
  pageGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  drawerButton: {
    position: 'absolute',
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hexToRgba(colors.card, 0.92),
    borderWidth: 2,
    borderColor: hexToRgba(colors.border, 0.72),
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    opacity: 0.58,
    zIndex: 30,
  },
  floatingPressable: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hexToRgba(colors.card, 0.92),
    borderWidth: 2,
    borderColor: hexToRgba(colors.border, 0.72),
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    opacity: 0.32,
    zIndex: 30,
  },
  bellBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
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
  bellBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    includeFontPadding: false,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  loadingCard: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
});

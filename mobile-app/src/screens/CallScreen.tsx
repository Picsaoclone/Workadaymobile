import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  ChannelProfileType,
  ClientRoleType,
  createAgoraRtcEngine,
  IRtcEngine,
  RtcSurfaceView,
  RtcTextureView,
  VideoSourceType,
} from 'react-native-agora';

import { AppStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { AppButton } from '../components/AppButton';
import { useAuthStore } from '../store/authStore';
import { agoraApi } from '../services/api';
import { deriveAgoraUid } from '../utils/agoraUid';
import { getApiErrorMessage } from '../services/error';
import { getRealtimeSocket } from '../services/realtimeSingleton';
import { startIncomingRingtone, stopIncomingRingtone } from '../utils/ringtone';

// NOTE: App Certificate must stay on backend (.env). Mobile only needs App ID.
const AGORA_APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID;

type Props = NativeStackScreenProps<AppStackParamList, 'Call'>;

export function CallScreen({ route, navigation }: Props) {
  const {
    agoraChannelName: initialAgoraChannelName,
    mode,
    title,
    callId,
    callRole,
    otherUserId,
    channelId,
    autoAccept,
    acceptedViaPushAction,
  } = route.params;
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  const isCaller = callRole === 'caller';
  const isCallee = callRole === 'callee';

  // Caller must wait until callee accepts.
  const shouldWaitForCallerAccept = isCaller && !!callId;
  // Callee may open this screen from push tap; in that case we must wait for user to Accept.
  const shouldWaitForCalleeDecision = isCallee && !!callId && autoAccept === false;

  const engineRef = useRef<IRtcEngine | null>(null);
  const [joined, setJoined] = useState(false);
  const [agoraReady, setAgoraReady] = useState(false);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(mode === 'video');
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [canJoinAgora, setCanJoinAgora] = useState(!shouldWaitForCallerAccept && !shouldWaitForCalleeDecision);
  const [agoraChannelName, setAgoraChannelName] = useState(initialAgoraChannelName);

  const [isAccepting, setIsAccepting] = useState(false);

  const acceptSentRef = useRef(false);

  useEffect(() => {
    if (!isCallee) return;
    if (!autoAccept) return;
    if (acceptedViaPushAction) return;
    if (acceptSentRef.current) return;
    if (!token || !callId || !otherUserId) return;

    acceptSentRef.current = true;
    stopIncomingRingtone();
    try {
      const socket = getRealtimeSocket(token);
      socket.emit('call_accept', {
        callId,
        callerId: otherUserId,
        channelId: channelId || '',
        mode,
        agoraChannelName,
        title,
      });
    } catch {
      // ignore
    }
  }, [agoraChannelName, acceptedViaPushAction, autoAccept, channelId, isCallee, mode, otherUserId, title, token, callId]);

  useEffect(() => {
    if (!shouldWaitForCalleeDecision) return;
    if (!token || !callId) return;

    // If the user opened from a push tap, start an in-app ringtone while we wait for Accept/Decline.
    void startIncomingRingtone({
      title: title || (mode === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi'),
      body: 'Chạm để nhận hoặc từ chối',
      data: {
        kind: 'incoming_call',
        callId,
        callerId: otherUserId,
        callerName: undefined,
        channelId,
        mode,
        agoraChannelName,
        title,
      },
    });

    try {
      const socket = getRealtimeSocket(token);
      socket.emit('call_get', { callId }, (resp: any) => {
        if (!resp?.ok) return;
        const state = resp?.state;
        if (!state) return;
        if (String(state.callId) !== String(callId)) return;
        const status = String(state.status || '');
        if (status === 'cancelled' || status === 'ended' || status === 'rejected') {
          Alert.alert('Cuộc gọi', 'Cuộc gọi đã kết thúc hoặc bị hủy.');
          navigation.goBack();
        }
      });
    } catch {
      // ignore
    }
    return () => {
      stopIncomingRingtone();
    };
  }, [callId, navigation, shouldWaitForCalleeDecision, token]);

  const uid = useMemo(() => deriveAgoraUid(String(user?._id || 'unknown-user')), [user?._id]);
  const visibleRemoteUids = useMemo(() => remoteUids.slice(0, 6), [remoteUids]);

  const ensurePermissions = async () => {
    if (Platform.OS !== 'android') return;

    const permissions: string[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (mode === 'video') permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);

    const result = await PermissionsAndroid.requestMultiple(permissions as any);
    const denied = Object.entries(result).filter(([, v]) => v !== PermissionsAndroid.RESULTS.GRANTED);
    if (denied.length > 0) {
      throw new Error('Thiếu quyền micro/camera để thực hiện cuộc gọi.');
    }
  };

  const leave = async () => {
    stopIncomingRingtone();
    if (token && callId && otherUserId) {
      try {
        const socket = getRealtimeSocket(token);
        if (isCaller && !joined) {
          socket.emit('call_cancel', { callId, recipientId: otherUserId });
        } else if (isCallee && !joined && shouldWaitForCalleeDecision) {
          socket.emit('call_reject', { callId, callerId: otherUserId, reason: 'declined' });
        } else {
          socket.emit('call_end', { callId, otherUserId });
        }
      } catch {
        // ignore
      }
    }

    try {
      const engine = engineRef.current;
      if (engine) {
        if (joined) {
          await engine.leaveChannel();
        }
        engine.release();
      }
    } finally {
      engineRef.current = null;
      setJoined(false);
      setAgoraReady(false);
      setRemoteUids([]);
      navigation.goBack();
    }
  };

  useEffect(() => {
    if (!shouldWaitForCallerAccept) {
      if (isCaller) setCanJoinAgora(true);
      return;
    }
    if (!token || !callId) return;

    const socket = getRealtimeSocket(token);

    const onAccept = (payload: any) => {
      if (!payload || String(payload.callId) !== String(callId)) return;
      if (payload.agoraChannelName) setAgoraChannelName(String(payload.agoraChannelName));
      setCanJoinAgora(true);
    };

    const onReject = (payload: any) => {
      if (!payload || String(payload.callId) !== String(callId)) return;
      Alert.alert('Cuộc gọi', 'Người nhận đã từ chối cuộc gọi.');
      navigation.goBack();
    };

    socket.on('call_accept', onAccept);
    socket.on('call_reject', onReject);

    // Avoid race condition: if accept happened before we mounted this screen,
    // fetch current state from server.
    try {
      socket.emit('call_get', { callId }, (resp: any) => {
        if (!resp?.ok || !resp?.state) return;
        if (String(resp.state.callId) !== String(callId)) return;
        if (resp.state.status !== 'accepted') return;
        if (resp.state.agoraChannelName) setAgoraChannelName(String(resp.state.agoraChannelName));
        setCanJoinAgora(true);
      });
    } catch {
      // ignore
    }

    return () => {
      socket.off('call_accept', onAccept);
      socket.off('call_reject', onReject);
    };
  }, [callId, navigation, shouldWaitForCallerAccept, token]);

  useEffect(() => {
    if (!token || !callId) return;
    const socket = getRealtimeSocket(token);

    const onEnd = (payload: any) => {
      if (!payload || String(payload.callId) !== String(callId)) return;
      Alert.alert('Cuộc gọi', 'Cuộc gọi đã kết thúc.');
      navigation.goBack();
    };

    socket.on('call_end', onEnd);
    return () => {
      socket.off('call_end', onEnd);
    };
  }, [callId, navigation, token]);

  useEffect(() => {
    if (!canJoinAgora) return;

    let cancelled = false;

    const start = async () => {
      try {
        if (!AGORA_APP_ID || !AGORA_APP_ID.trim()) {
          Alert.alert('Thiếu cấu hình Agora', 'Bạn cần set EXPO_PUBLIC_AGORA_APP_ID trong mobile-app/.env');
          navigation.goBack();
          return;
        }

        await ensurePermissions();

        const tokenRes = await agoraApi.token({
          channelName: agoraChannelName,
          uid,
          role: 'publisher',
          expireSeconds: 3600,
        });

        if (!tokenRes.data?.success || !tokenRes.data?.data?.token) {
          throw new Error(tokenRes.data?.message || 'Không lấy được Agora token.');
        }

        if (cancelled) return;

        const engine = createAgoraRtcEngine();
        engineRef.current = engine;

        engine.registerEventHandler({
          onJoinChannelSuccess: () => {
            setJoined(true);
          },
          onUserJoined: (_connection, remoteUid) => {
            setRemoteUids((prev) => (prev.includes(remoteUid) ? prev : [...prev, remoteUid]));
          },
          onUserOffline: (_connection, remoteUid) => {
            setRemoteUids((prev) => prev.filter((id) => id !== remoteUid));
          },
          onLeaveChannel: () => {
            setJoined(false);
            setRemoteUids([]);
          },
        });

        engine.initialize({
          appId: tokenRes.data.data.appId,
          channelProfile: ChannelProfileType.ChannelProfileCommunication,
        });

        setAgoraReady(true);

        engine.enableAudio();
        engine.setEnableSpeakerphone(true);

        if (mode === 'video') {
          engine.enableVideo();
          engine.muteLocalVideoStream(!videoEnabled);
          engine.startPreview();
        } else {
          engine.disableVideo();
        }

        engine.joinChannel(tokenRes.data.data.token, tokenRes.data.data.channelName, uid, {
          clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        });
      } catch (err: any) {
        if (cancelled) return;
        Alert.alert('Không thể bắt đầu cuộc gọi', getApiErrorMessage(err) || String(err?.message || err));
        navigation.goBack();
      }
    };

    void start();

    return () => {
      cancelled = true;
      setAgoraReady(false);
      const engine = engineRef.current;
      if (engine) {
        try {
          engine.leaveChannel();
        } catch {
          // ignore
        }
        try {
          engine.release();
        } catch {
          // ignore
        }
      }
      engineRef.current = null;
    };
  }, [agoraChannelName, canJoinAgora, mode, navigation, uid]);

  useEffect(() => {
    if (mode !== 'video') return;
    if (!agoraReady) return;
    const engine = engineRef.current;
    if (!engine) return;
    try {
      if (videoEnabled) engine.startPreview();
      else engine.stopPreview();
    } catch {
      // ignore
    }
  }, [agoraReady, mode, videoEnabled]);

  const toggleMute = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !muted;
    setMuted(next);
    engine.muteLocalAudioStream(next);
  };

  const toggleSpeaker = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !speakerEnabled;
    setSpeakerEnabled(next);
    engine.setEnableSpeakerphone(next);
  };

  const toggleVideo = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !videoEnabled;
    setVideoEnabled(next);
    engine.muteLocalVideoStream(!next);
    if (next) engine.startPreview();
    else engine.stopPreview();
  };

  const headerTitle = title || (mode === 'video' ? 'Video call' : 'Cuộc gọi');
  const headerStatus = (shouldWaitForCallerAccept && !canJoinAgora)
    ? 'Đang đổ chuông...'
    : (shouldWaitForCalleeDecision && !canJoinAgora)
      ? 'Chờ bạn chấp nhận...'
      : joined
        ? 'Đã kết nối'
        : 'Đang kết nối...';

  const VideoView = Platform.OS === 'android' ? RtcTextureView : RtcSurfaceView;

  return (
    <Screen scroll={false} style={styles.screen}>
      <Card style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{headerTitle}</Text>
            <Text style={styles.subTitle}>{headerStatus}</Text>
          </View>
          <TouchableOpacity style={styles.hangupBtn} onPress={() => void leave()}>
            <Ionicons name="call" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </Card>

      <View style={styles.body}>
        {shouldWaitForCalleeDecision && !canJoinAgora ? (
          <View style={styles.incomingWrap}>
            <Text style={styles.incomingText}>Bạn có muốn nhận cuộc gọi không?</Text>
            <View style={styles.incomingBtns}>
              <AppButton
                label="Từ chối"
                variant="outline"
                disabled={isAccepting}
                style={{ flex: 1 }}
                onPress={() => {
                  void leave();
                }}
              />
              <AppButton
                label={isAccepting ? 'Đang nhận...' : 'Nhận'}
                loading={isAccepting}
                disabled={isAccepting}
                style={{ flex: 1 }}
                onPress={() => {
                  if (!token || !callId || !otherUserId) {
                    Alert.alert('Cuộc gọi', 'Thiếu dữ liệu cuộc gọi.');
                    return;
                  }

                  setIsAccepting(true);

                  const fallback = setTimeout(() => {
                    setCanJoinAgora(true);
                    setIsAccepting(false);
                  }, 1500);

                  try {
                    const socket = getRealtimeSocket(token);
                    socket.emit(
                      'call_accept',
                      {
                        callId,
                        callerId: otherUserId,
                        channelId: channelId || '',
                        mode,
                        agoraChannelName,
                        title,
                      },
                      () => {
                        clearTimeout(fallback);
                        setCanJoinAgora(true);
                        setIsAccepting(false);
                      }
                    );
                  } catch {
                    clearTimeout(fallback);
                    setCanJoinAgora(true);
                    setIsAccepting(false);
                  }
                }}
              />
            </View>
          </View>
        ) : mode === 'video' ? (
          <View style={styles.videoGrid}>
            <View style={styles.videoTile}>
              {agoraReady && videoEnabled ? (
                <VideoView style={styles.video} canvas={{ uid, sourceType: VideoSourceType.VideoSourceCamera }} />
              ) : (
                <View style={[styles.video, styles.videoOff]} />
              )}
              <Text style={styles.videoLabel}>Bạn</Text>
            </View>

            {visibleRemoteUids.length === 0 ? (
              <View style={[styles.videoTile, styles.waitTile]}>
                <Text style={styles.waitText}>Đang chờ người khác tham gia...</Text>
              </View>
            ) : null}

            {visibleRemoteUids.map((remoteUid) => (
              <View key={`remote-${remoteUid}`} style={styles.videoTile}>
                {agoraReady ? <VideoView style={styles.video} canvas={{ uid: remoteUid }} /> : <View style={styles.video} />}
                <Text style={styles.videoLabel}>UID {remoteUid}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.voiceWrap}>
            <Text style={styles.voiceText}>{remoteUids.length > 0 ? 'Đang gọi...' : 'Đang chờ người khác tham gia...'}</Text>
          </View>
        )}
      </View>

      {shouldWaitForCalleeDecision && !canJoinAgora ? null : (
        <Card style={styles.controlsCard}>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.ctrlBtn} onPress={() => void toggleMute()}>
              <Ionicons name={muted ? 'mic-off-outline' : 'mic-outline'} size={20} color={colors.text} />
              <Text style={styles.ctrlText}>{muted ? 'Tắt mic' : 'Mic'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ctrlBtn} onPress={() => void toggleSpeaker()}>
              <Ionicons name={speakerEnabled ? 'volume-high-outline' : 'volume-mute-outline'} size={20} color={colors.text} />
              <Text style={styles.ctrlText}>Loa</Text>
            </TouchableOpacity>

            {mode === 'video' ? (
              <TouchableOpacity style={styles.ctrlBtn} onPress={() => void toggleVideo()}>
                <Ionicons name={videoEnabled ? 'videocam-outline' : 'videocam-off-outline'} size={20} color={colors.text} />
                <Text style={styles.ctrlText}>Video</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.ctrlBtn} onPress={() => void leave()}>
              <Ionicons name="call-outline" size={20} color={colors.danger} />
              <Text style={[styles.ctrlText, { color: colors.danger }]}>Kết thúc</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerCard: { margin: 16, padding: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontFamily: 'BeVietnamPro_900Black', fontSize: 16 },
  subTitle: { color: colors.muted, marginTop: 2, fontFamily: 'BeVietnamPro_700Bold' },
  hangupBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  body: { flex: 1, paddingHorizontal: 16 },
  incomingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  incomingText: { color: colors.text, fontFamily: 'BeVietnamPro_900Black', fontSize: 16, textAlign: 'center' },
  incomingBtns: { width: '100%', flexDirection: 'row', gap: 12 },
  videoGrid: { flex: 1, gap: 12 },
  videoTile: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.border,
    position: 'relative',
  },
  video: { width: '100%', height: '100%' },
  videoOff: { backgroundColor: colors.primaryDark },
  videoLabel: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    color: colors.white,
    fontFamily: 'BeVietnamPro_900Black',
  },
  waitTile: { alignItems: 'center', justifyContent: 'center' },
  waitText: { color: colors.muted, fontFamily: 'BeVietnamPro_800ExtraBold' },
  voiceWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  voiceText: { color: colors.text, fontFamily: 'BeVietnamPro_900Black', fontSize: 16 },
  controlsCard: { margin: 16, padding: 12 },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  ctrlBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 4 },
  ctrlText: { color: colors.text, fontFamily: 'BeVietnamPro_800ExtraBold', fontSize: 12 },
});

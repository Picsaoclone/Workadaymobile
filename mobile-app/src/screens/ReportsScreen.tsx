import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { colors } from '../theme/colors';
import { hexToRgba } from '../utils/color';
import { projectApi, reportApi, uploadApi, userApi } from '../services/api';
import { AuthUser, EmployeeReport, MessageAttachment, Project } from '../types/models';
import { useAuthStore } from '../store/authStore';

type ReportTab = 'all' | 'submitted' | 'viewed' | 'approved' | 'changes_requested';

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoToVNDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '').trim();
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const guessFileName = (uri: string, fallback: string) => {
  const clean = String(uri || '').trim();
  const parts = clean.split('/');
  const last = parts[parts.length - 1] || '';
  return last.includes('.') ? last : fallback;
};

const openUrl = async (url: string) => {
  const u = String(url || '').trim();
  if (!u) return;
  const supported = await Linking.canOpenURL(u);
  if (!supported) throw new Error('Không mở được link này.');
  await Linking.openURL(u);
};

const safeFileName = (name: string) => (String(name || '').trim() || 'download').replace(/[\\/:*?"<>|]/g, '_');

const buildCloudinaryDownloadUrl = (url: string, filename: string) => {
  const cleanUrl = String(url || '').split('?')[0];
  const cleanName = String(filename || '').trim() || 'download';
  // For Cloudinary raw uploads, force download and set filename to preserve extension.
  if (!cleanUrl.includes('/raw/upload/')) return url;
  const encodedName = encodeURIComponent(cleanName);
  const [prefix, rest] = cleanUrl.split('/raw/upload/');
  if (!prefix || !rest) return url;
  if (rest.startsWith('fl_attachment')) return cleanUrl;
  return `${prefix}/raw/upload/fl_attachment:${encodedName}/${rest}`;
};

const downloadAndOpen = async (url: string, filename: string) => {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) return;

  try {
    const cleanName = safeFileName(filename);
    const primaryUrl = cleanUrl;
    const secondaryUrl = buildCloudinaryDownloadUrl(cleanUrl, cleanName) || cleanUrl;

    const downloadToLocal = async (sourceUrl: string) => {
      // 1) Try new SDK 54 API
      try {
        const baseDir = FileSystem.Paths.cache || FileSystem.Paths.document;
        const destination = new FileSystem.File(baseDir, `${Date.now()}-${cleanName}`);
        const downloaded = await FileSystem.File.downloadFileAsync(sourceUrl, destination, { idempotent: true });
        return downloaded.uri;
      } catch {
        // 2) Fallback to legacy API (often more reliable in Expo Go)
        const cacheDir = (LegacyFileSystem as any).cacheDirectory || (LegacyFileSystem as any).documentDirectory;
        if (!cacheDir) return null;
        const legacyTarget = `${cacheDir}${Date.now()}-${cleanName}`;
        const legacyResult = await (LegacyFileSystem as any).downloadAsync(sourceUrl, legacyTarget);
        return legacyResult?.uri || null;
      }
    };

    const verifyNotEmpty = async (fileUri: string | null) => {
      if (!fileUri) return false;
      try {
        const info = await (LegacyFileSystem as any).getInfoAsync(fileUri);
        const size = Number(info?.size || 0);
        return size > 0;
      } catch {
        return true;
      }
    };

    let localUri: string | null = await downloadToLocal(primaryUrl);
    if (!(await verifyNotEmpty(localUri))) {
      localUri = await downloadToLocal(secondaryUrl);
    }

    if (!(await verifyNotEmpty(localUri))) {
      await openUrl(secondaryUrl);
      return;
    }

    if (!localUri) {
      await openUrl(secondaryUrl);
      return;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(localUri);
      return;
    }

    await openUrl(localUri);
  } catch (err: any) {
    const detail = String(err?.message || err || '').trim();
    Alert.alert('Không thể tải tệp', detail || 'Vui lòng thử lại.');
  }
};

const reportStatusLabel = (s: EmployeeReport['status']) => {
  if (s === 'submitted') return 'Chờ duyệt';
  if (s === 'viewed') return 'Đã xem';
  if (s === 'approved') return 'Đã duyệt';
  if (s === 'changes_requested') return 'Cần chỉnh sửa';
  return 'Nháp';
};

const reportStatusPill = (s: EmployeeReport['status']) => {
  if (s === 'submitted') return { bg: hexToRgba(colors.warning, 0.14), border: hexToRgba(colors.warning, 0.5), text: colors.warning };
  if (s === 'viewed') return { bg: hexToRgba(colors.info, 0.12), border: hexToRgba(colors.info, 0.45), text: colors.info };
  if (s === 'approved') return { bg: hexToRgba(colors.success, 0.16), border: hexToRgba(colors.success, 0.5), text: colors.success };
  if (s === 'changes_requested') return { bg: hexToRgba(colors.danger, 0.12), border: hexToRgba(colors.danger, 0.45), text: colors.danger };
  return { bg: hexToRgba(colors.muted, 0.08), border: hexToRgba(colors.muted, 0.25), text: colors.muted };
};

export function ReportsScreen() {
  const me = useAuthStore((s) => s.user);
  const isReviewer = me?.role === 'admin' || me?.role === 'manager';

  const [reports, setReports] = useState<EmployeeReport[]>([]);
  const [reviewers, setReviewers] = useState<Array<Pick<AuthUser, '_id' | 'name' | 'email' | 'role'>>>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [activeTab, setActiveTab] = useState<ReportTab>('all');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReviewerModal, setShowReviewerModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editing, setEditing] = useState<EmployeeReport | null>(null);

  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState<Pick<AuthUser, '_id' | 'name' | 'email' | 'role'> | null>(null);
  const [project, setProject] = useState<Pick<Project, '_id' | 'name'> | null>(null);
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<(MessageAttachment & { resourceType?: 'image' | 'file' })[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [detail, setDetail] = useState<EmployeeReport | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setEditing(null);
    setTitle('');
    setAssignedTo(null);
    setProject(null);
    setContent('');
    setAttachments([]);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setShowCreateModal(true);
  }, [resetForm]);

  const openEdit = useCallback((r: EmployeeReport) => {
    setEditing(r);
    setTitle(String(r.title || '').trim() || '');
    const a = (r.assignedToUser || (r.managerId ? { _id: r.managerId, name: '', email: '', role: 'manager' as const } : null)) as any;
    setAssignedTo(a?._id ? a : null);
    setProject(r.project ? { _id: r.project._id, name: r.project.name } : r.projectId ? { _id: r.projectId, name: '' } : null);
    setContent(String(r.content || ''));
    setAttachments((r.attachments || []) as any);
    setShowCreateModal(true);
  }, []);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [reportRes, reviewerRes, projectRes] = await Promise.all([
        reportApi.getAll(),
        userApi.getReviewers(),
        projectApi.getAll(),
      ]);
      setReports(reportRes.data.data || []);
      setReviewers(reviewerRes.data.data || []);
      setProjects(projectRes.data.data || []);

      if (!assignedTo && (reviewerRes.data.data || []).length) {
        setAssignedTo((reviewerRes.data.data || [])[0] as any);
      }
    } finally {
      setRefreshing(false);
    }
  }, [assignedTo]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const counts = useMemo(() => {
    const c = { all: reports.length, submitted: 0, viewed: 0, approved: 0, changes_requested: 0 };
    for (const r of reports) {
      if (r.status === 'submitted') c.submitted += 1;
      else if (r.status === 'viewed') c.viewed += 1;
      else if (r.status === 'approved') c.approved += 1;
      else if (r.status === 'changes_requested') c.changes_requested += 1;
    }
    return c;
  }, [reports]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return reports;
    return reports.filter((r) => r.status === activeTab);
  }, [activeTab, reports]);

  const handlePickImages = useCallback(async () => {
    try {
      setUploading(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Thiếu quyền truy cập', 'Vui lòng cho phép truy cập thư viện ảnh để gửi ảnh.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 0.85,
      });
      if (result.canceled) return;
      const assets = result.assets || [];
      if (!assets.length) return;

      const next: (MessageAttachment & { resourceType?: 'image' | 'file' })[] = [];
      for (const asset of assets.slice(0, 5)) {
        if (!asset?.uri) continue;
        const name = (asset as any).fileName || (asset as any).name || guessFileName(asset.uri, `image-${Date.now()}.jpg`);
        const type = (asset as any).mimeType || 'image/jpeg';
        const uploadRes = await uploadApi.uploadImage({ uri: asset.uri, name, type });
        const uploaded = uploadRes.data.data;
        next.push({
          url: uploaded.url,
          name: uploaded.name || name,
          type: uploaded.type || type,
          size: uploaded.size || 0,
          resourceType: 'image',
        });
      }
      if (next.length) setAttachments((prev) => [...prev, ...next]);
    } catch (err: any) {
      Alert.alert('Upload ảnh thất bại', String(err?.message || err || 'Vui lòng thử lại.'));
    } finally {
      setUploading(false);
    }
  }, []);

  const handlePickFiles = useCallback(async () => {
    try {
      setUploading(true);
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      const assets = result.assets || [];
      if (!assets.length) return;

      const next: (MessageAttachment & { resourceType?: 'image' | 'file' })[] = [];
      for (const asset of assets.slice(0, 5)) {
        if (!asset?.uri) continue;
        const name = asset.name || guessFileName(asset.uri, `file-${Date.now()}`);
        const type = asset.mimeType || 'application/octet-stream';
        const uploadRes = await uploadApi.uploadFile({ uri: asset.uri, name, type });
        const uploaded = uploadRes.data.data;
        next.push({
          url: uploaded.url,
          name: uploaded.name || name,
          type: uploaded.type || type,
          size: uploaded.size || asset.size || 0,
          resourceType: 'file',
        });
      }
      if (next.length) setAttachments((prev) => [...prev, ...next]);
    } catch (err: any) {
      Alert.alert('Upload file thất bại', String(err?.message || err || 'Vui lòng thử lại.'));
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const t = String(title || '').trim();
    const c = String(content || '').trim();
    const toId = String(assignedTo?._id || '').trim();
    if (!t) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tiêu đề báo cáo.');
      return;
    }
    if (!toId) {
      Alert.alert('Thiếu thông tin', 'Vui lòng chọn người nhận (Manager/Admin).');
      return;
    }
    if (!c) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập nội dung báo cáo.');
      return;
    }

    setSubmitting(true);
    try {
      if (editing?._id) {
        await reportApi.update(editing._id, {
          assignedTo: toId,
          projectId: project?._id,
          title: t,
          content: c,
          attachments,
          status: 'submitted',
        });
      } else {
        await reportApi.create({
          assignedTo: toId,
          projectId: project?._id,
          title: t,
          content: c,
          attachments,
          status: 'submitted',
        });
      }

      setShowCreateModal(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      Alert.alert('Không thể gửi báo cáo', String(err?.response?.data?.message || err?.message || err || 'Vui lòng thử lại.'));
    } finally {
      setSubmitting(false);
    }
  }, [assignedTo?._id, attachments, content, editing?._id, loadData, project?._id, resetForm, title]);

  const openDetail = useCallback(
    async (r: EmployeeReport) => {
      setDetail(r);
      setReviewFeedback('');
      if (isReviewer && (r.status === 'submitted' || r.status === 'draft')) {
        try {
          await reportApi.markViewed(r._id);
          await loadData();
        } catch {
          // ignore
        }
      }
    },
    [isReviewer, loadData]
  );

  const submitReview = useCallback(
    async (status: 'approved' | 'changes_requested') => {
      if (!detail?._id) return;
      const fb = String(reviewFeedback || '').trim();
      if (status === 'changes_requested' && !fb) {
        Alert.alert('Thiếu phản hồi', 'Vui lòng nhập phản hồi khi yêu cầu chỉnh sửa.');
        return;
      }

      setReviewSubmitting(true);
      try {
        await reportApi.review(detail._id, { status, feedback: fb || undefined });
        setDetail(null);
        setReviewFeedback('');
        await loadData();
      } catch (err: any) {
        Alert.alert('Không thể duyệt', String(err?.response?.data?.message || err?.message || err || 'Vui lòng thử lại.'));
      } finally {
        setReviewSubmitting(false);
      }
    },
    [detail?._id, loadData, reviewFeedback]
  );

  const tabs = useMemo(
    () => [
      { key: 'all' as const, label: `Tất cả (${counts.all})` },
      { key: 'submitted' as const, label: `Chờ duyệt (${counts.submitted})` },
      { key: 'viewed' as const, label: `Đã xem (${counts.viewed})` },
      { key: 'approved' as const, label: `Đã duyệt (${counts.approved})` },
      { key: 'changes_requested' as const, label: `Cần chỉnh sửa (${counts.changes_requested})` },
    ],
    [counts]
  );

  const reviewerLabel = assignedTo
    ? `${assignedTo.name}${assignedTo.role ? ` (${assignedTo.role === 'manager' ? 'Manager' : 'Admin'})` : ''}`
    : 'Chọn quản lý...';

  const projectLabel = project ? project.name || 'Dự án' : 'Không thuộc dự án cụ thể';

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={colors.primary} />}
    >
      <View>
        <View style={styles.pageTitleRow}>
          <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
            <Ionicons name="document-text-outline" size={18} color={colors.primaryDark} />
          </View>
          <Text style={styles.title}>Báo cáo từ nhân viên</Text>
        </View>
        <Text style={styles.subtitle}>Xem và phản hồi báo cáo từ nhân viên</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[styles.tabPill, active ? styles.tabPillActive : undefined]}
            >
              <Text style={[styles.tabText, active ? styles.tabTextActive : undefined]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!isReviewer ? (
        <View style={styles.createBtnWrap}>
          <AppButton label="Tạo báo cáo mới" onPress={openCreate} />
        </View>
      ) : null}

      {filtered.map((r) => {
        const pill = reportStatusPill(r.status);
        const reportTitle = String(r.title || '').trim() || 'Báo cáo';
        const projectName = r.project?.name || (r.projectId ? 'Dự án' : '');
        const from = r.user?.name || 'Nhân viên';
        const createdAt = r.createdAt ? isoToVNDate(r.createdAt) : '';
        const preview = String(r.content || '').replace(/\s+/g, ' ').trim();

        return (
          <TouchableOpacity key={r._id} activeOpacity={0.9} onPress={() => void openDetail(r)}>
            <Card>
              <View style={styles.cardTopRow}>
                <View style={[styles.statusPill, { backgroundColor: pill.bg, borderColor: pill.border }]}> 
                  <Text style={[styles.statusPillText, { color: pill.text }]}>{reportStatusLabel(r.status)}</Text>
                </View>
                {projectName ? (
                  <View style={[styles.projectPill, { backgroundColor: colors.secondary, borderColor: colors.border }]}> 
                    <Text style={styles.projectPillText} numberOfLines={1}>{projectName}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.reportTitle} numberOfLines={2}>{reportTitle}</Text>
              <Text style={styles.preview} numberOfLines={2}>{preview}</Text>

              <View style={styles.metaRow}>
                <Text style={styles.metaText} numberOfLines={1}>Từ: {from}</Text>
                {createdAt ? <Text style={styles.metaText}>{createdAt}</Text> : null}
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}

      {showCreateModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
          <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}>
              <Pressable style={styles.modalCard} onPress={() => {}}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.modalTitle}>{editing ? 'Chỉnh sửa báo cáo' : 'Tạo báo cáo mới'}</Text>
                    <Text style={styles.modalSub}>Gửi báo cáo công việc cho quản lý</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                    style={styles.modalClose}
                  >
                    <Text style={styles.modalCloseText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
                  <AppInput label="Tiêu đề báo cáo *" value={title} onChangeText={setTitle} placeholder="VD: Báo cáo tiến độ tuần 10" />

                  <View style={styles.twoColsRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Gửi đến *</Text>
                      <TouchableOpacity style={styles.selectBox} onPress={() => setShowReviewerModal(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{reviewerLabel}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Dự án (optional)</Text>
                      <TouchableOpacity style={styles.selectBox} onPress={() => setShowProjectModal(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{projectLabel}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <AppInput
                    label="Nội dung báo cáo *"
                    value={content}
                    onChangeText={setContent}
                    placeholder="Mô tả chi tiết về công việc đã làm, tiến độ, vấn đề gặp phải..."
                    multiline
                    style={{ minHeight: 140, textAlignVertical: 'top' }}
                  />

                  <View style={styles.attachWrap}>
                    <Text style={styles.fieldLabel}>Đính kèm</Text>
                    <View style={styles.attachRow}>
                      <TouchableOpacity disabled={uploading} style={[styles.attachBtn, uploading ? styles.attachBtnDisabled : undefined]} onPress={() => void handlePickImages()}>
                        <Text style={styles.attachBtnText}>＋ Ảnh</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={uploading} style={[styles.attachBtn, uploading ? styles.attachBtnDisabled : undefined]} onPress={() => void handlePickFiles()}>
                        <Text style={styles.attachBtnText}>＋ File</Text>
                      </TouchableOpacity>
                    </View>

                    {attachments.length ? (
                      <View style={{ gap: 8, marginTop: 8 }}>
                        {attachments.map((a, idx) => (
                          <View key={`${a.url}-${idx}`} style={styles.attachmentItem}>
                            <Text style={styles.attachmentName} numberOfLines={1}>{a.name}</Text>
                            <TouchableOpacity onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))} style={styles.attachmentRemove}>
                              <Text style={styles.attachmentRemoveText}>×</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.tipBox}>
                    <Text style={styles.tipText}>Lưu ý: Báo cáo nên ngắn gọn, súc tích và tập trung vào kết quả công việc.</Text>
                  </View>

                  <View style={styles.actionsRow}>
                    <AppButton
                      label="Hủy"
                      variant="outline"
                      style={{ flex: 1 }}
                      onPress={() => {
                        setShowCreateModal(false);
                        resetForm();
                      }}
                    />
                    <AppButton
                      label={editing ? 'Gửi lại báo cáo' : 'Gửi báo cáo'}
                      style={{ flex: 1 }}
                      onPress={handleSubmit}
                      loading={submitting}
                      disabled={uploading}
                    />
                  </View>
                </ScrollView>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      ) : null}

      {showReviewerModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowReviewerModal(false)}>
          <Pressable style={styles.pickerOverlay} onPress={() => setShowReviewerModal(false)}>
            <Pressable style={styles.pickerCard} onPress={() => {}}>
              <Text style={styles.pickerTitle}>Chọn quản lý</Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={{ gap: 8 }}>
                  {reviewers.map((rv) => {
                    const active = rv._id === assignedTo?._id;
                    const roleLabel = rv.role === 'manager' ? 'Manager' : 'Admin';
                    return (
                      <TouchableOpacity
                        key={rv._id}
                        onPress={() => {
                          setAssignedTo(rv as any);
                          setShowReviewerModal(false);
                        }}
                        style={[styles.pickerOption, active ? styles.pickerOptionActive : undefined]}
                      >
                        <Text style={[styles.pickerOptionText, active ? styles.pickerOptionTextActive : undefined]} numberOfLines={1}>
                          {rv.name} ({roleLabel})
                        </Text>
                        <Text style={styles.pickerOptionMeta} numberOfLines={1}>{rv.email}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={{ marginTop: 10 }}>
                <AppButton label="Đóng" variant="outline" onPress={() => setShowReviewerModal(false)} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {showProjectModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowProjectModal(false)}>
          <Pressable style={styles.pickerOverlay} onPress={() => setShowProjectModal(false)}>
            <Pressable style={styles.pickerCard} onPress={() => {}}>
              <Text style={styles.pickerTitle}>Chọn dự án</Text>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setProject(null);
                      setShowProjectModal(false);
                    }}
                    style={[styles.pickerOption, !project ? styles.pickerOptionActive : undefined]}
                  >
                    <Text style={[styles.pickerOptionText, !project ? styles.pickerOptionTextActive : undefined]}>Không thuộc dự án cụ thể</Text>
                  </TouchableOpacity>

                  {projects.map((p) => {
                    const active = p._id === project?._id;
                    return (
                      <TouchableOpacity
                        key={p._id}
                        onPress={() => {
                          setProject({ _id: p._id, name: p.name });
                          setShowProjectModal(false);
                        }}
                        style={[styles.pickerOption, active ? styles.pickerOptionActive : undefined]}
                      >
                        <Text style={[styles.pickerOptionText, active ? styles.pickerOptionTextActive : undefined]} numberOfLines={1}>{p.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={{ marginTop: 10 }}>
                <AppButton label="Đóng" variant="outline" onPress={() => setShowProjectModal(false)} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {detail ? (
        <Modal transparent animationType="fade" onRequestClose={() => setDetail(null)}>
          <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}>
              <Pressable style={styles.modalCard} onPress={() => {}}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.modalTitle} numberOfLines={2}>{String(detail.title || 'Báo cáo')}</Text>
                    <Text style={styles.modalSub} numberOfLines={2}>
                      {detail.user ? `Từ: ${detail.user.name} • ${isoToVNDate(detail.createdAt)}` : isoToVNDate(detail.createdAt)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setDetail(null)} style={styles.modalClose}>
                    <Text style={styles.modalCloseText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {(() => {
                      const pill = reportStatusPill(detail.status);
                      return (
                        <View style={[styles.statusPill, { backgroundColor: pill.bg, borderColor: pill.border }]}> 
                          <Text style={[styles.statusPillText, { color: pill.text }]}>{reportStatusLabel(detail.status)}</Text>
                        </View>
                      );
                    })()}
                    {detail.project?.name ? (
                      <View style={[styles.projectPill, { backgroundColor: colors.secondary, borderColor: colors.border }]}> 
                        <Text style={styles.projectPillText} numberOfLines={1}>{detail.project.name}</Text>
                      </View>
                    ) : null}
                  </View>

                  <Card style={{ backgroundColor: colors.secondary }}>
                    <Text style={styles.sectionLabel}>Nội dung báo cáo</Text>
                    <Text style={styles.detailText}>{detail.content}</Text>
                  </Card>

                  {detail.attachments && detail.attachments.length ? (
                    <Card style={{ marginTop: 10 }}>
                      <Text style={styles.sectionLabel}>Tệp đính kèm</Text>
                      <View style={{ gap: 8, marginTop: 8 }}>
                        {detail.attachments.map((a, idx) => (
                          <TouchableOpacity
                            key={`${a.url}-${idx}`}
                            onPress={() =>
                              void downloadAndOpen(a.url, a.name).catch((e) =>
                                Alert.alert('Không thể tải tệp', String(e?.message || e))
                              )
                            }
                            style={styles.downloadRow}
                          >
                            <Text style={styles.downloadName} numberOfLines={1}>{a.name}</Text>
                            <Text style={styles.downloadAction}>Tải</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </Card>
                  ) : null}

                  {detail.feedback ? (
                    <Card style={{ marginTop: 10, backgroundColor: colors.secondary }}>
                      <Text style={styles.sectionLabel}>Phản hồi</Text>
                      <Text style={styles.detailText}>{detail.feedback}</Text>
                    </Card>
                  ) : null}

                  {isReviewer ? (
                    <View style={{ marginTop: 10 }}>
                      <AppInput
                        label="Phản hồi báo cáo"
                        value={reviewFeedback}
                        onChangeText={setReviewFeedback}
                        placeholder="Nhập phản hồi của bạn..."
                        multiline
                        style={{ minHeight: 110, textAlignVertical: 'top' }}
                      />

                      <View style={[styles.actionsRow, { marginTop: 10 }]}>
                        <AppButton
                          label="Duyệt báo cáo"
                          style={{ flex: 1 }}
                          onPress={() => void submitReview('approved')}
                          loading={reviewSubmitting}
                        />
                        <AppButton
                          label="Yêu cầu chỉnh sửa"
                          variant="outline"
                          style={{ flex: 1 }}
                          onPress={() => void submitReview('changes_requested')}
                          loading={reviewSubmitting}
                        />
                      </View>
                    </View>
                  ) : detail.status === 'changes_requested' ? (
                    <View style={{ marginTop: 10 }}>
                      <AppButton label="Chỉnh sửa & gửi lại" onPress={() => openEdit(detail)} />
                    </View>
                  ) : null}
                </ScrollView>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </Modal>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pageTitleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.muted,
  },
  tabsRow: {
    gap: 8,
    paddingVertical: 10,
  },
  tabPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tabPillActive: {
    backgroundColor: hexToRgba(colors.primary, 0.12),
    borderColor: colors.primary,
  },
  tabText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
    color: colors.text,
  },
  tabTextActive: {
    color: colors.primaryDark,
  },
  createBtnWrap: {
    marginTop: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 2,
  },
  statusPillText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    fontSize: 11,
  },
  projectPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 2,
    flexShrink: 1,
  },
  projectPillText: {
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 11,
    color: colors.text,
  },
  reportTitle: {
    marginTop: 10,
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
    color: colors.text,
  },
  preview: {
    marginTop: 6,
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    color: colors.text,
    lineHeight: 18,
  },
  metaRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  metaText: {
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    color: colors.muted,
    flexShrink: 1,
  },
  modalOverlay: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    backgroundColor: hexToRgba(colors.text, 0.32),
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    maxHeight: '84%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  modalTitle: {
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 18,
    color: colors.text,
  },
  modalSub: {
    fontFamily: 'BeVietnamPro_600SemiBold',
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 18,
    color: colors.text,
    marginTop: -2,
  },
  twoColsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: 'BeVietnamPro_700Bold',
    color: colors.text,
    marginBottom: 6,
  },
  selectBox: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectText: {
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.text,
  },
  attachWrap: {
    marginTop: 10,
  },
  attachRow: {
    flexDirection: 'row',
    gap: 10,
  },
  attachBtn: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  attachBtnDisabled: {
    opacity: 0.6,
  },
  attachBtnText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
    fontSize: 12,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
  },
  attachmentName: {
    flex: 1,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.text,
  },
  attachmentRemove: {
    width: 26,
    height: 26,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRemoveText: {
    fontFamily: 'BeVietnamPro_900Black',
    color: colors.text,
    marginTop: -2,
  },
  tipBox: {
    marginTop: 12,
    borderWidth: 2,
    borderColor: hexToRgba(colors.warning, 0.55),
    backgroundColor: hexToRgba(colors.warning, 0.08),
    borderRadius: 16,
    padding: 12,
  },
  tipText: {
    fontFamily: 'BeVietnamPro_700Bold',
    fontSize: 12,
    color: colors.warning,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  pickerOverlay: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    backgroundColor: hexToRgba(colors.text, 0.32),
  },
  pickerCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    maxHeight: '84%',
  },
  pickerTitle: {
    fontFamily: 'BeVietnamPro_900Black',
    fontSize: 16,
    color: colors.text,
    marginBottom: 10,
  },
  pickerOption: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
  },
  pickerOptionActive: {
    borderColor: colors.primary,
    backgroundColor: hexToRgba(colors.primary, 0.08),
  },
  pickerOptionText: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  pickerOptionTextActive: {
    color: colors.primaryDark,
  },
  pickerOptionMeta: {
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.muted,
    marginTop: 4,
    fontSize: 12,
  },
  sectionLabel: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
    fontSize: 13,
  },
  detailText: {
    marginTop: 8,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  downloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
  },
  downloadName: {
    flex: 1,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.text,
  },
  downloadAction: {
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.primaryDark,
  },
});

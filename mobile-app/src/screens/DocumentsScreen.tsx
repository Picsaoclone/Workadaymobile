import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { SectionTitle } from '../components/SectionTitle';
import { colors } from '../theme/colors';
import { hexToRgba } from '../utils/color';
import { documentApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { CompanyDocument, DocumentCategory, DocumentStats } from '../types/models';
import { useAuthStore } from '../store/authStore';

const tabs = [
  { key: 'all' as const, label: 'Tất cả' },
  { key: 'important' as const, label: 'Quan trọng' },
  { key: 'recent' as const, label: 'Gần đây' },
];

type TabKey = (typeof tabs)[number]['key'];

type PickedFile = { uri: string; name: string; type: string };

type UploadState = {
  title: string;
  category: DocumentCategory;
  isStarred: boolean;
  file: PickedFile | null;
};

const documentCategories: DocumentCategory[] = ['Kỹ thuật', 'Thiết kế', 'Marketing', 'Nhân sự'];

function formatBytes(bytes: number) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const rounded = value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[idx]}`;
}

function safeFilename(name: string) {
  const base = String(name || 'document').trim() || 'document';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function guessExtension(mimeType?: string, url?: string) {
  const mt = String(mimeType || '').toLowerCase();
  if (mt.includes('pdf')) return '.pdf';
  if (mt.includes('msword')) return '.doc';
  if (mt.includes('officedocument.wordprocessingml')) return '.docx';
  if (mt.includes('officedocument.spreadsheetml')) return '.xlsx';
  if (mt.includes('officedocument.presentationml')) return '.pptx';
  if (mt.includes('text/csv')) return '.csv';
  if (mt.startsWith('text/')) return '.txt';
  if (mt.includes('zip')) return '.zip';
  if (mt.includes('rar')) return '.rar';

  const u = String(url || '').split('?')[0];
  const m = u.match(/\.([a-zA-Z0-9]{1,6})$/);
  if (!m?.[1]) return '';
  return `.${m[1].toLowerCase()}`;
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN');
}

export function DocumentsScreen() {
  const isFocused = useIsFocused();
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const [tab, setTab] = useState<TabKey>('all');
  const [category, setCategory] = useState<string>('Tất cả');
  const [query, setQuery] = useState('');

  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [docs, setDocs] = useState<CompanyDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [upload, setUpload] = useState<UploadState>(() => ({
    title: '',
    category: documentCategories[0],
    isStarred: false,
    file: null,
  }));

  const categories = useMemo(() => ['Tất cả', ...documentCategories], []);

  const quotaLabel = useMemo(() => {
    if (!stats) return null;
    return `${formatBytes(stats.usedBytes)} / ${formatBytes(stats.quotaBytes)} · ${stats.count} tài liệu`;
  }, [stats]);

  const loadStats = useCallback(async () => {
    try {
      const res = await documentApi.stats();
      setStats(res.data?.data || null);
    } catch {
      // ignore stats errors
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    setRefreshing(true);
    try {
      const params: any = { tab };
      const trimmed = String(query || '').trim();
      if (category && category !== 'Tất cả') params.category = category;
      if (trimmed) params.q = trimmed;

      const res = await documentApi.getAll(params);
      setDocs(res.data?.data || []);
    } catch (err) {
      Alert.alert('Không tải được tài liệu', getApiErrorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, [category, query, tab]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
      loadDocuments();
    }, [loadDocuments, loadStats])
  );

  useEffect(() => {
    if (!isFocused) return;
    const timer = setTimeout(() => {
      loadDocuments();
    }, 350);
    return () => clearTimeout(timer);
  }, [category, isFocused, loadDocuments, query, tab]);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      const nextFile: PickedFile = {
        uri: asset.uri,
        name: asset.name || 'document',
        type: asset.mimeType || 'application/octet-stream',
      };

      setUpload((prev) => ({
        ...prev,
        file: nextFile,
        title: prev.title || (asset.name ? String(asset.name).replace(/\.[^.]+$/, '') : ''),
      }));
    } catch (err: any) {
      Alert.alert('Không chọn được file', String(err?.message || err));
    }
  };

  const submitUpload = async () => {
    if (!canManage) return;
    const title = String(upload.title || '').trim();
    if (!upload.file) {
      Alert.alert('Thiếu file', 'Vui lòng chọn file để đăng.' );
      return;
    }
    if (!upload.category) {
      Alert.alert('Thiếu danh mục', 'Vui lòng chọn danh mục.' );
      return;
    }

    setUploadLoading(true);
    try {
      await documentApi.upload({
        file: upload.file,
        title: title || undefined,
        category: upload.category,
        isStarred: upload.isStarred,
      });
      setUploadVisible(false);
      setUpload({ title: '', category: documentCategories[0], isStarred: false, file: null });
      await loadStats();
      await loadDocuments();
    } catch (err) {
      Alert.alert('Không đăng được tài liệu', getApiErrorMessage(err));
    } finally {
      setUploadLoading(false);
    }
  };

  const toggleStar = async (doc: CompanyDocument) => {
    if (!canManage) return;
    try {
      await documentApi.toggleStar(doc._id, !doc.isStarred);
      await loadDocuments();
    } catch (err) {
      Alert.alert('Không cập nhật được', getApiErrorMessage(err));
    }
  };

  const download = async (doc: CompanyDocument) => {
    const url = String(doc.fileUrl || '').trim();
    if (!url) return;

    try {
      const filename = safeFilename(doc.title || 'document');
      const ext = guessExtension(doc.mimeType, url);
      const fullName = `${filename}${ext}`;
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) throw new Error('Không thể xác định thư mục tạm để tải file.');

      const tempUri = `${baseDir}${fullName}`;

      if (Platform.OS === 'android') {
        const saf = (FileSystem as any).StorageAccessFramework;
        if (!saf?.requestDirectoryPermissionsAsync || !saf?.createFileAsync) {
          Alert.alert('Không hỗ trợ', 'Thiết bị không hỗ trợ lưu trực tiếp.');
          return;
        }

        const perm = await saf.requestDirectoryPermissionsAsync();
        if (!perm?.granted) return;

        await FileSystem.downloadAsync(url, tempUri);

        const mimeType = String(doc.mimeType || 'application/octet-stream') || 'application/octet-stream';
        const destUri = await saf.createFileAsync(perm.directoryUri, fullName, mimeType);

        const base64 = await FileSystem.readAsStringAsync(tempUri, {
          encoding: (FileSystem as any).EncodingType?.Base64 || 'base64',
        });
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: (FileSystem as any).EncodingType?.Base64 || 'base64',
        });

        Alert.alert('Đã lưu', 'Tài liệu đã được lưu trong thư mục bạn chọn.');
        return;
      }

      const destUri = `${(FileSystem.documentDirectory || FileSystem.cacheDirectory || baseDir) as string}${fullName}`;
      await FileSystem.downloadAsync(url, destUri);

      Alert.alert('Đã tải', 'Tài liệu đã được tải về trong ứng dụng.');
    } catch (err: any) {
      Alert.alert('Không tải được', String(err?.message || err || 'Vui lòng thử lại.'), [
        { text: 'Mở liên kết', onPress: () => void Linking.openURL(url) },
        { text: 'Đóng', style: 'cancel' },
      ]);
    }
  };

  return (
    <Screen
      safeEdges={['top', 'left', 'right']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadDocuments} tintColor={colors.primary} />}
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.pageTitleRow}>
            <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
              <Ionicons name="folder-open-outline" size={18} color={colors.primaryDark} />
            </View>
            <Text style={styles.title}>Tài liệu</Text>
          </View>
          <Text style={styles.sub}>{quotaLabel || 'Thư viện tài liệu của công ty'}</Text>
        </View>

        {canManage ? (
          <TouchableOpacity style={styles.iconBtn} onPress={() => setUploadVisible(true)}>
            <Ionicons name="cloud-upload-outline" size={22} color={colors.primaryDark} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.tabsRow}>
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabPill, active ? styles.tabPillActive : styles.tabPillInactive]}
            >
              <Text style={[styles.tabLabel, active ? styles.tabLabelActive : styles.tabLabelInactive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle>Danh mục</SectionTitle>
      <Card>
        <View style={styles.categoriesRow}>
          {categories.map((c) => {
            const active = c === category;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.categoryPill, active ? styles.categoryActive : styles.categoryInactive]}
              >
                <Text style={[styles.categoryText, active ? styles.categoryTextActive : styles.categoryTextInactive]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={styles.searchCard}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Tìm tài liệu..."
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} style={styles.clearBtn}>
              <Ionicons name="close" size={18} color={colors.primaryDark} />
            </Pressable>
          ) : null}
        </View>
      </Card>

      <SectionTitle>Danh sách</SectionTitle>
      <Card style={{ backgroundColor: colors.secondary }}>
        {docs.length === 0 ? (
          <Text style={styles.emptyText}>Chưa có tài liệu.</Text>
        ) : (
          docs.map((d, idx) => {
            const showDivider = idx !== docs.length - 1;
            return (
              <View key={d._id} style={[styles.docItem, showDivider ? styles.itemDivider : null]}>
                <View style={styles.docTop}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.docTitleRow}>
                      <Ionicons name="document-text-outline" size={18} color={colors.primaryDark} />
                      <Text style={styles.docTitle} numberOfLines={1}>
                        {d.title}
                      </Text>
                    </View>
                    <Text style={styles.docMeta}>
                      {d.category} · {formatBytes(d.sizeBytes)} · {d.uploadedByName} · {formatDateShort(d.createdAt)}
                    </Text>
                  </View>

                  {d.isStarred ? (
                    <View
                      style={[
                        styles.starBadge,
                        { backgroundColor: hexToRgba(colors.warning, 0.2), borderColor: hexToRgba(colors.warning, 0.55) },
                      ]}
                    >
                      <Ionicons name="star" size={14} color={colors.warning} />
                      <Text style={[styles.starText, { color: colors.warning }]}>Quan trọng</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.actionsRow}>
                  <AppButton label="Tải xuống" variant="outline" onPress={() => download(d)} style={styles.smallBtn} />
                  {canManage ? (
                    <Pressable onPress={() => toggleStar(d)} style={styles.starBtn}>
                      <Ionicons name={d.isStarred ? 'star' : 'star-outline'} size={20} color={colors.primaryDark} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </Card>

      <Modal visible={uploadVisible} animationType="fade" transparent onRequestClose={() => setUploadVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Đăng tài liệu</Text>
              <Pressable onPress={() => setUploadVisible(false)}>
                <Ionicons name="close" size={22} color={colors.primaryDark} />
              </Pressable>
            </View>

            <AppInput label="Tiêu đề" value={upload.title} onChangeText={(t) => setUpload((p) => ({ ...p, title: t }))} placeholder="VD: Quy định công ty" />

            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Danh mục</Text>
              <View style={styles.pillsRow}>
                {documentCategories.map((c) => {
                  const active = c === upload.category;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setUpload((p) => ({ ...p, category: c }))}
                      style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
                    >
                      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.fileRow}>
              <Pressable onPress={pickFile} style={styles.filePickBtn}>
                <Ionicons name="attach" size={18} color={colors.primaryDark} />
                <Text style={styles.filePickText}>Chọn file</Text>
              </Pressable>
              <Text style={styles.fileName} numberOfLines={1}>
                {upload.file?.name || 'Chưa chọn file'}
              </Text>
            </View>

            <Pressable onPress={() => setUpload((p) => ({ ...p, isStarred: !p.isStarred }))} style={styles.importantRow}>
              <Ionicons name={upload.isStarred ? 'star' : 'star-outline'} size={18} color={colors.primaryDark} />
              <Text style={styles.importantText}>Đánh dấu quan trọng</Text>
            </Pressable>

            <View style={styles.modalActions}>
              <AppButton label="Hủy" variant="outline" onPress={() => setUploadVisible(false)} style={{ flex: 1 }} />
              <AppButton label="Đăng" onPress={submitUpload} loading={uploadLoading} style={{ flex: 1 }} />
            </View>

            {!canManage ? <Text style={styles.hint}>Chỉ Admin/Manager mới có quyền đăng tài liệu.</Text> : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  sub: {
    marginTop: 2,
    fontSize: 13,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.muted,
  },
  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  tabPill: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
  },
  tabPillInactive: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  tabLabel: {
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  tabLabelActive: {
    color: colors.white,
  },
  tabLabelInactive: {
    color: colors.text,
  },
  bodyRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  categoriesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    borderWidth: 2,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  categoryActive: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
  },
  categoryInactive: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  categoryText: {
    fontSize: 12,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  categoryTextActive: {
    color: colors.white,
  },
  categoryTextInactive: {
    color: colors.text,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 6,
    fontSize: 13,
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  clearBtn: {
    width: 30,
    height: 30,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
    textAlign: 'center',
    paddingVertical: 16,
  },
  docItem: {
    paddingVertical: 10,
  },
  itemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: hexToRgba(colors.border, 0.2),
  },
  docTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  docTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  docTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  docMeta: {
    marginTop: 4,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.muted,
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  smallBtn: {
    minHeight: 42,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  starBtn: {
    width: 44,
    height: 42,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  starText: {
    fontSize: 11,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: hexToRgba(colors.text, 0.35),
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
    width: '92%',
    maxWidth: 420,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: 'BeVietnamPro_700Bold',
    color: colors.text,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderWidth: 2,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
  },
  pillInactive: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  pillText: {
    fontSize: 12,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  pillTextActive: {
    color: colors.white,
  },
  pillTextInactive: {
    color: colors.text,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filePickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  filePickText: {
    fontSize: 13,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  fileName: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.muted,
  },
  importantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  importantText: {
    fontSize: 13,
    fontFamily: 'BeVietnamPro_700Bold',
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
    color: colors.muted,
    textAlign: 'center',
  },
});

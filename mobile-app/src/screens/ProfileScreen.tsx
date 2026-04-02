import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { AppInput } from '../components/AppInput';
import { AppButton } from '../components/AppButton';
import { useAuthStore } from '../store/authStore';
import { companyApi, userApi } from '../services/api';
import { AppStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { hexToRgba } from '../utils/color';
import { ClipboardIcon } from '../components/SvgIcons';

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [loading, setLoading] = useState(false);

  const canViewInviteCodes = useMemo(() => user?.role === 'admin' || user?.role === 'manager', [user?.role]);
  const canEditCustomCode = useMemo(() => user?.role === 'admin', [user?.role]);

  const [initialInviteCode, setInitialInviteCode] = useState<string>('');
  const [customInviteCode, setCustomInviteCode] = useState<string>('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const loadInviteCodes = async () => {
    if (!canViewInviteCodes) return;
    if (!user?.companyId) return;
    try {
      setInviteLoading(true);
      const resp = await companyApi.getMyInviteCode();
      setInitialInviteCode(String(resp.data.data.inviteCode || ''));
      setCustomInviteCode(String(resp.data.data.customInviteCode || ''));
    } catch {
      // ignore
    } finally {
      setInviteLoading(false);
    }
  };

  useEffect(() => {
    void loadInviteCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, user?.role]);

  const handleSave = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await userApi.updateProfile(user._id, { name: name.trim(), phone: phone.trim() || undefined });
      setUser(response.data.data);
      Alert.alert('Thành công', 'Đã cập nhật thông tin cá nhân.');
    } catch (error: any) {
      Alert.alert('Cập nhật thất bại', error?.response?.data?.message || 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen safeEdges={['top', 'left', 'right']}>
      <View style={styles.pageTitleRow}>
        <View style={[styles.pageTitleIconWrap, { backgroundColor: hexToRgba(colors.primary, 0.18) }]}>
          <ClipboardIcon size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.title}>Hồ sơ cá nhân</Text>
      </View>
      <Card>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email}</Text>

        <Text style={styles.label}>Vai trò</Text>
        <Text style={styles.value}>{user?.role}</Text>

        {canViewInviteCodes ? (
          <>
            <Text style={styles.label}>Mã giới thiệu (khởi tạo)</Text>
            <Text style={styles.value}>{initialInviteCode || (inviteLoading ? 'Đang tải...' : '—')}</Text>
            <Text style={styles.hint}>Mã khởi tạo không thể chỉnh sửa.</Text>

            <Text style={styles.label}>Mã giới thiệu (tuỳ chỉnh)</Text>
            <Text style={styles.value}>{customInviteCode || '—'}</Text>

            {canEditCustomCode ? (
              <>
                <AppInput
                  label="Đặt mã tuỳ chỉnh"
                  value={customInviteCode}
                  autoCapitalize="characters"
                  onChangeText={(v) => setCustomInviteCode(String(v || '').toUpperCase())}
                />
                <AppButton
                  label="Lưu mã tuỳ chỉnh"
                  variant="outline"
                  loading={inviteLoading}
                  onPress={() => {
                    void (async () => {
                      try {
                        const code = String(customInviteCode || '').trim().toUpperCase();
                        if (!code) {
                          Alert.alert('Thiếu thông tin', 'Vui lòng nhập mã tuỳ chỉnh.');
                          return;
                        }
                        setInviteLoading(true);
                        await companyApi.setCustomInviteCode({ code });
                        await loadInviteCodes();
                        Alert.alert('Thành công', 'Đã cập nhật mã tuỳ chỉnh.');
                      } catch (error: any) {
                        Alert.alert('Cập nhật thất bại', error?.response?.data?.message || 'Vui lòng thử lại.');
                      } finally {
                        setInviteLoading(false);
                      }
                    })();
                  }}
                />
              </>
            ) : null}
          </>
        ) : null}

        <AppInput label="Họ tên" value={name} onChangeText={setName} />
        <AppInput label="Số điện thoại" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        <AppButton label="Lưu thay đổi" onPress={handleSave} loading={loading} />
        <AppButton label="Thông báo" variant="outline" onPress={() => navigation.navigate('Notifications')} />
        <AppButton label="Đăng xuất" variant="outline" onPress={logout} />
      </Card>
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
    fontSize: 22,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  value: {
    color: colors.text,
    fontSize: 15,
    marginBottom: 4,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 6,
  },
});

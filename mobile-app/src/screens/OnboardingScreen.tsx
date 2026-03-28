import React, { useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { Screen } from '../components/Screen';
import { colors } from '../theme/colors';
import { authApi, companyApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { useAuthStore } from '../store/authStore';

export function OnboardingScreen() {
  const navigation = useNavigation<any>();
  const setUser = useAuthStore((state) => state.setUser);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('1-10');

  const sizeOptions = useMemo(() => ['1-10', '11-50', '51-200', '200+'], []);

  const handleCreateCompany = async () => {
    if (!name || !industry || !size) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên công ty, ngành nghề và quy mô.');
      return;
    }

    try {
      setLoading(true);
      await companyApi.create({
        name: name.trim(),
        industry: industry.trim(),
        size,
      });

      const me = await authApi.me();
      setUser(me.data.data);

      try {
        const invite = await companyApi.getMyInviteCode();
        setInviteCode(invite.data.data.inviteCode);
      } catch {
        setInviteCode(null);
      }

      Alert.alert('Thành công', 'Đã tạo workspace công ty.');
    } catch (error: any) {
      Alert.alert('Tạo công ty thất bại', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen safeEdges={['top', 'left', 'right', 'bottom']}>
      <Text style={styles.title}>Thiết lập công ty</Text>
      <Text style={styles.subtitle}>Tài khoản của bạn chưa thuộc công ty. Tạo workspace để bắt đầu.</Text>

      <View style={styles.formCard}>
        <AppButton
          label="Quay lại"
          variant="outline"
          onPress={() => {
            try {
              navigation.goBack();
            } catch {
              // ignore
            }
          }}
        />

        <AppInput label="Tên công ty" value={name} onChangeText={setName} />
        <AppInput label="Ngành nghề" value={industry} onChangeText={setIndustry} />

        <View style={styles.sizeWrap}>
          <Text style={styles.sizeLabel}>Quy mô</Text>
          <View style={styles.sizeRow}>
            {sizeOptions.map((opt) => {
              const selected = opt === size;
              return (
                <Pressable
                  key={opt}
                  onPress={() => setSize(opt)}
                  style={[styles.sizeBtn, selected ? styles.sizeBtnActive : undefined]}
                >
                  <Text style={[styles.sizeText, selected ? styles.sizeTextActive : undefined]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <AppButton label="Tạo workspace" onPress={handleCreateCompany} loading={loading} />

        <View style={styles.inviteBox}>
          <Text style={styles.inviteLabel}>Mã giới thiệu (khởi tạo)</Text>
          <Text style={styles.inviteCode}>{inviteCode || '—'}</Text>
          <Text style={styles.inviteHint}>
            Dùng mã này để nhân viên đăng ký vào chung công ty. Mã khởi tạo không thể chỉnh sửa; Admin có thể đặt mã tuỳ chỉnh trong phần Hồ sơ.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
    marginTop: 8,
  },
  subtitle: {
    color: colors.muted,
    marginBottom: 8,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  sizeWrap: {
    gap: 6,
  },
  sizeLabel: {
    fontSize: 14,
    fontFamily: 'BeVietnamPro_700Bold',
    color: colors.text,
  },
  sizeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sizeBtn: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
  },
  sizeBtnActive: {
    backgroundColor: colors.primary,
  },
  sizeText: {
    color: colors.text,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  sizeTextActive: {
    color: colors.white,
  },
  inviteBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  inviteLabel: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  inviteCode: {
    fontSize: 24,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.primaryDark,
    letterSpacing: 1,
  },
  inviteHint: {
    color: colors.muted,
    fontSize: 12,
  },
});

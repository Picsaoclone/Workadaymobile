import React, { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { AppInput } from '../components/AppInput';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { colors } from '../theme/colors';
import { authApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { useAuthStore } from '../store/authStore';
import { AuthStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList>;

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập email và mật khẩu.');
      return;
    }

    try {
      setLoading(true);
      const response = await authApi.login(email.trim(), password);
      const { token, user } = response.data.data;
      login(token, user);
    } catch (error: any) {
      Alert.alert('Đăng nhập thất bại', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen safeEdges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.hero}>
        <Text style={styles.title}>Workaday Mobile</Text>
        <Text style={styles.subtitle}>ERP cho doanh nghiệp trên điện thoại</Text>
      </View>

      <View style={styles.formCard}>
        <AppInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <AppInput label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry />
        <AppButton label="Đăng nhập" onPress={handleLogin} loading={loading} />
        <AppButton label="Tạo tài khoản mới" variant="outline" onPress={() => navigation.navigate('Register')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginTop: 28,
    marginBottom: 8,
    gap: 6,
  },
  title: {
    fontSize: 28,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
});

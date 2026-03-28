import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Alert, Dimensions, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppInput } from '../components/AppInput';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { colors } from '../theme/colors';
import { authApi } from '../services/api';
import { getApiErrorMessage } from '../services/error';
import { useAuthStore } from '../store/authStore';
import { AuthStackParamList } from '../navigation/types';

type AccountType = 'create' | 'join';
type Nav = NativeStackNavigationProp<AuthStackParamList>;

export function RegisterScreen() {
  const navigation = useNavigation<Nav>();
  const login = useAuthStore((state) => state.login);
  const insets = useSafeAreaInsets();

  const scrollRef = useRef<ScrollView | null>(null);

  const [step, setStep] = useState<1 | 2>(1);

  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const end = event.endCoordinates;
      const reported = end?.height ?? 0;
      const screenY = end?.screenY;
      const screenHeight = Dimensions.get('screen').height;
      const overlap = typeof screenY === 'number' ? Math.max(screenHeight - screenY, 0) : 0;
      setKeyboardHeight(Math.max(reported, overlap));
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [accountType, setAccountType] = useState<AccountType>('create');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const effectiveKeyboardHeight = keyboardHeight;

  const scrollToBottomSoon = () => {
    // Let layout/keyboard settle before scrolling.
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
  };

  const isJoin = accountType === 'join';

  useEffect(() => {
    setStep(1);
  }, [accountType]);

  const canGoNext = useMemo(() => {
    if (!email || !password || !confirmPassword) return false;
    if (password !== confirmPassword) return false;
    return true;
  }, [confirmPassword, email, password]);

  const canSubmit = useMemo(() => {
    if (!canGoNext) return false;
    if (!name) return false;
    if (isJoin && !inviteCode) return false;
    return true;
  }, [canGoNext, inviteCode, isJoin, name]);

  const handleRegister = async () => {
    if (!canSubmit) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập đầy đủ thông tin bắt buộc.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mật khẩu không khớp', 'Vui lòng kiểm tra lại mật khẩu xác nhận.');
      return;
    }

    try {
      setLoading(true);
      const response = await authApi.register({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
        inviteCode: isJoin ? inviteCode.trim().toUpperCase() : undefined,
      });
      const { token, user } = response.data.data;
      login(token, user);
    } catch (error: any) {
      Alert.alert('Đăng ký thất bại', getApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen safeEdges={['top', 'left', 'right', 'bottom']} scroll={false} style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <ScrollView
          ref={(ref) => {
            scrollRef.current = ref;
          }}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: 16 + Math.max(18, insets.bottom) + effectiveKeyboardHeight,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          contentInset={{ bottom: effectiveKeyboardHeight }}
          scrollIndicatorInsets={{ bottom: effectiveKeyboardHeight }}
        >
          <Text style={styles.title}>Đăng ký Workaday</Text>
          <Text style={styles.subtitle}>Chọn hình thức tài khoản và tạo user mobile</Text>

          <View style={styles.switchWrap}>
            <Pressable onPress={() => setAccountType('create')} style={[styles.switchBtn, accountType === 'create' ? styles.switchActive : undefined]}>
              <Text style={[styles.switchText, accountType === 'create' ? styles.switchTextActive : undefined]}>Tạo công ty</Text>
            </Pressable>
            <Pressable onPress={() => setAccountType('join')} style={[styles.switchBtn, accountType === 'join' ? styles.switchActive : undefined]}>
              <Text style={[styles.switchText, accountType === 'join' ? styles.switchTextActive : undefined]}>Tham gia bằng mã</Text>
            </Pressable>
          </View>

          <View style={styles.formCard}>
            {step === 1 ? (
              <>
                <AppInput label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
                <AppInput label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry onFocus={scrollToBottomSoon} />
                <AppInput label="Xác nhận mật khẩu" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry onFocus={scrollToBottomSoon} />

                <AppButton
                  label="Tiếp tục"
                  onPress={() => {
                    if (!email || !password || !confirmPassword) {
                      Alert.alert('Thiếu thông tin', 'Vui lòng nhập email và mật khẩu.');
                      return;
                    }
                    if (password !== confirmPassword) {
                      Alert.alert('Mật khẩu không khớp', 'Vui lòng kiểm tra lại mật khẩu xác nhận.');
                      return;
                    }
                    setStep(2);
                    scrollToBottomSoon();
                  }}
                  disabled={!canGoNext}
                />

                <AppButton label="Quay lại đăng nhập" variant="outline" onPress={() => navigation.navigate('Login')} />
              </>
            ) : (
              <>
                <AppInput label="Họ tên" value={name} onChangeText={setName} onFocus={scrollToBottomSoon} />
                <AppInput label="Số điện thoại" value={phone} onChangeText={setPhone} keyboardType="phone-pad" onFocus={scrollToBottomSoon} />
                {isJoin ? <AppInput label="Mã mời" value={inviteCode} onChangeText={setInviteCode} autoCapitalize="characters" onFocus={scrollToBottomSoon} /> : null}

                <AppButton label="Đăng ký" onPress={handleRegister} loading={loading} disabled={!canSubmit} />
                <AppButton
                  label="Quay lại"
                  variant="outline"
                  onPress={() => {
                    setStep(1);
                    scrollToBottomSoon();
                  }}
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 0,
    gap: 0,
  },
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
    marginTop: 8,
  },
  subtitle: {
    color: colors.muted,
    marginBottom: 4,
  },
  switchWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  switchBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  switchActive: {
    backgroundColor: '#E0F2FE',
  },
  switchText: {
    color: colors.muted,
    fontFamily: 'BeVietnamPro_600SemiBold',
  },
  switchTextActive: {
    color: colors.primaryDark,
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

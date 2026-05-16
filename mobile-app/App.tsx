import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, BeVietnamPro_400Regular, BeVietnamPro_500Medium, BeVietnamPro_600SemiBold, BeVietnamPro_700Bold, BeVietnamPro_800ExtraBold, BeVietnamPro_900Black } from '@expo-google-fonts/be-vietnam-pro';
import { AppNavigator } from './src/navigation/AppNavigator';
import { PushNotificationsBootstrap } from './src/components/PushNotificationsBootstrap';
import { RealtimeBootstrap } from './src/components/RealtimeBootstrap';

export default function App() {
  const [fontsLoaded] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
    BeVietnamPro_800ExtraBold,
    BeVietnamPro_900Black,
  });

  useEffect(() => {
    if (!fontsLoaded) return;

    const applyDefaultFont = (Component: any) => {
      Component.defaultProps = Component.defaultProps ?? {};
      const currentStyle = Component.defaultProps.style;
      Component.defaultProps.style = [{ fontFamily: 'BeVietnamPro_400Regular' }, currentStyle];
    };

    applyDefaultFont(Text);
    applyDefaultFont(TextInput);
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AppNavigator />
        <PushNotificationsBootstrap />
        <RealtimeBootstrap />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

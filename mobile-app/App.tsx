import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Workaday Mobile</Text>
        <Text style={{ marginTop: 8, opacity: 0.7 }}>Bootstrapping…</Text>
      </View>
    </SafeAreaProvider>
  );
}

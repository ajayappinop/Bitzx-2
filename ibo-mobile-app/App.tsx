/**
 * IBO Mobile App — Root Entry
 */
import React, { useEffect, useState } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { store, AppDispatch, RootState } from './src/store';
import { bootstrapAuth } from './src/store/auth.slice';
import { setSessionExpiredHandler } from './src/api/client';
import { clearAuth } from './src/store/auth.slice';
import AppNavigator from './src/navigation/AppNavigator';
import AnimatedSplash from './src/components/common/AnimatedSplash';
import { Colors } from './src/theme';
import { hideNativeSplash } from './src/native/splash';
import { navigationThemeDark } from './src/navigation/navigationTheme';
import { linking } from './src/navigation/linking';

function AppInner() {
  const dispatch    = useDispatch<AppDispatch>();
  const authLoading = useSelector((s: RootState) => s.auth.authLoading);
  const [splashDone, setSplashDone] = useState(false);
  /** Always use app dark navigation theme (not system light/dark). */
  const navTheme = navigationThemeDark;

  useEffect(() => {
    // Hand off from native window-background → JS animated splash immediately
    hideNativeSplash();
    dispatch(bootstrapAuth());
    setSessionExpiredHandler(() => dispatch(clearAuth()));
  }, [dispatch]);

  return (
    <View style={{ flex: 1, backgroundColor: navTheme.colors.background }}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={navTheme.colors.background}
        translucent={Platform.OS === 'android'}
      />

      {/*
       * Render nav only after splash is done — avoids z-index battles on Android
       * and guarantees there's never two screens visible at once.
       */}
      {splashDone && (
        <NavigationContainer theme={navTheme} linking={linking}>
          <AppNavigator />
        </NavigationContainer>
      )}

      {!splashDone && (
        <AnimatedSplash
          authReady={!authLoading}
          onFinish={() => setSplashDone(true)}
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.surfaceDark }}>
      <SafeAreaProvider>
        <Provider store={store}>
          <AppInner />
        </Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

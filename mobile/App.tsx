import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { restoreUser, setSessionExpiredHandler, User } from './src/api';
import { AdminScreen } from './src/admin';
import {
  CollectionsScreen,
  DashboardScreen,
  HouseholdsScreen,
  LoginScreen,
  ReportsScreen,
  SettingsScreen,
} from './src/screens';
import { usePalette } from './src/ui';

type Tabs = {
  Dashboard: undefined;
  Collections: undefined;
  Households: undefined;
  Reports: undefined;
  Settings: undefined;
  Admin: undefined;
};

const Tab = createBottomTabNavigator<Tabs>();

const icons = {
  Dashboard: { active: 'home', inactive: 'home-outline' },
  Collections: { active: 'add-circle', inactive: 'add-circle-outline' },
  Households: { active: 'people', inactive: 'people-outline' },
  Reports: { active: 'bar-chart', inactive: 'bar-chart-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
  Admin: { active: 'people', inactive: 'people-outline' },
} as const satisfies Record<keyof Tabs, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }>;

function AppTabs({
  user,
  onUserUpdated,
  onSignOut,
}: {
  user: User;
  onUserUpdated: (user: User) => void;
  onSignOut: () => void;
}) {
  const colors = usePalette();
  const { bottom } = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const [refreshKey, setRefreshKey] = useState(0);
  const baseTheme = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.green,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.gold,
    },
  };

  return (
    <NavigationContainer theme={theme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ focused, color, size }) => {
            const icon = icons[route.name as keyof Tabs];
            return <Ionicons name={focused ? icon.active : icon.inactive} size={size + 1} color={color} />;
          },
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: colors.muted,
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: { fontFamily: 'IBMPlexSans_600SemiBold', fontSize: 10, marginBottom: 2 },
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            ...(Platform.OS === 'android' ? { height: 68 + bottom } : { minHeight: 68 }),
            paddingTop: 6,
            paddingBottom: Platform.OS === 'android' ? 6 + bottom : 6,
          },
        })}
      >
        <Tab.Screen name="Dashboard" options={{ tabBarLabel: 'Home' }}>
          {({ navigation }) => (
            <DashboardScreen
              user={user}
              refreshKey={refreshKey}
              onRecordPayment={() => navigation.navigate('Collections')}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Collections" options={{ tabBarLabel: 'Collect' }}>
          {() => <CollectionsScreen onPaymentRecorded={() => setRefreshKey((key) => key + 1)} />}
        </Tab.Screen>
        <Tab.Screen name="Households" options={{ tabBarLabel: 'Homes' }}>
          {() => <HouseholdsScreen refreshKey={refreshKey} />}
        </Tab.Screen>
        <Tab.Screen name="Reports">
          {() => <ReportsScreen refreshKey={refreshKey} />}
        </Tab.Screen>
        <Tab.Screen name="Settings">
          {() => <SettingsScreen user={user} onUserUpdated={onUserUpdated} onSignOut={onSignOut} />}
        </Tab.Screen>
        {user.role === 'admin' ? (
          <Tab.Screen name="Admin" options={{ tabBarLabel: 'Admin' }}>
            {() => <AdminScreen user={user} />}
          </Tab.Screen>
        ) : null}
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const colors = usePalette();
  const dark = useColorScheme() === 'dark';
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexMono_500Medium,
    IBMPlexSans_400Regular,
    IBMPlexSans_600SemiBold,
  });
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = setSessionExpiredHandler(() => {
      if (!active) return;
      setBootError('Your session expired. Sign in again to continue.');
      setUser(null);
    });
    restoreUser()
      .then((savedUser) => { if (active) setUser(savedUser); })
      .catch((cause: unknown) => {
        if (active) setBootError(cause instanceof Error ? cause.message : 'Could not restore your session.');
      })
      .finally(() => { if (active) setBooting(false); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        {booting || !fontsLoaded ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background, padding: 24 }}>
            {fontError ? (
              <Text style={{ color: colors.danger, textAlign: 'center' }}>
                The app typefaces could not be loaded: {fontError.message}
              </Text>
            ) : (
              <>
                <ActivityIndicator color={colors.green} />
                <Text style={{ color: colors.muted }}>
                  {booting ? 'Connecting securely…' : 'Preparing the app…'}
                </Text>
              </>
            )}
          </View>
        ) : user ? (
          <AppTabs
            key={user.id}
            user={user}
            onUserUpdated={setUser}
            onSignOut={() => {
              setBootError('');
              setUser(null);
            }}
          />
        ) : (
          <LoginScreen
            onLogin={(signedInUser) => {
              setBootError('');
              setUser(signedInUser);
            }}
            initialError={bootError}
          />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

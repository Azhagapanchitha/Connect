import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, Vibration, View } from 'react-native';
import { Alert } from './src/alert';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from './src/api';
import { AuthProvider, useAuth, useSocketEvent } from './src/AuthContext';
import { SettingsProvider } from './src/settings';
import { colors, money } from './src/theme';
import { setupCalls } from './src/call/setup';
import { onRequestTapped, registerForPush } from './src/push';

setupCalls();
import LoginScreen from './src/screens/LoginScreen';
import ProfileSetupScreen from './src/screens/ProfileSetupScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import ChatScreen from './src/screens/ChatScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const TAB_ICONS = { Dashboard: 'speedometer', Consultations: 'chatbubbles', Earnings: 'cash', Profile: 'person' };

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? TAB_ICONS[route.name] : `${TAB_ICONS[route.name]}-outline`} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'JothidaConnect Partner' }} />
      <Tab.Screen name="Consultations" component={ChatsScreen} />
      <Tab.Screen name="Earnings" component={EarningsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Pops up wherever the astrologer is in the app when a customer requests a chat.
function IncomingRequests() {
  useSocketEvent('session:request', useCallback((sess) => {
    Vibration.vibrate([0, 400, 200, 400]);
    const respond = async (action) => {
      try {
        await api(`/sessions/${sess.id}/${action}`, { method: 'POST' });
        if (action === 'accept' && navigationRef.isReady()) navigationRef.navigate('Chat', { sessionId: sess.id });
      } catch (e) {
        Alert.alert('Request unavailable', e.message);
      }
    };
    Alert.alert(
      sess.kind === 'call' ? 'New call request' : 'New chat request',
      `${sess.customer?.name || 'A customer'} wants ${sess.kind === 'call' ? 'a voice call' : 'to chat'} at ${money(sess.ratePerMin)}/min.`,
      [
        { text: 'Decline', style: 'destructive', onPress: () => respond('reject') },
        { text: 'Accept', onPress: () => respond('accept') },
      ],
    );
  }, []));
  return null;
}

// Lets requests ring this phone while the app is closed, and opens a request when its notification is tapped.
function PushSetup() {
  useEffect(() => { registerForPush().catch((e) => console.warn('Push setup failed:', e.message)); }, []);
  useEffect(() => onRequestTapped((sessionId) => {
    const open = () => (navigationRef.isReady() ? navigationRef.navigate('Chat', { sessionId }) : setTimeout(open, 300));
    open();
  }), []);
  return null;
}

function Root() {
  const { user, loading } = useAuth();
  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  return (
    <>
      {user?.name ? <IncomingRequests /> : null}
      {user?.name ? <PushSetup /> : null}
      <Stack.Navigator screenOptions={{ headerTintColor: colors.primary }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : !user.name ? (
          <Stack.Screen name="Onboarding" component={ProfileSetupScreen} options={{ title: 'Set up your profile' }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="EditProfile" component={ProfileSetupScreen} options={{ title: 'Edit profile' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </>
        )}
      </Stack.Navigator>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SettingsProvider>
          <NavigationContainer ref={navigationRef} theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary } }}>
            <StatusBar style="dark" />
            <Root />
          </NavigationContainer>
        </SettingsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

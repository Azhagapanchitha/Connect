import React, { useCallback } from 'react';
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
import { colors, money } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import ProfileSetupScreen from './src/screens/ProfileSetupScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import ChatScreen from './src/screens/ChatScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

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
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'AstroConnect Partner' }} />
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
      'New chat request',
      `${sess.customer?.name || 'A customer'} wants to chat at ${money(sess.ratePerMin)}/min.`,
      [
        { text: 'Decline', style: 'destructive', onPress: () => respond('reject') },
        { text: 'Accept', onPress: () => respond('accept') },
      ],
    );
  }, []));
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
        <NavigationContainer ref={navigationRef} theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary } }}>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

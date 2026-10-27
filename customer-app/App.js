import React from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from './src/AuthContext';
import { colors } from './src/theme';
import { setupCalls } from './src/call/setup';

setupCalls();
import LoginScreen from './src/screens/LoginScreen';
import ProfileSetupScreen from './src/screens/ProfileSetupScreen';
import HomeScreen from './src/screens/HomeScreen';
import AstrologerScreen from './src/screens/AstrologerScreen';
import BirthDetailsScreen from './src/screens/BirthDetailsScreen';
import ChatScreen from './src/screens/ChatScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import WalletScreen from './src/screens/WalletScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ChangePasswordScreen from './src/screens/ChangePasswordScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = { Home: 'planet', Chats: 'chatbubbles', Wallet: 'wallet', Profile: 'person' };

// Home screen header: the app name with its tagline underneath (too long for one line on a phone).
function BrandTitle() {
  return (
    <View>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>JothidaConnect</Text>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary, marginTop: 1 }}>by Adithya Guruji Students</Text>
    </View>
  );
}

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
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'JothidaConnect', headerTitle: BrandTitle, tabBarLabel: 'Home' }} />
      <Tab.Screen name="Chats" component={ChatsScreen} options={{ title: 'My Chats' }} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { user, loading } = useAuth();
  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  return (
    <Stack.Navigator screenOptions={{ headerTintColor: colors.primary }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : !user.name ? (
        <Stack.Screen name="Onboarding" component={ProfileSetupScreen} options={{ title: 'Tell us about you' }} />
      ) : (
        <>
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="Astrologer" component={AstrologerScreen} options={{ title: 'Astrologer' }} />
          <Stack.Screen name="BirthDetails" component={BirthDetailsScreen} options={{ title: 'Birth details' }} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="EditProfile" component={ProfileSetupScreen} options={{ title: 'Edit profile' }} />
          <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change password' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary } }}>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

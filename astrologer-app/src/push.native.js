import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from './api';

let pushToken = null;
export const getPushToken = () => pushToken;

// While the app is open the in-app pop-up already announces requests, so don't double up with a banner.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const isRequest = n.request.content.data?.type === 'request';
    return { shouldShowBanner: !isRequest, shouldShowList: !isRequest, shouldPlaySound: false, shouldSetBadge: false };
  },
});

// Ask for permission, set up the ringing channel and tell the server where to reach this phone.
export async function registerForPush() {
  await Notifications.setNotificationChannelAsync('requests', {
    name: 'Chat and call requests',
    description: 'Rings when a client asks for a chat or call',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'ring.wav',
    vibrationPattern: [0, 800, 400, 800, 400, 800],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api('/me/push-token', { method: 'POST', body: { token: data } });
  pushToken = data;
  return data;
}

// Calls handler(sessionId) when the astrologer taps a request notification, including one that launched the app.
export function onRequestTapped(handler) {
  const handle = (response) => {
    const d = response?.notification?.request?.content?.data;
    if (d?.type === 'request' && d.sessionId) handler(d.sessionId);
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

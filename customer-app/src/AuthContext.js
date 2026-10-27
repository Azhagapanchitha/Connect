import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { api, API_URL, setAuthToken } from './api';
import { ROLE } from './theme';

const AuthContext = createContext(null);
const TOKEN_KEY = `astroconnect:${ROLE}:token`;
const USER_KEY = `astroconnect:${ROLE}:user`; // last known profile, so the app opens signed in even offline

// Right after a cold start the phone's network may not be ready yet: retry before giving up.
// Errors with a status (e.g. 401) come from the server itself and are not retried.
async function fetchMe() {
  let last;
  for (const delay of [0, 1000, 2000, 4000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try { return await api('/me'); } catch (e) { if (e.status) throw e; last = e; }
  }
  throw last;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore a saved session on launch. Open straight away from the cached profile, then refresh it;
  // only a server rejection (401) signs the user out, never a slow or unreachable network.
  useEffect(() => {
    (async () => {
      let saved = null;
      let cached = null;
      try {
        [saved, cached] = await Promise.all([AsyncStorage.getItem(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)]);
        if (!saved) return;
        setAuthToken(saved);
        cached = cached ? JSON.parse(cached) : null;
        if (cached) {
          setUser(cached);
          setToken(saved);
          setLoading(false);
        }
        setUser(await fetchMe());
        setToken(saved);
      } catch (e) {
        if (e.status === 401) {
          await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
          setAuthToken(null);
          setToken(null);
          setUser(null);
        } else if (saved && !cached) {
          setAuthToken(null); // no profile to show yet; the saved login stays for the next launch
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Keep the cached profile current.
  useEffect(() => {
    if (user) AsyncStorage.setItem(USER_KEY, JSON.stringify(user)).catch(() => {});
  }, [user]);

  // One realtime connection per signed-in user.
  useEffect(() => {
    if (!token) return undefined;
    const s = io(API_URL, { auth: { token }, transports: ['websocket'] });
    setSocket(s);
    const refresh = () => api('/me').then(setUser).catch(() => {});
    s.on('wallet:update', ({ balance, packageMinutes }) => setUser((u) => (u ? { ...u, wallet: balance, ...(packageMinutes !== undefined ? { packageMinutes } : {}) } : u)));
    s.on('earnings:update', ({ earnings }) => setUser((u) => (u ? { ...u, earnings } : u)));
    s.on('connect', refresh);
    return () => { s.disconnect(); setSocket(null); };
  }, [token]);

  const signIn = useCallback(async (phone, otp) => {
    const res = await api('/auth/verify', { method: 'POST', body: { phone, otp, role: ROLE } });
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setUser(res.user);
    setToken(res.token);
    return res;
  }, []);

  // Customers sign in with mobile number + password; 'register' also sets a first password on an older account.
  const signInWithPassword = useCallback(async (phone, password, mode = 'login') => {
    const res = await api(mode === 'register' ? '/auth/customer/register' : '/auth/customer/login', { method: 'POST', body: { phone, password } });
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setUser(res.user);
    setToken(res.token);
    return res;
  }, []);

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const u = await api('/me', { method: 'PATCH', body: patch });
    setUser(u);
    return u;
  }, []);

  const refreshUser = useCallback(() => api('/me').then(setUser), []);

  return (
    <AuthContext.Provider value={{ token, user, setUser, socket, loading, signIn, signInWithPassword, signOut, updateProfile, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Subscribe to a socket event for the lifetime of a component.
export function useSocketEvent(event, handler) {
  const { socket } = useAuth();
  useEffect(() => {
    if (!socket) return undefined;
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [socket, event, handler]);
}

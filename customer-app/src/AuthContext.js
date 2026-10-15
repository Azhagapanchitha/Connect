import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { api, API_URL, setAuthToken } from './api';
import { ROLE } from './theme';

const AuthContext = createContext(null);
const TOKEN_KEY = `astroconnect:${ROLE}:token`;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore a saved session on launch.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved) {
          setAuthToken(saved);
          setUser(await api('/me'));
          setToken(saved);
        }
      } catch (e) {
        // Only forget the token if the server rejected it, not when it's merely unreachable.
        if (e.status === 401) await AsyncStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // One realtime connection per signed-in user.
  useEffect(() => {
    if (!token) return undefined;
    const s = io(API_URL, { auth: { token }, transports: ['websocket'] });
    setSocket(s);
    const refresh = () => api('/me').then(setUser).catch(() => {});
    s.on('wallet:update', ({ balance }) => setUser((u) => (u ? { ...u, wallet: balance } : u)));
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

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await AsyncStorage.removeItem(TOKEN_KEY);
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
    <AuthContext.Provider value={{ token, user, setUser, socket, loading, signIn, signOut, updateProfile, refreshUser }}>
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

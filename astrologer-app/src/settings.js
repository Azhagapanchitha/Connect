import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-device app preferences, kept on the phone (not the server) so they survive sign-out.
const SETTINGS_KEY = 'settings';
const DEFAULTS = {
  chartLanguage: 'en', // 'en' | 'ta': language of the client's birth chart panel
  chartSplit: 0.5,     // share of the chat screen given to the client chart (dragged in ChatScreen)
};

const SettingsContext = createContext({ settings: DEFAULTS, setSetting: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((v) => v && setSettings({ ...DEFAULTS, ...JSON.parse(v) }))
      .catch(() => {});
  }, []);
  function setSetting(key, value) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }
  return <SettingsContext.Provider value={{ settings, setSetting }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

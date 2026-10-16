import { Alert as NativeAlert, Platform } from 'react-native';

// react-native-web's Alert.alert is a no-op, so on web fall back to the browser's
// alert/confirm. With several buttons, OK runs the last one and Cancel runs the
// 'cancel'-style button (or the first one if none is marked).
function webAlert(title, message, buttons = []) {
  const text = [title, message].filter(Boolean).join('\n\n');
  if (buttons.length < 2) {
    window.alert(text);
    buttons[0]?.onPress?.();
    return;
  }
  const ok = buttons[buttons.length - 1];
  const cancel = buttons.find((b) => b.style === 'cancel') || buttons[0];
  const choice = window.confirm(`${text}\n\nOK: ${ok.text}   ·   Cancel: ${cancel.text}`) ? ok : cancel;
  choice.onPress?.();
}

export const Alert = Platform.OS === 'web' ? { alert: webAlert } : NativeAlert;

// React Native's Alert.alert does nothing in a web browser, so on the web version every
// message ("Login failed") and every confirmation ("Clock out?", "Delete?") silently vanished.
// This swaps in the browser's own alert/confirm dialogs on web. Phones are unaffected.
import { Alert, Platform } from 'react-native';

type Btn = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };

let installed = false;

export function installWebAlert() {
  if (installed || Platform.OS !== 'web' || typeof window === 'undefined') return;
  installed = true;
  (Alert as any).alert = (title: string, message?: string, buttons?: Btn[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const list = buttons || [];
    const cancel = list.find((b) => b.style === 'cancel');
    const actions = list.filter((b) => b !== cancel);
    // Defer so the dialog doesn't block React's current render/update.
    setTimeout(() => {
      if (list.length <= 1) {
        window.alert(text);
        list[0]?.onPress?.();
        return;
      }
      const action = actions[actions.length - 1];
      if (window.confirm(action?.text ? `${text}\n\nOK = ${action.text}` : text)) action?.onPress?.();
      else cancel?.onPress?.();
    }, 0);
  };
}

installWebAlert();

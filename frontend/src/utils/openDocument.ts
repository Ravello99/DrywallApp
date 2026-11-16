// Opens a document page from the server (e.g. a printable invoice) in a browser tab.
// On web a blank tab is opened straight away (before the link request finishes) so popup
// blockers allow it; on phones the system browser opens, where it can be shared or printed.
import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from '../services/api';
import { apiError } from '../services/pmService';

// download: the server sends a file (Excel / ZIP); on web it downloads without opening a tab.
export async function openServerDocument(getPath: () => Promise<{ url: string }>, opts: { download?: boolean } = {}) {
  const tab = Platform.OS === 'web' && typeof window !== 'undefined' && !opts.download ? window.open('', '_blank') : null;
  try {
    const { url } = await getPath();
    const full = `${API_URL}${url}`;
    if (Platform.OS === 'web') {
      if (tab) tab.location.href = full;
      else window.location.href = full;
    } else {
      await WebBrowser.openBrowserAsync(full);
    }
  } catch (e) {
    if (tab) tab.close();
    Alert.alert('Could not open the document', apiError(e));
  }
}

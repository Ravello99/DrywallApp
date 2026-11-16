// Phone browsers count the space behind their address/tool bars as part of "100%" height, so
// anything pinned to the bottom of the page (our tab bar) ended up partly hidden behind the
// browser's toolbar. Size the app to the area actually visible instead, and keep sideways
// overflow from adding a scrollbar that steals height on desktop. Phones in the app: no effect.
import { Platform } from 'react-native';

let installed = false;

export function installWebViewportFix() {
  if (installed || Platform.OS !== 'web' || typeof document === 'undefined') return;
  installed = true;

  const style = document.createElement('style');
  style.id = 'vanguard-viewport-fix';
  style.textContent = `
    html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; }
    html, body, #root { height: var(--app-height, 100%); }
    @supports (height: 100dvh) { html, body, #root { height: 100dvh; } }
    #root { display: flex; flex-direction: column; overflow: hidden; width: 100%; max-width: 100vw; }
  `;
  document.head.appendChild(style);

  // Fallback for browsers without dvh: track the visible height ourselves.
  const setHeight = () => {
    const h = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
  };
  setHeight();
  window.addEventListener('resize', setHeight);
  window.visualViewport?.addEventListener('resize', setHeight);
  window.addEventListener('orientationchange', () => setTimeout(setHeight, 300));
}

installWebViewportFix();

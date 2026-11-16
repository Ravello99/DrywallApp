// Our own bottom tab bar.
//
// * It takes its tabs from the layout (name, label, icon) and navigates with expo-router's
//   router, so it doesn't depend on the props a router version hands to custom tab bars
//   (those changed in Expo Router 58).
// * On the web it measures whether anything (the browser's toolbar, the page being taller than
//   the window, a clipping container) hides the bottom of the bar, and adds exactly that much
//   padding so the labels are always visible.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';

export type TabSpec = { name: string; label: string; icon: any };

type Props = {
  base: string; // '/manager' or '/worker'
  tabs: TabSpec[];
  /** Other screens that should light up a tab, e.g. { project: 'projects' }. Anything else lights up "more". */
  aliases?: Record<string, string>;
};

/** How many px of `el` are hidden below the visible window or below a clipping parent. */
function hiddenBelow(el: any): number {
  if (!el?.getBoundingClientRect || typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  let clip = vv ? vv.offsetTop + vv.height : window.innerHeight;
  let node = el.parentElement;
  while (node && node !== document.body) {
    const s = window.getComputedStyle(node);
    if (s.overflowY !== 'visible' || s.overflow !== 'visible') clip = Math.min(clip, node.getBoundingClientRect().bottom);
    node = node.parentElement;
  }
  return Math.max(0, Math.ceil(el.getBoundingClientRect().bottom - clip));
}

export default function BrandTabBar({ base, tabs, aliases = {} }: Props) {
  const router = useRouter();
  const pathname = usePathname() || base;
  const insets = useSafeAreaInsets();
  const ref = useRef<any>(null);
  const [lift, setLift] = useState(0);

  const segment = pathname.startsWith(base) ? pathname.slice(base.length).split('/')[1] || 'index' : 'index';
  const names = tabs.map((t) => t.name);
  const active = names.includes(segment) ? segment : aliases[segment] || (names.includes('more') ? 'more' : '');

  const measure = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const hidden = hiddenBelow(ref.current);
    if (hidden > 0) {
      // eslint-disable-next-line no-console
      console.log('[VanGuard] tab bar was', hidden, 'px off screen; lifting it');
      setLift((prev) => Math.min(prev + hidden, 120)); // capped, in case the page keeps growing
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const timers = [50, 400, 1200, 3000].map((ms) => setTimeout(measure, ms));
    const onResize = () => {
      setLift(0); // re-measure from scratch after the window changes size
      setTimeout(measure, 120);
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [measure]);

  return (
    <View ref={ref} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 4) + lift }]}>
      {tabs.map((tab) => {
        const focused = tab.name === active;
        const color = focused ? COLORS.primary : COLORS.gray400;
        const go = () => {
          if (focused) return;
          router.navigate((tab.name === 'index' ? base : `${base}/${tab.name}`) as any);
        };
        return (
          <TouchableOpacity
            key={tab.name}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            onPress={go}
            style={styles.item}
            activeOpacity={0.7}
          >
            <View style={[styles.indicator, focused && styles.indicatorOn]} />
            <MaterialIcons name={tab.icon} size={24} color={color} />
            <Text style={[styles.label, { color }, focused && styles.labelOn]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
    flexShrink: 0,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 7,
    paddingBottom: 4,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 32,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: 'transparent',
  },
  indicatorOn: {
    backgroundColor: COLORS.accent,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 3,
    fontWeight: '600',
  },
  labelOn: {
    fontWeight: '700',
  },
});

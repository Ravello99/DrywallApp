// Our own bottom tab bar (replaces the navigation library's default bar, whose built-in sizing
// cut the labels off in the browser). Plain flexbox: icon above label, sized to its content,
// plus the phone's bottom safe-area so it never sits under the home indicator.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';

type Props = {
  state: any;
  descriptors: any;
  navigation: any;
  /** Route names to show, in this order. Everything else stays reachable but hidden. */
  visible: string[];
};

export default function BrandTabBar({ state, descriptors, navigation, visible }: Props) {
  const insets = useSafeAreaInsets();
  const focusedName = state.routes[state.index]?.name;
  const routes = visible
    .map((name) => state.routes.find((r: any) => r.name === name))
    .filter(Boolean);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 4) }]}>
      {routes.map((route: any) => {
        const { options } = descriptors[route.key];
        const focused = focusedName === route.name;
        const color = focused ? COLORS.primary : COLORS.gray400;
        const label =
          typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={onPress}
            style={styles.item}
            activeOpacity={0.7}
          >
            <View style={[styles.indicator, focused && styles.indicatorOn]} />
            {options.tabBarIcon ? options.tabBarIcon({ focused, color, size: 24 }) : null}
            <Text style={[styles.label, { color }, focused && styles.labelOn]} numberOfLines={1}>
              {label}
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
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    paddingBottom: 6,
    minHeight: 56,
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

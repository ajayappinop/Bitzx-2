import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import { Colors } from '../theme';

/** Navigation theme aligned with IBO surfaces; follows system light/dark via caller. */
export const navigationThemeDark: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.gold,
    background: Colors.surfaceDark,
    card: Colors.surfaceCard,
    text: Colors.textPrimary,
    border: Colors.surfaceBorder,
    notification: Colors.danger,
  },
};

export const navigationThemeLight: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.gold,
    background: '#f4f4f5',
    card: '#ffffff',
    text: '#18181b',
    border: '#e4e4e7',
    notification: Colors.danger,
  },
};

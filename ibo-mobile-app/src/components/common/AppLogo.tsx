import React from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet } from 'react-native';
import { APP_LOGO } from '../../assets/branding';

type Props = {
  width?: number;
  height?: number;
  style?: StyleProp<ImageStyle>;
};

export default function AppLogo({ width = 160, height = 56, style }: Props) {
  return (
    <Image
      source={APP_LOGO}
      style={[styles.logo, { width, height }, style]}
      resizeMode="contain"
      accessibilityLabel="IBO"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    alignSelf: 'center',
  },
});

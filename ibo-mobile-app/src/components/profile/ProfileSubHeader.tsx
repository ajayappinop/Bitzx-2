import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from '../common/AppIcon';
import { Colors } from '../../theme';
import { profileStyles } from './profileStyles';

type Props = {
  title: string;
  onBack: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
};

export default function ProfileSubHeader({ title, onBack, rightIcon, onRightPress }: Props) {
  return (
    <View style={profileStyles.subHeader}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
      >
        <Icon name="arrow-left" size={22} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Text style={profileStyles.subHeaderTitle} numberOfLines={1}>{title}</Text>
      {rightIcon && onRightPress ? (
        <TouchableOpacity onPress={onRightPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name={rightIcon as any} size={20} color={Colors.goldLight} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 22 }} />
      )}
    </View>
  );
}

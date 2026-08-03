import React from 'react';
import { View, Text, StyleSheet, TextInputProps } from 'react-native';
import Input from '../common/Input';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';

type Props = {
  label: string;
  error?: string;
  button?: React.ReactNode;
  inputProps: TextInputProps & {
    rightElement?: React.ReactNode;
    leftIcon?: React.ReactNode;
  };
};

export default function AuthOtpInlineField({ label, error, button, inputProps }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.field}>
          <Input
            variant="auth"
            fieldOnly
            error={error}
            {...inputProps}
          />
        </View>
        {button ? <View style={styles.btnSlot}>{button}</View> : null}
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing[4] },
  labelRow: { marginBottom: Spacing[2] },
  label: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
  },
  field: { flex: 1, minWidth: 0 },
  btnSlot: { paddingTop: 2 },
  err: {
    marginTop: Spacing[1],
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.danger,
  },
});

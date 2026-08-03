import React, { useState, useEffect, useCallback } from 'react';
import Icon from '@/components/common/AppIcon';
import {
  View, Text, ScrollView, StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../../store';
import { logoutThunk } from '../../store/auth.slice';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import { profileStyles } from '../../components/profile/profileStyles';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatDate } from '../../utils/formatters';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'Sessions'>;
};

interface Session {
  session_id: string;
  user_agent?: string;
  ip?: string;
  created_at: string;
  last_active?: string;
  is_current?: boolean;
}

function parseUA(ua?: string): { label: string; icon: string } {
  if (!ua) return { label: 'Unknown device', icon: 'monitor' };
  if (/android/i.test(ua)) return { label: 'Android device', icon: 'cellphone' };
  if (/iphone|ipad/i.test(ua)) return { label: 'iOS device', icon: 'cellphone' };
  if (/windows/i.test(ua)) return { label: 'Windows browser', icon: 'monitor' };
  if (/mac/i.test(ua)) return { label: 'macOS browser', icon: 'laptop' };
  return { label: 'Web browser', icon: 'web' };
}

export default function SessionsScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await authApi.session();
      const list = Array.isArray(data) ? data : data?.sessions ?? [];
      setSessions(list);
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleRevokeAll = () => {
    Alert.alert(
      'Revoke All Sessions',
      'This will sign you out from all devices including this one. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke All',
          style: 'destructive',
          onPress: async () => {
            setRevokeLoading(true);
            try {
              await authApi.revokeAllSessions();
              dispatch(logoutThunk());
            } catch (err) {
              setBannerType('error');
              setBanner(parseApiError(err).message);
              setRevokeLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="Active Sessions" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={profileStyles.content}
        showsVerticalScrollIndicator={false}
      >
        <ErrorBanner message={banner} type={bannerType} />

        {sessions.length === 0 ? (
          <View style={[profileStyles.card, profileStyles.empty]}>
            <Text style={profileStyles.emptyText}>No active sessions found</Text>
          </View>
        ) : (
          <View style={profileStyles.card}>
            {sessions.map((s, i) => {
              const { label, icon } = parseUA(s.user_agent);
              return (
                <View
                  key={s.session_id ?? i}
                  style={[
                    styles.sessionRow,
                    s.is_current && styles.sessionRowCurrent,
                    i === sessions.length - 1 && styles.sessionRowLast,
                  ]}
                >
                  <View style={[styles.sessionIcon, s.is_current && styles.sessionIconCurrent]}>
                    <Icon name={icon as any} size={18} color={s.is_current ? Colors.goldLight : Colors.textMuted} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <View style={styles.sessionTitleRow}>
                      <Text style={styles.sessionDevice} numberOfLines={1}>{label}</Text>
                      {s.is_current && (
                        <View style={styles.currentBadge}>
                          <Text style={styles.currentBadgeText}>Current</Text>
                        </View>
                      )}
                    </View>
                    {s.ip ? <Text style={styles.sessionMeta}>IP · {s.ip}</Text> : null}
                    <Text style={styles.sessionMeta}>Signed in · {formatDate(s.created_at)}</Text>
                    {s.last_active ? (
                      <Text style={styles.sessionMeta}>Last active · {formatDate(s.last_active)}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.revokeSection}>
            <View style={styles.warningBox}>
              <Icon name="alert-circle-outline" size={18} color={Colors.warning} />
              <Text style={styles.warningText}>
                Revoking all sessions will immediately sign you out of every device. You will need to sign in again.
              </Text>
            </View>
            <Button
              title="Revoke All Sessions"
              variant="outline"
              onPress={handleRevokeAll}
              loading={revokeLoading}
              fullWidth
            />
          </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  sessionRowCurrent: { backgroundColor: Colors.goldAlpha10 },
  sessionRowLast: { borderBottomWidth: 0 },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[3],
  },
  sessionIconCurrent: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  sessionInfo: { flex: 1, minWidth: 0 },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: 4,
  },
  sessionDevice: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  currentBadge: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.goldLight,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  sessionMeta: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 17,
  },
  revokeSection: { gap: Spacing[3], marginTop: Spacing[1] },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    borderRadius: Radius.xl,
    padding: Spacing[4],
  },
  warningText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});

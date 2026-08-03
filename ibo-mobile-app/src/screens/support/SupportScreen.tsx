import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, Alert, Platform, ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import apiClient from '../../api/client';
import { EP } from '../../api/endpoints';
import { parseApiError } from '../../api/errors';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import StatusBadge from '../../components/common/StatusBadge';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatDate } from '../../utils/formatters';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'Support'>;
};

interface Ticket {
  ticket_id: string;
  subject: string;
  status: string;
  created_at: string;
  updated_at?: string;
  category?: string;
}

const CATEGORIES = ['General', 'Deposit', 'Withdrawal', 'Trading', 'KYC', 'Account', 'Other'];

export default function SupportScreen({ navigation }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('General');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [showForm, setShowForm] = useState(false);

  const loadTickets = useCallback(async () => {
    try {
      const { data } = await apiClient.get(EP.SUPPORT_TICKETS);
      setTickets(Array.isArray(data) ? data : data?.tickets ?? []);
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const handleSubmit = async () => {
    if (!subject.trim()) return Alert.alert('Subject required', 'Please enter a subject for your ticket.');
    if (!message.trim()) return Alert.alert('Message required', 'Please describe your issue.');

    setSubmitLoading(true);
    setBanner('');
    try {
      await apiClient.post(EP.SUPPORT_TICKETS, { subject: subject.trim(), message: message.trim(), category });
      setBannerType('success');
      setBanner('Ticket submitted! We will respond within 24 hours.');
      setSubject('');
      setMessage('');
      setShowForm(false);
      loadTickets();
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setSubmitLoading(false);
    }
  };

  const STATUS_COLOR: Record<string, string> = {
    open: Colors.info,
    in_progress: Colors.warning,
    resolved: Colors.success,
    closed: Colors.textMuted,
  };

  const renderTicket = ({ item }: { item: Ticket }) => (
    <TouchableOpacity
      style={styles.ticketCard}
      onPress={() => navigation.navigate('TicketDetail', { ticketId: item.ticket_id })}
      activeOpacity={0.7}
    >
      <View style={styles.ticketTop}>
        <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] ?? Colors.textMuted }]} />
      </View>
      <View style={styles.ticketBottom}>
        {item.category && <Text style={styles.ticketCategory}>{item.category}</Text>}
        <Text style={styles.ticketDate}>{formatDate(item.updated_at ?? item.created_at)}</Text>
        <Text style={styles.ticketStatus}>{item.status.replace(/_/g, ' ')}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Support</Text>
        <TouchableOpacity onPress={() => setShowForm((f: boolean) => !f)} style={styles.newBtn}>
          <Text style={styles.newBtnText}>{showForm ? '✕' : '+ New'}</Text>
        </TouchableOpacity>
      </View>

      <ErrorBanner message={banner} type={bannerType} />

      {showForm && (
        <AdaptiveKeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent} {...iosManualKeyboardScrollProps()}>
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>New Ticket</Text>

              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.catChip, category === c && styles.catChipActive]}
                    onPress={() => setCategory(c)}
                  >
                    <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Input label="Subject" placeholder="Brief description" value={subject} onChangeText={setSubject} />
              <Input label="Message" placeholder="Describe your issue in detail..." value={message} onChangeText={setMessage} multiline numberOfLines={5} />
              <Button title="Submit Ticket" onPress={handleSubmit} loading={submitLoading} fullWidth />
            </View>
          </ScrollView>
        </AdaptiveKeyboardAvoidingView>
      )}

      <FlatList
          data={tickets}
          keyExtractor={item => item.ticket_id}
          renderItem={renderTicket}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🎫</Text>
              <Text style={styles.emptyText}>No support tickets yet</Text>
              <Text style={styles.emptyHint}>Tap "+ New" to open a ticket</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          showsVerticalScrollIndicator={false}
        />
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3] },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing[2] },
  backText: { fontFamily: FontFamily.semiBold, fontSize: 28, color: Colors.textSecondary, lineHeight: 32 },
  pageTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary, flex: 1 },
  newBtn: {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    backgroundColor: Colors.goldAlpha15, borderWidth: 1, borderColor: Colors.goldAlpha30,
    borderRadius: Radius.md,
  },
  newBtnText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.goldLight },
  formScroll: {},
  formContent: { padding: Spacing[4] },
  formCard: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.xl, padding: Spacing[5],
  },
  formTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary, marginBottom: Spacing[4] },
  fieldLabel: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing[2] },
  catRow: { marginBottom: Spacing[4] },
  catChip: {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover, marginRight: Spacing[2],
  },
  catChipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  catChipText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  catChipTextActive: { color: Colors.goldLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: Spacing[4], paddingBottom: Spacing[8] },
  ticketCard: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[4],
  },
  ticketTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  ticketSubject: { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textPrimary, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: Spacing[2] },
  ticketBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  ticketCategory: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.gold },
  ticketDate: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, flex: 1 },
  ticketStatus: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'capitalize' },
  sep: { height: Spacing[2] },
  empty: { paddingVertical: Spacing[16], alignItems: 'center', gap: Spacing[2] },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textMuted },
  emptyHint: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textDisabled },
});

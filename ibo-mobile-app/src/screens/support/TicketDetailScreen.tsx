import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, Platform,
  TextInput,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { ProfileStackParamList } from '../../navigation/types';
import apiClient from '../../api/client';
import { EP } from '../../api/endpoints';
import { parseApiError } from '../../api/errors';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatDate } from '../../utils/formatters';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'TicketDetail'>;
  route: RouteProp<ProfileStackParamList, 'TicketDetail'>;
};

interface TicketMessage {
  message_id: string;
  sender: 'user' | 'support';
  content: string;
  created_at: string;
  attachments?: string[];
}

interface TicketDetail {
  ticket_id: string;
  subject: string;
  status: string;
  category?: string;
  created_at: string;
}

export default function TicketDetailScreen({ navigation, route }: Props) {
  const { ticketId } = route.params;
  const user = useSelector((s: RootState) => s.auth.user);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    try {
      const [ticketRes, msgsRes] = await Promise.all([
        apiClient.get(EP.SUPPORT_TICKET(ticketId)),
        apiClient.get(EP.SUPPORT_TICKET_MESSAGES(ticketId)),
      ]);
      setTicket(ticketRes.data);
      const list = Array.isArray(msgsRes.data) ? msgsRes.data : msgsRes.data?.messages ?? [];
      setMessages(list);
    } catch {
      // silent — show existing data
    } finally {
      setRefreshing(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async () => {
    if (!reply.trim()) return;
    const text = reply.trim();
    setReply('');
    setSending(true);
    try {
      await apiClient.post(EP.SUPPORT_TICKET_MESSAGES(ticketId), { content: text });
      load();
    } catch {
      setReply(text);
    } finally {
      setSending(false);
    }
  };

  const STATUS_COLOR: Record<string, string> = {
    open: Colors.info,
    in_progress: Colors.warning,
    resolved: Colors.success,
    closed: Colors.textMuted,
  };

  const renderMessage = ({ item }: { item: TicketMessage }) => {
    const isUser = item.sender === 'user';
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowSupport]}>
        {!isUser && (
          <View style={styles.supportAvatar}>
            <Text style={styles.supportAvatarText}>S</Text>
          </View>
        )}
        <View style={[styles.msgBubble, isUser ? styles.msgBubbleUser : styles.msgBubbleSupport]}>
          {!isUser && <Text style={styles.msgSenderName}>Support Team</Text>}
          <Text style={[styles.msgContent, isUser ? styles.msgContentUser : styles.msgContentSupport]}>
            {item.content}
          </Text>
          <Text style={[styles.msgTime, isUser ? styles.msgTimeUser : {}]}>
            {formatDate(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.topBarInfo}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {ticket?.subject ?? 'Ticket'}
          </Text>
          {ticket && (
            <View style={[styles.statusPill, { borderColor: (STATUS_COLOR[ticket.status] ?? Colors.textMuted) + '50', backgroundColor: (STATUS_COLOR[ticket.status] ?? Colors.textMuted) + '18' }]}>
              <Text style={[styles.statusPillText, { color: STATUS_COLOR[ticket.status] ?? Colors.textMuted }]}>
                {ticket.status.replace(/_/g, ' ')}
              </Text>
            </View>
          )}
        </View>
      </View>

      <AdaptiveKeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.message_id}
            {...iosManualKeyboardScrollProps()}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No messages yet. Start the conversation below.</Text>
              </View>
            }
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />

          {ticket?.status !== 'closed' && (
            <View style={styles.replyBar}>
              <TextInput
                style={styles.replyInput}
                placeholder="Type your message..."
                placeholderTextColor={Colors.textMuted}
                value={reply}
                onChangeText={setReply}
                multiline
                maxLength={2000}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!reply.trim() || sending) && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!reply.trim() || sending}
              >
                <Text style={styles.sendBtnText}>{sending ? '…' : '↑'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </AdaptiveKeyboardAvoidingView>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing[2] },
  backText: { fontFamily: FontFamily.semiBold, fontSize: 28, color: Colors.textSecondary, lineHeight: 32 },
  topBarInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  pageTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary, flex: 1 },
  statusPill: {
    paddingHorizontal: Spacing[2], paddingVertical: 2,
    borderRadius: Radius.full, borderWidth: 1,
  },
  statusPillText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, textTransform: 'capitalize' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: Spacing[4], paddingBottom: Spacing[2] },
  msgRow: { flexDirection: 'row', marginBottom: Spacing[3] },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowSupport: { justifyContent: 'flex-start' },
  supportAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.goldAlpha15, borderWidth: 1, borderColor: Colors.goldAlpha30,
    alignItems: 'center', justifyContent: 'center', marginRight: Spacing[2], marginTop: 2,
  },
  supportAvatarText: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.goldLight },
  msgBubble: {
    maxWidth: '78%', borderRadius: Radius.lg, padding: Spacing[3],
    borderWidth: 1,
  },
  msgBubbleUser: { backgroundColor: Colors.goldAlpha15, borderColor: Colors.goldAlpha30 },
  msgBubbleSupport: { backgroundColor: Colors.surfaceCard, borderColor: Colors.surfaceBorder },
  msgSenderName: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 4 },
  msgContent: { fontFamily: FontFamily.regular, fontSize: FontSize.base, lineHeight: 22 },
  msgContentUser: { color: Colors.textPrimary },
  msgContentSupport: { color: Colors.textPrimary },
  msgTime: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  msgTimeUser: { textAlign: 'right' },
  empty: { paddingVertical: Spacing[10], alignItems: 'center' },
  emptyText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  replyBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: Spacing[3], borderTopWidth: 1, borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard, gap: Spacing[3],
  },
  replyInput: {
    flex: 1, backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    fontFamily: FontFamily.regular, fontSize: FontSize.base, color: Colors.textPrimary,
    maxHeight: 120, minHeight: 48,
  },
  sendBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.gold, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.surfaceBorder },
  sendBtnText: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.white, lineHeight: 26 },
});

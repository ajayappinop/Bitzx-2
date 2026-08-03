import React, { useMemo, useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import AppIcon from '../common/AppIcon';
import { buildReferralChildrenMap } from '../../utils/referral';
import { ReferralTreeEntry } from '../../api/referral.api';
import { API_URL } from '../../config/env';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

type RootUser = {
  uid: string;
  name?: string;
  avatar_url?: string;
};

type Summary = {
  total_referral_count?: number;
  total_earned_ibo?: number;
  total_pending_ibo?: number;
};

type Props = {
  rootUser: RootUser;
  referrals: ReferralTreeEntry[];
  summary?: Summary;
};

function resolveAvatarUrl(avatarUrl?: string): string | null {
  const u = (avatarUrl || '').trim();
  if (!u) return null;
  if (u.startsWith('http')) return u;
  const rel = u.startsWith('/') ? u : `/${u}`;
  return `${API_URL}${rel}`;
}

function initials(name?: string): string {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function KycPill({ status }: { status?: string }) {
  const ok = status === 'approved';
  return (
    <View style={[styles.kycPill, ok ? styles.kycOk : styles.kycPending]}>
      <Text style={[styles.kycText, ok ? styles.kycTextOk : styles.kycTextPending]}>
        {ok ? 'KYC ✓' : 'Pending KYC'}
      </Text>
    </View>
  );
}

function Avatar({ node, large, isRoot }: { node: ReferralTreeEntry | RootUser; large?: boolean; isRoot?: boolean }) {
  const src = resolveAvatarUrl(node.avatar_url);
  const dim = large ? 56 : 44;
  return (
    <View style={[
      styles.avatar,
      { width: dim, height: dim, borderRadius: dim / 2 },
      isRoot ? styles.avatarRoot : styles.avatarNode,
    ]}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: dim, height: dim, borderRadius: dim / 2 }} />
      ) : (
        <Text style={[styles.avatarInitials, large && { fontSize: FontSize.base }]}>
          {initials(node.name)}
        </Text>
      )}
    </View>
  );
}

function NodeCard({
  node,
  isRoot,
  hasChildren,
  isOpen,
  onToggle,
}: {
  node: ReferralTreeEntry | RootUser;
  isRoot?: boolean;
  hasChildren?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
}) {
  const earned = Number((node as ReferralTreeEntry).earned_from_this_referral_ibo || 0);
  const pending = Number((node as ReferralTreeEntry).pending_from_this_referral_ibo || 0);
  const level = (node as ReferralTreeEntry).level;

  return (
    <View style={styles.nodeCard}>
      <Avatar node={node} large={isRoot} isRoot={isRoot} />
      <Text style={styles.nodeName} numberOfLines={2}>{node.name || 'User'}</Text>
      {!isRoot && level ? (
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>Level {level}</Text>
        </View>
      ) : null}
      {!isRoot ? <KycPill status={(node as ReferralTreeEntry).kyc_status} /> : (
        <Text style={styles.rootLabel}>You</Text>
      )}
      {(earned > 0 || pending > 0) ? (
        <View style={styles.earnBlock}>
          {earned > 0 ? <Text style={styles.earnedText}>{earned.toFixed(4)} IBO earned</Text> : null}
          {pending > 0 ? <Text style={styles.pendingText}>{pending.toFixed(4)} IBO pending</Text> : null}
        </View>
      ) : null}
      {hasChildren ? (
        <TouchableOpacity onPress={onToggle} style={styles.toggleBtn} activeOpacity={0.7}>
          <AppIcon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} color={Colors.textMuted} />
          <Text style={styles.toggleText}>{isOpen ? 'Collapse' : 'Expand'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function TreeBranch({
  node,
  childrenMap,
  depth,
  defaultOpenDepth,
  remountKey,
}: {
  node: ReferralTreeEntry;
  childrenMap: Record<string, ReferralTreeEntry[]>;
  depth: number;
  defaultOpenDepth: number;
  remountKey: number;
}) {
  const children = childrenMap[node.uid] || [];
  const [open, setOpen] = useState(depth < defaultOpenDepth);

  if (!children.length) {
    return <NodeCard node={node} />;
  }

  return (
    <View style={styles.branch}>
      <NodeCard
        node={node}
        hasChildren
        isOpen={open}
        onToggle={() => setOpen(v => !v)}
      />
      <Text style={styles.directCount}>{children.length} direct</Text>
      {open ? (
        <View style={styles.childrenRow}>
          {children.length > 1 ? <View style={styles.hConnector} /> : null}
          {children.map(child => (
            <View key={`${child.uid}-${remountKey}`} style={styles.childCol}>
              <View style={styles.vConnectorShort} />
              <TreeBranch
                node={child}
                childrenMap={childrenMap}
                depth={depth + 1}
                defaultOpenDepth={defaultOpenDepth}
                remountKey={remountKey}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function ReferralNetworkTree({ rootUser, referrals, summary }: Props) {
  const childrenMap = useMemo(() => buildReferralChildrenMap(referrals), [referrals]);
  const [rootOpen, setRootOpen] = useState(true);
  const [defaultOpenDepth, setDefaultOpenDepth] = useState(2);
  const [remountKey, setRemountKey] = useState(0);

  const rootNode: RootUser & Partial<ReferralTreeEntry> = useMemo(() => ({
    uid: rootUser.uid,
    name: rootUser.name || 'You',
    avatar_url: rootUser.avatar_url,
    level: 0,
    earned_from_this_referral_ibo: summary?.total_earned_ibo,
    pending_from_this_referral_ibo: summary?.total_pending_ibo,
  }), [rootUser, summary]);

  const directChildren = childrenMap[rootUser.uid] || [];

  const expandAll = () => {
    setDefaultOpenDepth(99);
    setRootOpen(true);
    setRemountKey(k => k + 1);
  };

  const collapseAll = () => {
    setDefaultOpenDepth(0);
    setRootOpen(false);
    setRemountKey(k => k + 1);
  };

  if (!directChildren.length) {
    return (
      <View style={styles.emptyBox}>
        <AppIcon name="account-group-outline" size={36} color={Colors.textDisabled} />
        <Text style={styles.emptyTitle}>No referrals in your network yet</Text>
        <Text style={styles.emptySub}>
          Share your referral link — when someone signs up under you, they will appear here.
        </Text>
        <NodeCard node={rootNode} isRoot />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Referral tree</Text>
          <Text style={styles.headerSub}>Tap Expand/Collapse on branches with referrals below.</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={expandAll} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Expand all</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={collapseAll} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Collapse all</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.networkCount}>
        {summary?.total_referral_count ?? referrals.length} in network
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.treeScroll}>
        <View style={styles.treeInner}>
          <NodeCard
            node={rootNode}
            isRoot
            hasChildren
            isOpen={rootOpen}
            onToggle={() => setRootOpen(v => !v)}
          />
          {rootOpen ? (
            <>
              <View style={styles.vConnector} />
              <View style={styles.childrenRow}>
                {directChildren.length > 1 ? <View style={styles.hConnectorWide} /> : null}
                {directChildren.map(child => (
                  <View key={`${child.uid}-${remountKey}`} style={styles.childCol}>
                    <View style={styles.vConnectorShort} />
                    <TreeBranch
                      node={child}
                      childrenMap={childrenMap}
                      depth={1}
                      defaultOpenDepth={defaultOpenDepth}
                      remountKey={remountKey}
                    />
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.white05,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    gap: Spacing[2],
  },
  headerTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing[1],
  },
  headerBtn: {
    borderWidth: 1,
    borderColor: Colors.white12,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
  },
  headerBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  networkCount: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[2],
  },
  treeScroll: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
  },
  treeInner: {
    alignItems: 'center',
    minWidth: '100%',
  },
  branch: {
    alignItems: 'center',
  },
  nodeCard: {
    alignItems: 'center',
    minWidth: 120,
    maxWidth: 140,
    paddingHorizontal: Spacing[1],
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarRoot: {
    borderWidth: 2,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  avatarNode: {
    borderWidth: 2,
    borderColor: Colors.white12,
    backgroundColor: Colors.white05,
  },
  avatarInitials: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  nodeName: {
    marginTop: Spacing[2],
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  levelBadge: {
    marginTop: Spacing[1],
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  levelBadgeText: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.goldLight,
  },
  rootLabel: {
    marginTop: Spacing[1],
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  kycPill: {
    marginTop: Spacing[1],
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  kycOk: {
    backgroundColor: Colors.successDim,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  kycPending: {
    backgroundColor: Colors.white05,
    borderColor: Colors.white12,
  },
  kycText: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
  },
  kycTextOk: {
    color: Colors.success,
  },
  kycTextPending: {
    color: Colors.textMuted,
  },
  earnBlock: {
    marginTop: Spacing[1],
    alignItems: 'center',
  },
  earnedText: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.goldLight,
  },
  pendingText: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.warning,
    marginTop: 2,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: Spacing[1],
    paddingVertical: 2,
  },
  toggleText: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.textMuted,
  },
  directCount: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.textDisabled,
    marginTop: 2,
  },
  childrenRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing[4],
    position: 'relative',
    paddingTop: 0,
  },
  childCol: {
    alignItems: 'center',
  },
  vConnector: {
    width: 1,
    height: 24,
    backgroundColor: Colors.goldAlpha30,
  },
  vConnectorShort: {
    width: 1,
    height: 16,
    backgroundColor: Colors.white12,
  },
  hConnector: {
    position: 'absolute',
    top: 0,
    left: '12%',
    right: '12%',
    height: 1,
    backgroundColor: Colors.white12,
  },
  hConnectorWide: {
    position: 'absolute',
    top: 0,
    left: '8%',
    right: '8%',
    height: 1,
    backgroundColor: Colors.white12,
  },
  emptyBox: {
    alignItems: 'center',
    padding: Spacing[6],
    backgroundColor: Colors.white05,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    gap: Spacing[2],
  },
  emptyTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing[4],
    maxWidth: 280,
  },
});

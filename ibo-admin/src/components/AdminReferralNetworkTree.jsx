import { useMemo, memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, Users } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

function resolveAvatarUrl(avatarUrl) {
  const u = (avatarUrl || '').trim();
  if (!u) return null;
  if (u.startsWith('http')) return u;
  return `${API_BASE}${u.startsWith('/') ? u : `/${u}`}`;
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

export function buildReferralChildrenMap(referrals) {
  const byParent = {};
  for (const row of referrals || []) {
    const parent = row.referred_by;
    if (!parent) continue;
    (byParent[parent] = byParent[parent] || []).push(row);
  }
  for (const key of Object.keys(byParent)) {
    byParent[key].sort((a, b) => {
      const la = Number(a.level) || 0;
      const lb = Number(b.level) || 0;
      if (la !== lb) return la - lb;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  return byParent;
}

function KycPill({ status }) {
  const approved = status === 'approved';
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
        approved
          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
          : 'bg-white/5 text-white/45 border border-white/10'
      }`}
    >
      {approved ? 'KYC ✓' : 'Pending KYC'}
    </span>
  );
}

function ReferralAvatar({ node, size = 'md', isRoot = false }) {
  const src = resolveAvatarUrl(node.avatar_url);
  const dim = size === 'lg' ? 'w-14 h-14 text-base' : 'w-11 h-11 text-sm';
  return (
    <div
      className={`${dim} rounded-full overflow-hidden flex items-center justify-center font-extrabold shrink-0 ${
        isRoot
          ? 'ring-2 ring-gold/55 bg-gold/20 text-gold-light'
          : 'ring-2 ring-white/10 bg-white/[0.06] text-white/85'
      }`}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        initials(node.name)
      )}
    </div>
  );
}

function ReferralNodeCard({
  node,
  isRoot = false,
  hasChildren = false,
  isOpen = true,
  onToggle,
}) {
  const earned = Number(node.earned_from_this_referral_ibo || 0);
  const pending = Number(node.pending_from_this_referral_ibo || 0);
  const userPath = `/users/${encodeURIComponent(node.uid)}`;

  return (
    <div
      className={`flex flex-col items-center min-w-[10rem] max-w-[12rem] px-2 ${
        isRoot ? 'min-w-[11rem]' : ''
      }`}
    >
      <Link
        to={userPath}
        className="flex flex-col items-center rounded-xl px-2 py-1 hover:bg-white/[0.05] transition-colors group"
        title="Open user in admin"
      >
        <ReferralAvatar node={node} size={isRoot ? 'lg' : 'md'} isRoot={isRoot} />
        <p className="mt-2 text-sm font-bold text-white text-center leading-tight line-clamp-2 group-hover:text-gold-light">
          {node.name || node.email || node.uid || 'User'}
        </p>
        {node.email && !isRoot ? (
          <p className="text-[10px] text-white/40 text-center truncate max-w-full">{node.email}</p>
        ) : null}
        {!isRoot ? (
          <>
            <span className="mt-1 text-[10px] font-extrabold text-gold-light/90 bg-gold/10 border border-gold/25 rounded px-1.5 py-0.5">
              Level {node.level}
            </span>
            <div className="mt-1.5">
              <KycPill status={node.kyc_status} />
            </div>
            {(earned > 0 || pending > 0) ? (
              <div className="mt-2 space-y-0.5 text-center w-full">
                {earned > 0 ? (
                  <p className="text-[10px] font-bold text-gold-light">{earned.toFixed(4)} Delta earned</p>
                ) : null}
                {pending > 0 ? (
                  <p className="text-[10px] font-bold text-gold">{pending.toFixed(4)} Delta pending</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-xs text-white/50 font-semibold">Root user</p>
        )}
        <span className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-gold-light/70 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink size={10} /> Open user
        </span>
      </Link>

      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold text-white/45 hover:text-white/75 px-2 py-0.5 rounded-lg hover:bg-white/[0.04]"
          title={isOpen ? 'Collapse branch' : 'Expand branch'}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isOpen ? 'Collapse' : 'Expand'}
        </button>
      ) : null}
    </div>
  );
}

function TreeBranch({ node, childrenMap, depth, defaultOpenDepth, remountKey }) {
  const children = childrenMap[node.uid] || [];
  const [open, setOpen] = useState(depth < defaultOpenDepth);

  if (!children.length) {
    return <ReferralNodeCard node={node} />;
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex flex-col items-center">
        <ReferralNodeCard
          node={node}
          hasChildren
          isOpen={open}
          onToggle={() => setOpen((v) => !v)}
        />
        <p className="mt-0.5 text-[10px] font-bold text-white/35">{children.length} direct</p>
      </div>

      {open ? (
        <>
          <div className="w-px h-5 bg-gradient-to-b from-gold/40 to-white/15" />
          <div className="relative flex items-start justify-center gap-6 sm:gap-8 pt-0">
            {children.length > 1 ? (
              <div
                className="absolute top-0 h-px bg-white/15"
                style={{ left: '12%', right: '12%' }}
              />
            ) : null}
            {children.map((child) => (
              <div key={child.uid} className="flex flex-col items-center">
                <div className="w-px h-4 bg-white/15" />
                <TreeBranch
                  key={`${child.uid}-${remountKey}`}
                  node={child}
                  childrenMap={childrenMap}
                  depth={depth + 1}
                  defaultOpenDepth={defaultOpenDepth}
                  remountKey={remountKey}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default memo(function AdminReferralNetworkTree({ rootUser, referrals, summary }) {
  const childrenMap = useMemo(() => buildReferralChildrenMap(referrals), [referrals]);
  const [rootOpen, setRootOpen] = useState(true);
  const [defaultOpenDepth, setDefaultOpenDepth] = useState(2);
  const [remountKey, setRemountKey] = useState(0);

  const rootNode = useMemo(() => ({
    uid: rootUser?.uid,
    name: rootUser?.name || rootUser?.email || 'Root',
    email: rootUser?.email || '',
    avatar_url: rootUser?.avatar_url || '',
    level: 0,
    kyc_status: rootUser?.kyc_status || '',
    earned_from_this_referral_ibo: summary?.total_earned_ibo || 0,
    pending_from_this_referral_ibo: summary?.total_pending_ibo || 0,
  }), [rootUser, summary]);

  const directChildren = childrenMap[rootUser?.uid] || [];

  const expandAll = () => {
    setDefaultOpenDepth(99);
    setRootOpen(true);
    setRemountKey((k) => k + 1);
  };

  const collapseAll = () => {
    setDefaultOpenDepth(0);
    setRootOpen(false);
    setRemountKey((k) => k + 1);
  };

  if (!directChildren.length) {
    return (
      <div className="rounded-2xl border border-surface-border bg-white/[0.02] px-6 py-12 text-center">
        <Users className="mx-auto text-white/25 mb-3" size={36} />
        <p className="text-white/70 font-semibold">No downstream referrals</p>
        <p className="text-white/45 text-sm mt-1 max-w-md mx-auto">
          This user has not referred anyone yet. Their direct signups will appear here as branches.
        </p>
        <div className="mt-8 flex justify-center">
          <ReferralNodeCard node={rootNode} isRoot />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-surface-border bg-white/[0.02] overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-surface-border flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide">Referral network</h3>
          <p className="text-xs text-white/45 mt-0.5">
            Direct and indirect referrals — click a user to open their profile; use Expand/Collapse on branches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-white/10 text-white/60 hover:text-white/85 hover:bg-white/[0.04]"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-white/10 text-white/60 hover:text-white/85 hover:bg-white/[0.04]"
          >
            Collapse all
          </button>
          <p className="text-xs text-white/50 font-semibold pl-1">
            {summary?.total_referral_count ?? referrals.length} in network
          </p>
        </div>
      </div>
      <div className="overflow-x-auto py-8 px-4 sm:px-6">
        <div className="min-w-max mx-auto flex flex-col items-center">
          <ReferralNodeCard
            node={rootNode}
            isRoot
            hasChildren
            isOpen={rootOpen}
            onToggle={() => setRootOpen((v) => !v)}
          />
          {rootOpen ? (
            <>
              <div className="w-px h-6 bg-gradient-to-b from-gold/50 to-white/20" />
              <div className="relative flex items-start justify-center gap-6 sm:gap-10">
                {directChildren.length > 1 ? (
                  <div
                    className="absolute top-0 h-px bg-white/15"
                    style={{ left: '8%', right: '8%' }}
                  />
                ) : null}
                {directChildren.map((child) => (
                  <div key={child.uid} className="flex flex-col items-center">
                    <div className="w-px h-4 bg-white/15" />
                    <TreeBranch
                      key={`${child.uid}-${remountKey}`}
                      node={child}
                      childrenMap={childrenMap}
                      depth={1}
                      defaultOpenDepth={defaultOpenDepth}
                      remountKey={remountKey}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
});

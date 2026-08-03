import { useMemo, memo, useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

function resolveAvatarUrl(avatarUrl) {
  const u = (avatarUrl || '').trim();
  if (!u) return null;
  if (u.startsWith('http')) return u;
  const base = API.replace(/\/$/, '');
  return `${base}${u.startsWith('/') ? u : `/${u}`}`;
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
          ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
          : 'bg-transparent text-[color:var(--ibo-muted)] border border-[color:var(--ibo-border-solid)]'
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
          ? 'ring-2 ring-[rgba(254, 157, 85,0.55)] bg-[rgba(254, 157, 85,0.15)] text-[#FE9D55]'
          : 'ring-2 ring-[color:var(--ibo-border-solid)] bg-transparent text-[color:var(--ibo-ink)]'
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
  const clickable = hasChildren && onToggle;

  return (
    <button
      type="button"
      onClick={clickable ? onToggle : undefined}
      disabled={!clickable}
      className={`flex flex-col items-center min-w-[9.5rem] max-w-[11rem] px-2 rounded-xl transition-colors ${
        isRoot ? 'min-w-[10rem]' : ''
      } ${clickable ? 'cursor-pointer hover:bg-[color:var(--ibo-hover)] py-1 -my-1' : 'cursor-default'}`}
      title={clickable ? (isOpen ? 'Click to collapse' : 'Click to expand') : undefined}
    >
      <ReferralAvatar node={node} size={isRoot ? 'lg' : 'md'} isRoot={isRoot} />
      <p className="mt-2 text-sm font-bold text-[color:var(--ibo-ink)] text-center leading-tight line-clamp-2">
        {node.name || 'User'}
      </p>
      {!isRoot ? (
        <>
          <span className="mt-1 text-[10px] font-extrabold text-[#FE9D55] bg-[rgba(254, 157, 85,0.1)] border border-[rgba(254, 157, 85,0.25)] rounded px-1.5 py-0.5">
            Level {node.level}
          </span>
          <div className="mt-1.5">
            <KycPill status={node.kyc_status} />
          </div>
          {(earned > 0 || pending > 0) ? (
            <div className="mt-2 space-y-0.5 text-center w-full">
              {earned > 0 ? (
                <p className="text-[10px] font-bold text-[#FE9D55]">{earned.toFixed(4)} Delta earned</p>
              ) : null}
              {pending > 0 ? (
                <p className="text-[10px] font-bold text-[#FE6C02]">{pending.toFixed(4)} Delta pending</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-xs text-[color:var(--ibo-muted)] font-semibold">You</p>
      )}
      {hasChildren ? (
        <span className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-[color:var(--ibo-muted)]">
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isOpen ? 'Collapse' : 'Expand'}
        </span>
      ) : null}
    </button>
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
        <p className="mt-0.5 text-[10px] font-bold text-[color:var(--ibo-muted)]">{children.length} direct</p>
      </div>

      {open ? (
        <>
          <div className="w-px h-5 bg-gradient-to-b from-[rgba(254, 157, 85,0.45)] to-[color:var(--ibo-border-solid)]" />
          <div className="relative flex items-start justify-center gap-6 sm:gap-8 pt-0">
            {children.length > 1 ? (
              <div
                className="absolute top-0 h-px bg-[color:var(--ibo-border-solid)]"
                style={{ left: '12%', right: '12%' }}
              />
            ) : null}
            {children.map((child) => (
              <div key={child.uid} className="flex flex-col items-center">
                <div className="w-px h-4 bg-[color:var(--ibo-border-solid)]" />
                <TreeBranch
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

export default memo(function ReferralNetworkTree({ rootUser, referrals, summary }) {
  const childrenMap = useMemo(() => buildReferralChildrenMap(referrals), [referrals]);
  const [rootOpen, setRootOpen] = useState(true);
  const [defaultOpenDepth, setDefaultOpenDepth] = useState(2);
  const [remountKey, setRemountKey] = useState(0);

  const rootNode = useMemo(() => ({
    uid: rootUser?.uid,
    name: rootUser?.name || 'You',
    avatar_url: rootUser?.avatar_url || '',
    level: 0,
    kyc_status: 'approved',
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
      <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-transparent px-6 py-12 text-center">
        <Users className="mx-auto text-[color:var(--ibo-muted)] mb-3 opacity-50" size={36} />
        <p className="text-[color:var(--ibo-ink)] font-semibold">No referrals in your network yet</p>
        <p className="text-[color:var(--ibo-muted)] text-sm mt-1 max-w-md mx-auto">
          Share your referral link — when someone signs up under you, they will appear here as your tree grows.
        </p>
        <div className="mt-8 flex justify-center">
          <ReferralNodeCard node={rootNode} isRoot />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-transparent overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-[color:var(--ibo-border-solid)] bg-transparent flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-[color:var(--ibo-ink)] uppercase tracking-wide">Referral tree</h3>
          <p className="text-xs text-[color:var(--ibo-muted)] mt-0.5">Click any avatar to expand or collapse that branch.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)]"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)]"
          >
            Collapse all
          </button>
          <p className="text-xs text-[color:var(--ibo-muted)] font-semibold pl-1">
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
              <div className="w-px h-6 bg-gradient-to-b from-[rgba(254, 157, 85,0.5)] to-[color:var(--ibo-border-solid)]" />
              <div className="relative flex items-start justify-center gap-6 sm:gap-10">
                {directChildren.length > 1 ? (
                  <div
                    className="absolute top-0 h-px bg-[color:var(--ibo-border-solid)]"
                    style={{ left: '8%', right: '8%' }}
                  />
                ) : null}
                {directChildren.map((child) => (
                  <div key={child.uid} className="flex flex-col items-center">
                    <div className="w-px h-4 bg-[color:var(--ibo-border-solid)]" />
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

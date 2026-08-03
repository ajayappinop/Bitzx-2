import { useEffect, useRef, useState } from 'react';
import { User } from 'lucide-react';
import { api } from '@/lib/api';

export default function UserUidSuggestInput({
  value,
  onChange,
  placeholder = 'UID, email, phone, or deposit address',
  className = '',
  containerClassName = '',
  dropdownClassName = '',
  minChars = 1,
  onSelect,
}) {
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const q = (value || '').trim();
    if (!q || q.length < minChars) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.searchUsers(q);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('Search failed');
        const items = Array.isArray(j) ? j : (j.items || []);
        setHits(items);
      } catch {
        setHits([]);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [value, minChars]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className={`relative ${containerClassName}`} ref={wrapRef}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
      />
      {open && hits.length > 0 ? (
        <div className={`absolute z-40 top-full mt-1 left-0 right-0 rounded-xl border border-surface-border bg-surface-card shadow-xl max-h-56 overflow-y-auto ${dropdownClassName}`}>
          {hits.slice(0, 8).map((u) => (
            <button
              key={u.uid}
              type="button"
              className="w-full text-left px-3 py-2.5 hover:bg-white/[.05]"
              onClick={() => {
                onChange(u.uid);
                setOpen(false);
                if (onSelect) onSelect(u);
              }}
            >
              <div className="flex items-center gap-2">
                <User size={14} className="text-gold-light shrink-0" />
                <span className="text-white text-sm truncate">{u.name || u.email || 'Unknown user'}</span>
                {u.matched_via_deposit_address ? (
                  <span className="text-[10px] font-bold uppercase text-gold-light/90 shrink-0">addr</span>
                ) : null}
              </div>
              <p className="text-[11px] text-white/50 truncate">{u.email || '—'}</p>
              <p className="text-[11px] text-white/40 font-mono truncate">{u.uid}</p>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

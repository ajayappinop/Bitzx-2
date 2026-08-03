import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} props.sortKey
 * @param {string} props.activeKey
 * @param {'asc'|'desc'} props.dir
 * @param {(key: string) => void} props.onSort
 * @param {string} [props.className]
 * @param {'left'|'right'|'center'} [props.align]
 */
export default function SortableTh({
  children,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = '',
  align = 'left',
}) {
  const active = activeKey === sortKey;
  const justify =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <th className={`${alignCls} ${className}`.trim()}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 w-full ${justify} font-extrabold uppercase tracking-wider text-white/50 hover:text-white/85 text-[11px] group`}
      >
        <span>{children}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUp size={14} className="text-gold-light shrink-0" />
          ) : (
            <ArrowDown size={14} className="text-gold-light shrink-0" />
          )
        ) : (
          <ArrowUpDown size={14} className="opacity-35 shrink-0 group-hover:opacity-55" />
        )}
      </button>
    </th>
  );
}

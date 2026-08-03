import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

/**
 * Navbar / drawer control — switches IBO Exchange between dark and branded light.
 */
export default function ThemeToggle({ className = '', compact = false }) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      data-testid="theme-toggle"
      className={`inline-flex items-center justify-center gap-2 rounded-xl border transition-all
        border-[color:var(--ibo-border)] bg-[color:var(--ibo-elevated)]
        text-[color:var(--ibo-ink-secondary)]
        hover:border-[#0EA4AB]/45 hover:text-[color:var(--ibo-ink)]
        ${compact ? 'h-9 w-9 p-0' : 'h-9 px-2.5 sm:px-3'}
        ${className}`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-logo-gradient text-[#050a1a] shrink-0">
        {isLight ? <Moon size={13} strokeWidth={2.5} /> : <Sun size={13} strokeWidth={2.5} />}
      </span>
      {!compact ? (
        <span className="hidden lg:inline text-xs font-bold tracking-wide">
          {isLight ? 'Dark' : 'Light'}
        </span>
      ) : null}
    </button>
  );
}

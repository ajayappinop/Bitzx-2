"""Replace leftover amber/Binance-yellow brand accents with IBO cyan/lime palette."""
from __future__ import annotations

import os
from pathlib import Path

ROOTS = [
    Path(r"e:\IBO-Exchange\frontend\src"),
    Path(r"e:\IBO-Exchange\ibo-exchange\src"),
    Path(r"e:\IBO-Exchange\ibo-admin\src"),
]
EXTS = {".js", ".jsx", ".ts", ".tsx", ".css"}

# Exact string replacements (order matters — longer / specific first)
HEX = [
    ("#F0B90B", "#0EA4AB"),
    ("#f0b90b", "#0EA4AB"),
    ("#F7C741", "#C5E35B"),
    ("#f7c741", "#C5E35B"),
    ("#A37336", "#1B5FFF"),
    ("#a37336", "#1B5FFF"),
    ("#c9a227", "#C5E35B"),
    ("#C9A227", "#C5E35B"),
    ("#fde68a", "#C5E35B"),
    ("#FDE68A", "#C5E35B"),
    ("#fbbf24", "#C5E35B"),
    ("#FBBF24", "#C5E35B"),
    ("#facc15", "#C5E35B"),
    ("#FACC15", "#C5E35B"),
    ("#f59e0b", "#0EA4AB"),
    ("#F59E0B", "#0EA4AB"),
    ("#d97706", "#0EA4AB"),
    ("#D97706", "#0EA4AB"),
    ("#b45309", "#1B5FFF"),
    ("#B45309", "#1B5FFF"),
    ("#92400e", "#0a5c60"),
    ("#92400E", "#0a5c60"),
    ("#1a1208", "#050a1a"),
    # rgba forms
    ("240, 185, 11", "14, 164, 171"),
    ("240,185,11", "14,164,171"),
    ("163, 115, 54", "27, 95, 255"),
    ("163,115,54", "27,95,255"),
    ("251, 191, 36", "197, 227, 91"),
    ("251,191,36", "197,227,91"),
    ("245, 158, 11", "14, 164, 171"),
    ("245,158,11", "14,164,171"),
]

# Tailwind amber/yellow brand classes → gold (already remapped to cyan/lime)
TW = [
    ("from-amber-600/90", "from-gold/90"),
    ("to-amber-500/90", "to-gold-light/90"),
    ("hover:from-amber-500", "hover:from-gold"),
    ("hover:to-amber-400", "hover:to-gold-light"),
    ("from-amber-500", "from-gold"),
    ("to-amber-500", "to-gold"),
    ("to-amber-400", "to-gold-light"),
    ("to-amber-300", "to-gold-light"),
    ("from-amber-400", "from-gold"),
    ("via-amber-300", "via-gold-light"),
    ("to-yellow-300", "to-gold-light"),
    ("bg-amber-700/80", "bg-gold-dark/80"),
    ("bg-amber-400/25", "bg-gold/25"),
    ("bg-amber-400/20", "bg-gold/20"),
    ("bg-amber-400/15", "bg-gold/15"),
    ("bg-amber-400/10", "bg-gold/10"),
    ("bg-amber-500/[.06]", "bg-gold/[.06]"),
    ("bg-amber-500/[0.08]", "bg-gold/[0.08]"),
    ("bg-amber-500/10", "bg-gold/10"),
    ("bg-amber-500/8", "bg-gold/10"),
    ("bg-amber-500/20", "bg-gold/20"),
    ("bg-amber-500/30", "bg-gold/30"),
    ("bg-amber-900/20", "bg-gold/15"),
    ("bg-amber-400", "bg-gold"),
    ("bg-yellow-400/10", "bg-gold-light/10"),
    ("bg-yellow-400/5", "bg-gold-light/10"),
    ("bg-yellow-500/10", "bg-gold-light/10"),
    ("border-amber-500/25", "border-gold/25"),
    ("border-amber-500/20", "border-gold/20"),
    ("border-amber-500/30", "border-gold/30"),
    ("border-amber-500/35", "border-gold/35"),
    ("border-amber-500/40", "border-gold/40"),
    ("border-amber-400/35", "border-gold/35"),
    ("border-amber-400/30", "border-gold/30"),
    ("border-amber-400/25", "border-gold/25"),
    ("border-amber-300", "border-gold-light"),
    ("border-yellow-500/30", "border-gold-light/30"),
    ("border-yellow-400/30", "border-gold-light/30"),
    ("border-yellow-400/20", "border-gold-light/20"),
    ("text-amber-100", "text-gold-light/90"),
    ("text-amber-200/90", "text-gold-light/90"),
    ("text-amber-200/80", "text-gold-light/80"),
    ("text-amber-200/70", "text-gold-light/70"),
    ("text-amber-200/55", "text-gold-light/55"),
    ("text-amber-200/35", "text-gold-light/40"),
    ("text-amber-200", "text-gold-light"),
    ("text-amber-300/95", "text-gold-light/95"),
    ("text-amber-300/90", "text-gold-light/90"),
    ("text-amber-300/85", "text-gold-light/85"),
    ("text-amber-300", "text-gold-light"),
    ("text-amber-400/90", "text-gold/90"),
    ("text-amber-400/80", "text-gold/80"),
    ("text-amber-400", "text-gold"),
    ("text-amber-500/60", "text-gold/60"),
    ("text-yellow-400", "text-gold-light"),
    ("text-yellow-300", "text-gold-light"),
    ("shadow-amber-500/25", "shadow-gold/25"),
    ("accent-amber-400", "accent-gold"),
    ("hover:bg-amber-500/20", "hover:bg-gold/20"),
    ("hover:bg-amber-500/30", "hover:bg-gold/30"),
    ("hover:text-amber-200", "hover:text-gold-light"),
]


def main() -> None:
    changed_files = 0
    for root in ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.suffix.lower() not in EXTS or not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except Exception:
                continue
            new = text
            for old, rep in HEX + TW:
                if old in new:
                    new = new.replace(old, rep)
            if new != text:
                path.write_text(new, encoding="utf-8", newline="\n")
                changed_files += 1
                print(f"updated {path}")
    print(f"Changed files: {changed_files}")


if __name__ == "__main__":
    main()

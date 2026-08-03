/**
 * SVG icons via lucide-react-native — works without bundling custom .ttf fonts
 * (react-native-vector-icons often shows empty boxes when fonts are not merged into the native binary).
 *
 * Maps former MaterialCommunityIcons `name` strings to Lucide components.
 * Fallback for unknown `name` uses HelpCircle — lucide-react-native v0.378 does not export CircleQuestionMark.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  AlertCircle,
  ArrowDown,
  ArrowDownCircle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpCircle,
  ArrowRight,
  BarChart2,
  Bell,
  Building2,
  Camera,
  LineChart,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  PlusCircle,
  XCircle,
  Clipboard,
  Banknote,
  Clock,
  Copy,
  FileText,
  Eye,
  EyeOff,
  Apple,
  Gauge,
  Headphones,
  History,
  ContactRound,
  Globe,
  Hash,
  Info,
  KeyRound,
  Landmark,
  Laptop,
  LayoutDashboard,
  LogOut,
  Monitor,
  MonitorSmartphone,
  QrCode,
  RefreshCw,
  Repeat,
  ArrowUpDown,
  Rocket,
  ScanLine,
  Search,
  Share2,
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Ticket,
  TrendingUp,
  Wallet,
  CircleUser,
  HelpCircle,
  Link,
  Zap,
  X,
  Pencil,
  Sun,
  Glasses,
  ImageOff,
  Image as ImageIcon,
  ScanFace,
  ExternalLink,
  Maximize2,
} from 'lucide-react-native';

type IconCmp = React.ComponentType<{
  size?: number | string;
  color?: string;
  strokeWidth?: number;
}>;

/** Lucide Gift — not exported in lucide-react-native v0.378. */
function GiftIcon({ size = 24, color = '#FFFFFF', strokeWidth = 2 }: {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x="3" y="8" width="18" height="4" rx="1" />
      <Path d="M12 8v13" />
      <Path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <Path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </Svg>
  );
}

const ICON_MAP: Record<string, IconCmp> = {
  'view-dashboard-outline': LayoutDashboard,
  'chart-line': LineChart,
  'swap-horizontal': ArrowLeftRight,
  'swap-vertical': ArrowUpDown,
  'wallet-outline': Wallet,
  'account-circle-outline': CircleUser,
  account: CircleUser,

  'arrow-left': ArrowLeft,
  'arrow-back': ArrowLeft,
  'chevron-left': ChevronLeft,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  refresh: RefreshCw,
  search: Search,
  'search-outline': Search,
  magnify: Search,
  x: X,
  close: X,
  'close-circle': XCircle,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'shield-check-outline': ShieldCheck,
  'shield-checkmark-outline': ShieldCheck,
  history: History,
  clock: Clock,
  'clock-outline': Clock,
  'file-document-outline': FileText,
  'chevron-right': ChevronRight,
  'bank-off-outline': Landmark,
  'share-variant-outline': Share2,
  check: Check,
  'content-copy': Copy,
  'alert-circle-outline': AlertCircle,
  'alert-circle': AlertCircle,
  'information-outline': Info,
  'camera-outline': Camera,
  'camera-portrait': Camera,
  'camera-enhance-outline': ScanFace,
  'camera-front': Smartphone,
  'weather-sunny': Sun,
  'eye-outline': Eye,
  glasses: Glasses,
  'image-filter-none': ImageOff,
  'image-outline': ImageIcon,
  image: ImageIcon,
  'open-in-new': ExternalLink,
  fullscreen: Maximize2,
  'arrow-down-circle-outline': ArrowDownCircle,
  'arrow-up-circle-outline': ArrowUpCircle,
  circle: Circle,

  'card-account-details-outline': ContactRound,
  'card-account-details': ContactRound,
  'shield-key-outline': Shield,
  'shield-off-outline': ShieldOff,
  'lock-reset': KeyRound,
  'key-variant': KeyRound,
  'qr-code-scan': QrCode,
  'qr-code': QrCode,
  'scan-helper': ScanLine,
  'numeric': Hash,
  'check-circle': CheckCircle2,
  'check-circle-outline': CheckCircle2,
  'cellphone': Smartphone,
  'cellphone-key': Smartphone,
  laptop: Laptop,
  monitor: Monitor,
  web: Globe,
  'monitor-cellphone': MonitorSmartphone,
  'ticket-outline': Ticket,
  logout: LogOut,

  eye: Eye,
  'eye-off': EyeOff,
  'arrow-right': ArrowRight,
  'arrow-forward': ArrowRight,
  'notifications-outline': Bell,
  'headset-outline': Headphones,
  'analytics-outline': BarChart2,
  'chart-candlestick': LineChart,
  'speedometer-outline': Gauge,
  'repeat-outline': Repeat,
  'person-outline': CircleUser,
  'account-outline': CircleUser,
  'rocket-outline': Rocket,
  'business-outline': Building2,
  'phone-portrait-outline': Smartphone,
  'trending-up': TrendingUp,
  'add-circle-outline': PlusCircle,
  apple: Apple,
  'link-variant': Link,
  'lightning-bolt': Zap,
  'plus-circle-outline': PlusCircle,
  'clipboard-outline': Clipboard,
  'cash-multiple': Banknote,
  'cash-outline': Banknote,
  'currency-inr': Banknote,
  'bank-transfer-out': Landmark,
  'gift-outline': GiftIcon,
  gift: GiftIcon,
  flash: Zap,
  'flash-outline': Zap,
  'options-outline': TrendingUp,
  'grid-outline': BarChart2,
  'people-outline': CircleUser,
  'view-grid-outline': BarChart2,

  pencil: Pencil,
  'pencil-outline': Pencil,
  'account-edit-outline': Pencil,
  'account-edit': Pencil,
};

export interface AppIconProps {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export default function AppIcon({ name, size = 24, color = '#FFFFFF', style }: AppIconProps) {
  const Cmp = ICON_MAP[name] ?? HelpCircle;
  const strokeWidth = Math.min(2.5, Math.max(2, Number(size) * 0.085));
  return (
    <View
      collapsable={false}
      pointerEvents="box-none"
      style={[
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
        },
        style,
      ]}
    >
      <Cmp size={size} color={color} strokeWidth={strokeWidth} />
    </View>
  );
}

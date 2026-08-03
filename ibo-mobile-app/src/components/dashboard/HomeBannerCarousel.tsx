/**
 * HomeBannerCarousel — admin-managed promo banners.
 * Horizontal swipe + optional auto-advance; no dark image tint unless API sets overlay_opacity.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  ActivityIndicator,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { API_URL } from '../../config/env';

type Banner = {
  id: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  image_url?: string;
  gradient_start?: string;
  gradient_end?: string;
  overlay_opacity?: number;
  cta_label?: string;
  cta_action?: string;
  cta_url?: string;
};

type BannersPayload = {
  enabled: boolean;
  auto_scroll_seconds?: number;
  banners: Banner[];
};

function bannerImageUrl(path?: string): string {
  const s = String(path ?? '').trim();
  if (!s) return '';
  if (s.startsWith('http')) return s;
  return `${API_URL}${s.startsWith('/') ? '' : '/'}${s}`;
}

function useBannerCta() {
  const navigation = useNavigation<any>();
  return useCallback(
    (banner: Banner) => {
      const action = String(banner.cta_action ?? 'none').toLowerCase();
      switch (action) {
        case 'markets':
          navigation.navigate('Markets', { screen: 'MarketsList' });
          break;
        case 'trade':
          navigation.navigate('Trade', { screen: 'TradePair', params: { symbol: 'IBOUSDT', market: 'spot' } });
          break;
        case 'wallet':
          navigation.navigate('Wallet', { screen: 'WalletHome' });
          break;
        case 'wallet_swap':
          navigation.navigate('Wallet', { screen: 'WalletHome', params: { tab: 'swap' } });
          break;
        case 'futures':
          navigation.navigate('Futures', { screen: 'DerivativesPair', params: { symbol: 'BTCUSDT', market: 'futures' } });
          break;
        default:
          break;
      }
    },
    [navigation],
  );
}

function BannerSlide({
  banner,
  width,
  height,
  onPress,
}: {
  banner: Banner;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const img = bannerImageUrl(banner.image_url);
  const gradStart = banner.gradient_start ?? '#1a1408';
  const overlayOp = banner.overlay_opacity != null && banner.overlay_opacity > 0
    ? banner.overlay_opacity
    : 0;

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      style={[slide.slide, { width, height }]}
    >
      {img ? (
        <Image
          source={{ uri: img }}
          style={slide.image}
          resizeMode="cover"
        />
      ) : (
        <View style={[slide.image, { backgroundColor: gradStart }]} />
      )}

      {overlayOp > 0 ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(8,9,12,${overlayOp})` },
          ]}
        />
      ) : null}

      <View style={slide.content}>
        {banner.badge ? (
          <View style={slide.badgeWrap}>
            <Text style={slide.badge}>{banner.badge}</Text>
          </View>
        ) : null}
        {banner.title ? (
          <Text style={slide.title} numberOfLines={2}>{banner.title}</Text>
        ) : null}
        {banner.subtitle ? (
          <Text style={slide.sub} numberOfLines={2}>{banner.subtitle}</Text>
        ) : null}
        {banner.cta_label ? (
          <View style={slide.ctaRow}>
            <Text style={slide.ctaText}>{banner.cta_label}</Text>
            <Icon name="arrow-right" size={14} color={Colors.surfaceDark} />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const BANNER_ASPECT = 490 / 1200; // server image spec (1200×490)

function bannerHeightForWidth(w: number): number {
  return Math.max(120, Math.round(w * BANNER_ASPECT));
}

const slide = StyleSheet.create({
  slide: {
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  content: {
    position: 'absolute',
    left: Spacing[5],
    right: Spacing[5],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  badgeWrap: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.gold + '66',
    backgroundColor: Colors.gold + '33',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    marginBottom: 8,
  },
  badge: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.goldLight,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: FontFamily.extraBold ?? FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.white,
    lineHeight: 28,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 4,
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 12,
    backgroundColor: Colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  ctaText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.surfaceDark,
  },
});

export default function HomeBannerCarousel() {
  const { width: screenW } = useWindowDimensions();
  const carouselWidth = screenW - Spacing[4] * 2;

  const handleCta = useBannerCta();
  const listRef = useRef<FlatList<Banner>>(null);
  const [payload, setPayload] = useState<BannersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [userDragging, setUserDragging] = useState(false);
  const [layoutW, setLayoutW] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slideW = layoutW > 0 ? layoutW : carouselWidth;
  const bannerH = bannerHeightForWidth(slideW);

  useEffect(() => {
    fetch(`${API_URL}/api/app/home-banners`, { cache: 'no-store' } as RequestInit)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        setPayload({
          enabled: data.enabled !== false,
          auto_scroll_seconds: data.auto_scroll_seconds ?? 5,
          banners: Array.isArray(data.banners) ? data.banners : [],
        });
      })
      .catch(() => setPayload({ enabled: false, auto_scroll_seconds: 5, banners: [] }))
      .finally(() => setLoading(false));
  }, []);

  const banners = payload?.enabled ? (payload?.banners ?? []) : [];
  const intervalSec = Math.max(3, payload?.auto_scroll_seconds ?? 5);

  const goTo = useCallback((i: number) => {
    if (!banners.length) return;
    const next = (banners.length + (i % banners.length)) % banners.length;
    setIdx(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }, [banners.length]);

  const handleScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / slideW);
    if (Number.isFinite(next) && next >= 0 && next < banners.length) {
      setIdx(next);
    }
  }, [banners.length, slideW]);

  useEffect(() => {
    if (banners.length < 2 || userDragging) return;
    timerRef.current = setTimeout(() => goTo(idx + 1), intervalSec * 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [banners.length, idx, intervalSec, goTo, userDragging]);

  if (loading) {
    return (
      <View
        style={[styles.wrap, { height: bannerHeightForWidth(carouselWidth), alignItems: 'center', justifyContent: 'center' }]}
        onLayout={(e) => setLayoutW(e.nativeEvent.layout.width)}
      >
        <ActivityIndicator size="small" color={Colors.gold} />
      </View>
    );
  }

  if (!banners.length) return null;

  return (
    <View
      style={[styles.wrap, { height: bannerH }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - layoutW) > 0.5) setLayoutW(w);
      }}
    >
      <FlatList
        ref={listRef}
        style={styles.list}
        data={banners}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        bounces={banners.length > 1}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={slideW}
        snapToAlignment="start"
        disableIntervalMomentum
        keyExtractor={(b) => b.id}
        getItemLayout={(_, index) => ({
          length: slideW,
          offset: slideW * index,
          index,
        })}
        onScrollBeginDrag={() => setUserDragging(true)}
        onScrollEndDrag={() => setUserDragging(false)}
        onMomentumScrollEnd={(e) => {
          setUserDragging(false);
          handleScrollEnd(e);
        }}
        renderItem={({ item }) => (
          <BannerSlide
            banner={item}
            width={slideW}
            height={bannerH}
            onPress={() => handleCta(item)}
          />
        )}
      />

      {banners.length > 1 ? (
        <View style={styles.dots} pointerEvents="box-none">
          {banners.map((b, i) => (
            <TouchableOpacity
              key={b.id}
              onPress={() => goTo(i)}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <View style={[styles.dot, i === idx && styles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    marginHorizontal: Spacing[4],
    marginTop: Spacing[3],
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.gold + '33',
    backgroundColor: Colors.surfaceCard,
  },
  list: {
    width: '100%',
    height: '100%',
  },
  dots: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    zIndex: 20,
  },
  dot: {
    height: 6,
    width: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  dotActive: {
    width: 28,
    backgroundColor: Colors.goldLight,
  },
});

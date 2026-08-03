/**
 * Token marketing site config — driven by REACT_APP_* at build time.
 * Mirror keys in backend/.env (IBO_*) for API seeding and /api/public/site-config.
 */

import { BRAND_LOGO, resolveBrandLogoUrl } from '@/lib/brandAssets';

function env(key, fallback = "") {
  const v = process.env[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function logoEnv(key, fallback = BRAND_LOGO) {
  return resolveBrandLogoUrl(env(key, fallback), fallback);
}

const CONTRACT = env(
  "REACT_APP_IBO_CONTRACT",
  "0x7962f32a587c49ad4235ddc5982a0ae1945a2c01",
).toLowerCase();

const OFFICIAL_WEBSITE = env("REACT_APP_OFFICIAL_WEBSITE", "https://ibo.io/");
const LOGO_URL = logoEnv("REACT_APP_TOKEN_LOGO_URL", BRAND_LOGO);
const SUPPORT_EMAIL = "support@ibo.io";
const DEX_SWAP =
  env("REACT_APP_DEX_SWAP_LINK") ||
  `https://pancakeswap.finance/swap?outputCurrency=${CONTRACT}`;

const OFFICIAL_EXCHANGE_URL = env("REACT_APP_EXCHANGE_URL", "https://exchange.ibo.io");

const isExternalUrl = (url) => Boolean(url && /^https?:\/\//i.test(url));

function resolveExchangeStatusLabel(raw) {
  const label = (raw || "Live now").trim();
  const lower = label.toLowerCase();
  if (
    isExternalUrl(OFFICIAL_EXCHANGE_URL) &&
    (lower.includes("development") ||
      lower.includes("planned") ||
      lower.includes("coming soon"))
  ) {
    return "Live now";
  }
  return label;
}

const EXCHANGE_STATUS_LABEL = resolveExchangeStatusLabel(
  env("REACT_APP_EXCHANGE_STATUS", "Live now"),
);

/** Large marketing logo used in the hero and navbar. */
const HERO_LOGO_URL = logoEnv("REACT_APP_HERO_LOGO_URL", BRAND_LOGO);

function buildTeam() {
  const linkedin = env("REACT_APP_TEAM_DIRECTOR_LINKEDIN");
  const name = env("REACT_APP_TEAM_DIRECTOR_NAME", "Alex Morgan");
  if (!name) return [];
  return [
    {
      name,
      role: env("REACT_APP_TEAM_DIRECTOR_ROLE", "Founder"),
      bio: env(
        "REACT_APP_TEAM_DIRECTOR_BIO",
        "Founder of Ibo Private Limited, the organization behind the IBO project.",
      ),
      linkedin,
    },
  ];
}

export const SITE_CONFIG = {
  projectName: env("REACT_APP_PROJECT_NAME", "IBO"),
  tokenName: env("REACT_APP_TOKEN_NAME", "IBO"),
  tokenSymbol: env("REACT_APP_TOKEN_SYMBOL", "IBO"),
  launchYear: env("REACT_APP_LAUNCH_YEAR", "2026"),
  networkLabel: env("REACT_APP_NETWORK_LABEL", "BNB Smart Chain (BEP-20)"),
  brandLogoUrl: logoEnv("REACT_APP_BRAND_LOGO_URL", BRAND_LOGO),
  heroLogoUrl: HERO_LOGO_URL,
  logoUrl: LOGO_URL,
  contractAddress: CONTRACT,
  supportEmail: SUPPORT_EMAIL,
  shortDescription: env(
    "REACT_APP_SHORT_DESCRIPTION",
    "IBO is a BNB Chain utility token focused on building accessible crypto trading infrastructure and a broader token ecosystem.",
  ),
  buyUrl: DEX_SWAP,
  bscScanUrl: `https://bscscan.com/token/${CONTRACT}`,
  officialWebsiteUrl: OFFICIAL_WEBSITE,
  officialExchangeUrl: OFFICIAL_EXCHANGE_URL,
  whitepaperPath: "/whitepaper",
  privacyPolicyPath: "/privacy-policy",
  termsPath: "/terms-of-service",
  community: {
    telegram:  env("REACT_APP_TELEGRAM_URL",  "https://t.me/iboofficial"),
    facebook:  env("REACT_APP_FACEBOOK_URL",  "https://www.facebook.com/profile.php?id=61590368919405"),
    instagram: env("REACT_APP_INSTAGRAM_URL", "https://www.instagram.com/theibo/"),
    discord:   env("REACT_APP_DISCORD_URL",   ""),
  },
  exchange: {
    statusLabel: EXCHANGE_STATUS_LABEL,
    launchWindow: env("REACT_APP_EXCHANGE_LAUNCH_WINDOW", "2026"),
    urlDisplay: env("REACT_APP_EXCHANGE_URL_DISPLAY", "exchange.ibo.io"),
    summary: env(
      "REACT_APP_EXCHANGE_SUMMARY",
      "IBO Exchange is live at exchange.ibo.io — spot trading, professional charts, INR deposits and payouts for Indian users, and IBO utility across the platform.",
    ),
  },
  organization: {
    legalEntityName: env("REACT_APP_LEGAL_ENTITY_NAME", "Ibo Private Limited"),
    registrationCountry: env("REACT_APP_REGISTRATION_COUNTRY", ""),
    headquarters: env("REACT_APP_HEADQUARTERS", "10 Anson Road, #10-01 International Plaza"),
  },
  team: buildTeam(),
};

export const SUPPORT_MAILTO = `mailto:${SITE_CONFIG.supportEmail}`;

export const hasExternalLink = isExternalUrl;

export const getExchangeHref = () =>
  hasExternalLink(SITE_CONFIG.officialExchangeUrl)
    ? SITE_CONFIG.officialExchangeUrl
    : "/markets";

export const isExternalExchangeHref = () =>
  hasExternalLink(SITE_CONFIG.officialExchangeUrl);

export const getExchangeStatusLabel = () => SITE_CONFIG.exchange.statusLabel;

export const isExchangeLive = () => {
  const label = getExchangeStatusLabel().toLowerCase();
  return (
    !label.includes("development") &&
    !label.includes("planned") &&
    !label.includes("coming soon")
  );
};

export const getExchangeUrlDisplay = () =>
  SITE_CONFIG.exchange.urlDisplay ||
  SITE_CONFIG.officialExchangeUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

/** Comma-separated channel names for FAQ / copy (Discord omitted when unset). */
export const officialSocialChannelLabels = () => {
  const labels = [];
  if (SITE_CONFIG.community.telegram)  labels.push("Telegram");
  if (SITE_CONFIG.community.facebook)  labels.push("Facebook");
  if (SITE_CONFIG.community.instagram) labels.push("Instagram");
  if (SITE_CONFIG.community.discord)   labels.push("Discord");
  return labels;
};

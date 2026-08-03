import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import {
  Building2,
  FileText,
  Globe,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  SITE_CONFIG,
  SUPPORT_MAILTO,
  hasExternalLink,
} from "@/config/site";

const infoCards = [
  {
    icon: Globe,
    title: "Official Website",
    value: SITE_CONFIG.officialWebsiteUrl || "Official domain to be added",
    note:
      "Publish the final official domain here before resubmitting any listing or verification request.",
  },
  {
    icon: FileText,
    title: "Logo Download URL",
    value: SITE_CONFIG.logoUrl,
    href: SITE_CONFIG.logoUrl,
    note:
      "Public logo download link for token information submissions and directory updates.",
  },
  {
    icon: Mail,
    title: "Project Contact Email",
    value: SITE_CONFIG.supportEmail,
    href: SUPPORT_MAILTO,
    note:
      "Use an email on the official project domain for token directory and listing submissions.",
  },
  {
    icon: ShieldCheck,
    title: "Token Contract",
    value: SITE_CONFIG.contractAddress,
    note: SITE_CONFIG.networkLabel,
  },
  {
    icon: Building2,
    title: "Legal / Operating Entity",
    value:
      SITE_CONFIG.organization.legalEntityName ||
      "Legal entity details to be published",
    note:
      SITE_CONFIG.organization.registrationCountry || SITE_CONFIG.organization.headquarters
        ? [
            SITE_CONFIG.organization.registrationCountry,
            SITE_CONFIG.organization.headquarters,
          ]
            .filter(Boolean)
            .join(" • ")
        : "Add registered entity name and jurisdiction if applicable.",
  },
];

export const ProjectTransparency = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="transparency"
      ref={ref}
      className="section-padding relative overflow-hidden bg-surface-elevated"
      data-testid="transparency-section"
    >
      <div className="absolute top-0 left-1/4 w-80 h-80 bg-[#0EA4AB]/8 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-[#C5E35B]/6 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="inline-block text-ink-accent text-sm font-semibold tracking-wider uppercase mb-4">
            Public Project Information
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mb-6">
            Verification and Transparency
          </h2>
          <p className="text-ink-soft text-base md:text-lg max-w-3xl mx-auto leading-relaxed">
            This section is reserved for the official Delta project details reviewers
            and community members look for: website, contact channel, token contract,
            legal information, and public team profiles.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid md:grid-cols-2 gap-6 mb-10"
        >
          {infoCards.map((card) => (
            <div
              key={card.title}
              className="card-glass p-6 border border-line hover:border-[#0EA4AB]/40 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-logo-gradient flex items-center justify-center mb-4">
                <card.icon size={22} className="icon-on-gradient text-white" />
              </div>
              <h3 className="text-ink font-semibold text-lg mb-2">{card.title}</h3>
              {card.href && hasExternalLink(card.href) ? (
                <a
                  href={card.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-accent break-all font-medium hover:underline"
                >
                  {card.value}
                </a>
              ) : card.href?.startsWith("mailto:") ? (
                <a
                  href={card.href}
                  className="text-ink-accent break-all font-medium hover:underline"
                >
                  {card.value}
                </a>
              ) : (
                <p className="text-ink break-words font-medium">{card.value}</p>
              )}
              <p className="text-ink-muted text-sm mt-3 leading-relaxed">{card.note}</p>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="card-glass p-8 border border-[#0EA4AB]/20"
        >
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-logo-gradient flex items-center justify-center flex-shrink-0">
              <UserRound size={22} className="icon-on-gradient text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-ink mb-2">
                Founder and Team Profiles
              </h3>
              <p className="text-ink-muted leading-relaxed">
                Public team information for token directory and explorer reviews.
                Each listed member includes a role, short bio, and a link to a
                public professional profile where available.
              </p>
            </div>
          </div>

          {SITE_CONFIG.team.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {SITE_CONFIG.team.map((member) => (
                <div
                  key={`${member.name}-${member.role}`}
                  className="rounded-2xl bg-surface-card border border-line p-5"
                >
                  <p className="text-ink font-semibold">{member.name}</p>
                  <p className="text-ink-accent text-sm mt-1">{member.role}</p>
                  {member.bio && (
                    <p className="text-ink-muted text-sm mt-3 leading-relaxed">
                      {member.bio}
                    </p>
                  )}
                  {member.linkedin ? (
                    <a
                      href={member.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex mt-4 text-sm text-ink-accent hover:underline"
                    >
                      View public profile
                    </a>
                  ) : (
                    <p className="text-ink-muted text-xs mt-4 leading-relaxed">
                      Professional profile link will be published here when available.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-surface-card border border-dashed border-[#0EA4AB]/35 p-6">
              <p className="text-ink font-medium mb-2">
                Team profiles are ready to be added.
              </p>
              <p className="text-ink-muted text-sm leading-relaxed">
                Please provide founder names, roles, 1-2 line bios, and LinkedIn or
                equivalent public professional profile links so this section can be
                published properly.
              </p>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-line flex items-start gap-3">
            <FileText size={18} className="text-ink-accent mt-0.5 flex-shrink-0" />
            <p className="text-ink-muted text-sm leading-relaxed">
              The same official details should also be kept consistent across the
              website, whitepaper, CoinMarketCap/CoinGecko submissions, and support
              communications.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default ProjectTransparency;

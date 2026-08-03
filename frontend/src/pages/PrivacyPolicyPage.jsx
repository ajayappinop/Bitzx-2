import { ArrowLeft, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { SITE_CONFIG, SUPPORT_MAILTO } from "@/config/site";

const sections = [
  {
    title: "Information We Collect",
    body:
      "We may collect information you submit directly, including contact details, wallet addresses you choose to share, and messages sent through our support or community channels.",
  },
  {
    title: "How We Use Information",
    body:
      "We use submitted information to respond to enquiries, improve the website experience, review partnership or listing requests, and communicate project updates through official channels.",
  },
  {
    title: "Cookies and Analytics",
    body:
      "Basic analytics or similar technologies may be used to understand site usage and improve performance. Any production deployment should also publish the final cookie and analytics tooling used.",
  },
  {
    title: "Third-Party Links",
    body:
      "This website may link to third-party services such as BscScan, PancakeSwap, Telegram, or X. Their privacy practices are governed by their own policies.",
  },
  {
    title: "Contact",
    body:
      "For privacy-related questions, please contact the Delta project using the public contact email listed below.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-surface text-[var(--text-primary)]">
      <header className="border-b border-line bg-surface-elevated">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft size={16} />
            Back to Home
          </Link>
          <span className="text-sm text-ink-accent font-medium">Privacy Policy</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <p className="text-ink-accent text-sm font-semibold tracking-wider uppercase mb-3">
            Legal
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-ink-muted max-w-3xl leading-relaxed">
            This page outlines the current privacy baseline for the Delta website.
            It should be reviewed and finalized with the project&apos;s official
            legal and operating details before production launch.
          </p>
        </div>

        <div className="space-y-5">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-line bg-surface-card p-6"
            >
              <h2 className="text-xl font-semibold mb-3">{section.title}</h2>
              <p className="text-ink-muted leading-relaxed">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-[#0EA4AB]/25 bg-surface-card p-6">
          <div className="flex items-start gap-3">
            <Mail size={18} className="text-ink-accent mt-1 flex-shrink-0" />
            <div>
              <p className="font-semibold text-ink">Privacy contact</p>
              <a
                href={SUPPORT_MAILTO}
                className="text-ink-accent hover:underline break-all"
              >
                {SITE_CONFIG.supportEmail}
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { SITE_CONFIG } from "@/config/site";

const sections = [
  {
    title: "Website Use",
    body:
      "The IBO website is provided for informational purposes. Users are responsible for independently verifying token details, contract addresses, and third-party links before making any decisions.",
  },
  {
    title: "No Financial Advice",
    body:
      "Nothing on this website constitutes financial, legal, tax, or investment advice. Digital asset participation involves risk, including the risk of loss.",
  },
  {
    title: "Third-Party Services",
    body:
      "Access to third-party services such as explorers, social channels, wallets, or swap platforms is outside IBO website control and subject to those services' own terms.",
  },
  {
    title: "Accuracy of Information",
    body:
      "Project materials, roadmap information, and launch timelines may evolve over time. Public-facing information should be kept aligned with the latest official project communications.",
  },
  {
    title: "Contact",
    body:
      "If you need clarification on these terms, use the official project contact information published on the site.",
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface text-[var(--text-primary)]">
      <header className="border-b border-line bg-surface-elevated">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft size={16} />
            Back to Home
          </Link>
          <span className="text-sm text-ink-accent font-medium">Terms of Service</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 bg-[#0EA4AB]/10 border border-[#0EA4AB]/25 px-4 py-2 rounded-full text-sm text-ink-accent mb-4">
            <FileText size={16} />
            IBO Terms
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Terms of Service</h1>
          <p className="text-ink-muted max-w-3xl leading-relaxed">
            These terms cover access to the public IBO website and project
            materials. They should be reviewed and finalized with the official
            operating entity details before public launch.
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

        <div className="mt-8 text-sm text-ink-muted">
          {SITE_CONFIG.projectName} • {SITE_CONFIG.networkLabel}
        </div>
      </main>
    </div>
  );
}

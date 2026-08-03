import { ArrowLeft, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SITE_CONFIG } from '@/lib/siteConfig';

const sections = [
  {
    title: 'Platform Use',
    body:
      'IBO Exchange is provided for cryptocurrency trading and related services. You are responsible for safeguarding your account credentials, verifying deposit addresses, and independently assessing the risks of digital asset activity.',
  },
  {
    title: 'No Financial Advice',
    body:
      'Nothing on this platform constitutes financial, legal, tax, or investment advice. Digital asset trading involves substantial risk, including the risk of total loss.',
  },
  {
    title: 'Compliance and KYC',
    body:
      'Access to certain features may require identity verification and compliance checks. You agree to provide accurate information and to use the exchange in accordance with applicable laws and platform rules.',
  },
  {
    title: 'Third-Party Services',
    body:
      'Links to explorers, payment rails, social channels, or other third-party services are outside IBO Exchange control and subject to those services\' own terms.',
  },
  {
    title: 'Accuracy of Information',
    body:
      'Market data, fees, supported assets, and platform features may change over time. Official announcements and in-app notices should be treated as the latest source of truth.',
  },
  {
    title: 'Contact',
    body:
      'If you need clarification on these terms, use the official support contact published on the exchange.',
  },
];

export default function TermsPage() {
  return (
    <div className="ibo-page text-white">
      <header className="border-b border-surface-border bg-[#0d0f14]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-white/55 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            Back to Exchange
          </Link>
          <span className="text-sm text-gold-light font-medium">Terms of Service</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/25 px-4 py-2 rounded-full text-sm text-gold-light mb-4">
            <FileText size={16} />
            IBO Exchange Terms
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Terms of Service</h1>
          <p className="text-white/55 max-w-3xl leading-relaxed">
            These terms cover access to IBO Exchange and related trading services.
            They should be reviewed and finalized with the official operating entity
            details before public launch.
          </p>
        </div>

        <div className="space-y-5">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-surface-border bg-surface-card p-6"
            >
              <h2 className="text-xl font-semibold mb-3">{section.title}</h2>
              <p className="text-white/55 leading-relaxed">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 text-sm text-white/40">
          {SITE_CONFIG.projectName} • {SITE_CONFIG.networkLabel}
        </div>
      </main>
    </div>
  );
}

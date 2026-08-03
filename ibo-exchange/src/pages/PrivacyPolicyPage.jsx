import { ArrowLeft, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SITE_CONFIG, SUPPORT_MAILTO } from '@/lib/siteConfig';

const sections = [
  {
    title: 'Information We Collect',
    body:
      'We may collect information you submit when creating an account, completing KYC, trading, contacting support, or using wallet and deposit features. This can include name, email, phone number, identity documents, wallet addresses, and transaction records.',
  },
  {
    title: 'How We Use Information',
    body:
      'We use account and activity information to operate the exchange, process deposits and withdrawals, comply with applicable regulations, prevent fraud, respond to support requests, and improve platform security and performance.',
  },
  {
    title: 'Cookies and Analytics',
    body:
      'The exchange may use cookies, session tokens, and analytics tools to keep you signed in, remember preferences, and understand how the platform is used. Production deployments should document the specific tools in use.',
  },
  {
    title: 'Third-Party Services',
    body:
      'The platform may link to or integrate with third-party services such as payment providers, blockchain explorers, or social channels. Their privacy practices are governed by their own policies.',
  },
  {
    title: 'Contact',
    body:
      'For privacy-related questions about IBO Exchange, contact us using the support email listed below.',
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="ibo-page text-white">
      <header className="border-b border-surface-border bg-[#0d0f14]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-white/55 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            Back to Exchange
          </Link>
          <span className="text-sm text-gold-light font-medium">Privacy Policy</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <p className="text-gold-light text-sm font-semibold tracking-wider uppercase mb-3">
            Legal
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Privacy Policy</h1>
          <p className="text-white/55 max-w-3xl leading-relaxed">
            This page outlines the privacy baseline for IBO Exchange. It should be
            reviewed and finalized with the project&apos;s official legal and operating
            details before production launch.
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

        <div className="mt-8 rounded-2xl border border-gold/25 bg-surface-card p-6">
          <div className="flex items-start gap-3">
            <Mail size={18} className="text-gold-light mt-1 flex-shrink-0" />
            <div>
              <p className="font-semibold text-white">Privacy contact</p>
              <a
                href={SUPPORT_MAILTO}
                className="text-gold-light hover:underline break-all"
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

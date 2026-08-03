import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { SITE_CONFIG, getExchangeUrlDisplay } from '@/config/site';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';
import { 
  ArrowLeft, 
  Download, 
  FileText, 
  Target,
  Lightbulb,
  Shield,
  Coins,
  Building,
  Map,
  Users,
  Lock,
  Scale,
  ChevronRight,
  CheckCircle,
  Globe,
  Zap,
  TrendingUp,
  BarChart3,
  Rocket,
  Loader2
} from 'lucide-react';

const LOGO_ICON_URL = SITE_CONFIG.brandLogoUrl;
const EXCHANGE_URL_LABEL = getExchangeUrlDisplay();

// Section wrapper component
const Section = ({ children, className = '', id = '' }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  
  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      className={className}
    >
      {children}
    </motion.section>
  );
};

// Table of Contents
const tableOfContents = [
  { id: 'executive-summary', title: '1. Executive Summary', icon: FileText },
  { id: 'vision-mission', title: '2. Vision & Mission', icon: Target },
  { id: 'problem', title: '3. Problem Statement', icon: Lightbulb },
  { id: 'solution', title: '4. The Delta Solution', icon: Rocket },
  { id: 'tokenomics', title: '5. Tokenomics', icon: Coins },
  { id: 'utility', title: '6. Token Utility', icon: Zap },
  { id: 'exchange', title: '7. Delta Exchange', icon: Building },
  { id: 'roadmap', title: '8. Roadmap', icon: Map },
  { id: 'security', title: '9. Security & Compliance', icon: Shield },
  { id: 'governance', title: '10. Governance', icon: Users },
  { id: 'conclusion', title: '11. Conclusion', icon: CheckCircle },
  { id: 'disclaimer', title: '12. Legal Disclaimer', icon: Scale },
];

// Tokenomics data
const tokenomicsAllocation = [
  { name: 'Liquidity Pool', percentage: 40, tokens: '36,00,00,000', description: 'Locked liquidity ensuring stable trading and price support', color: '#0EA4AB' },
  { name: 'Marketing', percentage: 15, tokens: '13,50,00,000', description: 'Global marketing campaigns, influencer partnerships, and brand awareness', color: '#C5E35B' },
  { name: 'Development', percentage: 15, tokens: '13,50,00,000', description: 'Platform development, exchange building, and technical infrastructure', color: '#D5D5D0' },
  { name: 'Ecosystem Rewards', percentage: 15, tokens: '13,50,00,000', description: 'Staking rewards, community incentives, and holder benefits', color: '#1B5FFF' },
  { name: 'Team & Reserve', percentage: 10, tokens: '9,00,00,000', description: 'Team allocation with 2-year vesting schedule', color: '#4A9EFF' },
  { name: 'Partnerships', percentage: 5, tokens: '4,50,00,000', description: 'Strategic partnerships and ecosystem collaborations', color: '#8A8B90' },
];

// Roadmap phases
const roadmapPhases = [
  {
    phase: 'Phase 1',
    title: 'Foundation',
    period: 'Q4 2025 - Q1 2026',
    status: 'completed',
    items: ['Token smart contract development', 'Security audit completion', 'Website and branding launch', 'Community building initiation', 'Initial marketing campaigns']
  },
  {
    phase: 'Phase 2',
    title: 'Launch & Growth',
    period: 'Q1 2026 - Q2 2026',
    status: 'completed',
    items: ['PancakeSwap DEX listing', 'CoinGecko & CMC listings', 'Influencer partnerships', 'Community expansion', 'Exchange development begins']
  },
  {
    phase: 'Phase 3',
    title: 'Ecosystem Expansion',
    period: 'Q2 2026 - Q3 2026',
    status: 'active',
    items: ['Staking platform launch', 'Strategic partnerships', 'Mobile app development', 'Cross-chain bridge research', 'Exchange feature rollout']
  },
  {
    phase: 'Phase 4',
    title: 'Exchange Live',
    period: '2026',
    status: 'completed',
    items: [`Delta Exchange live at ${EXCHANGE_URL_LABEL}`, 'Spot trading & professional charts', 'KYC/AML integration', 'INR deposit & payout flows', 'Advanced trading features']
  },
  {
    phase: 'Phase 5',
    title: 'Global Expansion',
    period: '2027 and Beyond',
    status: 'planned',
    items: ['Multi-region expansion', 'Derivatives trading', 'Institutional onboarding', 'DAO governance transition', 'Continuous innovation']
  },
];

export const WhitepaperPage = () => {
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const { showNotice, showBuyNotice } = useExchangeDevNotice();

  const scrollToSection = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);

    const PAGE_BG = '#050a1a';
    const PAGE_WIDTH_PX = 794; // ~A4 width at 96dpi
    const MARGIN_MM = 10;

    const container = document.createElement('div');
    container.setAttribute('data-ibo-pdf-root', '1');
    container.innerHTML = buildPrintableHTML();
    Object.assign(container.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${PAGE_WIDTH_PX}px`,
      background: PAGE_BG,
      color: '#ffffff',
      zIndex: '-1',
      pointerEvents: 'none',
      overflow: 'visible',
    });
    document.body.appendChild(container);

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const pages = Array.from(container.querySelectorAll('.pdf-page'));
      if (!pages.length) {
        throw new Error('No PDF sections found');
      }

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const contentWidth = pageWidth - MARGIN_MM * 2;
      const contentHeight = pageHeight - MARGIN_MM * 2;

      const fillPageBackground = () => {
        pdf.setFillColor(5, 10, 26);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      };

      const addCanvasSlices = (canvas, startNewPage) => {
        const imgWidth = contentWidth;
        const pxPerMm = canvas.width / contentWidth;
        const pageSlicePx = Math.floor(contentHeight * pxPerMm);

        let srcY = 0;
        let sliceIndex = 0;

        while (srcY < canvas.height) {
          const slicePx = Math.min(pageSlicePx, canvas.height - srcY);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = slicePx;
          const ctx = sliceCanvas.getContext('2d');
          ctx.fillStyle = PAGE_BG;
          ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          ctx.drawImage(
            canvas,
            0,
            srcY,
            canvas.width,
            slicePx,
            0,
            0,
            canvas.width,
            slicePx
          );

          if (startNewPage || sliceIndex > 0) {
            pdf.addPage();
          }
          fillPageBackground();

          const sliceHeightMm = slicePx / pxPerMm;
          const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
          pdf.addImage(imgData, 'JPEG', MARGIN_MM, MARGIN_MM, imgWidth, sliceHeightMm);

          srcY += slicePx;
          sliceIndex += 1;
          if (canvas.height - srcY < 2) break;
        }
      };

      for (let i = 0; i < pages.length; i += 1) {
        const section = pages[i];
        const canvas = await html2canvas(section, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: PAGE_BG,
          logging: false,
          width: PAGE_WIDTH_PX,
          windowWidth: PAGE_WIDTH_PX,
          scrollX: 0,
          scrollY: 0,
        });
        addCanvasSlices(canvas, i > 0);
      }

      pdf.save('IBO_Whitepaper_v1.0.pdf');
    } catch (error) {
      console.error('Error generating PDF:', error);
      window.alert('PDF generation failed. Please try again.');
    } finally {
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
      setIsGeneratingPDF(false);
    }
  };

  const buildPrintableHTML = () => {
    const bg = '#050a1a';
    const cardBg = '#0d1530';
    const border = '#1a2748';
    const gold = '#0EA4AB';
    const lightGold = '#C5E35B';
    const textPrimary = '#ffffff';
    const textBody = '#D5D5D0';
    const textMuted = '#8A8B90';
    const textDim = '#6B6D75';

    const pdfPage = (inner) =>
      `<div class="pdf-page" style="width:794px;box-sizing:border-box;background:${bg};padding:28px 36px;font-family:Helvetica,Arial,sans-serif;color:${textPrimary};">
        ${inner}
      </div>`;

    const card = (content, accent = false) =>
      `<div style="background:${cardBg};border:1px solid ${accent ? 'rgba(14,164,171,0.35)' : border};border-radius:14px;padding:24px 26px;box-sizing:border-box;">
        ${content}
      </div>`;

    const sectionHeader = (num, title) =>
      `<table style="width:100%;border-collapse:collapse;margin:0 0 16px 0;">
        <tr>
          <td style="width:40px;vertical-align:middle;">
            <div style="width:36px;height:36px;border-radius:10px;background:${gold};text-align:center;line-height:36px;font-weight:800;font-size:14px;color:${bg};">${num}</div>
          </td>
          <td style="vertical-align:middle;padding-left:12px;">
            <h2 style="font-size:20px;font-weight:700;color:${textPrimary};margin:0;">${title}</h2>
          </td>
        </tr>
      </table>`;

    const para = (text) =>
      `<p style="font-size:11px;line-height:1.75;color:${textBody};margin:0 0 10px 0;">${text}</p>`;

    const subHeading = (text) =>
      `<h3 style="font-size:13px;font-weight:600;color:${lightGold};margin:14px 0 8px 0;">${text}</h3>`;

    const bulletItem = (text) =>
      `<table style="width:100%;border-collapse:collapse;margin:0 0 6px 0;">
        <tr>
          <td style="width:16px;vertical-align:top;color:${lightGold};font-size:12px;padding-top:2px;">&#10003;</td>
          <td style="font-size:11px;line-height:1.6;color:${textBody};vertical-align:top;">${text}</td>
        </tr>
      </table>`;

    const statCell = (label, value, sub = '') =>
      `<td style="width:33.33%;text-align:center;background:${bg};border:1px solid ${border};border-radius:10px;padding:12px 8px;vertical-align:top;">
        <div style="font-size:8px;color:${textDim};text-transform:uppercase;letter-spacing:1.5px;">${label}</div>
        <div style="font-size:15px;font-weight:700;color:${lightGold};margin:4px 0 2px 0;">${value}</div>
        ${sub ? `<div style="font-size:8px;color:${textMuted};">${sub}</div>` : ''}
      </td>`;

    const statRow = (items) =>
      `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:12px 0 0 0;"><tr>
        ${items.map(([l, v, s]) => statCell(l, v, s)).join('')}
      </tr></table>`;

    const numberedItem = (num, title, desc) =>
      `<table style="width:100%;border-collapse:collapse;background:${bg};border:1px solid ${border};border-radius:10px;margin:0 0 8px 0;">
        <tr>
          <td style="width:40px;vertical-align:top;padding:12px 0 12px 12px;">
            <div style="width:28px;height:28px;border-radius:8px;background:rgba(235,80,80,0.12);text-align:center;line-height:28px;color:#e05050;font-weight:700;font-size:12px;">${num}</div>
          </td>
          <td style="vertical-align:top;padding:12px 14px 12px 0;">
            <div style="font-size:12px;font-weight:600;color:${textPrimary};margin-bottom:2px;">${title}</div>
            <div style="font-size:10px;color:${textMuted};line-height:1.5;">${desc}</div>
          </td>
        </tr>
      </table>`;

    const featureBox = (title, desc) =>
      `<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px 14px;margin:0 0 8px 0;box-sizing:border-box;">
        <div style="font-size:12px;font-weight:600;color:${textPrimary};margin-bottom:3px;">&#10003; ${title}</div>
        <div style="font-size:10px;color:${textMuted};line-height:1.5;">${desc}</div>
      </div>`;

    const infoBox = (title, desc) =>
      `<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px 14px;margin:0 0 8px 0;box-sizing:border-box;">
        <div style="font-size:12px;font-weight:600;color:${textPrimary};margin-bottom:3px;">${title}</div>
        <div style="font-size:10px;color:${textMuted};line-height:1.5;">${desc}</div>
      </div>`;

    const twoCol = (pairs) => {
      let html = '';
      for (let i = 0; i < pairs.length; i += 2) {
        const left = pairs[i];
        const right = pairs[i + 1];
        html += `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;"><tr>
          <td style="width:50%;vertical-align:top;padding:0;">${infoBox(left[0], left[1])}</td>
          <td style="width:50%;vertical-align:top;padding:0;">${right ? infoBox(right[0], right[1]) : ''}</td>
        </tr></table>`;
      }
      return html;
    };

    return `
      ${pdfPage(`
        <div style="text-align:center;padding:48px 12px 24px 12px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:3px;margin-bottom:6px;color:${textPrimary};">Delta</div>
          <div style="font-size:24px;font-weight:300;color:${textBody};margin-bottom:8px;">Whitepaper</div>
          <div style="font-size:12px;color:${lightGold};font-weight:600;margin-bottom:6px;">Version 1.0 &nbsp;|&nbsp; March 2026</div>
          <p style="font-size:11px;color:${textMuted};max-width:460px;margin:12px auto 0 auto;line-height:1.7;">
            The comprehensive guide to the Delta ecosystem, tokenomics, and our vision for building the next generation of cryptocurrency infrastructure.
          </p>
          ${statRow([
            ['Total Supply', '900 Million', '$DELTA Tokens'],
            ['Network', 'BNB Chain', 'BEP-20 Standard'],
            ['Launch', 'Q1 2026', 'PancakeSwap'],
          ])}
        </div>
      `)}

      ${pdfPage(card(`
        <h3 style="font-size:14px;font-weight:700;color:${textPrimary};margin:0 0 12px 0;">
          <span style="color:${lightGold};">&#9776;</span> Table of Contents
        </h3>
        ${tableOfContents
          .map(
            (item) =>
              `<div style="font-size:11px;color:${textMuted};padding:7px 0;border-bottom:1px solid ${border};">${item.title}</div>`
          )
          .join('')}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('1', 'Executive Summary')}
        ${para(`Delta ($DELTA) represents a paradigm shift in the cryptocurrency ecosystem, serving as the foundational utility token for an ambitious project that seamlessly bridges decentralized and centralized finance. Built on the BNB Smart Chain (BEP-20), Delta is engineered to create a comprehensive crypto ecosystem centered around our flagship product: <strong style="color:${lightGold}">Delta Exchange</strong>.`)}
        ${para('Unlike countless tokens that rely solely on speculation and hype, Delta is designed with tangible utility at its core. Every token serves a purpose within our expanding ecosystem, from trading fee discounts to governance participation, staking rewards to exclusive access privileges.')}
        ${statRow([
          ['Total Supply', '900 Million', '$DELTA Tokens'],
          ['Network', 'BNB Chain', 'BEP-20 Standard'],
          ['Launch', 'Q1 2026', 'PancakeSwap'],
        ])}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('2', 'Vision & Mission')}
        ${subHeading('Our Vision')}
        ${para('To become a leading force in the cryptocurrency industry by providing accessible, secure, and innovative trading solutions that empower individuals worldwide to participate in the global digital economy. We envision a future where the barriers between traditional finance and cryptocurrency are eliminated, creating seamless opportunities for wealth creation and financial freedom.')}
        ${subHeading('Our Mission')}
        ${para('To build a comprehensive crypto ecosystem that combines the benefits of decentralized finance (DeFi) with the efficiency and user experience of centralized exchanges:')}
        ${bulletItem('Democratizing access to advanced trading infrastructure')}
        ${bulletItem('Providing institutional-grade security for all users')}
        ${bulletItem('Creating sustainable value for token holders')}
        ${bulletItem('Fostering a transparent and community-driven ecosystem')}
        ${bulletItem('Continuously innovating to stay ahead of market demands')}
        ${subHeading('Core Values')}
        ${twoCol([
          ['Security First', 'Enterprise-grade protection for all assets and transactions'],
          ['Community Driven', 'Decisions guided by community feedback and governance'],
          ['Innovation', 'Continuous adoption of cutting-edge technology'],
          ['Transparency', 'Open communication and clear documentation'],
        ])}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('3', 'Problem Statement')}
        ${para('The cryptocurrency market, despite its tremendous growth, continues to face significant challenges that hinder mainstream adoption:')}
        ${numberedItem('1', 'Fragmented Ecosystem', 'Users must navigate multiple platforms for trading, staking, and DeFi activities, leading to poor user experience and increased security risks.')}
        ${numberedItem('2', 'Lack of Real Utility', 'The market is flooded with tokens that offer little to no real-world utility, relying solely on speculation and hype for value.')}
        ${numberedItem('3', 'Security Concerns', 'Exchange hacks, rug pulls, and smart contract vulnerabilities have eroded trust in the cryptocurrency space.')}
        ${numberedItem('4', 'Complex User Experience', 'Many platforms are designed for experienced traders, creating barriers for newcomers seeking to enter the market.')}
        ${numberedItem('5', 'Limited Integration', 'The gap between DeFi and CeFi creates inefficiencies and missed opportunities for users and projects alike.')}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('4', 'The Delta Solution')}
        ${para('Delta addresses these challenges by building a unified ecosystem that combines the best aspects of decentralized and centralized finance. Our solution is built on four foundational pillars:')}
        ${twoCol([
          ['Delta Token ($DELTA)', 'The native utility token powering all ecosystem transactions, governance, and rewards. Built on BNB Chain for speed and efficiency.'],
          ['Delta Exchange', 'A next-generation centralized exchange offering spot trading, advanced charting, and institutional-grade security.'],
          ['Staking & Rewards', 'Comprehensive staking programs allowing holders to earn passive income while supporting network security.'],
          ['Global Ecosystem', 'Cross-chain integration, launchpad access, and partnerships creating a comprehensive crypto ecosystem.'],
        ])}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('5', 'Tokenomics')}
        <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 0 14px 0;"><tr>
          ${[
            ['Token Name', 'Delta', ''],
            ['Symbol', '$DELTA', ''],
            ['Total Supply', '90,00,00,000', ''],
            ['Network', 'BNB Chain', 'BEP-20'],
          ]
            .map(
              ([l, v, s]) =>
                `<td style="width:25%;text-align:center;background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 6px;vertical-align:top;">
                  <div style="font-size:7px;color:${textDim};text-transform:uppercase;letter-spacing:1px;">${l}</div>
                  <div style="font-size:12px;font-weight:700;color:${lightGold};margin:4px 0 2px 0;">${v}</div>
                  ${s ? `<div style="font-size:7px;color:${textMuted};">${s}</div>` : ''}
                </td>`
            )
            .join('')}
        </tr></table>
        ${subHeading('Token Allocation')}
        ${tokenomicsAllocation
          .map(
            (item) =>
              `<table style="width:100%;border-collapse:collapse;background:${bg};border:1px solid ${border};border-radius:10px;margin:0 0 6px 0;">
                <tr>
                  <td style="width:14px;padding:10px 0 10px 12px;vertical-align:middle;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.color};"></span>
                  </td>
                  <td style="padding:10px 8px;vertical-align:middle;">
                    <div style="font-size:11px;font-weight:600;color:${textPrimary};">${item.name}</div>
                    <div style="font-size:9px;color:${textDim};margin-top:2px;">${item.description}</div>
                  </td>
                  <td style="padding:10px 12px 10px 0;text-align:right;vertical-align:middle;white-space:nowrap;">
                    <div style="font-size:13px;font-weight:700;color:${lightGold};">${item.percentage}%</div>
                    <div style="font-size:9px;color:${textDim};">${item.tokens} Delta</div>
                  </td>
                </tr>
              </table>`
          )
          .join('')}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('6', 'Token Utility')}
        ${para('$DELTA is designed to be the cornerstone of the Delta ecosystem, providing multiple use cases that create sustainable demand and value for token holders:')}
        ${[
          ['Trading Fee Discounts', 'Hold $DELTA to unlock tiered discounts on trading fees across Delta Exchange, with up to 50% reduction for top-tier holders.'],
          ['VIP Membership', 'Access exclusive VIP tiers with premium benefits including priority support, early feature access, and exclusive trading pairs.'],
          ['Staking Rewards', 'Earn passive income by staking your $DELTA tokens in our secure staking pools with competitive APY rates.'],
          ['Governance Rights', 'Participate in key decisions shaping the future of the Delta ecosystem through our decentralized governance system.'],
          ['Launchpad Access', 'Get exclusive early access to vetted token launches and IDO opportunities on the Delta Launchpad.'],
          ['Referral Rewards', 'Earn $DELTA rewards for every successful referral to our ecosystem, creating additional passive income streams.'],
        ]
          .map(([t, d]) => featureBox(t, d))
          .join('')}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('7', 'Delta Exchange')}
        ${para(`Delta Exchange is the project's live flagship product â€” a centralized cryptocurrency exchange for both beginners and professional traders. Trade at ${EXCHANGE_URL_LABEL} with spot markets, professional charts, secure wallets, and INR flows for eligible Indian users.`)}
        <div style="background:rgba(14,164,171,0.1);border:1px solid rgba(14,164,171,0.3);border-radius:10px;padding:10px 14px;margin:10px 0 14px 0;">
          <span style="font-size:12px;font-weight:600;color:${lightGold};">Live now: ${EXCHANGE_URL_LABEL}</span>
        </div>
        ${subHeading('Key Features')}
        ${twoCol([
          ['Spot Trading', 'Advanced spot trading with real-time charts, multiple order types, and deep liquidity'],
          ['Security', 'Multi-layer security with cold storage, 2FA, and comprehensive insurance coverage'],
          ['Fast Execution', 'High-performance matching engine with sub-millisecond order execution'],
          ['Secure Wallets', 'Enterprise wallet infrastructure with multi-signature protection'],
          ['Mobile Apps', 'Native iOS and Android apps for trading on the go'],
          ['Fiat Support', 'Multiple fiat on/off ramps for easy deposits and withdrawals'],
        ])}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('8', 'Roadmap')}
        ${roadmapPhases
          .map(
            (phase) =>
              `<div style="background:${bg};border:1px solid ${phase.status === 'active' ? `${lightGold}80` : border};border-radius:10px;padding:12px 14px;margin:0 0 8px 0;box-sizing:border-box;">
                <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
                  <tr>
                    <td style="vertical-align:middle;">
                      <span style="display:inline-block;background:${phase.status === 'completed' ? 'rgba(40,167,69,0.15)' : phase.status === 'active' ? 'rgba(197,227,91,0.15)' : 'rgba(74,75,80,0.2)'};color:${phase.status === 'completed' ? '#28a745' : phase.status === 'active' ? lightGold : textMuted};font-size:10px;font-weight:600;padding:3px 10px;border-radius:10px;margin-right:8px;">${phase.phase}</span>
                      <span style="font-size:12px;font-weight:600;color:${textPrimary};">${phase.title}</span>
                    </td>
                    <td style="text-align:right;font-size:10px;color:${textDim};vertical-align:middle;white-space:nowrap;">${phase.period}</td>
                  </tr>
                </table>
                ${phase.items
                  .map(
                    (it) =>
                      `<div style="font-size:10px;color:${textMuted};margin:0 0 3px 4px;">
                        <span style="color:${gold};">&#9656;</span> ${it}
                      </div>`
                  )
                  .join('')}
              </div>`
          )
          .join('')}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('9', 'Security & Compliance')}
        ${para('Security is the foundation of everything we build. Delta implements multiple layers of protection to ensure the safety of user assets and data.')}
        ${twoCol([
          ['Smart Contract Audits', 'Independent audit reports should be published publicly once completed and officially available.'],
          ['Asset Security Model', 'Cold storage, wallet controls, and custody architecture are implemented across the live exchange platform.'],
          ['Compliance Readiness', 'KYC/AML processes apply on the live exchange where required by jurisdiction and product scope.'],
          ['Insurance', 'Insurance coverage should not be assumed unless formal provider and policy details are published.'],
          ['Security Testing', 'Penetration testing and infrastructure reviews should be documented once they are completed.'],
          ['Monitoring', 'Operational monitoring and incident response run on the live exchange platform.'],
        ])}
      `))}

      ${pdfPage(card(`
        ${sectionHeader('10', 'Governance')}
        ${para('Delta is committed to progressive decentralization. As the ecosystem matures, governance will transition to a DAO (Decentralized Autonomous Organization) structure, giving $DELTA holders direct influence over key decisions.')}
        ${subHeading('Governance Scope')}
        <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:14px 16px;">
          ${[
            'Protocol upgrades and feature prioritization',
            'Fee structure adjustments',
            'Treasury allocation for ecosystem development',
            'Partnership approvals and strategic decisions',
            'Staking reward parameters',
          ]
            .map((it) => bulletItem(it))
            .join('')}
        </div>
      `))}

      ${pdfPage(card(
        `
        ${sectionHeader('11', 'Conclusion')}
        ${para("Delta represents more than just a token â€” it's the foundation of a comprehensive crypto ecosystem designed to empower users and drive innovation in the digital asset space. With a clear vision, strong tokenomics, robust security measures, and an ambitious roadmap, we are positioned to become a significant player in the cryptocurrency industry.")}
        ${para("We invite you to join us on this exciting journey. Whether you're a trader, investor, or crypto enthusiast, the Delta ecosystem offers opportunities for growth, participation, and rewards. Together, we will build the future of cryptocurrency trading.")}
      `,
        true
      ))}

      ${pdfPage(`
        ${card(`
          ${sectionHeader('12', 'Legal Disclaimer')}
          <p style="font-size:10px;line-height:1.6;color:${textMuted};margin:0 0 8px 0;">
            This whitepaper is for informational purposes only and does not constitute financial, legal, or investment advice. The information contained herein is subject to change without notice. Cryptocurrency investments carry significant risk, and the value of $DELTA tokens may fluctuate significantly. Past performance is not indicative of future results.
          </p>
          <p style="font-size:10px;line-height:1.6;color:${textMuted};margin:0 0 8px 0;">
            Nothing in this whitepaper shall be deemed to constitute a prospectus or offer document of any sort. $DELTA tokens are not intended to constitute securities in any jurisdiction.
          </p>
          <p style="font-size:10px;line-height:1.6;color:${textMuted};margin:0;">
            Always conduct your own research (DYOR) and consult with professional advisors before making any investment decisions. By participating in the Delta ecosystem, you acknowledge that you understand and accept the risks involved.
          </p>
        `)}
        <div style="padding:20px 0 8px 0;border-top:2px solid ${gold};text-align:center;margin-top:18px;">
          <div style="font-size:16px;font-weight:800;letter-spacing:2px;color:${textPrimary};">Delta</div>
          <p style="font-size:9px;color:${textDim};margin:6px 0 0 0;">&copy; ${new Date().getFullYear()} Delta. All rights reserved.</p>
        </div>
      `)}
    `;
  };

  return (
    <div className="min-h-screen bg-surface" data-testid="whitepaper-page">
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-xl border-b border-line">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 group min-w-0">
            <img src={LOGO_ICON_URL} alt="Delta" className="h-8 w-8 object-contain flex-shrink-0" />
            <span className="text-lg font-bold">
              <span className="text-ink">Delta</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <Link 
              to="/" 
              className="flex items-center gap-2 text-ink-muted hover:text-ink-accent transition-colors text-sm"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Back to Home</span>
            </Link>
            <button 
              onClick={handleDownloadPDF}
              disabled={isGeneratingPDF}
              className="flex items-center gap-2 bg-logo-gradient text-[#050a1a] font-bold px-3 sm:px-4 py-2 rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-70"
            >
              {isGeneratingPDF ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span className="hidden sm:inline">Generating...</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span className="hidden sm:inline">Download PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <div>
        {/* Hero Section */}
        <section className="relative pt-28 pb-16 overflow-hidden pdf-section" style={{ backgroundColor: 'var(--bg-default)' }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(14,164,171,0.15),transparent)]" />
        <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-[#0EA4AB]/10 rounded-full blur-3xl" />
        
        <div className="max-w-5xl mx-auto px-4 sm:px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="inline-block mb-8"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-[#0EA4AB]/20 rounded-full blur-xl scale-150" />
                <img src={LOGO_ICON_URL} alt="Delta" className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto" />
              </div>
            </motion.div>
            
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-4">
              Delta Whitepaper
            </h1>
            <p className="text-ink-accent text-lg font-medium mb-2">Version 1.0 | March 2026</p>
            <p className="text-ink-muted max-w-2xl mx-auto">
              The comprehensive guide to the Delta ecosystem, tokenomics, and our vision for 
              building the next generation of cryptocurrency infrastructure.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 pb-20">
        <div className="grid lg:grid-cols-[280px_1fr] gap-8 lg:gap-12">
          
          {/* Mobile TOC */}
          <div className="lg:hidden -mx-1">
            <div className="flex gap-2 overflow-x-auto pb-2 px-1 snap-x snap-mandatory scrollbar-thin">
              {tableOfContents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className="snap-start flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-card px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink-accent hover:border-[#0EA4AB]/40"
                >
                  <item.icon size={12} className="text-ink-accent" />
                  {item.title}
                </button>
              ))}
            </div>
          </div>

          {/* Sidebar - Table of Contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-6"
              >
                <h3 className="text-ink font-bold mb-4 flex items-center gap-2">
                  <FileText size={18} className="text-ink-accent" />
                  Table of Contents
                </h3>
                <nav className="space-y-1">
                  {tableOfContents.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => scrollToSection(item.id)}
                      className="w-full flex items-center gap-2 text-left text-sm text-ink-muted hover:text-ink-accent hover:bg-[#0EA4AB]/10 px-3 py-2 rounded-lg transition-all group"
                    >
                      <item.icon size={14} className="text-ink-muted group-hover:text-ink-accent" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                </nav>
              </motion.div>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="space-y-16">
            
            {/* Executive Summary */}
            <Section id="executive-summary">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <FileText size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">1. Executive Summary</h2>
                </div>
                
                <div className="prose prose-invert max-w-none space-y-4">
                  <p className="text-ink-soft leading-relaxed">
                    Delta ($DELTA) is a BEP-20 utility token on BNB Smart Chain issued by Delta Private Limited.
                    The project operates crypto trading infrastructure, including{' '}
                    <span className="text-ink-accent font-semibold">Delta Exchange</span> at{' '}
                    <button
                      type="button"
                      onClick={showNotice}
                      className="text-ink-accent font-semibold underline underline-offset-2 hover:text-ink"
                    >
                      {EXCHANGE_URL_LABEL}
                    </button>
                    . This document describes tokenomics, platform utility, and roadmap milestones.
                  </p>
                  
                  <p className="text-ink-soft leading-relaxed">
                    Unlike countless tokens that rely solely on speculation and hype, Delta is designed with tangible 
                    utility at its core. Every token serves a purpose within our expanding ecosystem, from trading fee 
                    discounts to governance participation, staking rewards to exclusive access privileges.
                  </p>

                  <div className="grid md:grid-cols-3 gap-4 mt-8">
                    {[
                      { label: 'Total Supply', value: '900 Million', sub: '$DELTA Tokens' },
                      { label: 'Network', value: 'BNB Chain', sub: 'BEP-20 Standard' },
                      { label: 'Launch', value: 'Q1 2026', sub: 'PancakeSwap' },
                    ].map((stat) => (
                      <div key={stat.label} className="bg-surface/50 rounded-xl p-4 text-center border border-line">
                        <p className="text-ink-muted text-xs uppercase tracking-wider mb-1">{stat.label}</p>
                        <p className="text-ink-accent font-bold text-xl">{stat.value}</p>
                        <p className="text-ink-muted text-xs">{stat.sub}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* Vision & Mission */}
            <Section id="vision-mission">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Target size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">2. Vision & Mission</h2>
                </div>
                
                <div className="space-y-8">
                  <div>
                    <h3 className="text-xl font-semibold text-ink-accent mb-3">Our Vision</h3>
                    <p className="text-ink-soft leading-relaxed">
                      To become a leading force in the cryptocurrency industry by providing accessible, secure, and 
                      innovative trading solutions that empower individuals worldwide to participate in the global 
                      digital economy. We envision a future where the barriers between traditional finance and 
                      cryptocurrency are eliminated, creating seamless opportunities for wealth creation and 
                      financial freedom.
                    </p>
                  </div>
                  
                  <div>
                    <h3 className="text-xl font-semibold text-ink-accent mb-3">Our Mission</h3>
                    <p className="text-ink-soft leading-relaxed">
                      To build a comprehensive crypto ecosystem that combines the benefits of decentralized finance 
                      (DeFi) with the efficiency and user experience of centralized exchanges. We are committed to:
                    </p>
                    <ul className="mt-4 space-y-3">
                      {[
                        'Democratizing access to advanced trading infrastructure',
                        'Providing institutional-grade security for all users',
                        'Creating sustainable value for token holders',
                        'Fostering a transparent and community-driven ecosystem',
                        'Continuously innovating to stay ahead of market demands'
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-ink-soft">
                          <CheckCircle size={18} className="text-ink-accent mt-0.5 flex-shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-xl font-semibold text-ink-accent mb-3">Core Values</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      {[
                        { title: 'Security First', desc: 'Enterprise-grade protection for all assets and transactions' },
                        { title: 'Community Driven', desc: 'Decisions guided by community feedback and governance' },
                        { title: 'Innovation', desc: 'Continuous adoption of cutting-edge technology' },
                        { title: 'Transparency', desc: 'Open communication and clear documentation' },
                      ].map((value) => (
                        <div key={value.title} className="bg-surface/50 rounded-xl p-4 border border-line">
                          <p className="text-ink font-semibold mb-1">{value.title}</p>
                          <p className="text-ink-muted text-sm">{value.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            {/* Problem Statement */}
            <Section id="problem">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Lightbulb size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">3. Problem Statement</h2>
                </div>
                
                <div className="space-y-6">
                  <p className="text-ink-soft leading-relaxed">
                    The cryptocurrency market, despite its tremendous growth, continues to face significant challenges 
                    that hinder mainstream adoption and create barriers for both new and experienced users:
                  </p>
                  
                  <div className="space-y-4">
                    {[
                      {
                        title: 'Fragmented Ecosystem',
                        desc: 'Users must navigate multiple platforms for trading, staking, and DeFi activities, leading to poor user experience and increased security risks.'
                      },
                      {
                        title: 'Lack of Real Utility',
                        desc: 'The market is flooded with tokens that offer little to no real-world utility, relying solely on speculation and hype for value.'
                      },
                      {
                        title: 'Security Concerns',
                        desc: 'Exchange hacks, rug pulls, and smart contract vulnerabilities have eroded trust in the cryptocurrency space.'
                      },
                      {
                        title: 'Complex User Experience',
                        desc: 'Many platforms are designed for experienced traders, creating barriers for newcomers seeking to enter the market.'
                      },
                      {
                        title: 'Limited Integration',
                        desc: 'The gap between DeFi and CeFi creates inefficiencies and missed opportunities for users and projects alike.'
                      }
                    ].map((problem, i) => (
                      <div key={i} className="flex gap-4 bg-surface/50 rounded-xl p-4 border border-line">
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-red-400 font-bold text-sm">{i + 1}</span>
                        </div>
                        <div>
                          <p className="text-ink font-semibold mb-1">{problem.title}</p>
                          <p className="text-ink-muted text-sm">{problem.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* The Delta Solution */}
            <Section id="solution">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-[#0EA4AB]/30 rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Rocket size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">4. The Delta Solution</h2>
                </div>
                
                <div className="space-y-6">
                  <p className="text-ink-soft leading-relaxed">
                    Delta addresses these challenges by building a unified ecosystem that combines the best aspects 
                    of decentralized and centralized finance. Our solution is built on four foundational pillars:
                  </p>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    {[
                      {
                        icon: Coins,
                        title: 'Delta Token ($DELTA)',
                        desc: 'The native utility token powering all ecosystem transactions, governance, and rewards. Built on BNB Chain for speed and efficiency.'
                      },
                      {
                        icon: Building,
                        title: 'Delta Exchange',
                        desc: 'A next-generation centralized exchange offering spot trading, advanced charting, and institutional-grade security.'
                      },
                      {
                        icon: TrendingUp,
                        title: 'Staking & Rewards',
                        desc: 'Comprehensive staking programs allowing holders to earn passive income while supporting network security.'
                      },
                      {
                        icon: Globe,
                        title: 'Global Ecosystem',
                        desc: 'Cross-chain integration, launchpad access, and partnerships creating a comprehensive crypto ecosystem.'
                      }
                    ].map((pillar, i) => (
                      <div key={i} className="bg-surface/50 rounded-xl p-6 border border-line hover:border-[#0EA4AB]/30 transition-colors">
                        <div className="w-12 h-12 rounded-xl bg-[#0EA4AB]/10 flex items-center justify-center mb-4">
                          <pillar.icon size={24} className="text-ink-accent" />
                        </div>
                        <h4 className="text-ink font-semibold text-lg mb-2">{pillar.title}</h4>
                        <p className="text-ink-muted text-sm leading-relaxed">{pillar.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* Tokenomics */}
            <Section id="tokenomics">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Coins size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">5. Tokenomics</h2>
                </div>
                
                <div className="space-y-8">
                  {/* Token Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                    {[
                      { label: 'Token Name', value: 'Delta' },
                      { label: 'Symbol', value: '$DELTA', highlight: true },
                      { label: 'Total Supply', value: '90,00,00,000' },
                      { label: 'Network', value: 'BNB Chain (BEP-20)' },
                    ].map((detail) => (
                      <div key={detail.label} className="bg-surface/50 rounded-xl p-3 sm:p-4 text-center border border-line min-w-0">
                        <p className="text-ink-muted text-[10px] sm:text-xs uppercase tracking-wider mb-1">{detail.label}</p>
                        <p className={`font-bold text-sm sm:text-base break-words ${detail.highlight ? 'text-ink-accent' : 'text-ink'}`}>{detail.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Allocation Breakdown */}
                  <div>
                    <h3 className="text-xl font-semibold text-ink-accent mb-4">Token Allocation</h3>
                    <div className="space-y-3">
                      {tokenomicsAllocation.map((item, i) => (
                        <div key={i} className="relative bg-surface/50 rounded-xl p-4 border border-line overflow-hidden">
                          <div 
                            className="absolute left-0 top-0 bottom-0 opacity-10"
                            style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                          />
                          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                              <div 
                                className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                                style={{ backgroundColor: item.color }}
                              />
                              <div className="min-w-0">
                                <p className="text-ink font-semibold">{item.name}</p>
                                <p className="text-ink-muted text-xs break-words">{item.description}</p>
                              </div>
                            </div>
                            <div className="text-left sm:text-right flex-shrink-0 pl-6 sm:pl-0">
                              <p className="text-ink-accent font-bold">{item.percentage}%</p>
                              <p className="text-ink-muted text-xs tabular-nums break-all">{item.tokens} Delta</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            {/* Token Utility */}
            <Section id="utility">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Zap size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">6. Token Utility</h2>
                </div>
                
                <p className="text-ink-soft leading-relaxed mb-6">
                  $DELTA is designed to be the cornerstone of the Delta ecosystem, providing multiple use cases 
                  that create sustainable demand and value for token holders:
                </p>
                
                <div className="grid md:grid-cols-2 gap-4">
                  {[
                    { title: 'Trading Fee Discounts', desc: 'Hold $DELTA to unlock tiered discounts on trading fees across Delta Exchange, with up to 50% reduction for top-tier holders.' },
                    { title: 'VIP Membership', desc: 'Access exclusive VIP tiers with premium benefits including priority support, early feature access, and exclusive trading pairs.' },
                    { title: 'Staking Rewards', desc: 'Earn passive income by staking your $DELTA tokens in our secure staking pools with competitive APY rates.' },
                    { title: 'Governance Rights', desc: 'Participate in key decisions shaping the future of the Delta ecosystem through our decentralized governance system.' },
                    { title: 'Launchpad Access', desc: 'Get exclusive early access to vetted token launches and IDO opportunities on the Delta Launchpad.' },
                    { title: 'Referral Rewards', desc: 'Earn $DELTA rewards for every successful referral to our ecosystem, creating additional passive income streams.' },
                  ].map((utility, i) => (
                    <div key={i} className="bg-surface/50 rounded-xl p-5 border border-line hover:border-[#0EA4AB]/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <CheckCircle size={20} className="text-ink-accent mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="text-ink font-semibold mb-1">{utility.title}</h4>
                          <p className="text-ink-muted text-sm leading-relaxed">{utility.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {/* Delta Exchange */}
            <Section id="exchange">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-[#0EA4AB]/30 rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Building size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">7. Delta Exchange</h2>
                </div>
                
                <div className="space-y-6">
                  <p className="text-ink-soft leading-relaxed">
                    Delta Exchange is the project&apos;s live flagship product: a centralized cryptocurrency exchange
                    for both beginners and professional traders. Sign in at{' '}
                    <button
                      type="button"
                      onClick={showNotice}
                      className="text-ink-accent font-semibold underline underline-offset-2 hover:text-ink"
                    >
                      {EXCHANGE_URL_LABEL}
                    </button>{' '}
                    for spot trading, secure wallets, and INR deposit and payout flows where available.
                  </p>
                  
                  <div className="bg-[#0EA4AB]/10 border border-[#0EA4AB]/30 rounded-xl p-4">
                    <p className="text-ink-accent font-semibold">Live now at {EXCHANGE_URL_LABEL}</p>
                  </div>

                  <h3 className="text-xl font-semibold text-ink-accent">Key Features</h3>
                  
                  <div className="grid md:grid-cols-3 gap-4">
                    {[
                      { title: 'Spot Trading', desc: 'Advanced spot trading with real-time charts, multiple order types, and deep liquidity' },
                      { title: 'Security', desc: 'Multi-layer security with cold storage, 2FA, and comprehensive insurance coverage' },
                      { title: 'Fast Execution', desc: 'High-performance matching engine with sub-millisecond order execution' },
                      { title: 'Secure Wallets', desc: 'Enterprise wallet infrastructure with multi-signature protection' },
                      { title: 'Mobile Apps', desc: 'Native iOS and Android apps for trading on the go' },
                      { title: 'Fiat Support', desc: 'Multiple fiat on/off ramps for easy deposits and withdrawals' },
                    ].map((feature, i) => (
                      <div key={i} className="bg-surface/50 rounded-xl p-4 border border-line">
                        <h4 className="text-ink font-semibold mb-2">{feature.title}</h4>
                        <p className="text-ink-muted text-sm">{feature.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* Roadmap */}
            <Section id="roadmap">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Map size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">8. Roadmap</h2>
                </div>
                
                <div className="space-y-4">
                  {roadmapPhases.map((phase, i) => (
                    <div 
                      key={i} 
                      className={`bg-surface/50 rounded-xl p-5 border transition-colors ${
                        phase.status === 'active' ? 'border-[#C5E35B]/50' : 'border-line'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            phase.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                            phase.status === 'active' ? 'bg-[#C5E35B]/20 text-ink-accent' :
                            'bg-[#4A4B50]/20 text-ink-muted'
                          }`}>
                            {phase.phase}
                          </span>
                          <h4 className="text-ink font-semibold">{phase.title}</h4>
                        </div>
                        <span className="text-ink-muted text-sm">{phase.period}</span>
                      </div>
                      <ul className="grid md:grid-cols-2 gap-2">
                        {phase.items.map((item, j) => (
                          <li key={j} className="flex items-center gap-2 text-ink-muted text-sm">
                            <ChevronRight size={14} className="text-[#0EA4AB]" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {/* Security & Compliance */}
            <Section id="security">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Shield size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">9. Security & Compliance</h2>
                </div>
                
                <div className="space-y-6">
                  <p className="text-ink-soft leading-relaxed">
                    Security is the foundation of everything we build. Delta implements multiple layers of protection 
                    to ensure the safety of user assets and data.
                  </p>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    {[
                      { title: 'Smart Contract Audits', desc: 'Audit reports should be published publicly once they are completed and officially available.' },
                      { title: 'Asset Security Model', desc: 'Cold storage, wallet controls, and custody architecture are implemented across the live exchange platform.' },
                      { title: 'Compliance Readiness', desc: 'KYC/AML processes apply on the live exchange where required by jurisdiction and product scope.' },
                      { title: 'Insurance', desc: 'Insurance coverage should not be assumed unless provider and policy details are formally published.' },
                      { title: 'Security Testing', desc: 'Penetration testing and infrastructure review results should be shared once completed.' },
                      { title: 'Monitoring', desc: 'Operational monitoring and incident response run on the live exchange platform.' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-3 bg-surface/50 rounded-xl p-4 border border-line">
                        <Lock size={18} className="text-ink-accent mt-0.5 flex-shrink-0" />
                        <div>
                          <h4 className="text-ink font-semibold mb-1">{item.title}</h4>
                          <p className="text-ink-muted text-sm">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* Governance */}
            <Section id="governance">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <Users size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">10. Governance</h2>
                </div>
                
                <div className="space-y-4">
                  <p className="text-ink-soft leading-relaxed">
                    Delta is committed to progressive decentralization. As the ecosystem matures, governance will 
                    transition to a DAO (Decentralized Autonomous Organization) structure, giving $DELTA holders 
                    direct influence over key decisions.
                  </p>
                  
                  <div className="bg-surface/50 rounded-xl p-5 border border-line">
                    <h4 className="text-ink font-semibold mb-3">Governance Scope</h4>
                    <ul className="space-y-2">
                      {[
                        'Protocol upgrades and feature prioritization',
                        'Fee structure adjustments',
                        'Treasury allocation for ecosystem development',
                        'Partnership approvals and strategic decisions',
                        'Staking reward parameters'
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-2 text-ink-muted">
                          <CheckCircle size={16} className="text-ink-accent" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </Section>

            {/* Conclusion */}
            <Section id="conclusion">
              <div className="bg-gradient-to-br from-surface-card to-surface-soft border border-[#0EA4AB]/30 rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-logo-gradient flex items-center justify-center">
                    <CheckCircle size={20} className="icon-on-gradient text-white" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">11. Conclusion</h2>
                </div>
                
                <div className="space-y-4">
                  <p className="text-ink-soft leading-relaxed">
                    Delta represents more than just a token â€” it's the foundation of a comprehensive crypto ecosystem 
                    designed to empower users and drive innovation in the digital asset space. With a clear vision, 
                    strong tokenomics, robust security measures, and an ambitious roadmap, we are positioned to become 
                    a significant player in the cryptocurrency industry.
                  </p>
                  
                  <p className="text-ink-soft leading-relaxed">
                    We invite you to join us on this exciting journey. Whether you're a trader, investor, or crypto 
                    enthusiast, the Delta ecosystem offers opportunities for growth, participation, and rewards. 
                    Together, we will build the future of cryptocurrency trading.
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-4 mt-8">
                    <button
                      type="button"
                      onClick={showBuyNotice}
                      className="inline-flex items-center justify-center gap-2 bg-logo-gradient text-[#050a1a] font-bold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity"
                    >
                      Buy $DELTA Now
                      <ChevronRight size={18} />
                    </button>
                    <Link
                      to="/"
                      className="inline-flex items-center justify-center gap-2 border-2 border-[#4A4B50] text-ink-soft font-semibold px-6 py-3 rounded-xl hover:border-[#C5E35B] hover:text-ink-accent transition-colors"
                    >
                      Explore Website
                    </Link>
                  </div>
                </div>
              </div>
            </Section>

            {/* Legal Disclaimer */}
            <Section id="disclaimer">
              <div className="bg-surface border border-line rounded-2xl p-5 sm:p-8 md:p-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-[#4A4B50]/20 flex items-center justify-center">
                    <Scale size={20} className="text-ink-muted" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-ink">12. Legal Disclaimer</h2>
                </div>
                
                <div className="prose prose-invert max-w-none">
                  <p className="text-ink-muted text-sm leading-relaxed">
                    This whitepaper is for informational purposes only and does not constitute financial, legal, 
                    or investment advice. The information contained herein is subject to change without notice. 
                    Cryptocurrency investments carry significant risk, and the value of $DELTA tokens may fluctuate 
                    significantly. Past performance is not indicative of future results.
                  </p>
                  
                  <p className="text-ink-muted text-sm leading-relaxed mt-4">
                    Nothing in this whitepaper shall be deemed to constitute a prospectus or offer document of any 
                    sort. $DELTA tokens are not intended to constitute securities in any jurisdiction. This whitepaper 
                    does not constitute or form part of any opinion or any advice to sell, or any solicitation of 
                    any offer to purchase $DELTA tokens.
                  </p>
                  
                  <p className="text-ink-muted text-sm leading-relaxed mt-4">
                    Always conduct your own research (DYOR) and consult with professional advisors before making 
                    any investment decisions. By participating in the Delta ecosystem, you acknowledge that you 
                    understand and accept the risks involved.
                  </p>
                </div>
              </div>
            </Section>

          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-line py-8" style={{ backgroundColor: 'var(--bg-default)' }}>
          <div className="max-w-7xl mx-auto px-6 md:px-10 xl:px-16">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-ink-muted text-sm">
            <p>&copy; {new Date().getFullYear()} Delta. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <Link to="/" className="hover:text-ink-accent transition-colors">Home</Link>
              <Link to="/about" className="hover:text-ink-accent transition-colors">About</Link>
            </div>
          </div>
        </div>
      </footer>
      </div> {/* End Page Content */}
    </div>
  );
};

export default WhitepaperPage;

import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ExchangeDevNoticeProvider from "./components/ExchangeDevNotice";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Stats from "./components/Stats";
import ProjectTransparency from "./components/ProjectTransparency";
import Utility from "./components/Utility";
import Exchange from "./components/Exchange";
import InstantKyc from "./components/InstantKyc";
import Roadmap from "./components/Roadmap";
import Tokenomics from "./components/Tokenomics";
import Whitepaper from "./components/Whitepaper";
import HowToBuy from "./components/HowToBuy";
import FAQ from "./components/FAQ";
import Footer from "./components/Footer";

const WhitepaperPage = lazy(() => import("./pages/WhitepaperPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const MarketsPage = lazy(() => import("./pages/MarketsPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const TradePage = lazy(() => import("./pages/TradePage"));
const ResetPasswordRedirect = lazy(() => import("./pages/ResetPasswordRedirect"));

const PageLoader = () => (
  <div className="min-h-screen bg-surface flex items-center justify-center">
    <p className="text-ink-accent text-sm font-medium">Loading…</p>
  </div>
);

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-surface noise-overlay" data-testid="landing-page">
      <Navbar />
      <Hero />
      <Stats />
      <ProjectTransparency />
      <Utility />
      <Exchange />
      <InstantKyc />
      <Roadmap />
      <Tokenomics />
      <Whitepaper />
      <HowToBuy />
      <FAQ />
      <Footer />
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <ExchangeDevNoticeProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/whitepaper" element={<WhitepaperPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
              <Route path="/terms-of-service" element={<TermsPage />} />
              <Route path="/trade" element={<TradePage />} />
              <Route path="/trade/:symbol" element={<TradePage />} />
              <Route path="/reset-password" element={<ResetPasswordRedirect />} />
            </Routes>
          </Suspense>
        </ExchangeDevNoticeProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;

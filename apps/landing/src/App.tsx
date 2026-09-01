import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { VisibilitySection } from './components/VisibilitySection';
import { OverviewSection } from './components/OverviewSection';
import { ModulesSection } from './components/ModulesSection';
import { LiveProductionSection } from './components/LiveProductionSection';
import { MonitoringSection } from './components/MonitoringSection';
import { OeePerformanceSection } from './components/OeePerformanceSection';
import { QualityTraceabilitySection } from './components/QualityTraceabilitySection';
import { JourneySection } from './components/JourneySection';
import { UsersInterfacesSection } from './components/UsersInterfacesSection';
import { DataDecisionSection } from './components/DataDecisionSection';
import { ShowcaseSection } from './components/ShowcaseSection';
import { DeploymentSection } from './components/DeploymentSection';
import { BusinessImpactSection } from './components/BusinessImpactSection';
import { CtaSection } from './components/CtaSection';
import { Footer } from './components/Footer';
import { BookDemoModal } from './components/BookDemoModal';

export const App: React.FC = () => {
  const [demoModalOpen, setDemoModalOpen] = useState(false);

  const handleOpenDemo = () => setDemoModalOpen(true);
  const handleCloseDemo = () => setDemoModalOpen(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navigation Header */}
      <Navbar onOpenDemo={handleOpenDemo} />

      <main style={{ flex: 1 }}>
        {/* 01 HERO */}
        <HeroSection onOpenDemo={handleOpenDemo} />

        {/* 02 MANUFACTURING VISIBILITY */}
        <VisibilitySection />

        {/* 03 FACTORY VISION OVERVIEW */}
        <OverviewSection />

        {/* 04 PRODUCT MODULES */}
        <ModulesSection />

        {/* 05 LIVE PRODUCTION */}
        <LiveProductionSection />

        {/* 06 REAL-TIME FACTORY MONITORING */}
        <MonitoringSection />

        {/* 07 OEE & PERFORMANCE */}
        <OeePerformanceSection />

        {/* 08 QUALITY & TRACEABILITY */}
        <QualityTraceabilitySection />

        {/* 09 ORDER → PRODUCTION JOURNEY */}
        <JourneySection />

        {/* 10 USERS & INTERFACES */}
        <UsersInterfacesSection />

        {/* 11 DATA → DECISION */}
        <DataDecisionSection />

        {/* 12 PRODUCT SHOWCASE */}
        <ShowcaseSection />

        {/* 13 DEPLOYMENT */}
        <DeploymentSection />

        {/* 14 BUSINESS IMPACT */}
        <BusinessImpactSection />

        {/* 15 FINAL CTA */}
        <CtaSection onOpenDemo={handleOpenDemo} />
      </main>

      {/* 16 FOOTER */}
      <Footer />

      {/* Interactive Book a Demo Modal */}
      <BookDemoModal isOpen={demoModalOpen} onClose={handleCloseDemo} />
    </div>
  );
};

export default App;

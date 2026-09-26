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
import { TrialSignupModal } from './components/TrialSignupModal';
import { WhatsAppButton } from './components/WhatsAppButton';

export const App: React.FC = () => {
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [trialModalOpen, setTrialModalOpen] = useState(false);

  const handleOpenDemo = () => setDemoModalOpen(true);
  const handleCloseDemo = () => setDemoModalOpen(false);

  const handleOpenTrial = () => setTrialModalOpen(true);
  const handleCloseTrial = () => setTrialModalOpen(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar onOpenDemo={handleOpenDemo} onOpenTrial={handleOpenTrial} />

      <main style={{ flex: 1 }}>
        <HeroSection onOpenDemo={handleOpenDemo} onOpenTrial={handleOpenTrial} />

        <VisibilitySection />

        <OverviewSection />

        <ModulesSection />

        <LiveProductionSection />

        <MonitoringSection />

        <OeePerformanceSection />

        <QualityTraceabilitySection />

        <JourneySection />

        <UsersInterfacesSection />

        <DataDecisionSection />

        <ShowcaseSection />

        <DeploymentSection />

        <BusinessImpactSection />

        <CtaSection onOpenDemo={handleOpenDemo} onOpenTrial={handleOpenTrial} />
      </main>

      <Footer />

      <BookDemoModal isOpen={demoModalOpen} onClose={handleCloseDemo} />

      <TrialSignupModal isOpen={trialModalOpen} onClose={handleCloseTrial} />
      <WhatsAppButton />
    </div>
  );
};

export default App;

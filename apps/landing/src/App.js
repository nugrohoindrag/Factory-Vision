import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
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
export const App = () => {
    const [demoModalOpen, setDemoModalOpen] = useState(false);
    const handleOpenDemo = () => setDemoModalOpen(true);
    const handleCloseDemo = () => setDemoModalOpen(false);
    return (_jsxs("div", { style: { minHeight: '100vh', display: 'flex', flexDirection: 'column' }, children: [_jsx(Navbar, { onOpenDemo: handleOpenDemo }), _jsxs("main", { style: { flex: 1 }, children: [_jsx(HeroSection, { onOpenDemo: handleOpenDemo }), _jsx(VisibilitySection, {}), _jsx(OverviewSection, {}), _jsx(ModulesSection, {}), _jsx(LiveProductionSection, {}), _jsx(MonitoringSection, {}), _jsx(OeePerformanceSection, {}), _jsx(QualityTraceabilitySection, {}), _jsx(JourneySection, {}), _jsx(UsersInterfacesSection, {}), _jsx(DataDecisionSection, {}), _jsx(ShowcaseSection, {}), _jsx(DeploymentSection, {}), _jsx(BusinessImpactSection, {}), _jsx(CtaSection, { onOpenDemo: handleOpenDemo })] }), _jsx(Footer, {}), _jsx(BookDemoModal, { isOpen: demoModalOpen, onClose: handleCloseDemo })] }));
};
export default App;
//# sourceMappingURL=App.js.map
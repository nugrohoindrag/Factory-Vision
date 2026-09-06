import React from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { useOnboarding } from './OnboardingContext.js';
import { TrialCommandCenter } from './TrialCommandCenter.js';
import { OnboardingWizardModal } from './OnboardingWizardModal.js';
import { WelcomeTourModal } from './WelcomeTourModal.js';
import { OnboardingChecklistDrawer } from './OnboardingChecklistDrawer.js';
import { FirstWorkflowGuideModal } from './FirstWorkflowGuideModal.js';
import { UpgradePlanModal } from './UpgradePlanModal.js';

/**
 * Topbar Trigger Button for Onboarding Guide
 */
export const OnboardingHeaderTrigger: React.FC = () => {
  const { openChecklist, progress } = useOnboarding();

  if (!progress || progress.trialStatus === 'converted') {
    return null;
  }

  return (
    <Button
      variant="outlined"
      size="sm"
      icon={<Icon name="school" size={16} />}
      onClick={openChecklist}
      style={{
        height: '32px',
        fontSize: '11.5px',
        fontWeight: 700,
        gap: 'var(--space-1)',
      }}
      title="Buka panduan onboarding & checklist"
    >
      Panduan Onboarding
    </Button>
  );
};

/**
 * All Onboarding overlays, drawers, modals, and trial banner
 */
export const OnboardingLayers: React.FC = () => {
  const {
    isWizardOpen,
    closeWizard,
    isTourOpen,
    closeTour,
    isChecklistOpen,
    closeChecklist,
    isFirstWorkflowOpen,
    closeFirstWorkflow,
    isUpgradeOpen,
    closeUpgrade,
  } = useOnboarding();

  return (
    <>
      <TrialCommandCenter />
      <OnboardingWizardModal isOpen={isWizardOpen} onClose={closeWizard} />
      <WelcomeTourModal isOpen={isTourOpen} onClose={closeTour} />
      <OnboardingChecklistDrawer isOpen={isChecklistOpen} onClose={closeChecklist} />
      <FirstWorkflowGuideModal isOpen={isFirstWorkflowOpen} onClose={closeFirstWorkflow} />
      <UpgradePlanModal isOpen={isUpgradeOpen} onClose={closeUpgrade} />
    </>
  );
};

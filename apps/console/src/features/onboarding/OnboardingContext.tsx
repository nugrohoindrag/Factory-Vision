import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import type {
  FactoryProfileInput,
  FirstWorkflowResult,
  GuidanceState,
  IndustryTemplateInfo,
  IndustryType,
  OnboardingProgress,
  OnboardingStepId,
} from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

interface OnboardingContextValue {
  progress: OnboardingProgress | null;
  guidance: GuidanceState | null;
  templates: IndustryTemplateInfo[];
  loading: boolean;
  error: string | null;
  isWizardOpen: boolean;
  isTourOpen: boolean;
  isChecklistOpen: boolean;
  isFirstWorkflowOpen: boolean;
  isUpgradeOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;
  openTour: () => void;
  closeTour: () => void;
  openChecklist: () => void;
  closeChecklist: () => void;
  openFirstWorkflow: () => void;
  closeFirstWorkflow: () => void;
  openUpgrade: () => void;
  closeUpgrade: () => void;
  dismissTooltip: (id: string) => Promise<void>;
  isTooltipDismissed: (id: string) => boolean;
  refreshStatus: () => Promise<void>;
  applyTemplate: (industry: IndustryType, profile?: Partial<FactoryProfileInput>) => Promise<boolean>;
  createBlank: (profile: FactoryProfileInput) => Promise<boolean>;
  completeStep: (stepId: OnboardingStepId) => Promise<void>;
  executeFirstWorkflow: (payload?: { productId?: string; quantity?: number; goodQty?: number; rejectQty?: number }) => Promise<FirstWorkflowResult>;
  requestUpgrade: (planCode: string) => Promise<{ success: boolean; message: string }>;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [guidance, setGuidance] = useState<GuidanceState | null>(null);
  const [templates, setTemplates] = useState<IndustryTemplateInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals & Drawers
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [isTourOpen, setIsTourOpen] = useState<boolean>(false);
  const [isChecklistOpen, setIsChecklistOpen] = useState<boolean>(false);
  const [isFirstWorkflowOpen, setIsFirstWorkflowOpen] = useState<boolean>(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState<boolean>(false);

  const refreshStatus = useCallback(async () => {
    try {
      const [statusRes, guidanceRes] = await Promise.all([
        api.getOnboardingStatus().catch(() => null),
        api.getGuidanceState().catch(() => null),
      ]);
      if (statusRes) setProgress(statusRes);
      if (guidanceRes) setGuidance(guidanceRes);
    } catch (err) {
      // Non-blocking for unauthenticated or disconnected states
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      try {
        const [tmpls, statusRes, guidanceRes] = await Promise.all([
          api.getOnboardingTemplates().catch(() => []),
          api.getOnboardingStatus().catch(() => null),
          api.getGuidanceState().catch(() => null),
        ]);
        if (!mounted) return;
        setTemplates(tmpls);
        if (statusRes) {
          setProgress(statusRes);
          // Check url param or if user hasn't setup factory yet
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('onboarding') === 'true' || urlParams.get('trial') === '1' || statusRes.readinessPercent === 0) {
            setIsWizardOpen(true);
          }
        }
        if (guidanceRes) setGuidance(guidanceRes);
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Gagal memuat data onboarding');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  const openWizard = () => setIsWizardOpen(true);
  const closeWizard = () => setIsWizardOpen(false);

  const openTour = () => setIsTourOpen(true);
  const closeTour = () => {
    setIsTourOpen(false);
    void api.updateGuidanceState({ tourCompleted: true }).then((g) => setGuidance(g));
  };

  const openChecklist = () => setIsChecklistOpen(true);
  const closeChecklist = () => setIsChecklistOpen(false);

  const openFirstWorkflow = () => setIsFirstWorkflowOpen(true);
  const closeFirstWorkflow = () => setIsFirstWorkflowOpen(false);

  const openUpgrade = () => setIsUpgradeOpen(true);
  const closeUpgrade = () => setIsUpgradeOpen(false);

  const dismissTooltip = async (id: string) => {
    const updated = await api.updateGuidanceState({ dismissedTooltips: [id] });
    setGuidance(updated);
  };

  const isTooltipDismissed = (id: string): boolean => {
    return guidance?.dismissedTooltips.includes(id) ?? false;
  };

  const applyTemplate = async (industry: IndustryType, profile?: Partial<FactoryProfileInput>): Promise<boolean> => {
    try {
      const res = await api.applyIndustryTemplate({
        industry,
        factoryName: profile?.factoryName,
        city: profile?.city,
        timezone: profile?.timezone,
      });
      if (res.progress) {
        setProgress(res.progress);
      }
      await refreshStatus();
      return true;
    } catch {
      return false;
    }
  };

  const createBlank = async (profile: FactoryProfileInput): Promise<boolean> => {
    try {
      const res = await api.createBlankFactory(profile);
      if (res.progress) {
        setProgress(res.progress);
      }
      await refreshStatus();
      return true;
    } catch {
      return false;
    }
  };

  const completeStep = async (stepId: OnboardingStepId) => {
    const updated = await api.updateOnboardingStep(stepId, 'completed');
    setProgress(updated);
  };

  const executeFirstWorkflow = async (payload?: {
    productId?: string;
    quantity?: number;
    goodQty?: number;
    rejectQty?: number;
  }): Promise<FirstWorkflowResult> => {
    const result = await api.executeFirstWorkflow(payload);
    await refreshStatus();
    return result;
  };

  const requestUpgrade = async (planCode: string) => {
    const res = await api.requestUpgrade(planCode);
    await refreshStatus();
    return res;
  };

  return (
    <OnboardingContext.Provider
      value={{
        progress,
        guidance,
        templates,
        loading,
        error,
        isWizardOpen,
        isTourOpen,
        isChecklistOpen,
        isFirstWorkflowOpen,
        isUpgradeOpen,
        openWizard,
        closeWizard,
        openTour,
        closeTour,
        openChecklist,
        closeChecklist,
        openFirstWorkflow,
        closeFirstWorkflow,
        openUpgrade,
        closeUpgrade,
        dismissTooltip,
        isTooltipDismissed,
        refreshStatus,
        applyTemplate,
        createBlank,
        completeStep,
        executeFirstWorkflow,
        requestUpgrade,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};

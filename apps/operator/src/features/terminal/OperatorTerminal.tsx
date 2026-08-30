import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { WorkOrderStatus, Operator, statusLabel } from '@factory-vision/domain-types';
import { Icon, Button, M3_EASE, M3_TRANSITIONS } from '@factory-vision/ui';
import { enqueueCommand, syncQueue } from '../../offline/queue.js';
import { SyncStatusBar } from './SyncStatusBar.js';
import {
  Page,
  Section,
  FullCircleIcon,
  toneContainer,
  toneOnContainer,
  type Tone,
} from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

interface OperatorTerminalProps {
  operator: Operator;
  onLogout: () => void;
}

export const OperatorTerminal: React.FC<OperatorTerminalProps> = ({ operator, onLogout }) => {
  const queryClient = useQueryClient();

  const [selectedWoId, setSelectedWoId] = useState<string>('wo-101');
  const [showDowntimeModal, setShowDowntimeModal] = useState<boolean>(false);
  const [showRejectModal, setShowRejectModal] = useState<boolean>(false);
  const [showCustomQtyModal, setShowCustomQtyModal] = useState<boolean>(false);
  const [customQty, setCustomQty] = useState<string>('');
  const [customQtyType, setCustomQtyType] = useState<'GOOD' | 'REJECT'>('GOOD');

  const [selectedDowntimeReasonId, setSelectedDowntimeReasonId] = useState<string>('dt-breakdown');
  const [selectedRejectReasonId, setSelectedRejectReasonId] = useState<string>('rej-dimension');

  // Active Downtime State
  const [activeDowntimeId, setActiveDowntimeId] = useState<string | null>(null);
  const [downtimeSeconds, setDowntimeSeconds] = useState<number>(0);

  // Floating tap feedback animation
  const [lastTapBadge, setLastTapBadge] = useState<{ id: number; text: string; tone: Tone } | null>(null);

  // Connection state and the queue drain belong to the sync engine (started
  // once in App). The terminal only needs to refresh its own data once a batch
  // has landed, so the work order totals on screen match the server.
  useEffect(() => {
    const refreshAfterSync = () => {
      void syncQueue().then(() => queryClient.invalidateQueries());
    };
    window.addEventListener('online', refreshAfterSync);
    return () => window.removeEventListener('online', refreshAfterSync);
  }, [queryClient]);

  // Downtime Timer
  useEffect(() => {
    let timer: any;
    if (activeDowntimeId) {
      timer = setInterval(() => {
        setDowntimeSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setDowntimeSeconds(0);
    }
    return () => clearInterval(timer);
  }, [activeDowntimeId]);

  // Fetch Work Orders
  const { data: workOrders } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => api.workOrders.list(),
    refetchInterval: 4000,
  });

  // Fetch Processes & Batches ( &)
  const { data: processes } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.master.getProcesses(),
  });

  const { data: batches } = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.master.getBatches(),
  });

  // Fetch Reasons
  const { data: downtimeReasons } = useQuery({
    queryKey: ['downtime-reasons'],
    queryFn: () => api.master.getDowntimeReasons(),
  });

  const { data: rejectReasons } = useQuery({
    queryKey: ['reject-reasons'],
    queryFn: () => api.master.getRejectReasons(),
  });

  const activeWo = workOrders?.find((w) => w.id === selectedWoId) || workOrders?.[0];

  const triggerTapFeedback = (text: string, tone: Tone) => {
    setLastTapBadge({ id: Date.now(), text, tone });
    setTimeout(() => {
      setLastTapBadge(null);
    }, 1200);
  };

  // Action Handlers
  const handleStartWo = async () => {
    if (!activeWo) return;
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'START_WO',
      payload: {
        operatorId: operator.id,
      },
    });
    triggerTapFeedback('PRODUCTION STARTED', 'primary');
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const handlePauseWo = async () => {
    if (!activeWo) return;
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'PAUSE_WO',
      payload: { operatorId: operator.id },
    });
    triggerTapFeedback('PRODUKSI DIJEDA', 'warning');
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const handleResumeWo = async () => {
    if (!activeWo) return;
    // US-017, resuming closes the open downtime so run time is measured
    // correctly; the queue keeps the two events in order.
    if (activeDowntimeId) {
      await enqueueCommand({
        tenantId: activeWo.tenantId,
        workOrderId: activeWo.id,
        type: 'RESOLVE_DOWNTIME',
        payload: { downtimeId: activeDowntimeId },
      });
      setActiveDowntimeId(null);
    }
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'RESUME_WO',
      payload: { operatorId: operator.id },
    });
    triggerTapFeedback('PRODUKSI DILANJUTKAN', 'primary');
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const handleCompleteWo = async () => {
    if (!activeWo) return;
    // US-020, an open downtime must be handled before the work order closes,
    // or the stoppage would run forever against a finished order.
    if (activeDowntimeId) {
      window.alert('Selesaikan downtime yang masih aktif sebelum menutup work order.');
      return;
    }
    if (window.confirm(`Selesaikan Work Order ${activeWo.woNumber}?`)) {
      await enqueueCommand({
        tenantId: activeWo.tenantId,
        workOrderId: activeWo.id,
        type: 'COMPLETE_WO',
        payload: { operatorId: operator.id },
      });
      triggerTapFeedback('WO SELESAI', 'primary');
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    }
  };

  const handleQuickGoodOutput = async (qty: number) => {
    if (!activeWo) return;
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'RECORD_OUTPUT',
      payload: {
        workOrderId: activeWo.id,
        machineId: activeWo.machineId,
        operatorId: operator.id,
        shiftId: 'shift-1',
        goodQuantity: qty,
        rejectQuantity: 0,
      },
    });
    triggerTapFeedback(`+${qty} GOOD`, 'primary');
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const handleRecordReject = async (reasonId: string) => {
    if (!activeWo) return;
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'RECORD_OUTPUT',
      payload: {
        workOrderId: activeWo.id,
        machineId: activeWo.machineId,
        operatorId: operator.id,
        shiftId: 'shift-1',
        goodQuantity: 0,
        rejectQuantity: 1,
        rejectReasonId: reasonId,
      },
    });
    setShowRejectModal(false);
    triggerTapFeedback('+1 REJECT', 'error');
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  /**
   * US-016, record downtime.
   *
   * Always queued, never sent directly. Online and offline then take the exact
   * same path, so the one that is exercised daily is also the one that is
   * exercised when the Wi-Fi drops, rather than a rarely-run offline branch
   * that nobody notices is broken.
   */
  const handleStartDowntime = async () => {
    if (!activeWo) return;
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'RECORD_DOWNTIME',
      payload: {
        machineId: activeWo.machineId,
        lineId: activeWo.lineId,
        operatorId: operator.id,
        reasonId: selectedDowntimeReasonId,
        notes: 'Dicatat dari terminal operator',
      },
    });
    // Tracked locally by work order: the server assigns the real downtime id,
    // and `RESOLVE_DOWNTIME` finds the open record for this work order.
    setActiveDowntimeId(activeWo.id);
    setDowntimeSeconds(0);
    setShowDowntimeModal(false);
    triggerTapFeedback('DOWNTIME AKTIF', 'error');
  };

  const handleResolveDowntime = async () => {
    if (!activeDowntimeId || !activeWo) return;
    await enqueueCommand({
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      type: 'RESOLVE_DOWNTIME',
      payload: {},
    });
    setActiveDowntimeId(null);
    setDowntimeSeconds(0);
    triggerTapFeedback('DOWNTIME SELESAI', 'primary');
  };

  const handleCustomQtySubmit = async () => {
    const qty = parseInt(customQty, 10);
    if (isNaN(qty) || qty <= 0 || !activeWo) return;

    if (customQtyType === 'GOOD') {
      await handleQuickGoodOutput(qty);
    } else {
      await enqueueCommand({
        tenantId: activeWo.tenantId,
        workOrderId: activeWo.id,
        type: 'RECORD_OUTPUT',
        payload: {
          workOrderId: activeWo.id,
          machineId: activeWo.machineId,
          operatorId: operator.id,
          shiftId: 'shift-1',
          goodQuantity: 0,
          rejectQuantity: qty,
          rejectReasonId: selectedRejectReasonId,
        },
      });
      triggerTapFeedback(`+${qty} REJECT`, 'error');
    }

    setShowCustomQtyModal(false);
    setCustomQty('');
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const formatDowntimeTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <Page
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-on-background)',
        fontFamily: 'var(--font-family)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Real-time Tap Feedback Toast Banner */}
      <AnimatePresence>
        {lastTapBadge && (
          <motion.div
            key={lastTapBadge.id}
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.8 }}
            transition={{ duration: 0.2, ease: M3_EASE.emphasizedDecelerate }}
            style={{
              position: 'fixed',
              top: '64px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9999,
              backgroundColor: toneContainer[lastTapBadge.tone],
              color: toneOnContainer[lastTapBadge.tone],
              padding: '6px 20px',
              borderRadius: 'var(--radius-pill)',
              fontWeight: 800,
              fontSize: '13px',
              boxShadow: 'var(--elevation-3)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'none',
            }}
          >
            <Icon name="check_circle" size={16} />
            <span>{lastTapBadge.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Touch Bar Header */}
      <Section
        style={{
          height: '52px',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-outline-variant)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FullCircleIcon size={32} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--color-on-surface)' }}>
              OPERATOR TERMINAL
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              {operator.name} ({operator.employeeNumber})
            </div>
          </div>
        </div>

        {/* Sync & Logout Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <SyncStatusBar />

          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={onLogout}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm, 6px)',
              backgroundColor: 'var(--color-surface-container-high)',
              border: '1px solid var(--color-outline-variant)',
              color: 'var(--color-on-surface-variant)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Logout
          </motion.button>
        </div>
      </Section>

      {/* Active Downtime Emergency Alert Banner */}
      <AnimatePresence>
        {activeDowntimeId && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={M3_TRANSITIONS.enter}
            style={{
              backgroundColor: 'var(--color-error)',
              color: 'var(--color-on-error)',
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 800,
              fontSize: '14px',
              boxShadow: 'var(--elevation-2)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Icon name="warning" size={20} />
              </motion.div>
              <span>MACHINE DOWNTIME ACTIVE:</span>
              <span
                style={{
                  fontSize: '18px',
                  fontFamily: 'monospace',
                  backgroundColor: 'var(--color-scrim)',
                  color: 'var(--color-on-error)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-xs, 4px)',
                  fontWeight: 900,
                }}
              >
                {formatDowntimeTime(downtimeSeconds)}
              </span>
            </div>

            <motion.button
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.96 }}
              onClick={handleResolveDowntime}
              style={{
                minHeight: '38px',
                padding: '0 18px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--color-on-error)',
                color: 'var(--color-error)',
                fontWeight: 900,
                fontSize: '12px',
                border: 'none',
                cursor: 'pointer',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              RESOLVE DOWNTIME & RESUME
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Touch Grid */}
      <Section
        stagger
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '270px 1fr',
          padding: '14px',
          gap: '14px',
          overflow: 'hidden',
        }}
      >
        {/* Left Column: Work Order Selector */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg, 16px)',
            border: '1px solid var(--color-outline-variant)',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            overflowY: 'auto',
            boxShadow: 'var(--elevation-1)',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 800,
              color: 'var(--color-on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Work Order Queue
          </div>

          {workOrders?.map((wo) => {
            const isSelected = wo.id === activeWo?.id;
            return (
              <motion.button
                key={wo.id}
                whileHover={{ scale: 1.02, x: 2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedWoId(wo.id)}
                style={{
                  minHeight: '60px',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md, 10px)',
                  border: isSelected ? 'none' : '1px solid var(--color-outline-variant)',
                  backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--color-surface-container-low)',
                  color: isSelected ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '13px' }}>{wo.woNumber}</span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: isSelected
                        ? 'var(--color-on-primary)'
                        : wo.status === WorkOrderStatus.IN_PROGRESS
                          ? 'var(--color-primary-container)'
                          : 'var(--color-surface-container)',
                      color: isSelected
                        ? 'var(--color-primary)'
                        : wo.status === WorkOrderStatus.IN_PROGRESS
                          ? 'var(--color-primary)'
                          : 'var(--color-on-surface-variant)',
                    }}
                  >
                    {statusLabel(wo.status)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: isSelected ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                    opacity: isSelected ? 0.85 : 1,
                  }}
                >
                  {wo.lineId} • Target: {wo.targetQuantity.toLocaleString('en-US')} {wo.unit}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Right Column: Execution Workspace */}
        {activeWo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
            {/* Header Telemetry Card with Multi-Process and Lot Badge */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={M3_TRANSITIONS.enter}
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-lg, 16px)',
                border: '1px solid var(--color-outline-variant)',
                padding: '14px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              {/* Process & Batch Info Row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--color-on-surface)' }}>
                    {activeWo.woNumber}
                  </span>
                  {(() => {
                    const proc = processes?.find((p) => p.id === activeWo.processId);
                    return (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '11px',
                          fontWeight: 800,
                          backgroundColor: 'var(--color-primary-container)',
                          color: 'var(--color-on-primary-container)',
                        }}
                      >
                        {activeWo.sequence ? `Seq ${activeWo.sequence}: ` : ''}
                        {proc ? proc.name : activeWo.processId || 'Tahap Umum'}
                      </span>
                    );
                  })()}
                  {(() => {
                    const batch = batches?.find((b) => b.id === activeWo.batchId);
                    return (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '11px',
                          fontWeight: 800,
                          backgroundColor: 'var(--color-surface-container)',
                          color: 'var(--color-on-surface-variant)',
                          border: '1px solid var(--color-outline-variant)',
                        }}
                      >
                        Lot: {batch ? batch.batchNumber : activeWo.batchId || 'B260829-01'}
                      </span>
                    );
                  })()}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>
                  Production Line: <strong>{activeWo.lineId}</strong> • Mesin:{' '}
                  <strong>{activeWo.machineId || 'Semua'}</strong>
                </div>
              </div>

              {/* Telemetry Metrics */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '12px',
                  borderTop: '1px solid var(--color-outline-variant)',
                  paddingTop: '8px',
                }}
              >
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                    TARGET
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      color: 'var(--color-on-surface)',
                      fontFeatureSettings: '"tnum" 1',
                    }}
                  >
                    {activeWo.targetQuantity.toLocaleString('en-US')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                    JUMLAH GOOD
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      color: 'var(--color-primary)',
                      fontFeatureSettings: '"tnum" 1',
                    }}
                  >
                    {activeWo.goodQuantity.toLocaleString('en-US')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                    JUMLAH REJECT
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      color:
                        activeWo.rejectQuantity > 0 ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
                      fontFeatureSettings: '"tnum" 1',
                    }}
                  >
                    {activeWo.rejectQuantity.toLocaleString('en-US')}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                    PENCAPAIAN
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 800,
                      color: 'var(--color-primary)',
                      fontFeatureSettings: '"tnum" 1',
                    }}
                  >
                    {activeWo.targetQuantity > 0
                      ? Math.round((activeWo.goodQuantity / activeWo.targetQuantity) * 100)
                      : 0}
                    %
                  </div>
                </div>
              </div>
            </motion.div>

            {/* State Actions & Production Entry Panel */}
            <div
              style={{
                flex: 1,
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-lg, 16px)',
                border: '1px solid var(--color-outline-variant)',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              {/* Work Order State Action Bar */}
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  paddingBottom: '10px',
                  borderBottom: '1px solid var(--color-outline-variant)',
                }}
              >
                {activeWo.status === WorkOrderStatus.RELEASED && (
                  <motion.button
                    whileHover={{ scale: 1.02, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleStartWo}
                    style={{
                      flex: 1,
                      minHeight: '44px',
                      borderRadius: 'var(--radius-md, 10px)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontWeight: 800,
                      fontSize: '13px',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: 'var(--elevation-1)',
                    }}
                  >
                    ▶ START PRODUCTION
                  </motion.button>
                )}

                {activeWo.status === WorkOrderStatus.IN_PROGRESS && (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.02, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handlePauseWo}
                      style={{
                        flex: 1,
                        minHeight: '44px',
                        borderRadius: 'var(--radius-md, 10px)',
                        backgroundColor: 'var(--color-surface-container-high)',
                        color: 'var(--color-warning)',
                        fontWeight: 800,
                        fontSize: '13px',
                        border: '1px solid var(--color-outline-variant)',
                        cursor: 'pointer',
                      }}
                    >
                      ⏸ PAUSE WO
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02, y: -1 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleCompleteWo}
                      style={{
                        flex: 1,
                        minHeight: '44px',
                        borderRadius: 'var(--radius-md, 10px)',
                        backgroundColor: 'var(--color-primary)',
                        color: 'var(--color-on-primary)',
                        fontWeight: 800,
                        fontSize: '13px',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      ✓ COMPLETE WO
                    </motion.button>
                  </>
                )}

                {activeWo.status === WorkOrderStatus.PAUSED && (
                  <motion.button
                    whileHover={{ scale: 1.02, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleResumeWo}
                    style={{
                      flex: 1,
                      minHeight: '44px',
                      borderRadius: 'var(--radius-md, 10px)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontWeight: 800,
                      fontSize: '13px',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    ▶ RESUME PRODUCTION
                  </motion.button>
                )}
              </div>

              {/* 1-Touch Quick Good Entry Buttons */}
              <div style={{ margin: '8px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-on-surface-variant)' }}>
                    INPUT CEPAT JUMLAH GOOD
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      setCustomQtyType('GOOD');
                      setShowCustomQtyModal(true);
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      backgroundColor: 'var(--color-surface-container)',
                      border: '1px solid var(--color-outline-variant)',
                      color: 'var(--color-primary)',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    + Jumlah Lain
                  </motion.button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  {[1, 5, 10, 50].map((qty) => (
                    <motion.button
                      key={qty}
                      whileHover={activeWo.status === WorkOrderStatus.IN_PROGRESS ? { scale: 1.03, y: -1 } : {}}
                      whileTap={activeWo.status === WorkOrderStatus.IN_PROGRESS ? { scale: 0.95 } : {}}
                      onClick={() => handleQuickGoodOutput(qty)}
                      disabled={activeWo.status !== WorkOrderStatus.IN_PROGRESS}
                      style={{
                        minHeight: '58px',
                        borderRadius: 'var(--radius-md, 12px)',
                        backgroundColor:
                          activeWo.status === WorkOrderStatus.IN_PROGRESS
                            ? 'var(--color-primary)'
                            : 'var(--color-surface-container)',
                        color:
                          activeWo.status === WorkOrderStatus.IN_PROGRESS
                            ? 'var(--color-on-primary)'
                            : 'var(--color-on-surface-variant)',
                        fontWeight: 800,
                        fontSize: '22px',
                        border: 'none',
                        cursor: activeWo.status === WorkOrderStatus.IN_PROGRESS ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow:
                          activeWo.status === WorkOrderStatus.IN_PROGRESS ? 'var(--elevation-1)' : 'none',
                      }}
                    >
                      +{qty}
                      <span style={{ fontSize: '10px', fontWeight: 700 }}>GOOD</span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* 1-Touch Quick Reject Defect Buttons ( &) */}
              <div style={{ margin: '8px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-error)' }}>
                    INPUT CEPAT JUMLAH REJECT
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setShowRejectModal(true)}
                    disabled={activeWo.status !== WorkOrderStatus.IN_PROGRESS}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      backgroundColor: 'var(--color-error-container)',
                      border: '1px solid var(--color-error)',
                      color: 'var(--color-on-error-container)',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: activeWo.status === WorkOrderStatus.IN_PROGRESS ? 'pointer' : 'not-allowed',
                    }}
                  >
                    + Alasan Reject Lainnya
                  </motion.button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {(
                    rejectReasons?.slice(0, 4) || [
                      { id: 'rej-tire-blister', code: 'REJ-BLISTER', name: 'Blister / Gelembung' },
                      { id: 'rej-tire-ply-straight', code: 'REJ-PLY', name: 'Ply Distortion' },
                      { id: 'rej-tire-flash', code: 'REJ-FLASH', name: 'Rubber Flash' },
                      { id: 'rej-tire-dimension', code: 'REJ-DIM', name: 'Dimension Out' },
                    ]
                  ).map((rej) => (
                    <motion.button
                      key={rej.id}
                      whileHover={activeWo.status === WorkOrderStatus.IN_PROGRESS ? { scale: 1.02, y: -1 } : {}}
                      whileTap={activeWo.status === WorkOrderStatus.IN_PROGRESS ? { scale: 0.96 } : {}}
                      onClick={() => handleRecordReject(rej.id)}
                      disabled={activeWo.status !== WorkOrderStatus.IN_PROGRESS}
                      style={{
                        minHeight: '44px',
                        borderRadius: 'var(--radius-sm, 8px)',
                        backgroundColor: 'var(--color-surface-container-high)',
                        border: '1px solid var(--color-error)',
                        color: 'var(--color-error)',
                        fontWeight: 700,
                        fontSize: '11px',
                        cursor: activeWo.status === WorkOrderStatus.IN_PROGRESS ? 'pointer' : 'not-allowed',
                        opacity: activeWo.status === WorkOrderStatus.IN_PROGRESS ? 1 : 0.5,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px',
                        textAlign: 'center',
                      }}
                    >
                      <span>+1 REJECT</span>
                      <span
                        style={{
                          fontSize: '9.5px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100%',
                        }}
                      >
                        {rej.name}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Bottom Downtime Trigger */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <motion.button
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowDowntimeModal(true)}
                  style={{
                    flex: 1,
                    minHeight: '44px',
                    borderRadius: 'var(--radius-md, 10px)',
                    backgroundColor: 'var(--color-surface-container-high)',
                    border: '1px solid var(--color-warning)',
                    color: 'var(--color-warning)',
                    fontWeight: 800,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  ⏱ LAPORKAN DOWNTIME
                </motion.button>
              </div>
            </div>
          </div>
        ) : null}
      </Section>

      {/* Reject Reason Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'var(--color-scrim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 1000,
              backdropFilter: 'blur(4px)',
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={M3_TRANSITIONS.enter}
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-xl, 18px)',
                border: '1px solid var(--color-outline-variant)',
                width: '100%',
                maxWidth: '460px',
                padding: '22px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                boxShadow: 'var(--elevation-3)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--color-error)' }}>
                PILIH ALASAN REJECT
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                {rejectReasons?.map((r) => (
                  <motion.button
                    key={r.id}
                    whileHover={{ scale: 1.02, x: 3 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleRecordReject(r.id)}
                    style={{
                      minHeight: '44px',
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-md, 8px)',
                      backgroundColor: 'var(--color-surface-container-high)',
                      border: '1px solid var(--color-outline-variant)',
                      color: 'var(--color-on-surface)',
                      fontWeight: 700,
                      fontSize: '13px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {r.name} ({r.code})
                  </motion.button>
                ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowRejectModal(false)}
                style={{
                  minHeight: '42px',
                  borderRadius: 'var(--radius-md, 8px)',
                  backgroundColor: 'var(--color-surface-container)',
                  color: 'var(--color-on-surface)',
                  fontWeight: 700,
                  fontSize: '13px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Downtime Reason Modal */}
      <AnimatePresence>
        {showDowntimeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'var(--color-scrim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 1000,
              backdropFilter: 'blur(4px)',
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={M3_TRANSITIONS.enter}
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-xl, 18px)',
                border: '1px solid var(--color-outline-variant)',
                width: '100%',
                maxWidth: '480px',
                padding: '22px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                boxShadow: 'var(--elevation-3)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--color-warning)' }}>
                RECORD MACHINE DOWNTIME
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                {downtimeReasons?.map((dr) => {
                  const isSelected = selectedDowntimeReasonId === dr.id;
                  return (
                    <motion.button
                      key={dr.id}
                      whileHover={{ scale: 1.02, x: 3 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedDowntimeReasonId(dr.id)}
                      style={{
                        minHeight: '44px',
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-md, 8px)',
                        backgroundColor: isSelected
                          ? 'var(--color-primary)'
                          : 'var(--color-surface-container-high)',
                        border: isSelected ? 'none' : '1px solid var(--color-outline-variant)',
                        color: isSelected ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                        fontWeight: 700,
                        fontSize: '13px',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      {dr.name} ({dr.category})
                    </motion.button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowDowntimeModal(false)}
                  style={{
                    flex: 1,
                    minHeight: '42px',
                    borderRadius: 'var(--radius-md, 8px)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontWeight: 700,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleStartDowntime}
                  style={{
                    flex: 1,
                    minHeight: '42px',
                    borderRadius: 'var(--radius-md, 8px)',
                    backgroundColor: 'var(--color-warning)',
                    color: 'var(--color-on-warning)',
                    fontWeight: 800,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Start Downtime
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Jumlah Lain modal */}
      <AnimatePresence>
        {showCustomQtyModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'var(--color-scrim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 1000,
              backdropFilter: 'blur(4px)',
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={M3_TRANSITIONS.enter}
              style={{
                backgroundColor: 'var(--color-surface)',
                borderRadius: 'var(--radius-xl, 18px)',
                border: '1px solid var(--color-outline-variant)',
                width: '100%',
                maxWidth: '380px',
                padding: '22px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: 'var(--elevation-3)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                Masukkan {customQtyType === 'GOOD' ? 'Jumlah Good' : 'Jumlah Reject'}
              </h2>

              <input
                type="number"
                autoFocus
                value={customQty}
                onChange={(e) => setCustomQty(e.target.value)}
                placeholder="Enter units, ..."
                style={{
                  height: '46px',
                  padding: '0 14px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '2px solid var(--color-primary)',
                  backgroundColor: 'var(--color-surface-container)',
                  color: 'var(--color-on-surface)',
                  fontSize: '18px',
                  fontWeight: 800,
                  outline: 'none',
                }}
              />

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowCustomQtyModal(false)}
                  style={{
                    flex: 1,
                    minHeight: '40px',
                    borderRadius: 'var(--radius-md, 8px)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontWeight: 700,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCustomQtySubmit}
                  style={{
                    flex: 1,
                    minHeight: '40px',
                    borderRadius: 'var(--radius-md, 8px)',
                    backgroundColor: 'var(--color-primary)',
                    color: 'var(--color-on-primary)',
                    fontWeight: 800,
                    fontSize: '13px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Submit
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Page>
  );
};

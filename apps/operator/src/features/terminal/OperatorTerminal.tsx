import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Operator } from '@factory-vision/domain-types';
import { Icon, M3_EASE, M3_TRANSITIONS } from '@factory-vision/ui';
import { enqueueCommand, syncQueue } from '../../offline/queue.js';
import { TerminalDashboard } from './TerminalDashboard.js';
import { WorkOrderPicker } from './WorkOrderPicker.js';
import {
  ShopFloorTransactionModal,
  type TransactionKind,
  type TransactionOption,
  type TransactionSubmission,
} from './ShopFloorTransactionModal.js';
import type { ThemeMode } from '../../app/theme.js';
import {
  acknowledgeRejections,
  getSyncStatus,
  subscribeSyncStatus,
  type SyncStatus,
} from '../../offline/queue.js';
import { Page, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/** Survives a tablet reload so the operator does not re-pick mid-shift. */
const WO_STORAGE_KEY = 'fv.operator.workOrderId';

interface OperatorTerminalProps {
  operator: Operator;
  onLogout: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

/**
 * The unmissable half of "sync status dapat diketahui operator".
 *
 * `SyncStatusBar` answers the question when asked; this one asks for attention
 * when something was refused. It stays until dismissed, because the rejection
 * stays until dealt with.
 */
const RejectionBanner: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => subscribeSyncStatus(setStatus), []);

  const notice = status.rejectionNotice;
  if (!notice) return null;

  return (
    <div
      role="alert"
      style={{
        backgroundColor: 'var(--color-error)',
        color: 'var(--color-on-error)',
        padding: `var(--space-3) var(--space-5)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 800 }}>
          {notice.count} catatan tidak diterima server
        </div>
        <div style={{ fontSize: '12px', opacity: 0.92 }}>
          {notice.message} Catatan tetap tersimpan di terminal dan sudah dilaporkan ke supervisor.
        </div>
      </div>
      <button
        type="button"
        onClick={acknowledgeRejections}
        style={{
          flexShrink: 0,
          minHeight: '36px',
          padding: `0 var(--space-4)`,
          borderRadius: 'var(--radius-sm, 8px)',
          border: '1px solid var(--color-on-error)',
          backgroundColor: 'transparent',
          color: 'var(--color-on-error)',
          fontSize: '12px',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'var(--font-family)',
        }}
      >
        Mengerti
      </button>
    </div>
  );
};

export const OperatorTerminal: React.FC<OperatorTerminalProps> = ({
  operator,
  onLogout,
  themeMode,
  onToggleTheme,
}) => {
  const queryClient = useQueryClient();

  /*
   * Which work order this terminal is bound to.
   *
   * Null means "not chosen yet", which sends the operator to the picker rather
   * than to a board bound to a guess. It is remembered across a reload for the
   * same reason the session is: a dropped browser must not cost an operator
   * their place mid-shift.
   */
  const [selectedWoId, setSelectedWoId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(WO_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  // Set while the operator is deliberately switching away from a bound order.
  const [changingWo, setChangingWo] = useState<boolean>(false);
  const [showDowntimeModal, setShowDowntimeModal] = useState<boolean>(false);
  const [showRejectModal, setShowRejectModal] = useState<boolean>(false);
  const [showCustomQtyModal, setShowCustomQtyModal] = useState<boolean>(false);
  const [customQty, setCustomQty] = useState<string>('');
  const [customQtyType, setCustomQtyType] = useState<'GOOD' | 'REJECT'>('GOOD');

  /**
   * Which of the improvement's transactions the operator is entering
   * (Improvement PRD §38). One state, because only one modal is open at a time.
   */
  const [transactionKind, setTransactionKind] = useState<TransactionKind | null>(null);

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

  /*
   * Context the board reads and never writes.
   *
   * Every one of these is allowed to fail: the terminal has to keep counting
   * production on a tablet that cannot reach the server, so a panel with no
   * data renders an empty state rather than taking the screen down with it.
   */
  const { data: machines } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.master.getMachines(),
    retry: false,
  });

  const { data: shifts } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api.master.getShifts(),
    retry: false,
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.master.getProducts(),
    retry: false,
  });

  const { data: liveBoard } = useQuery({
    queryKey: ['live-board'],
    queryFn: () => api.analytics.getLiveProductionBoard(),
    refetchInterval: 15000,
    retry: false,
  });

  const { data: downtimeRecords } = useQuery({
    queryKey: ['downtimes'],
    queryFn: () => api.shopFloor.getDowntimes(),
    refetchInterval: 20000,
    retry: false,
  });

  const { data: alerts } = useQuery({
    queryKey: ['operational-alerts'],
    queryFn: () => api.analytics.getAlerts({ days: 1 }),
    refetchInterval: 60000,
    retry: false,
  });

  // No fallback on purpose: an unrecognised id (the order finished, or this
  // tablet was bound to another line's work) has to send the operator back to
  // the picker, not quietly re-point their counts at a different order.
  const activeWo = workOrders?.find((w) => w.id === selectedWoId);

  // Everything below narrows the fetched context to the selected work order,
  // so each panel receives one object rather than searching a list itself.
  const activeMachine = machines?.find((m) => m.id === activeWo?.machineId);
  const activeShift = shifts?.find((s) => s.id === activeWo?.shiftId) || shifts?.[0];
  const activeProduct = products?.find((p) => p.id === activeWo?.productId);
  const activeProcess = processes?.find((p) => p.id === activeWo?.processId);
  const activeBatch = batches?.find((b) => b.workOrderId === activeWo?.id);
  const activeBoard = liveBoard?.find((row) => row.workOrder?.id === activeWo?.id);

  // The timeline shows this machine's shift, not the whole plant's.
  const activeDowntimes = (downtimeRecords || []).filter(
    (record) => record.machineId === activeWo?.machineId || record.lineId === activeWo?.lineId,
  );

  // The reason the operator picked is what the downtime card should name,
  // because the server's own record has not come back yet while offline.
  const activeDowntimeReasonName = downtimeReasons?.find((r) => r.id === selectedDowntimeReasonId)?.name;

  // A line's alerts are the operator's business; the plant's are not.
  const activeAlerts = (alerts || []).filter(
    (alert) =>
      (alert.entityType === 'LINE' && alert.entityId === activeWo?.lineId) ||
      (alert.entityType === 'MACHINE' && alert.entityId === activeWo?.machineId) ||
      (alert.entityType === 'WORK_ORDER' && alert.entityId === activeWo?.id),
  );

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

  /*
   * What each transaction offers to choose from (§38).
   *
   * All three read from react-query's cache, which the service worker keeps
   * warm, so the lists are still there when the terminal is offline — which is
   * the only time any of this matters.
   */
  const { data: materialRequirements } = useQuery({
    queryKey: ['wo-material-requirements', activeWo?.id],
    queryFn: () => api.materials.getRequirements({ sourceType: 'WORK_ORDER', sourceId: activeWo!.id }),
    enabled: Boolean(activeWo?.id),
    staleTime: 5 * 60_000,
  });

  const { data: inspectionPlans } = useQuery({
    queryKey: ['inspection-plans', activeWo?.productId],
    queryFn: () => api.quality.getPlans({ productId: activeWo?.productId, status: 'ACTIVE' }),
    enabled: Boolean(activeWo?.id),
    staleTime: 5 * 60_000,
  });

  const { data: openWip } = useQuery({
    queryKey: ['wo-wip', activeWo?.id],
    queryFn: () => api.wip.getRecords({ workOrderId: activeWo!.id, openOnly: true }),
    enabled: Boolean(activeWo?.id),
    refetchInterval: 30_000,
  });

  const transactionOptions: TransactionOption[] =
    transactionKind === 'CONSUMPTION'
      ? (materialRequirements ?? []).map((requirement) => ({
          id: requirement.materialId,
          label: requirement.materialSku,
          sublabel: `${requirement.materialName} · rencana ${requirement.requiredQuantity} ${requirement.uom}`,
        }))
      : transactionKind === 'INSPECTION'
        ? (inspectionPlans ?? []).map((plan) => ({
            id: plan.id,
            label: plan.name,
            sublabel: `${plan.inspectionType}${plan.mandatory ? ' · wajib' : ''}`,
          }))
        : (openWip ?? []).map((record) => ({
            id: record.id,
            label: record.wipNumber,
            sublabel: `${record.quantity} ${record.uom} · ${record.sourceProcessName ?? 'proses ini'}`,
          }));

  /**
   * Queues one improvement transaction.
   *
   * `clientEventId` doubles as the server's idempotency key, so a queue that
   * replays after a reconnect issues the material, records the inspection or
   * moves the WIP exactly once.
   */
  const handleTransactionSubmit = async (submission: TransactionSubmission) => {
    if (!activeWo) return;

    const common = {
      tenantId: activeWo.tenantId,
      workOrderId: activeWo.id,
      operatorId: operator.id,
      operatorName: operator.name,
      notes: submission.notes,
    };

    if (submission.kind === 'CONSUMPTION') {
      await enqueueCommand({
        tenantId: activeWo.tenantId,
        workOrderId: activeWo.id,
        type: 'RECORD_CONSUMPTION',
        payload: {
          ...common,
          materialId: submission.optionId,
          actualQuantity: submission.quantity,
          machineId: activeWo.machineId,
          processId: activeWo.processId,
          batchId: activeBatch?.id,
        },
      });
      triggerTapFeedback('MATERIAL DIPAKAI', 'primary');
    } else if (submission.kind === 'INSPECTION') {
      await enqueueCommand({
        tenantId: activeWo.tenantId,
        workOrderId: activeWo.id,
        type: 'RECORD_INSPECTION',
        payload: {
          ...common,
          inspectionPlanId: submission.optionId || undefined,
          inspectedQuantity: submission.quantity,
          failedQuantity: submission.failedQuantity,
          productId: activeWo.productId,
          processId: activeWo.processId,
          machineId: activeWo.machineId,
          batchId: activeBatch?.id,
        },
      });
      triggerTapFeedback(
        (submission.failedQuantity ?? 0) > 0 ? 'INSPEKSI FAIL' : 'INSPEKSI PASS',
        (submission.failedQuantity ?? 0) > 0 ? 'error' : 'success'
      );
    } else {
      await enqueueCommand({
        tenantId: activeWo.tenantId,
        workOrderId: activeWo.id,
        type: 'TRANSFER_WIP',
        payload: {
          ...common,
          wipId: submission.optionId,
          quantity: submission.quantity,
        },
      });
      triggerTapFeedback('WIP DIKIRIM', 'primary');
    }

    setTransactionKind(null);
    queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    queryClient.invalidateQueries({ queryKey: ['wo-wip', activeWo.id] });
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

  const bindWorkOrder = (workOrderId: string) => {
    setSelectedWoId(workOrderId);
    setChangingWo(false);
    try {
      window.localStorage.setItem(WO_STORAGE_KEY, workOrderId);
    } catch {
      /* a terminal with storage disabled still works, it just re-asks on reload */
    }
  };

  const formatDowntimeTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  /*
   * US-001 — a terminal binds to a work order the operator chose.
   *
   * The picker stands in front of the board whenever nothing is bound, and
   * whenever the operator asks to switch. It is not a modal: choosing what the
   * next hour of counting belongs to deserves the whole screen.
   */
  if (!activeWo || changingWo) {
    return (
      <WorkOrderPicker
        operator={operator}
        workOrders={workOrders || []}
        products={products || []}
        machines={machines || []}
        currentWoId={activeWo?.id ?? null}
        loading={!workOrders}
        onConfirm={bindWorkOrder}
        onCancel={activeWo ? () => setChangingWo(false) : undefined}
        onLogout={onLogout}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
      />
    );
  }

  return (
    <Page
      style={{
        // Opts out of the .fv-page page rhythm: this is a kiosk, edge to edge.
        padding: 0,
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
              padding: `var(--space-2) var(--space-5)`,
              borderRadius: 'var(--radius-pill)',
              fontWeight: 800,
              fontSize: '13px',
              boxShadow: 'var(--elevation-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              pointerEvents: 'none',
            }}
          >
            <Icon name="check_circle" size={16} />
            <span>{lastTapBadge.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        MES-082-4 — the operator is told when the server refused a record.
        A banner they have to dismiss, not a chip they might tap: an operator
        who does not know a count was rejected will not re-enter it, and the
        production is then only on the terminal.
      */}
      <RejectionBanner />

      {/*
        The board. Header, status, counters, OEE, downtime, alerts, the shift
        timeline and the quick-action row all live here; every callback below
        is a handler this component already had, so the operator's flow is
        unchanged and only its presentation moved.
      */}
      <TerminalDashboard
        operator={operator}
        activeWo={activeWo}
        onChangeWo={() => setChangingWo(true)}
        machine={activeMachine}
        shift={activeShift}
        product={activeProduct}
        process={activeProcess}
        batch={activeBatch}
        board={activeBoard}
        downtimes={activeDowntimes}
        downtimeReasonName={activeDowntimeReasonName}
        alerts={activeAlerts}
        activeDowntimeId={activeDowntimeId}
        downtimeSeconds={downtimeSeconds}
        onQuickGood={handleQuickGoodOutput}
        onOpenReject={() => setShowRejectModal(true)}
        onOpenCustomQty={(type) => {
          setCustomQtyType(type);
          setShowCustomQtyModal(true);
        }}
        onOpenDowntime={() => setShowDowntimeModal(true)}
        onOpenConsumption={() => setTransactionKind('CONSUMPTION')}
        onOpenInspection={() => setTransactionKind('INSPECTION')}
        onOpenWipTransfer={() => setTransactionKind('WIP_TRANSFER')}
        onResolveDowntime={handleResolveDowntime}
        onStartWo={handleStartWo}
        onPauseWo={handlePauseWo}
        onCompleteWo={handleCompleteWo}
        onLogout={onLogout}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
      />

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
              padding: 'var(--space-4)',
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
                padding: 'var(--space-6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                boxShadow: 'var(--elevation-3)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--color-error)' }}>
                PILIH ALASAN REJECT
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-2)' }}>
                {rejectReasons?.map((r) => (
                  <motion.button
                    key={r.id}
                    whileHover={{ scale: 1.02, x: 3 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleRecordReject(r.id)}
                    style={{
                      minHeight: '44px',
                      padding: `var(--space-2) var(--space-4)`,
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
              padding: 'var(--space-4)',
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
                padding: 'var(--space-6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                boxShadow: 'var(--elevation-3)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--color-warning)' }}>
                RECORD MACHINE DOWNTIME
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-2)' }}>
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
                        padding: `var(--space-2) var(--space-4)`,
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

              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
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
              padding: 'var(--space-4)',
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
                padding: 'var(--space-6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
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
                  padding: `0 var(--space-4)`,
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '2px solid var(--color-primary)',
                  backgroundColor: 'var(--color-surface-container)',
                  color: 'var(--color-on-surface)',
                  fontSize: '18px',
                  fontWeight: 800,
                  outline: 'none',
                }}
              />

              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
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

      {/* Material, quality and WIP from the terminal (Improvement PRD §38) */}
      <AnimatePresence>
        {transactionKind && activeWo ? (
          <ShopFloorTransactionModal
            kind={transactionKind}
            options={transactionOptions}
            context={`${activeWo.woNumber} · ${activeProduct?.name ?? ''}`}
            onClose={() => setTransactionKind(null)}
            onSubmit={handleTransactionSubmit}
          />
        ) : null}
      </AnimatePresence>
    </Page>
  );
};

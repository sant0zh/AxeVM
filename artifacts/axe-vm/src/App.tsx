import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, Box, Check, ChevronRight,
  CircleCheck, CircleDot, CircleX, Clock3, Cpu, Download, FileArchive, FileImage,
  Gauge, HardDrive, LayoutDashboard, LoaderCircle, Plus, RotateCcw, Save, Search,
  Server, Settings2, ShieldCheck, SlidersHorizontal, Square, Terminal, Trash2,
  Upload, X, Zap,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { assetBinaryStorage } from '@/lib/asset-storage';
import {
  ARM64_HARDWARE_DEFAULTS, createId, workspaceStorage,
  type AssetKind, type AssetRecord, type Preferences, type VMConfig, type WorkspaceData,
} from '@/lib/workspace';
import { unavailableEngine, type VMAssetResolver, type VMEngine } from '@/lib/vm-engine';
import { appendConsoleOutput, decodeConsoleBytes } from '@/lib/console-output';
import { VMRuntimeManager, type VMRuntimeSnapshot, type VMRuntimeState } from '@/lib/vm-runtime';
import {
  createVMProfile, deleteVMProfile, registerAssets, removeAssetFromWorkspace,
  updateVMProfile, type VMProfileInput,
} from '@/lib/workspace-operations';

type ToastFn = (message: string) => void;
type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type LifecycleAction = 'start' | 'stop' | 'restart';

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vms', label: 'Virtual machines', icon: Box },
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/storage', label: 'Storage', icon: HardDrive },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function handleVMAction(
  action: LifecycleAction,
  vm: VMConfig,
  runtime: VMRuntimeManager,
  notify: ToastFn,
): Promise<void> {
  const result = action === 'start'
    ? await runtime.start(vm)
    : action === 'stop'
      ? await runtime.stop(vm.id)
      : await runtime.restart(vm);
  if (!result.ok) {
    notify(result.error.message);
    return;
  }
  if (result.value.state === 'running') notify(`${vm.name} is running; the engine confirmed the session.`);
  else if (result.value.state === 'stopped') notify(`${vm.name} is stopped.`);
  else notify(`${action === 'restart' ? 'Restart' : action === 'start' ? 'Start' : 'Stop'} request accepted; waiting for engine confirmation.`);
}

type AxeVMAppProps = {
  engine?: VMEngine;
  assetResolver?: VMAssetResolver;
};

function App({ engine = unavailableEngine, assetResolver }: AxeVMAppProps) {
  const [location, setLocation] = useLocation();
  const [initialWorkspace] = useState(() => workspaceStorage.load());
  const [data, setData] = useState<WorkspaceData>(() => initialWorkspace.data);
  const dataRef = useRef(data);
  const [storageError, setStorageError] = useState(initialWorkspace.error);
  const storageLoadFailed = useRef(initialWorkspace.persistenceBlocked);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedVm = useMemo(() => data.vms.find((vm) => vm.id === data.selectedVmId) ?? data.vms[0] ?? null, [data.vms, data.selectedVmId]);
  const resolver = useMemo<VMAssetResolver>(() => assetResolver ?? ({
    resolve: async (id, expectedKind) => {
      const record = dataRef.current.assets.find((asset) => asset.id === id);
      if (!record || record.kind !== expectedKind || record.storageStatus !== 'indexeddb') return null;
      const binary = await assetBinaryStorage.get(id);
      return binary
        ? { id, kind: record.kind, locator: `indexeddb://${id}`, sizeBytes: binary.sizeBytes }
        : null;
    },
  }), [assetResolver]);
  const [runtime] = useState(() => new VMRuntimeManager(engine, resolver));
  const runtimeSnapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const [consoleOutput, setConsoleOutput] = useState<Record<string, string>>({});
  const consoleDecoders = useRef(new Map<string, TextDecoder>());
  const [quickCreateRequest, setQuickCreateRequest] = useState(0);
  const notify: ToastFn = (message) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(''), 3200);
  };

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    runtime.dispose();
  }, []);

  useEffect(() => runtime.subscribeEvents((vmId, event) => {
    if (event.type === 'state' && event.session.state === 'starting') {
      consoleDecoders.current.set(vmId, new TextDecoder());
    }
    if (event.type !== 'console-output') return;
    const decoder = consoleDecoders.current.get(vmId) ?? new TextDecoder();
    consoleDecoders.current.set(vmId, decoder);
    const text = decodeConsoleBytes(decoder, event.bytes);
    if (text) setConsoleOutput((current) => ({ ...current, [vmId]: appendConsoleOutput(current[vmId] ?? '', text) }));
  }), [runtime]);

  const patch = (updater: (current: WorkspaceData) => WorkspaceData): boolean => {
    if (storageLoadFailed.current) {
      notify('Changes were not saved because the existing workspace could not be read.');
      return false;
    }

    const next = updater(dataRef.current);
    try {
      workspaceStorage.save(next);
    } catch {
      setStorageError('The latest changes could not be saved in this browser. The displayed workspace was not changed.');
      notify('Could not save changes in browser storage.');
      return false;
    }

    dataRef.current = next;
    setData(next);
    setStorageError(null);
    return true;
  };

  return (
    <ErrorBoundary resetKey={location}>
      <div className="app-shell">
        <aside className="sidebar" aria-label="Main navigation">
          <Link href="/" className="brand" data-testid="link-brand-home">
            <span className="brand-mark">A</span>
            <span><span className="brand-name">AxeVM</span><br /><span className="brand-tag">ARM64 workspace</span></span>
          </Link>
          <div className="mobile-menu" aria-label="Quick navigation">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} aria-label={label} data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon className="nav-icon" /></Link>
            ))}
          </div>
          <nav>
            <div className="nav-label">Workspace</div>
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`nav-link ${location === href ? 'active' : ''}`} aria-current={location === href ? 'page' : undefined} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
                <Icon className="nav-icon" /><span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="engine-note" data-testid="status-engine-sidebar">
               <strong><span className="engine-dot" />{runtime.getAvailability().available ? 'Engine ready' : 'Engine unavailable'}</strong>
               <p>{runtime.getAvailability().message}</p>
            </div>
            <div className="sidebar-foot">AXEVM · BROWSER PROTOTYPE</div>
          </div>
        </aside>
        <div className="main-area">
          <header className="topbar">
            <div className="crumb">Workspace <ChevronRight size={13} /> <span>{navItems.find((item) => item.href === location)?.label ?? 'Not found'}</span></div>
            <div className="topbar-right">
              <span className={`system-pill ${runtime.getAvailability().available ? 'is-available' : ''}`} data-testid="status-engine-header"><span className="engine-dot" />{runtime.getAvailability().available ? 'ENGINE READY' : 'ENGINE UNAVAILABLE'}</span>
            </div>
          </header>
          <Switch>
            <Route path="/">
              <Dashboard
                data={data}
                selectedVm={selectedVm}
                runtime={runtime}
                runtimeSnapshot={runtimeSnapshot}
                onSelect={(id) => patch((current) => ({ ...current, selectedVmId: id }))}
                onQuickCreate={() => {
                  setQuickCreateRequest((request) => request + 1);
                  setLocation('/vms');
                }}
                onNavigate={setLocation}
                onAction={async (action, vm) => handleVMAction(action, vm, runtime, notify)}
              />
            </Route>
            <Route path="/vms">
              <VMManager
                data={data}
                selectedVm={selectedVm}
                runtime={runtime}
                runtimeSnapshot={runtimeSnapshot}
                createRequest={quickCreateRequest}
                patch={patch}
                notify={notify}
                onNavigate={setLocation}
                onDeleteRuntime={async (vm) => {
                  const status = runtime.getStatus(vm.id);
                  if (status.state === 'running') {
                    const stopped = await runtime.stop(vm.id);
                    if (!stopped.ok || runtime.getStatus(vm.id).state !== 'stopped') {
                      notify(stopped.ok ? 'The engine has not confirmed that the VM stopped.' : stopped.error.message);
                      return false;
                    }
                  } else if (status.state === 'starting' || status.state === 'stopping') {
                    notify('Wait for the current lifecycle operation to finish before deleting this VM.');
                    return false;
                  }
                  const saved = patch((current) => deleteVMProfile(current, vm.id));
                  if (saved) runtime.forget(vm.id);
                  return saved;
                }}
              />
            </Route>
            <Route path="/console">
              <ConsolePage
                data={data}
                selectedVm={selectedVm}
                status={selectedVm ? runtime.getStatus(selectedVm.id) : null}
                availability={runtime.getAvailability()}
                output={selectedVm ? consoleOutput[selectedVm.id] ?? '' : ''}
                onSelect={(id) => patch((current) => ({ ...current, selectedVmId: id }))}
                onSend={async (input) => {
                  if (!selectedVm) return { ok: false as const, error: { code: 'invalid-state' as const, message: 'Select a VM configuration first.' } };
                  const result = await runtime.sendConsoleInput(selectedVm.id, new TextEncoder().encode(`${input}\n`));
                  if (result.ok) notify('Input sent to the VM console.');
                  else notify(result.error.message);
                  return result;
                }}
                onClear={() => {
                  if (!selectedVm) return;
                  consoleDecoders.current.set(selectedVm.id, new TextDecoder());
                  setConsoleOutput((current) => ({ ...current, [selectedVm.id]: '' }));
                }}
                onAction={async (action) => {
                  if (!selectedVm) return;
                  const result = action === 'start'
                    ? await runtime.start(selectedVm)
                    : action === 'stop'
                      ? await runtime.stop(selectedVm.id)
                      : await runtime.restart(selectedVm);
                  if (!result.ok) notify(result.error.message);
                }}
              />
            </Route>
            <Route path="/storage">
              <StoragePage data={data} patch={patch} notify={notify} />
            </Route>
            <Route path="/settings">
              <SettingsPage preferences={data.preferences} onChange={(preferences) => patch((current) => ({ ...current, preferences }))} />
            </Route>
            <Route>
              <NotFound />
            </Route>
          </Switch>
        </div>
      </div>
      {storageError && <div className="storage-error" role="alert" data-testid="status-storage-error"><AlertTriangle size={15} /><span>{storageError}</span></div>}
      {toastMessage && <div className="toast-inline" role="status" aria-live="polite" data-testid="status-toast">{toastMessage}</div>}
    </ErrorBoundary>
  );
}

function PageHead({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) {
  return <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>{children}</div>;
}

function runtimeStatus(vm: VMConfig, runtime: VMRuntimeManager, snapshot: VMRuntimeSnapshot) {
  return snapshot[vm.id] ?? runtime.getStatus(vm.id);
}

function StatusBadge({ state, error }: { state: VMRuntimeState; error?: string }) {
  const labels: Record<VMRuntimeState, string> = {
    stopped: 'Stopped',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    error: 'Error',
    unavailable: 'Unavailable',
  };
  const Icon = state === 'running' ? CircleCheck
    : state === 'starting' || state === 'stopping' ? LoaderCircle
      : state === 'error' ? CircleX
        : state === 'stopped' ? CircleDot
          : Clock3;
  return <span className={`runtime-badge runtime-${state}`} title={error} data-testid={`status-vm-${state}`}><Icon size={13} className={state === 'starting' || state === 'stopping' ? 'spin' : undefined} />{labels[state]}</span>;
}

function LifecycleButtons({
  vm,
  status,
  onAction,
  onConsole,
  onEdit,
  onDelete,
}: {
  vm: VMConfig;
  status: VMRuntimeStatus;
  onAction: (action: LifecycleAction, vm: VMConfig) => void;
  onConsole: (vm: VMConfig) => void;
  onEdit?: (vm: VMConfig) => void;
  onDelete?: (vm: VMConfig) => void;
}) {
  const busy = status.state === 'starting' || status.state === 'stopping';
  const startBlocked = busy || status.state === 'running';
  const stopBlocked = busy || status.state !== 'running';
  const restartBlocked = busy;
  const editBlocked = busy || status.state === 'running';
  return (
    <div className="vm-actions" aria-label={`Actions for ${vm.name}`}>
      <button className="icon-btn action-start" aria-label={`Start ${vm.name}`} title="Start VM" disabled={startBlocked} onClick={() => onAction('start', vm)} data-testid={`button-start-vm-${vm.id}`}><Zap size={14} /></button>
      <button className="icon-btn" aria-label={`Stop ${vm.name}`} title="Stop VM" disabled={stopBlocked} onClick={() => onAction('stop', vm)} data-testid={`button-stop-vm-${vm.id}`}><Square size={13} /></button>
      <button className="icon-btn" aria-label={`Restart ${vm.name}`} title="Restart VM" disabled={restartBlocked} onClick={() => onAction('restart', vm)} data-testid={`button-restart-vm-${vm.id}`}><RotateCcw size={14} /></button>
      <button className="icon-btn" aria-label={`Open console for ${vm.name}`} title="Open console" onClick={() => onConsole(vm)} data-testid={`button-console-vm-${vm.id}`}><Terminal size={14} /></button>
      {onEdit && <button className="icon-btn" aria-label={`Edit ${vm.name}`} title={editBlocked ? 'Stop the VM before editing' : 'Edit configuration'} disabled={editBlocked} onClick={() => onEdit(vm)} data-testid={`button-edit-vm-${vm.id}`}><SlidersHorizontal size={14} /></button>}
      {onDelete && <button className="icon-btn danger-icon" aria-label={`Delete ${vm.name}`} title="Delete VM configuration" onClick={() => onDelete(vm)} data-testid={`button-delete-vm-${vm.id}`}><Trash2 size={14} /></button>}
    </div>
  );
}

function Dashboard({
  data,
  selectedVm,
  runtime,
  runtimeSnapshot,
  onSelect,
  onQuickCreate,
  onNavigate,
  onAction,
}: {
  data: WorkspaceData;
  selectedVm: VMConfig | null;
  runtime: VMRuntimeManager;
  runtimeSnapshot: VMRuntimeSnapshot;
  onSelect: (id: string) => void;
  onQuickCreate: () => void;
  onNavigate: (path: string) => void;
  onAction: (action: LifecycleAction, vm: VMConfig) => void;
}) {
  const [query, setQuery] = useState('');
  const availability = runtime.getAvailability();
  const runningCount = data.vms.filter((vm) => runtimeStatus(vm, runtime, runtimeSnapshot).state === 'running').length;
  const stoppedCount = data.vms.filter((vm) => runtimeStatus(vm, runtime, runtimeSnapshot).state === 'stopped').length;
  const filtered = data.vms.filter((vm) => vm.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return (
    <main className="page-wrap">
      <PageHead eyebrow="AxeVM / Workspace" title="Virtual machine workspace" subtitle="Manage ARM64 virtual machine profiles, linked assets, and the execution engine state." />
      <div className="overview-grid">
        <section className="panel hero-panel">
          <div className="hero-kicker"><Activity size={13} /> AxeVM · ARM64</div>
          <h2>Build and manage<br />your VM profiles.</h2>
          <p>Configure AArch64 machines on QEMU’s generic virt platform. Execution is shown only when the engine confirms a session.</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onQuickCreate} data-testid="button-create-vm"><Plus size={15} /> Create VM</button>
            <Link href="/vms" className="btn btn-quiet" data-testid="button-open-vms"><Server size={14} /> Manage VMs</Link>
          </div>
        </section>
        <section className="panel engine-summary">
          <div className="section-overline">Execution engine</div>
          <div className={`engine-status-large ${availability.available ? 'ready' : 'offline'}`}><span className="engine-dot" />{availability.available ? availability.mode === 'simulated' ? 'SIMULATED ENGINE' : 'ENGINE READY' : 'UNAVAILABLE'}</div>
          <p>{availability.message}</p>
          <div className="resource-line"><span>Guest target</span><strong>AArch64 · virt</strong></div>
        </section>
      </div>
      <section className="metric-grid" aria-label="Workspace statistics">
        <MetricCard label="Registered VMs" value={data.vms.length} icon={<Server size={16} />} testId="text-vm-count" />
        <MetricCard label="Running" value={runningCount} icon={<CircleCheck size={16} />} tone="green" testId="text-running-count" />
        <MetricCard label="Stopped" value={stoppedCount} icon={<CircleDot size={16} />} testId="text-stopped-count" />
        <MetricCard label="Storage assets" value={data.assets.length} icon={<HardDrive size={16} />} testId="text-asset-count" />
        <MetricCard label="Engine" value={availability.available ? availability.mode === 'simulated' ? 'SIM' : 'Ready' : 'Offline'} icon={<Gauge size={16} />} tone={availability.available ? 'green' : 'amber'} testId="text-engine-status" />
      </section>
      {availability.mode === 'simulated' && <section className="callout simulated-callout" role="note"><AlertTriangle className="callout-icon" size={16} /><span><strong>SIMULATED ENGINE.</strong> Console data is generated by a mock adapter and is not guest OS output.</span></section>}
      {!availability.available && <section className="callout" role="note"><ShieldCheck className="callout-icon" size={16} /><span><strong>Execution is in development.</strong> The current browser build has no QEMU process. VM profiles and asset metadata are real; guest boot output is not generated.</span></section>}
      <div className="section-heading"><h2>Virtual machines</h2><button className="text-link" onClick={() => onNavigate('/vms')} data-testid="link-all-vms">Manage all <ChevronRight size={13} /></button></div>
      <div className="list-toolbar">
        <label className="search-field"><Search size={15} /><input aria-label="Search virtual machines" placeholder="Search by VM name" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-dashboard-search" /></label>
        <span className="section-overline">{filtered.length} OF {data.vms.length} PROFILES</span>
      </div>
      {data.vms.length === 0 ? (
        <EmptyState icon={<Box size={21} />} title="No virtual machines yet" description="Create an ARM64 VM profile to configure its resources and linked boot or disk assets." action={<button className="btn btn-primary" onClick={onQuickCreate} data-testid="button-empty-create"><Plus size={14} /> Create VM</button>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search size={21} />} title="No matching VMs" description="Try another search term." />
      ) : (
        <div className="vm-list">
          {filtered.slice(0, 8).map((vm) => {
            const status = runtimeStatus(vm, runtime, runtimeSnapshot);
            return <div key={vm.id} className="vm-row dashboard-vm-row" data-testid={`row-dashboard-vm-${vm.id}`}>
              <div className="vm-ident">
                <div className="vm-glyph"><Cpu size={17} /></div>
                <div className="vm-ident-copy"><button className="vm-name" onClick={() => { onSelect(vm.id); onNavigate('/console'); }} data-testid={`button-select-vm-${vm.id}`}>{vm.name}</button><div className="vm-id">{selectedVm?.id === vm.id ? 'SELECTED · ' : ''}AARCH64 · {vm.machineType} · {vm.cpuModel}</div></div>
              </div>
              <div className="vm-spec">{vm.ramMiB.toLocaleString()} MiB RAM</div>
              <div className="vm-spec">{vm.vcpuCount} vCPU · {vm.diskGiB} GiB disk</div>
              <StatusBadge state={status.state} error={status.error} />
              <LifecycleButtons vm={vm} status={status} onAction={onAction} onConsole={(target) => { onSelect(target.id); onNavigate('/console'); }} />
            </div>;
          })}
        </div>
      )}
    </main>
  );
}

function MetricCard({ label, value, icon, tone, testId }: { label: string; value: string | number; icon: ReactNode; tone?: 'green' | 'amber'; testId: string }) {
  return <section className="panel metric-card" data-testid={testId}><div className={`metric-icon ${tone ?? ''}`}>{icon}</div><div className="metric-card-value">{value}</div><div className="metric-card-label">{label}</div></section>;
}

function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

type VMFormValues = { name: string; ramMiB: string; diskGiB: string; vcpuCount: string; cpuModel: string; diskAssetId: string; bootImageId: string };
const blankForm = (preferences: Preferences): VMFormValues => ({
  name: '',
  ramMiB: String(preferences.defaultRamMiB),
  diskGiB: String(preferences.defaultDiskGiB),
  vcpuCount: String(ARM64_HARDWARE_DEFAULTS.vcpuCount),
  cpuModel: preferences.defaultCpuModel,
  diskAssetId: '',
  bootImageId: '',
});

function VMManager({
  data,
  selectedVm,
  runtime,
  runtimeSnapshot,
  createRequest,
  patch,
  notify,
  onNavigate,
  onDeleteRuntime,
}: {
  data: WorkspaceData;
  selectedVm: VMConfig | null;
  runtime: VMRuntimeManager;
  runtimeSnapshot: VMRuntimeSnapshot;
  createRequest: number;
  patch: (updater: (current: WorkspaceData) => WorkspaceData) => boolean;
  notify: ToastFn;
  onNavigate: (path: string) => void;
  onDeleteRuntime: (vm: VMConfig) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<VMConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<VMFormValues>(() => blankForm(data.preferences));
  const [deleteTarget, setDeleteTarget] = useState<VMConfig | null>(null);
  const [query, setQuery] = useState('');
  const lastCreateRequest = useRef(0);
  const filtered = data.vms.filter((vm) => vm.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  const beginCreate = () => { setEditing(null); setForm(blankForm(data.preferences)); setCreating(true); };
  useEffect(() => {
    if (createRequest > lastCreateRequest.current) {
      lastCreateRequest.current = createRequest;
      beginCreate();
    }
  }, [createRequest]);

  const beginEdit = (vm: VMConfig) => {
    if (!patch((current) => ({ ...current, selectedVmId: vm.id }))) return;
    setEditing(vm);
    setForm({
      name: vm.name,
      ramMiB: String(vm.ramMiB),
      diskGiB: String(vm.diskGiB),
      vcpuCount: String(vm.vcpuCount),
      cpuModel: vm.cpuModel,
      diskAssetId: vm.diskAssetId ?? '',
      bootImageId: vm.bootImageId ?? '',
    });
    setCreating(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const input: VMProfileInput = {
      name: form.name,
      ramMiB: Number(form.ramMiB),
      diskGiB: Number(form.diskGiB),
      vcpuCount: Number(form.vcpuCount),
      cpuModel: form.cpuModel as VMProfileInput['cpuModel'],
      diskAssetId: form.diskAssetId || undefined,
      bootImageId: form.bootImageId || undefined,
    };
    const expectedAssets = [
      { id: input.diskAssetId, kind: 'Virtual disk' as const },
      { id: input.bootImageId, kind: 'Boot image' as const },
    ].filter((item): item is { id: string; kind: AssetKind } => Boolean(item.id));
    if (expectedAssets.some(({ id, kind }) => !data.assets.some((asset) => asset.id === id && asset.kind === kind))) {
      notify('Choose a registered asset with the matching disk or boot-image type.');
      return;
    }
    const now = new Date().toISOString();
    try {
      const saved = patch((current) => editing
        ? updateVMProfile(current, editing.id, input, now)
        : createVMProfile(current, input, createId(), now));
      if (!saved) return;
      notify(editing ? 'VM configuration updated.' : 'VM configuration created.');
      setCreating(false);
      setEditing(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The VM configuration could not be saved.');
    }
  };
  const performDelete = async (target: VMConfig) => {
    const removed = await onDeleteRuntime(target);
    if (!removed) return;
    notify(`Removed “${target.name}”.`);
    setDeleteTarget(null);
  };
  const cancelForm = () => { setCreating(false); setEditing(null); };

  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Virtual machines" title={creating ? (editing ? 'Edit VM configuration' : 'Create a VM') : 'Virtual machines'} subtitle={creating ? 'Configure a saved AArch64 profile on the virt machine. Saving a profile does not start a guest.' : 'Manage VM resources, linked assets, and lifecycle controls.'}>
        {!creating && <button className="btn btn-primary" onClick={beginCreate} data-testid="button-new-vm"><Plus size={15} /> Create VM</button>}
      </PageHead>
      {creating ? (
        <div className="split-layout">
          <form className="panel form-panel" onSubmit={save}>
            <div className="form-grid">
              <div className="field full"><label htmlFor="vm-name">VM name</label><input id="vm-name" className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. AxeOS development" autoFocus maxLength={64} required data-testid="input-vm-name" /><span className="field-help">Use a unique name of up to 64 characters.</span></div>
              <div className="field"><label htmlFor="vm-arch">Guest architecture</label><input id="vm-arch" className="input mono" value="AArch64" readOnly aria-readonly="true" data-testid="input-vm-architecture" /><span className="field-help">ARM64 guest configuration.</span></div>
              <div className="field"><label htmlFor="vm-machine">Machine profile</label><input id="vm-machine" className="input mono" value={data.preferences.defaultMachineType} readOnly aria-readonly="true" data-testid="input-vm-machine" /><span className="field-help">The supported machine profile is fixed to QEMU virt.</span></div>
              <div className="field"><label htmlFor="vm-cpu-model">CPU profile</label><select id="vm-cpu-model" className="select mono" value={form.cpuModel} onChange={(event) => setForm({ ...form, cpuModel: event.target.value })} data-testid="select-vm-cpu-profile"><option value="max">max · generic ARM64</option><option value="cortex-a72">cortex-a72</option></select><span className="field-help">Saved as a future engine profile; no CPU is emulated here.</span></div>
              <div className="field"><label htmlFor="vm-vcpus">Virtual CPU cores</label><input id="vm-vcpus" className="input mono" type="number" min="1" max="64" step="1" value={form.vcpuCount} onChange={(event) => setForm({ ...form, vcpuCount: event.target.value })} required data-testid="input-vm-vcpus" /><span className="field-help">Configure 1–64 guest vCPUs.</span></div>
              <div className="field"><label htmlFor="vm-ram">Memory (MiB)</label><input id="vm-ram" className="input mono" type="number" min="256" max="1048576" step="256" value={form.ramMiB} onChange={(event) => setForm({ ...form, ramMiB: event.target.value })} required data-testid="input-vm-ram" /><span className="field-help">256–1,048,576 MiB.</span></div>
              <div className="field"><label htmlFor="vm-disk">Virtual disk capacity (GiB)</label><input id="vm-disk" className="input mono" type="number" min="1" max="4096" step="1" value={form.diskGiB} onChange={(event) => setForm({ ...form, diskGiB: event.target.value })} required data-testid="input-vm-disk" /><span className="field-help">Capacity metadata only; no disk is created.</span></div>
              <div className="field full"><label htmlFor="vm-disk-image">Virtual disk image <span className="optional-label">(optional)</span></label><select id="vm-disk-image" className="select" value={form.diskAssetId} onChange={(event) => setForm({ ...form, diskAssetId: event.target.value })} data-testid="select-vm-disk-image"><option value="">No disk image linked</option>{data.assets.filter((asset) => asset.kind === 'Virtual disk').map((asset) => <option value={asset.id} key={asset.id}>{asset.name}{asset.storageStatus === 'reference-only' ? ' · metadata only' : ''}</option>)}</select><span className="field-help">Links an imported file. Browser-stored bytes are not a QEMU disk backend.</span></div>
              <div className="field full"><label htmlFor="vm-boot-image">Boot image <span className="optional-label">(optional)</span></label><select id="vm-boot-image" className="select" value={form.bootImageId} onChange={(event) => setForm({ ...form, bootImageId: event.target.value })} data-testid="select-vm-boot-image"><option value="">No boot image linked</option>{data.assets.filter((asset) => asset.kind === 'Boot image').map((asset) => <option value={asset.id} key={asset.id}>{asset.name}{asset.storageStatus === 'reference-only' ? ' · metadata only' : ''}</option>)}</select><span className="field-help">References an asset; AxeVM does not inspect or boot it.</span></div>
            </div>
            {editing && (editing.legacyMachineType || editing.legacyArchitecture || editing.legacyCpuModel) && <div className="callout" role="note" style={{ marginTop: 16 }}><AlertTriangle className="callout-icon" size={16} /><span>Legacy hardware settings were normalized to the ARM64 profile. Original values are retained in the saved configuration{editing.legacyMachineType ? ` (machine: ${editing.legacyMachineType})` : ''}{editing.legacyArchitecture ? ` (architecture: ${editing.legacyArchitecture})` : ''}{editing.legacyCpuModel ? ` (CPU: ${editing.legacyCpuModel})` : ''}.</span></div>}
            <div className="form-actions"><button type="button" className="btn btn-quiet" onClick={cancelForm} data-testid="button-cancel-vm"><ArrowLeft size={14} /> Cancel</button><button type="submit" className="btn btn-primary" data-testid="button-save-vm"><Save size={14} /> Save configuration</button></div>
          </form>
          <div className="detail-stack">
            <section className="panel detail-card"><h3>Hardware profile</h3><div className="detail-pair"><span>Architecture</span><strong>AArch64</strong></div><div className="detail-pair"><span>Machine</span><strong>virt</strong></div><div className="detail-pair"><span>CPU model</span><strong>{form.cpuModel}</strong></div><div className="detail-pair"><span>Execution</span><strong>Engine dependent</strong></div></section>
            <div className="callout"><AlertTriangle className="callout-icon" size={16} /><span>A saved profile is not a running VM. Start is accepted only when the engine returns a matching session.</span></div>
          </div>
        </div>
      ) : (
        <>
          <div className="list-toolbar">
            <label className="search-field"><Search size={15} /><input aria-label="Search configurations" placeholder="Filter by name" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-vm-search" /></label>
            <span className="section-overline">{filtered.length} OF {data.vms.length} PROFILES</span>
          </div>
          {filtered.length === 0 ? <EmptyState icon={<Box size={21} />} title={data.vms.length ? 'No matching configurations' : 'Your machine list is empty'} description={data.vms.length ? 'Try a different name or clear the filter.' : 'Create an ARM64 configuration to get started. It will be stored in this browser.'} action={!data.vms.length ? <button className="btn btn-primary" onClick={beginCreate} data-testid="button-vm-empty-create"><Plus size={14} /> Create VM</button> : undefined} /> :
            <div className={`vm-list ${data.preferences.compactRows ? 'compact' : ''}`}>{filtered.map((vm) => <div key={vm.id} className="vm-row" data-testid={`row-managed-vm-${vm.id}`}>
              <div className="vm-ident"><div className="vm-glyph"><Cpu size={17} /></div><div className="vm-ident-copy"><button className="vm-name" onClick={() => patch((current) => ({ ...current, selectedVmId: vm.id }))} data-testid={`button-set-selected-${vm.id}`}>{vm.name}</button><div className="vm-id">{vm.id.slice(0, 8).toUpperCase()} · AArch64 · {vm.machineType}/{vm.cpuModel}</div></div></div>
              <div className="vm-spec">{vm.ramMiB.toLocaleString()} MiB RAM</div><div className="vm-spec">{vm.vcpuCount} vCPU · {vm.diskGiB} GiB disk</div>
              <StatusBadge state={runtimeStatus(vm, runtime, runtimeSnapshot).state} error={runtimeStatus(vm, runtime, runtimeSnapshot).error} />
              <LifecycleButtons
                vm={vm}
                status={runtimeStatus(vm, runtime, runtimeSnapshot)}
                onAction={(action, target) => void handleVMAction(action, target, runtime, notify)}
                onConsole={(target) => { patch((current) => ({ ...current, selectedVmId: target.id })); onNavigate('/console'); }}
                onEdit={beginEdit}
                onDelete={(target) => data.preferences.confirmDelete ? setDeleteTarget(target) : void performDelete(target)}
              />
            </div>)}</div>}
          {selectedVm && <div className="section-heading"><h2>Selected profile</h2><button className="text-link" onClick={() => onNavigate('/console')} data-testid="link-selected-console">Open console <ChevronRight size={13} /></button></div>}
        </>
      )}
      {deleteTarget && <Modal title="Delete VM configuration?" description={`“${deleteTarget.name}” and its saved profile will be removed. Linked disk and boot assets remain in Storage. If it is running, AxeVM will stop it first and delete only after the engine confirms it stopped.`} onClose={() => setDeleteTarget(null)}><button className="btn btn-quiet" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">Keep VM</button><button className="btn btn-danger" onClick={() => void performDelete(deleteTarget)} data-testid="button-confirm-delete"><Trash2 size={14} /> Delete VM</button></Modal>}
    </main>
  );
}

function Modal({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="icon-btn" style={{ float: 'right' }} aria-label="Close dialog" onClick={onClose}><X size={15} /></button><h2 id="modal-title">{title}</h2><p>{description}</p><div className="modal-actions">{children}</div></section></div>;
}

function ConsolePage({
  data,
  selectedVm,
  status,
  availability,
  output,
  onSelect,
  onSend,
  onClear,
  onAction,
}: {
  data: WorkspaceData;
  selectedVm: VMConfig | null;
  status: VMRuntimeStatus | null;
  availability: ReturnType<VMRuntimeManager['getAvailability']>;
  output: string;
  onSelect: (id: string) => void;
  onSend: (input: string) => Promise<VMEngineResult<void>>;
  onClear: () => void;
  onAction: (action: LifecycleAction) => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const running = status?.state === 'running' && availability.available;
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || !running || sending) return;
    setSending(true);
    try {
      const result = await onSend(input);
      if (result.ok) setInput('');
    } finally {
      setSending(false);
    }
  };
  const engineLabel = availability.mode === 'simulated'
    ? 'SIMULATED'
    : availability.mode === 'real' && availability.available ? 'ENGINE CONNECTED' : 'UNAVAILABLE';
  const message = status?.error ?? availability.message;
  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Console" title="VM console" subtitle="Console output and keyboard input come only from the selected VMEngine session." >
        {data.vms.length > 0 && <label className="console-vm-select"><span className="sr-only">Select virtual machine</span><select className="select" aria-label="Select virtual machine" value={selectedVm?.id ?? ''} onChange={(event) => onSelect(event.target.value)} data-testid="select-console-vm">{data.vms.map((vm) => <option value={vm.id} key={vm.id}>{vm.name}</option>)}</select></label>}
      </PageHead>
      {availability.mode === 'simulated' && <div className="callout simulated-callout" role="note"><AlertTriangle className="callout-icon" size={16} /><span><strong>SIMULATED ENGINE OUTPUT.</strong> This adapter is for testing or demonstration. It is not boot output from a guest OS.</span></div>}
      {!availability.available && <div className="callout" role="note"><AlertTriangle className="callout-icon" size={16} /><span><strong>Execution unavailable.</strong> No guest session or boot output is present. {availability.message}</span></div>}
      <section className="console-panel" aria-label="VM console">
        <div className="console-top">
          <div><span className="console-label">AXEVM CONSOLE</span><span className="console-name">{selectedVm?.name ?? 'NO VM SELECTED'}</span></div>
          <div className="console-top-status"><StatusBadge state={status?.state ?? 'unavailable'} error={status?.error} /><span className={`engine-mode engine-${availability.mode}`}>{engineLabel}</span><button className="icon-btn console-clear" aria-label="Clear console output" title="Clear visible output" onClick={onClear} disabled={!selectedVm || !output} data-testid="button-clear-console"><X size={14} /></button></div>
        </div>
        <pre className="console-output" ref={outputRef} aria-live="polite" aria-label="Engine console output" data-testid="console-output">
          {output || <span className="console-placeholder">{selectedVm ? running ? 'Connected. Waiting for engine output.' : 'No session output. Start the VM to request an engine session.' : 'Choose a VM configuration to view its console.'}</span>}
        </pre>
      </section>
      <form className="console-input-section" onSubmit={send} aria-label="VM console input">
        <label htmlFor="guest-input">Send text to the VM console</label>
        <div className="console-input-control">
          <input id="guest-input" className="input mono" value={input} onChange={(event) => setInput(event.target.value)} disabled={!running || sending} placeholder={running ? 'Enter console input…' : 'Input is disabled until the engine confirms Running'} aria-describedby="guest-input-help" data-testid="input-guest-keyboard" />
          <button className="btn btn-primary" type="submit" disabled={!running || sending || !input.trim()} aria-label="Send console input" data-testid="button-send-guest-input">{sending ? <LoaderCircle size={14} className="spin" /> : <Zap size={14} />} Send</button>
        </div>
        <p id="guest-input-help" className="field-help">{running ? 'Input is encoded as UTF-8 and sent to the active VMEngine session.' : 'Keyboard input is disabled until this VM is confirmed running by the engine.'}</p>
      </form>
      <div className="section-heading"><h2>Lifecycle</h2>{status && <StatusBadge state={status.state} error={status.error} />}</div>
      {selectedVm ? (
        <div className="lifecycle-toolbar">
          <button className="btn btn-primary" onClick={() => onAction('start')} disabled={status?.state === 'running' || status?.state === 'starting' || status?.state === 'stopping'} data-testid="button-start-vm"><Zap size={14} /> Start</button>
          <button className="btn btn-quiet" onClick={() => onAction('stop')} disabled={status?.state !== 'running'} data-testid="button-stop-vm"><Square size={14} /> Stop</button>
          <button className="btn btn-quiet" onClick={() => onAction('restart')} disabled={status?.state === 'starting' || status?.state === 'stopping'} data-testid="button-restart-vm"><RotateCcw size={14} /> Restart</button>
          <Link href="/vms" className="btn btn-quiet" data-testid="link-console-edit"><SlidersHorizontal size={14} /> Edit configuration</Link>
          <span className="field-help lifecycle-message">{message}</span>
        </div>
      ) : (
        <EmptyState icon={<Terminal size={21} />} title="No VM selected" description="Create a configuration before opening a VM console." action={<Link href="/vms" className="btn btn-primary" data-testid="link-console-select-vm"><Plus size={14} /> Create a VM</Link>} />
      )}
    </main>
  );
}

function StoragePage({ data, patch, notify }: { data: WorkspaceData; patch: (updater: (current: WorkspaceData) => WorkspaceData) => boolean; notify: ToastFn }) {
  const [kind, setKind] = useState<'All files' | 'Virtual disk' | 'Boot image'>('All files');
  const [importKind, setImportKind] = useState<AssetKind>('Virtual disk');
  const [removeTarget, setRemoveTarget] = useState<AssetRecord | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = data.assets.filter((asset) => kind === 'All files' || asset.kind === kind);
  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) return;
    const validFiles = files.filter((file) => file.name.trim().length > 0 && file.size > 0);
    if (!validFiles.length) {
      notify('Choose a non-empty disk or boot asset.');
      return;
    }
    const addedAt = new Date().toISOString();
    const assets: AssetRecord[] = validFiles.map((file) => ({
      id: createId(),
      name: file.name,
      kind: importKind,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
      addedAt,
      storageStatus: 'indexeddb',
    }));
    try {
      await assetBinaryStorage.putMany(assets.map((asset, index) => ({
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        blob: validFiles[index],
      })));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Browser asset storage failed.';
      notify(`Could not store selected file${validFiles.length === 1 ? '' : 's'}: ${detail}`);
      return;
    }

    const saved = patch((current) => registerAssets(current, assets));
    if (!saved) {
      try {
        await assetBinaryStorage.removeMany(assets.map((asset) => asset.id));
      } catch {
        notify('Workspace metadata was not saved, and temporary file cleanup also failed.');
      }
      return;
    }

    const skippedCount = files.length - validFiles.length;
    notify(`${validFiles.length} asset${validFiles.length === 1 ? '' : 's'} stored in this browser${skippedCount ? `; skipped ${skippedCount} empty file${skippedCount === 1 ? '' : 's'}` : ''}.`);
  };
  const removeAssetNow = async (asset: AssetRecord) => {
    let binary: Awaited<ReturnType<typeof assetBinaryStorage.get>> = null;
    if (asset.storageStatus === 'indexeddb') {
      try {
        binary = await assetBinaryStorage.get(asset.id);
        if (binary) await assetBinaryStorage.removeMany([asset.id]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Browser asset storage failed.';
        notify(`Could not remove “${asset.name}”: ${detail}`);
        return;
      }
    }

    const saved = patch((current) => removeAssetFromWorkspace(current, asset.id, new Date().toISOString()).data);
    if (!saved) {
      if (binary) {
        try {
          await assetBinaryStorage.putMany([binary]);
        } catch {
          notify('Workspace metadata was not saved, and the removed file could not be restored.');
        }
      }
      return;
    }
    if (asset.storageStatus === 'indexeddb' && !binary) {
      notify(`Removed “${asset.name}”; its binary file was already missing from browser storage.`);
      setRemoveTarget(null);
      return;
    }
    const references = data.vms.filter((vm) => vm.diskAssetId === asset.id || vm.bootImageId === asset.id);
    notify(references.length
      ? `Removed “${asset.name}” and cleared its reference from ${references.length} VM${references.length === 1 ? '' : 's'}.`
      : `Removed “${asset.name}”.`);
    setRemoveTarget(null);
  };
  const requestRemoveAsset = (asset: AssetRecord) => {
    const referenced = data.vms.some((vm) => vm.diskAssetId === asset.id || vm.bootImageId === asset.id);
    if (data.preferences.confirmDelete || referenced) {
      setRemoveTarget(asset);
      return;
    }
    void removeAssetNow(asset);
  };
  const downloadAsset = async (asset: AssetRecord) => {
    try {
      await assetBinaryStorage.download(asset.id);
      notify(`Downloaded “${asset.name}”.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The stored file could not be downloaded.';
      notify(detail);
    }
  };
  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Storage" title="Storage manager" subtitle="Store and manage disk and boot-image files locally in this browser. AxeVM does not parse, mount, or boot them yet.">
        <div className="storage-head-actions">
          <button className="btn btn-quiet" onClick={() => workspaceStorage.exportManifest(data)} data-testid="button-export-manifest"><ArrowDownToLine size={14} /> Export manifest</button>
          <select className="select" value={importKind} onChange={(event) => setImportKind(event.target.value as AssetKind)} aria-label="Asset type to import" data-testid="select-import-asset-kind"><option value="Virtual disk">Virtual disk</option><option value="Boot image">Boot image</option></select>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()} data-testid="button-import-files"><Upload size={14} /> Import files</button>
          <input ref={inputRef} type="file" multiple hidden accept={importKind === 'Virtual disk' ? '.qcow,.qcow2,.raw,.img,.vhd,.vhdx' : '.img,.iso,.elf,.dtb,.bin,.gz,.xz'} onChange={importFiles} data-testid="input-import-files" aria-label={`Choose ${importKind.toLowerCase()} files`} />
        </div>
      </PageHead>
      <div className="callout"><FileArchive className="callout-icon" size={16} /><span>Registered assets appear below with their real file names, sizes, and types. New file bytes stay in this browser’s IndexedDB. Manifest export includes metadata only.</span></div>
      <div className="storage-toolbar">
        <div className="tabs" role="tablist" aria-label="Filter assets">
          {(['All files', 'Virtual disk', 'Boot image'] as const).map((option) => <button key={option} role="tab" aria-selected={kind === option} className="tab" onClick={() => setKind(option)} data-testid={`tab-storage-${option.toLowerCase().replace(' ', '-')}`}>{option} <span className="mono">({option === 'All files' ? data.assets.length : data.assets.filter((asset) => asset.kind === option).length})</span></button>)}
        </div>
      </div>
      {filtered.length === 0 ? <EmptyState icon={<HardDrive size={21} />} title={data.assets.length ? 'No files in this category' : 'No stored assets'} description={data.assets.length ? 'Import a disk or boot asset to add it to this category.' : 'Choose an asset type, then import a file. The browser stores its bytes locally in IndexedDB.'} action={<button className="btn btn-primary" onClick={() => inputRef.current?.click()} data-testid="button-empty-import"><Upload size={14} /> Import files</button>} /> :
        <section className="panel" aria-label="Stored assets">
          {filtered.map((asset) => <div className="asset-row" key={asset.id} data-testid={`row-asset-${asset.id}`}>
            <div className="vm-ident"><div className="vm-glyph">{asset.kind === 'Boot image' ? <FileImage size={16} /> : <HardDrive size={16} />}</div><div className="vm-ident-copy"><div className="vm-name" title={asset.name}>{asset.name}</div><div className="vm-id">{asset.id.slice(0, 8).toUpperCase()} · ADDED {timeLabel(asset.addedAt).toUpperCase()}</div></div></div>
            <div className="asset-kind">{asset.kind}</div><div className="asset-size"><strong>{formatBytes(asset.sizeBytes)}</strong><span>{asset.mimeType}</span><span className={`asset-storage-status ${asset.storageStatus}`}>{asset.storageStatus === 'indexeddb' ? 'FILE CONTENT STORED' : 'REGISTERED METADATA ONLY'}</span></div>
            <div className="vm-actions">{asset.storageStatus === 'indexeddb' && <button className="icon-btn" aria-label={`Download ${asset.name}`} title="Download file" onClick={() => void downloadAsset(asset)} data-testid={`button-download-asset-${asset.id}`}><Download size={14} /></button>}<button className="icon-btn danger-icon" aria-label={`Remove ${asset.name}`} title="Remove asset" onClick={() => requestRemoveAsset(asset)} data-testid={`button-remove-asset-${asset.id}`}><Trash2 size={14} /></button></div>
          </div>)}
        </section>}
      <div className="section-heading"><h2>About file references</h2></div>
      <div className="notice">Older workspace entries may be metadata-only references because the previous build did not store their file contents. New imports persist the actual bytes in this browser's IndexedDB. Storage is not synced; browser storage quotas apply. The manifest export contains configuration and asset metadata, not binary data.</div>
      {removeTarget && <AssetRemoveModal asset={removeTarget} vms={data.vms} onClose={() => setRemoveTarget(null)} onConfirm={() => void removeAssetNow(removeTarget)} />}
    </main>
  );
}

function AssetRemoveModal({ asset, vms, onClose, onConfirm }: { asset: AssetRecord; vms: VMConfig[]; onClose: () => void; onConfirm: () => void }) {
  const linkedVMs = vms.filter((vm) => vm.diskAssetId === asset.id || vm.bootImageId === asset.id);
  return (
    <Modal
      title="Remove registered asset?"
      description={`“${asset.name}” (${asset.kind.toLowerCase()}, ${formatBytes(asset.sizeBytes)}) will be removed from AxeVM’s registry. ${asset.storageStatus === 'indexeddb' ? 'Its locally stored file bytes will also be deleted.' : 'This entry contains metadata only.'}`}
      onClose={onClose}
    >
      {linkedVMs.length > 0 && <div className="asset-reference-warning" role="alert"><strong>This asset is linked to {linkedVMs.length} VM{linkedVMs.length === 1 ? '' : 's'}.</strong><ul>{linkedVMs.map((vm) => <li key={vm.id}>{vm.name}{vm.diskAssetId === asset.id ? ' · virtual disk' : ''}{vm.bootImageId === asset.id ? ' · boot image' : ''}</li>)}</ul><span>Removing it will clear those VM references. The VM profiles will remain.</span></div>}
      <div className="modal-actions"><button className="btn btn-quiet" onClick={onClose} data-testid="button-cancel-remove-asset">Keep asset</button><button className="btn btn-danger" onClick={onConfirm} data-testid="button-confirm-remove-asset"><Trash2 size={14} /> Remove asset</button></div>
    </Modal>
  );
}

function SettingsPage({ preferences, onChange }: { preferences: Preferences; onChange: (preferences: Preferences) => void }) {
  const [, setLocation] = useLocation();
  const setPref = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => onChange({ ...preferences, [key]: value });
  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Settings" title="Settings" subtitle="Set the defaults used by new VM profiles and control how destructive actions and lists behave." />
      <div className="section-heading" style={{ marginTop: 0 }}><h2>New configuration defaults</h2><span className="section-overline">APPLIED TO NEW VMS</span></div>
      <div className="settings-list">
        <section className="panel setting-row"><div><h3>Default memory</h3><p>Suggested RAM allocation for newly created VM profiles.</p></div><div className="setting-control"><select className="select mono" value={preferences.defaultRamMiB} onChange={(event) => setPref('defaultRamMiB', Number(event.target.value))} aria-label="Default memory" data-testid="select-default-ram"><option value={2048}>2,048 MiB</option><option value={4096}>4,096 MiB</option><option value={8192}>8,192 MiB</option><option value={16384}>16,384 MiB</option></select></div></section>
        <section className="panel setting-row"><div><h3>Default virtual disk</h3><p>Configured capacity for newly created VM profiles. This does not allocate a disk file.</p></div><div className="setting-control"><select className="select mono" value={preferences.defaultDiskGiB} onChange={(event) => setPref('defaultDiskGiB', Number(event.target.value))} aria-label="Default virtual disk" data-testid="select-default-disk"><option value={16}>16 GiB</option><option value={32}>32 GiB</option><option value={64}>64 GiB</option><option value={128}>128 GiB</option></select></div></section>
        <section className="panel setting-row"><div><h3>Default CPU profile</h3><p>Used by new VM configurations. These are saved profile values, not an active emulator CPU.</p></div><div className="setting-control"><select className="select mono" value={preferences.defaultCpuModel} onChange={(event) => setPref('defaultCpuModel', event.target.value as Preferences['defaultCpuModel'])} aria-label="Default CPU profile" data-testid="select-default-cpu"><option value="max">max · generic ARM64</option><option value="cortex-a72">cortex-a72</option></select></div></section>
        <section className="panel setting-row"><div><h3>Machine profile</h3><p>ARM64 VM profiles use QEMU virt. No incompatible machine types are available.</p></div><div className="setting-control"><select className="select mono" value={preferences.defaultMachineType} onChange={(event) => setPref('defaultMachineType', event.target.value as Preferences['defaultMachineType'])} aria-label="Default machine profile" data-testid="select-default-machine"><option value="virt">virt · ARM virtual platform</option></select></div></section>
      </div>
      <div className="section-heading"><h2>Workspace behavior</h2></div>
      <div className="settings-list">
        <section className="panel setting-row"><div><h3>Confirm before deleting</h3><p>Ask before removing VM profiles or storage assets. Referenced assets always show which VMs will be unlinked.</p></div><button className="toggle" role="switch" aria-checked={preferences.confirmDelete} aria-label="Confirm before deleting" onClick={() => setPref('confirmDelete', !preferences.confirmDelete)} data-testid="switch-confirm-delete" /></section>
        <section className="panel setting-row"><div><h3>Compact VM list</h3><p>Reduce row height in the Virtual Machines list.</p></div><button className="toggle" role="switch" aria-checked={preferences.compactRows} aria-label="Compact VM list" onClick={() => setPref('compactRows', !preferences.compactRows)} data-testid="switch-compact-rows" /></section>
      </div>
      <div className="section-heading"><h2>Application</h2></div>
      <div className="panel setting-row"><div><h3>Persistence</h3><p>VM configurations and preferences use browser local storage; imported asset bytes use IndexedDB on this device.</p></div><span className="state-tag"><Check size={12} /> Local only</span></div>
      <div className="panel setting-row" style={{ marginTop: 10 }}><div><h3>Execution engine</h3><p>{unavailableEngine.getAvailability().message}</p></div><StatusBadge state="unavailable" /></div>
      <div style={{ marginTop: 20 }}><button className="btn btn-quiet" onClick={() => setLocation('/')} data-testid="button-settings-done">Return to overview <ChevronRight size={14} /></button></div>
    </main>
  );
}

function NotFound() {
  return <main className="page-wrap"><PageHead eyebrow="AxeVM / 404" title="Nothing configured here." subtitle="That route is not part of this workspace." /><Link href="/" className="btn btn-primary" data-testid="link-not-found-home"><ArrowLeft size={14} /> Back to overview</Link></main>;
}

function RootApp() {
  return (
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <App />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default RootApp;

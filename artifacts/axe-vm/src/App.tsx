import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, Box, Check, ChevronRight,
  Cpu, Download, FileArchive, FileImage, HardDrive, LayoutDashboard,
  Plus, Save, Settings2, ShieldCheck, SlidersHorizontal, Terminal,
  Trash2, Upload, X, Zap,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { assetBinaryStorage } from '@/lib/asset-storage';
import {
  ARM64_HARDWARE_DEFAULTS, createId, workspaceStorage,
  type AssetKind, type AssetRecord, type Preferences, type VMConfig, type WorkspaceData,
} from '@/lib/workspace';
import { unavailableEngine } from '@/lib/vm-engine';

type ToastFn = (message: string) => void;
type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

const navItems: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
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

function App() {
  const [location] = useLocation();
  const [initialWorkspace] = useState(() => workspaceStorage.load());
  const [data, setData] = useState<WorkspaceData>(() => initialWorkspace.data);
  const dataRef = useRef(data);
  const [storageError, setStorageError] = useState(initialWorkspace.error);
  const storageLoadFailed = useRef(initialWorkspace.persistenceBlocked);
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedVm = useMemo(() => data.vms.find((vm) => vm.id === data.selectedVmId) ?? data.vms[0] ?? null, [data.vms, data.selectedVmId]);
  const notify: ToastFn = (message) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(''), 3200);
  };

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

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
              <strong><span className="engine-dot" />Engine unavailable</strong>
              <p>QEMU integration is in development. Configurations are saved locally.</p>
            </div>
            <div className="sidebar-foot">AXEVM · BROWSER PROTOTYPE</div>
          </div>
        </aside>
        <div className="main-area">
          <header className="topbar">
            <div className="crumb">Workspace <ChevronRight size={13} /> <span>{navItems.find((item) => item.href === location)?.label ?? 'Not found'}</span></div>
            <div className="topbar-right">
              <span className="system-pill"><span className="engine-dot" />ENGINE NOT CONNECTED</span>
            </div>
          </header>
          <Switch>
            <Route path="/">
              <Dashboard data={data} selectedVm={selectedVm} onSelect={(id) => patch((current) => ({ ...current, selectedVmId: id }))} />
            </Route>
            <Route path="/vms">
              <VMManager data={data} selectedVm={selectedVm} patch={patch} notify={notify} />
            </Route>
            <Route path="/console">
              <ConsolePage selectedVm={selectedVm} />
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

function Dashboard({ data, selectedVm, onSelect }: { data: WorkspaceData; selectedVm: VMConfig | null; onSelect: (id: string) => void }) {
  const [, setLocation] = useLocation();
  return (
    <main className="page-wrap">
      <PageHead eyebrow="AxeVM / Workspace" title="Your virtual machines." subtitle="Define independent ARM64 environments. Configuration is real; guest execution is not available in this browser prototype." />
      <div className="overview-grid">
        <section className="panel hero-panel">
          <div className="hero-kicker"><Activity size={13} /> Configuration workspace</div>
          <h2>Build the machine.<br />Keep execution honest.</h2>
          <p>Create and maintain VM profiles for your Android ARM64 development workflow. Every saved machine is clearly separate from a running guest.</p>
          <div className="hero-actions">
            <Link href="/vms" className="btn btn-primary" data-testid="button-create-vm"><Plus size={15} /> New configuration</Link>
            <Link href="/console" className="btn btn-quiet" data-testid="button-open-console"><Terminal size={14} /> View console</Link>
          </div>
        </section>
        <section className="panel summary-panel">
          <div className="section-overline">Saved configurations</div>
          <div className="metric-number" data-testid="text-vm-count">{data.vms.length.toString().padStart(2, '0')}</div>
          <div className="metric-caption">Locally stored VM profiles</div>
          <div className="metric-rule" />
          <div className="resource-line"><span>Guest architecture</span><strong>AArch64</strong></div>
          <div className="resource-line"><span>Execution engine</span><strong style={{ color: '#a66b29' }}>Unavailable</strong></div>
        </section>
      </div>
      <section className="callout" role="note"><ShieldCheck className="callout-icon" size={16} /><span><strong>Configuration only.</strong> AxeVM does not currently launch QEMU, start a guest OS, or generate console output. Start, stop, and restart are intentionally unavailable.</span></section>
      <div className="section-heading"><h2>Recent configurations</h2><Link href="/vms" className="text-link" data-testid="link-all-vms">Manage all <ChevronRight size={13} /></Link></div>
      {data.vms.length === 0 ? (
        <EmptyState icon={<Box size={21} />} title="No configurations yet" description="Start with a named ARM64 machine profile. You can edit its resources and boot-image reference at any time." action={<Link href="/vms" className="btn btn-primary" data-testid="button-empty-create"><Plus size={14} /> Create a VM configuration</Link>} />
      ) : (
        <div className="vm-list">
          {data.vms.slice(0, 5).map((vm) => <VMRow key={vm.id} vm={vm} selected={selectedVm?.id === vm.id} onSelect={() => { onSelect(vm.id); setLocation('/console'); }} />)}
        </div>
      )}
    </main>
  );
}

function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function VMRow({ vm, selected, onSelect }: { vm: VMConfig; selected: boolean; onSelect: () => void }) {
  return (
    <div className="vm-row" data-testid={`row-vm-${vm.id}`}>
      <div className="vm-ident"><div className="vm-glyph"><Cpu size={17} /></div><div style={{ minWidth: 0 }}><button className="vm-name" onClick={onSelect} data-testid={`button-select-vm-${vm.id}`}>{vm.name}</button><div className="vm-id">{selected ? 'SELECTED · ' : ''}{vm.id.slice(0, 8).toUpperCase()}</div></div></div>
      <div className="vm-spec">{vm.ramMiB.toLocaleString()} MiB RAM</div>
      <div className="vm-spec">{vm.vcpuCount} vCPU · {vm.diskGiB} GiB disk</div>
      <div className="vm-actions"><span className="state-tag">Saved config</span></div>
    </div>
  );
}

type VMFormValues = { name: string; ramMiB: string; diskGiB: string; vcpuCount: string; diskAssetId: string; bootImageId: string };
const blankForm = (preferences: Preferences): VMFormValues => ({
  name: '',
  ramMiB: String(preferences.defaultRamMiB),
  diskGiB: String(preferences.defaultDiskGiB),
  vcpuCount: String(ARM64_HARDWARE_DEFAULTS.vcpuCount),
  diskAssetId: '',
  bootImageId: '',
});

function VMManager({ data, selectedVm, patch, notify }: { data: WorkspaceData; selectedVm: VMConfig | null; patch: (updater: (current: WorkspaceData) => WorkspaceData) => boolean; notify: ToastFn }) {
  const [editing, setEditing] = useState<VMConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<VMFormValues>(() => blankForm(data.preferences));
  const [deleteTarget, setDeleteTarget] = useState<VMConfig | null>(null);
  const [query, setQuery] = useState('');
  const filtered = data.vms.filter((vm) => vm.name.toLowerCase().includes(query.toLowerCase()));

  const beginCreate = () => { setEditing(null); setForm(blankForm(data.preferences)); setCreating(true); };
  const beginEdit = (vm: VMConfig) => {
    patch((current) => ({ ...current, selectedVmId: vm.id }));
    setEditing(vm);
    setForm({
      name: vm.name,
      ramMiB: String(vm.ramMiB),
      diskGiB: String(vm.diskGiB),
      vcpuCount: String(vm.vcpuCount),
      diskAssetId: vm.diskAssetId ?? '',
      bootImageId: vm.bootImageId ?? '',
    });
    setCreating(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const ramMiB = Number(form.ramMiB);
    const diskGiB = Number(form.diskGiB);
    const vcpuCount = Number(form.vcpuCount);
    if (!name || !Number.isInteger(ramMiB) || ramMiB < 256 || !Number.isInteger(diskGiB) || diskGiB < 1 || !Number.isInteger(vcpuCount) || vcpuCount < 1 || vcpuCount > 64) {
      notify('Enter a name, valid memory and disk sizes, and 1–64 virtual CPUs.');
      return;
    }
    if (data.vms.some((vm) => vm.name.toLowerCase() === name.toLowerCase() && vm.id !== editing?.id)) {
      notify('A VM configuration with that name already exists.');
      return;
    }
    const now = new Date().toISOString();
    if (editing) {
      const updated: VMConfig = {
        ...editing,
        name,
        architecture: ARM64_HARDWARE_DEFAULTS.architecture,
        ramMiB,
        diskGiB,
        machineType: ARM64_HARDWARE_DEFAULTS.machineType,
        cpuModel: ARM64_HARDWARE_DEFAULTS.cpuModel,
        vcpuCount,
        diskAssetId: form.diskAssetId || undefined,
        bootImageId: form.bootImageId || undefined,
        updatedAt: now,
      };
      if (!patch((current) => ({ ...current, vms: current.vms.map((vm) => vm.id === editing.id ? updated : vm), selectedVmId: updated.id }))) return;
      notify('Configuration updated and saved locally.');
    } else {
      const created: VMConfig = {
        id: createId(),
        name,
        architecture: ARM64_HARDWARE_DEFAULTS.architecture,
        ramMiB,
        diskGiB,
        machineType: ARM64_HARDWARE_DEFAULTS.machineType,
        cpuModel: ARM64_HARDWARE_DEFAULTS.cpuModel,
        vcpuCount,
        diskAssetId: form.diskAssetId || undefined,
        bootImageId: form.bootImageId || undefined,
        createdAt: now,
        updatedAt: now,
      };
      if (!patch((current) => ({ ...current, vms: [created, ...current.vms], selectedVmId: created.id }))) return;
      notify('VM configuration created and saved locally.');
    }
    setCreating(false);
  };
  const deleteVm = (target: VMConfig) => {
    const saved = patch((current) => {
      const vms = current.vms.filter((vm) => vm.id !== target.id);
      return { ...current, vms, selectedVmId: current.selectedVmId === target.id ? (vms[0]?.id ?? null) : current.selectedVmId };
    });
    if (!saved) return;
    notify(`Removed “${target.name}”.`);
    setDeleteTarget(null);
  };
  const remove = () => { if (deleteTarget) deleteVm(deleteTarget); };
  const cancelForm = () => { setCreating(false); setEditing(null); };

  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Virtual machines" title={creating ? (editing ? 'Edit configuration' : 'New configuration') : 'Virtual machines'} subtitle={creating ? 'Define the saved parameters for an independent ARM64 guest. These values do not start or emulate an operating system.' : 'Manage saved machine profiles. Selecting a profile changes the inspection target, not its execution state.'}>
        {!creating && <button className="btn btn-primary" onClick={beginCreate} data-testid="button-new-vm"><Plus size={15} /> New VM</button>}
      </PageHead>
      {creating ? (
        <div className="split-layout">
          <form className="panel form-panel" onSubmit={save}>
            <div className="form-grid">
              <div className="field full"><label htmlFor="vm-name">Configuration name</label><input id="vm-name" className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. AOSP bring-up" autoFocus maxLength={64} required data-testid="input-vm-name" /><span className="field-help">A descriptive label for your saved machine profile.</span></div>
              <div className="field"><label htmlFor="vm-arch">Guest architecture</label><input id="vm-arch" className="input mono" value="AArch64" readOnly aria-readonly="true" data-testid="input-vm-architecture" /><span className="field-help">ARM64 guest architecture configured; not an emulation claim.</span></div>
              <div className="field"><label htmlFor="vm-machine">Machine type</label><input id="vm-machine" className="input mono" value={ARM64_HARDWARE_DEFAULTS.machineType} readOnly aria-readonly="true" data-testid="input-vm-machine" /><span className="field-help">QEMU's generic ARM virtual platform; this is configuration only.</span></div>
              <div className="field"><label htmlFor="vm-cpu-model">CPU model</label><input id="vm-cpu-model" className="input mono" value={ARM64_HARDWARE_DEFAULTS.cpuModel} readOnly aria-readonly="true" data-testid="input-vm-cpu-model" /><span className="field-help">Generic ARM CPU profile for the planned QEMU engine.</span></div>
              <div className="field"><label htmlFor="vm-vcpus">Virtual CPU cores</label><input id="vm-vcpus" className="input mono" type="number" min="1" max="64" step="1" value={form.vcpuCount} onChange={(event) => setForm({ ...form, vcpuCount: event.target.value })} required data-testid="input-vm-vcpus" /><span className="field-help">Configured guest vCPU count; runtime limits are not checked yet.</span></div>
              <div className="field"><label htmlFor="vm-ram">Memory (MiB)</label><input id="vm-ram" className="input mono" type="number" min="256" max="1048576" step="256" value={form.ramMiB} onChange={(event) => setForm({ ...form, ramMiB: event.target.value })} required data-testid="input-vm-ram" /></div>
              <div className="field"><label htmlFor="vm-disk">Virtual disk capacity (GiB)</label><input id="vm-disk" className="input mono" type="number" min="1" max="4096" step="1" value={form.diskGiB} onChange={(event) => setForm({ ...form, diskGiB: event.target.value })} required data-testid="input-vm-disk" /></div>
              <div className="field full"><label htmlFor="vm-disk-image">Virtual disk image <span style={{ color: '#858982', fontWeight: 500 }}>(optional)</span></label><select id="vm-disk-image" className="select" value={form.diskAssetId} onChange={(event) => setForm({ ...form, diskAssetId: event.target.value })} data-testid="select-vm-disk-image"><option value="">No disk image linked</option>{data.assets.filter((asset) => asset.kind === 'Virtual disk').map((asset) => <option value={asset.id} key={asset.id}>{asset.name}{asset.storageStatus === 'reference-only' ? ' · metadata only' : ''}</option>)}</select><span className="field-help">Links an imported disk file; capacity above is configuration and does not create a disk.</span></div>
              <div className="field full"><label htmlFor="vm-boot-image">Boot image reference <span style={{ color: '#858982', fontWeight: 500 }}>(optional)</span></label><select id="vm-boot-image" className="select" value={form.bootImageId} onChange={(event) => setForm({ ...form, bootImageId: event.target.value })} data-testid="select-vm-boot-image"><option value="">No image linked</option>{data.assets.filter((asset) => asset.kind === 'Boot image').map((asset) => <option value={asset.id} key={asset.id}>{asset.name}{asset.storageStatus === 'reference-only' ? ' · metadata only' : ''}</option>)}</select><span className="field-help">Links a boot asset; no image is inspected or booted in this iteration.</span></div>
            </div>
            {editing && (editing.legacyMachineType || editing.legacyArchitecture || editing.legacyCpuModel) && <div className="callout" role="note" style={{ marginTop: 16 }}><AlertTriangle className="callout-icon" size={16} /><span>Legacy hardware settings were normalized to the ARM64 profile. Original values are retained in the saved configuration{editing.legacyMachineType ? ` (machine: ${editing.legacyMachineType})` : ''}{editing.legacyArchitecture ? ` (architecture: ${editing.legacyArchitecture})` : ''}{editing.legacyCpuModel ? ` (CPU: ${editing.legacyCpuModel})` : ''}.</span></div>}
            <div className="form-actions"><button type="button" className="btn btn-quiet" onClick={cancelForm} data-testid="button-cancel-vm"><ArrowLeft size={14} /> Cancel</button><button type="submit" className="btn btn-primary" data-testid="button-save-vm"><Save size={14} /> Save configuration</button></div>
          </form>
          <div className="detail-stack">
            <section className="panel detail-card"><h3>What this saves</h3><div className="detail-pair"><span>Architecture</span><strong>AArch64</strong></div><div className="detail-pair"><span>Memory & disk</span><strong>Profile values</strong></div><div className="detail-pair"><span>Execution</span><strong>Not available</strong></div></section>
            <div className="callout"><AlertTriangle className="callout-icon" size={16} /><span>This milestone stores configuration in browser storage. It does not include QEMU, native Android integration, or guest execution.</span></div>
          </div>
        </div>
      ) : (
        <>
          <div className="storage-toolbar">
            <div className="tabs" aria-label="VM views"><button className="tab" aria-selected="true">All configurations <span className="mono">({data.vms.length})</span></button></div>
            {data.vms.length > 0 && <input aria-label="Search configurations" className="input" style={{ maxWidth: 240 }} placeholder="Filter by name" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-vm-search" />}
          </div>
          {filtered.length === 0 ? <EmptyState icon={<Box size={21} />} title={data.vms.length ? 'No matching configurations' : 'Your machine list is empty'} description={data.vms.length ? 'Try a different name or clear the filter.' : 'Create an ARM64 configuration to get started. It will be stored in this browser.'} action={!data.vms.length ? <button className="btn btn-primary" onClick={beginCreate} data-testid="button-vm-empty-create"><Plus size={14} /> Create configuration</button> : undefined} /> :
            <div className={`vm-list ${data.preferences.compactRows ? 'compact' : ''}`}>{filtered.map((vm) => <div key={vm.id} className="vm-row" data-testid={`row-managed-vm-${vm.id}`}>
              <div className="vm-ident"><div className="vm-glyph"><Cpu size={17} /></div><div style={{ minWidth: 0 }}><button className="vm-name" onClick={() => patch((current) => ({ ...current, selectedVmId: vm.id }))} data-testid={`button-set-selected-${vm.id}`}>{vm.name}</button><div className="vm-id">{vm.id.slice(0, 8).toUpperCase()} · AArch64 · {vm.machineType}/{vm.cpuModel}</div></div></div>
              <div className="vm-spec">{vm.ramMiB.toLocaleString()} MiB RAM</div><div className="vm-spec">{vm.vcpuCount} vCPU · {vm.diskGiB} GiB disk</div>
              <div className="vm-actions"><button className="icon-btn" aria-label={`Edit ${vm.name}`} title="Edit configuration" onClick={() => beginEdit(vm)} data-testid={`button-edit-vm-${vm.id}`}><SlidersHorizontal size={14} /></button><button className="icon-btn" aria-label={`Delete ${vm.name}`} title="Delete configuration" onClick={() => data.preferences.confirmDelete ? setDeleteTarget(vm) : deleteVm(vm)} data-testid={`button-delete-vm-${vm.id}`}><Trash2 size={14} /></button></div>
            </div>)}</div>}
          {selectedVm && <div className="section-heading"><h2>Selected profile</h2><Link href="/console" className="text-link" data-testid="link-selected-console">Inspect console state <ChevronRight size={13} /></Link></div>}
        </>
      )}
      {deleteTarget && <Modal title="Delete configuration?" description={`“${deleteTarget.name}” will be removed from this browser's saved workspace. This does not affect any external disk or image file.`} onClose={() => setDeleteTarget(null)}><button className="btn btn-quiet" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">Keep configuration</button><button className="btn btn-danger" onClick={remove} data-testid="button-confirm-delete"><Trash2 size={14} /> Delete</button></Modal>}
    </main>
  );
}

function Modal({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="icon-btn" style={{ float: 'right' }} aria-label="Close dialog" onClick={onClose}><X size={15} /></button><h2 id="modal-title">{title}</h2><p>{description}</p><div className="modal-actions">{children}</div></section></div>;
}

function ConsolePage({ selectedVm }: { selectedVm: VMConfig | null }) {
  const engine = unavailableEngine.getAvailability();
  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Console" title="Console state" subtitle="A truthful view of the selected VM's execution availability. This prototype does not connect to a guest console." />
      <div className="callout" style={{ marginBottom: 20 }}><AlertTriangle className="callout-icon" size={16} /><span><strong>QEMU integration in development.</strong> Start, stop, and restart controls are disabled. No boot log or guest command prompt is simulated.</span></div>
      <div className="console-box" aria-label="Console availability panel">
        <div className="console-top"><span>AXEVM CONSOLE · {selectedVm ? selectedVm.name.toUpperCase() : 'NO VM SELECTED'}</span><span><span className="engine-dot" /> UNAVAILABLE</span></div>
        <div className="console-empty"><Terminal size={26} /><h3>{selectedVm ? 'No guest session' : 'Select a VM configuration'}</h3><p>{selectedVm ? `“${selectedVm.name}” is a saved configuration only. There is no process, boot output, or interactive console in this browser milestone.` : 'Choose a saved configuration before inspecting its console state. Selecting a VM will not launch it.'}</p>{!selectedVm && <Link href="/vms" className="btn btn-quiet" style={{ marginTop: 17, color: '#eee9dd', borderColor: '#5a6262' }} data-testid="link-console-select-vm">Choose configuration <ChevronRight size={14} /></Link>}<div className="console-warning">EXECUTION IS NOT IMPLEMENTED</div></div>
      </div>
      <section className="console-input-section" aria-label="Guest keyboard input">
        <label htmlFor="guest-input">Guest keyboard input</label>
        <div className="console-input-control">
          <input id="guest-input" className="input mono" disabled placeholder="Unavailable until QEMU integration" aria-describedby="guest-input-help" data-testid="input-guest-keyboard" />
          <button className="btn btn-quiet" disabled aria-label="Send guest input" data-testid="button-send-guest-input">Send</button>
        </div>
        <p id="guest-input-help" className="field-help">Keyboard input is unavailable because no guest process is running.</p>
      </section>
      <div className="section-heading"><h2>Execution controls</h2><span className="state-tag">Unavailable</span></div>
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled title={engine.message} data-testid="button-start-vm"><Zap size={14} /> Start VM</button>
        <button className="btn btn-quiet" disabled title={engine.message} data-testid="button-stop-vm"><X size={14} /> Stop</button>
        <button className="btn btn-quiet" disabled title={engine.message} data-testid="button-restart-vm"><Activity size={14} /> Restart</button>
      </div>
      <p className="field-help" style={{ marginTop: 12 }}>{engine.message}</p>
    </main>
  );
}

function StoragePage({ data, patch, notify }: { data: WorkspaceData; patch: (updater: (current: WorkspaceData) => WorkspaceData) => boolean; notify: ToastFn }) {
  const [kind, setKind] = useState<'All files' | 'Virtual disk' | 'Boot image'>('All files');
  const [importKind, setImportKind] = useState<AssetKind>('Virtual disk');
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

    const saved = patch((current) => ({ ...current, assets: [...assets, ...current.assets] }));
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
  const removeAsset = async (asset: AssetRecord) => {
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

    const saved = patch((current) => ({
      ...current,
      assets: current.assets.filter((item) => item.id !== asset.id),
      vms: current.vms.map((vm) => vm.bootImageId === asset.id || vm.diskAssetId === asset.id
        ? { ...vm, bootImageId: vm.bootImageId === asset.id ? undefined : vm.bootImageId, diskAssetId: vm.diskAssetId === asset.id ? undefined : vm.diskAssetId, updatedAt: new Date().toISOString() }
        : vm),
    }));
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
      return;
    }
    notify(`Removed “${asset.name}”.`);
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-quiet" onClick={() => workspaceStorage.exportManifest(data)} data-testid="button-export-manifest"><ArrowDownToLine size={14} /> Export manifest</button>
          <select className="select" value={importKind} onChange={(event) => setImportKind(event.target.value as AssetKind)} aria-label="Asset type to import" data-testid="select-import-asset-kind"><option value="Virtual disk">Virtual disk</option><option value="Boot image">Boot image</option></select>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()} data-testid="button-import-files"><Upload size={14} /> Import files</button>
          <input ref={inputRef} type="file" multiple hidden accept={importKind === 'Virtual disk' ? '.qcow,.qcow2,.raw,.img,.vhd,.vhdx' : '.img,.iso,.elf,.dtb,.bin,.gz,.xz'} onChange={importFiles} data-testid="input-import-files" aria-label={`Choose ${importKind.toLowerCase()} files`} />
        </div>
      </PageHead>
      <div className="callout"><FileArchive className="callout-icon" size={16} /><span>New binary assets are stored in this browser's IndexedDB; workspace metadata is saved separately. Export manifest backs up metadata only. Use each asset's download control to export its file bytes.</span></div>
      <div className="storage-toolbar">
        <div className="tabs" role="tablist" aria-label="Filter assets">
          {(['All files', 'Virtual disk', 'Boot image'] as const).map((option) => <button key={option} role="tab" aria-selected={kind === option} className="tab" onClick={() => setKind(option)} data-testid={`tab-storage-${option.toLowerCase().replace(' ', '-')}`}>{option} <span className="mono">({option === 'All files' ? data.assets.length : data.assets.filter((asset) => asset.kind === option).length})</span></button>)}
        </div>
      </div>
      {filtered.length === 0 ? <EmptyState icon={<HardDrive size={21} />} title={data.assets.length ? 'No files in this category' : 'No stored assets'} description={data.assets.length ? 'Import a disk or boot asset to add it to this category.' : 'Choose an asset type, then import a file. The browser stores its bytes locally in IndexedDB.'} action={<button className="btn btn-primary" onClick={() => inputRef.current?.click()} data-testid="button-empty-import"><Upload size={14} /> Import files</button>} /> :
        <section className="panel" aria-label="Stored assets">
          {filtered.map((asset) => <div className="asset-row" key={asset.id} data-testid={`row-asset-${asset.id}`}>
            <div className="vm-ident"><div className="vm-glyph">{asset.kind === 'Boot image' ? <FileImage size={16} /> : <HardDrive size={16} />}</div><div style={{ minWidth: 0 }}><div className="vm-name" title={asset.name}>{asset.name}</div><div className="vm-id">{asset.id.slice(0, 8).toUpperCase()} · ADDED {timeLabel(asset.addedAt).toUpperCase()}</div></div></div>
            <div className="asset-kind">{asset.kind}</div><div className="asset-size">{formatBytes(asset.sizeBytes)} · {asset.storageStatus === 'indexeddb' ? 'binary stored' : 'legacy metadata only'}</div>
            <div className="vm-actions">{asset.storageStatus === 'indexeddb' && <button className="icon-btn" aria-label={`Download ${asset.name}`} title="Download file" onClick={() => void downloadAsset(asset)} data-testid={`button-download-asset-${asset.id}`}><Download size={14} /></button>}<button className="icon-btn" aria-label={`Remove ${asset.name}`} title="Remove asset" onClick={() => void removeAsset(asset)} data-testid={`button-remove-asset-${asset.id}`}><Trash2 size={14} /></button></div>
          </div>)}
        </section>}
      <div className="section-heading"><h2>About file references</h2></div>
      <div className="notice">Older workspace entries may be metadata-only references because the previous build did not store their file contents. New imports persist the actual bytes in this browser's IndexedDB. Storage is not synced; browser storage quotas apply. The manifest export contains configuration and asset metadata, not binary data.</div>
    </main>
  );
}

function SettingsPage({ preferences, onChange }: { preferences: Preferences; onChange: (preferences: Preferences) => void }) {
  const [, setLocation] = useLocation();
  const setPref = <K extends keyof Preferences,>(key: K, value: Preferences[K]) => onChange({ ...preferences, [key]: value });
  return (
    <main className="page-wrap">
      <PageHead eyebrow="Workspace / Settings" title="Preferences" subtitle="Set defaults for new VM configurations and choose how the browser workspace behaves." />
      <div className="section-heading" style={{ marginTop: 0 }}><h2>New configuration defaults</h2><span className="section-overline">APPLIED TO NEW VMS</span></div>
      <div className="settings-list">
        <section className="panel setting-row"><div><h3>Default memory</h3><p>Suggested RAM allocation for newly created VM profiles.</p></div><div className="setting-control"><select className="select mono" value={preferences.defaultRamMiB} onChange={(event) => setPref('defaultRamMiB', Number(event.target.value))} aria-label="Default memory" data-testid="select-default-ram"><option value={2048}>2,048 MiB</option><option value={4096}>4,096 MiB</option><option value={8192}>8,192 MiB</option><option value={16384}>16,384 MiB</option></select></div></section>
        <section className="panel setting-row"><div><h3>Default virtual disk</h3><p>Configured capacity for newly created VM profiles. This does not allocate a disk file.</p></div><div className="setting-control"><select className="select mono" value={preferences.defaultDiskGiB} onChange={(event) => setPref('defaultDiskGiB', Number(event.target.value))} aria-label="Default virtual disk" data-testid="select-default-disk"><option value={16}>16 GiB</option><option value={32}>32 GiB</option><option value={64}>64 GiB</option><option value={128}>128 GiB</option></select></div></section>
      </div>
      <div className="section-heading"><h2>Workspace behavior</h2></div>
      <div className="settings-list">
        <section className="panel setting-row"><div><h3>Confirm before deleting</h3><p>Show a confirmation step before removing saved VM profiles.</p></div><button className="toggle" role="switch" aria-checked={preferences.confirmDelete} aria-label="Confirm before deleting" onClick={() => setPref('confirmDelete', !preferences.confirmDelete)} data-testid="switch-confirm-delete" /></section>
        <section className="panel setting-row"><div><h3>Compact VM list</h3><p>Preference saved for a future denser list presentation.</p></div><button className="toggle" role="switch" aria-checked={preferences.compactRows} aria-label="Compact VM list" onClick={() => setPref('compactRows', !preferences.compactRows)} data-testid="switch-compact-rows" /></section>
      </div>
      <div className="section-heading"><h2>Application</h2></div>
       <div className="panel setting-row"><div><h3>Persistence</h3><p>VM configurations and preferences use browser local storage; imported asset bytes use IndexedDB on this device.</p></div><span className="state-tag"><Check size={12} /> Local</span></div>
      <div className="panel setting-row" style={{ marginTop: 10 }}><div><h3>Execution engine</h3><p>QEMU, Android native integration, JNI, and guest execution are outside this browser milestone.</p></div><span className="state-tag">In development</span></div>
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

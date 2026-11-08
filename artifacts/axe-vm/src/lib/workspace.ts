export const WORKSPACE_SCHEMA_VERSION = 2 as const;
export const ARM64_HARDWARE_DEFAULTS = {
  architecture: 'aarch64',
  machineType: 'virt',
  cpuModel: 'max',
  vcpuCount: 2,
} as const;

export type GuestArchitecture = typeof ARM64_HARDWARE_DEFAULTS.architecture;
export type Arm64MachineType = typeof ARM64_HARDWARE_DEFAULTS.machineType;
export type CpuModel = typeof ARM64_HARDWARE_DEFAULTS.cpuModel;
export type AssetKind = 'Virtual disk' | 'Boot image';
export type AssetStorageStatus = 'indexeddb' | 'reference-only';

export type VMConfig = {
  id: string;
  name: string;
  architecture: GuestArchitecture;
  ramMiB: number;
  diskGiB: number;
  machineType: Arm64MachineType;
  cpuModel: CpuModel;
  vcpuCount: number;
  diskAssetId?: string;
  bootImageId?: string;
  /** Original values retained when a pre-v2 ARM profile is normalized. */
  legacyArchitecture?: string;
  legacyMachineType?: string;
  legacyCpuModel?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetRecord = {
  id: string;
  name: string;
  kind: AssetKind;
  sizeBytes: number;
  mimeType: string;
  addedAt: string;
  /** Old v1 entries contain metadata only; newly imported files use IndexedDB. */
  storageStatus: AssetStorageStatus;
};

export type Preferences = {
  defaultRamMiB: number;
  defaultDiskGiB: number;
  confirmDelete: boolean;
  compactRows: boolean;
};

export type WorkspaceData = {
  vms: VMConfig[];
  assets: AssetRecord[];
  preferences: Preferences;
  selectedVmId: string | null;
};

const STORAGE_KEY = 'axevm.workspace.v1';
export const DEFAULT_PREFERENCES: Preferences = {
  defaultRamMiB: 4096,
  defaultDiskGiB: 32,
  confirmDelete: true,
  compactRows: false,
};

const emptyWorkspace = (): WorkspaceData => ({
  vms: [],
  assets: [],
  preferences: DEFAULT_PREFERENCES,
  selectedVmId: null,
});

export type WorkspaceLoadResult = {
  data: WorkspaceData;
  error: string | null;
  /** Invalid/unreadable source data must never be overwritten automatically. */
  persistenceBlocked: boolean;
  migrated: boolean;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Saved ${label} is missing or invalid.`);
  }
  return value;
}

function safeDate(value: unknown, fallback: string): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return fallback;
}

function requiredInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`Saved ${label} is invalid.`);
  }
  return value;
}

function normalizeVm(value: unknown, index: number): VMConfig {
  if (!isRecord(value)) throw new Error(`Saved VM ${index + 1} is invalid.`);

  const now = new Date().toISOString();
  const rawArchitecture = typeof value.architecture === 'string' ? value.architecture : 'AArch64';
  const rawMachineType = typeof value.machineType === 'string' ? value.machineType : 'virt';
  const rawCpuModel = typeof value.cpuModel === 'string' ? value.cpuModel : 'max';
  const architectureWasLegacy = !['aarch64', 'arm64'].includes(rawArchitecture.toLowerCase());
  const vcpuCount = value.vcpuCount === undefined
    ? ARM64_HARDWARE_DEFAULTS.vcpuCount
    : requiredInteger(value.vcpuCount, `VM ${index + 1} vCPU count`, 1);
  if (vcpuCount > 64) throw new Error(`Saved VM ${index + 1} has more than 64 vCPUs.`);

  return {
    id: requiredString(value.id, `VM ${index + 1} id`),
    name: requiredString(value.name, `VM ${index + 1} name`),
    architecture: ARM64_HARDWARE_DEFAULTS.architecture,
    ramMiB: requiredInteger(value.ramMiB, `VM ${index + 1} RAM allocation`, 256),
    diskGiB: requiredInteger(value.diskGiB, `VM ${index + 1} disk capacity`, 1),
    machineType: ARM64_HARDWARE_DEFAULTS.machineType,
    cpuModel: ARM64_HARDWARE_DEFAULTS.cpuModel,
    vcpuCount,
    diskAssetId: typeof value.diskAssetId === 'string' ? value.diskAssetId : undefined,
    bootImageId: typeof value.bootImageId === 'string' ? value.bootImageId : undefined,
    legacyArchitecture: typeof value.legacyArchitecture === 'string'
      ? value.legacyArchitecture
      : architectureWasLegacy ? rawArchitecture : undefined,
    legacyMachineType: typeof value.legacyMachineType === 'string'
      ? value.legacyMachineType
      : rawMachineType === ARM64_HARDWARE_DEFAULTS.machineType ? undefined : rawMachineType,
    legacyCpuModel: typeof value.legacyCpuModel === 'string'
      ? value.legacyCpuModel
      : rawCpuModel === ARM64_HARDWARE_DEFAULTS.cpuModel ? undefined : rawCpuModel,
    createdAt: safeDate(value.createdAt, now),
    updatedAt: safeDate(value.updatedAt, now),
  };
}

function normalizeAsset(value: unknown, index: number): AssetRecord {
  if (!isRecord(value)) throw new Error(`Saved asset ${index + 1} is invalid.`);
  const kind = value.kind;
  if (kind !== 'Virtual disk' && kind !== 'Boot image') {
    throw new Error(`Saved asset ${index + 1} has an unknown type.`);
  }

  const sizeBytes = value.sizeBytes === undefined && value.storageStatus === undefined
    ? 0
    : value.sizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error(`Saved asset ${index + 1} has an invalid size.`);
  }

  return {
    id: requiredString(value.id, `asset ${index + 1} id`),
    name: requiredString(value.name, `asset ${index + 1} name`),
    kind,
    sizeBytes,
    mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'application/octet-stream',
    addedAt: safeDate(value.addedAt, new Date().toISOString()),
    storageStatus: value.storageStatus === 'indexeddb' ? 'indexeddb' : 'reference-only',
  };
}

function normalizePreferences(value: unknown): Preferences {
  const raw = isRecord(value) ? value : {};
  return {
    defaultRamMiB: typeof raw.defaultRamMiB === 'number' && Number.isInteger(raw.defaultRamMiB) && raw.defaultRamMiB >= 256
      ? raw.defaultRamMiB
      : DEFAULT_PREFERENCES.defaultRamMiB,
    defaultDiskGiB: typeof raw.defaultDiskGiB === 'number' && Number.isInteger(raw.defaultDiskGiB) && raw.defaultDiskGiB >= 1
      ? raw.defaultDiskGiB
      : DEFAULT_PREFERENCES.defaultDiskGiB,
    confirmDelete: typeof raw.confirmDelete === 'boolean' ? raw.confirmDelete : DEFAULT_PREFERENCES.confirmDelete,
    compactRows: typeof raw.compactRows === 'boolean' ? raw.compactRows : DEFAULT_PREFERENCES.compactRows,
  };
}

/** Normalizes both the original v1 localStorage shape and the current schema. */
export function normalizePersistedWorkspace(value: unknown): WorkspaceData {
  if (!isRecord(value)) throw new Error('Saved workspace must be a JSON object.');
  if (!Array.isArray(value.vms)) throw new Error('Saved VM list is invalid.');
  if (!Array.isArray(value.assets)) throw new Error('Saved asset list is invalid.');

  const vms = value.vms.map(normalizeVm);
  const assets = value.assets.map(normalizeAsset);
  const vmIds = new Set(vms.map((vm) => vm.id));

  return {
    vms,
    assets,
    preferences: normalizePreferences(value.preferences),
    selectedVmId: typeof value.selectedVmId === 'string' && vmIds.has(value.selectedVmId)
      ? value.selectedVmId
      : null,
  };
}

function serializeWorkspace(data: WorkspaceData): string {
  return JSON.stringify({ schemaVersion: WORKSPACE_SCHEMA_VERSION, ...data });
}

/** Configuration persistence boundary; native Android storage can replace this adapter. */
export const workspaceStorage = {
  load(): WorkspaceLoadResult {
    let raw: string | null;
    let parsed: unknown;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { data: emptyWorkspace(), error: null, persistenceBlocked: false, migrated: false };
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Browser storage is unavailable.';
      return {
        data: emptyWorkspace(),
        error: `Saved workspace could not be read (${detail}). Existing browser data will not be overwritten.`,
        persistenceBlocked: true,
        migrated: false,
      };
    }

    try {
      if (!isRecord(parsed)) throw new Error('The saved workspace has an unsupported format.');
      const sourceVersion = parsed.schemaVersion === undefined ? 1 : parsed.schemaVersion;
      if (typeof sourceVersion !== 'number' || sourceVersion < 1 || sourceVersion > WORKSPACE_SCHEMA_VERSION) {
        throw new Error(`Workspace schema version ${String(sourceVersion)} is not supported.`);
      }

      const data = normalizePersistedWorkspace(parsed);
      const migrated = sourceVersion < WORKSPACE_SCHEMA_VERSION;
      if (migrated) {
        try {
          localStorage.setItem(STORAGE_KEY, serializeWorkspace(data));
        } catch {
          return {
            data,
            error: 'Existing VM profiles were loaded, but their upgraded format could not be saved. Changes may not persist.',
            persistenceBlocked: false,
            migrated: true,
          };
        }
      }
      return { data, error: null, persistenceBlocked: false, migrated };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Saved workspace data is invalid.';
      return {
        data: emptyWorkspace(),
        error: `${detail} Existing browser data has been preserved and will not be overwritten.`,
        persistenceBlocked: true,
        migrated: false,
      };
    }
  },
  save(data: WorkspaceData): void {
    localStorage.setItem(STORAGE_KEY, serializeWorkspace(data));
  },
  exportManifest(data: WorkspaceData): void {
    const blob = new Blob([JSON.stringify({
      format: 'axevm-workspace',
      version: WORKSPACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      ...data,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'axevm-workspace.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

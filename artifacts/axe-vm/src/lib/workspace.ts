export type VMConfig = {
  id: string;
  name: string;
  architecture: 'AArch64';
  ramMiB: number;
  diskGiB: number;
  machineType: string;
  bootImageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetRecord = {
  id: string;
  name: string;
  kind: 'Virtual disk' | 'Boot image';
  sizeBytes: number;
  mimeType: string;
  addedAt: string;
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
};

/** Persistence boundary: swap this implementation for a native bridge later. */
export const workspaceStorage = {
  load(): WorkspaceLoadResult {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { data: emptyWorkspace(), error: null };
      const parsed = JSON.parse(raw) as Partial<WorkspaceData>;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.vms) || !Array.isArray(parsed.assets)) {
        throw new Error('The saved workspace has an unsupported format.');
      }
      return {
        data: {
          vms: parsed.vms,
          assets: parsed.assets,
          preferences: { ...DEFAULT_PREFERENCES, ...parsed.preferences },
          selectedVmId: typeof parsed.selectedVmId === 'string' ? parsed.selectedVmId : null,
        },
        error: null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Browser storage is unavailable.';
      return {
        data: emptyWorkspace(),
        error: `Saved workspace could not be read (${detail}). Existing browser data will not be overwritten; changes in this session may not persist.`,
      };
    }
  },
  save(data: WorkspaceData): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
  exportManifest(data: WorkspaceData): void {
    const blob = new Blob([JSON.stringify({ format: 'axevm-workspace', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'axevm-workspace.json';
    anchor.click();
    URL.revokeObjectURL(url);
  },
};

export function createId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

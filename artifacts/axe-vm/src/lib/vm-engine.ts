import type {
  Arm64MachineType,
  AssetKind,
  GuestArchitecture,
  VMConfig,
} from './workspace';

export type VMExecutionState =
  | 'preparing'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type EngineAvailability = {
  available: boolean;
  engine: 'qemu' | 'none';
  hostArchitecture: 'aarch64' | 'unknown';
  guestArchitectures: readonly GuestArchitecture[];
  machineTypes: readonly Arm64MachineType[];
  accelerators: readonly ('kvm' | 'tcg')[];
  message: string;
};

export type VMEngineErrorCode =
  | 'engine-unavailable'
  | 'invalid-configuration'
  | 'asset-not-found'
  | 'asset-storage-failed'
  | 'process-not-found'
  | 'launch-failed';

export type VMEngineError = {
  code: VMEngineErrorCode;
  message: string;
};

export type VMEngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VMEngineError };

export type VMEngineSession = {
  id: string;
  vmId: string;
  state: VMExecutionState;
};

export type ResolvedVMAsset = {
  id: string;
  kind: AssetKind;
  /** Opaque platform-owned file locator; the UI must not interpret it as a path. */
  locator: string;
  sizeBytes: number;
};

export type VMExecutionRequest = {
  config: VMConfig;
  assets: readonly ResolvedVMAsset[];
};

export type VMEngineEvent =
  | { type: 'state'; session: VMEngineSession }
  | { type: 'console-output'; bytes: Uint8Array }
  | { type: 'error'; error: VMEngineError };

export interface VMAssetResolver {
  resolve(id: string, expectedKind: AssetKind): Promise<ResolvedVMAsset | null>;
}

export async function createVMExecutionRequest(
  config: VMConfig,
  resolver: VMAssetResolver,
): Promise<VMEngineResult<VMExecutionRequest>> {
  if (
    config.architecture !== 'aarch64'
    || config.machineType !== 'virt'
    || config.cpuModel !== 'max'
    || !Number.isInteger(config.vcpuCount)
    || config.vcpuCount < 1
    || config.vcpuCount > 64
    || !Number.isInteger(config.ramMiB)
    || config.ramMiB < 256
    || !Number.isInteger(config.diskGiB)
    || config.diskGiB < 1
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid-configuration',
        message: 'The VM configuration is not a valid AArch64 virt machine profile.',
      },
    };
  }

  const assets: ResolvedVMAsset[] = [];
  const references: Array<{ id: string; kind: AssetKind }> = [];
  if (config.diskAssetId) references.push({ id: config.diskAssetId, kind: 'Virtual disk' });
  if (config.bootImageId) references.push({ id: config.bootImageId, kind: 'Boot image' });

  for (const reference of references) {
    let asset: ResolvedVMAsset | null;
    try {
      asset = await resolver.resolve(reference.id, reference.kind);
    } catch {
      return {
        ok: false,
        error: {
          code: 'asset-storage-failed',
          message: `The linked ${reference.kind.toLowerCase()} could not be read from storage.`,
        },
      };
    }
    if (!asset || asset.kind !== reference.kind) {
      return {
        ok: false,
        error: {
          code: 'asset-not-found',
          message: `The linked ${reference.kind.toLowerCase()} could not be resolved.`,
        },
      };
    }
    if (!asset.locator || asset.sizeBytes <= 0) {
      return {
        ok: false,
        error: {
          code: 'asset-not-found',
          message: `The linked ${reference.kind.toLowerCase()} is not a usable stored file.`,
        },
      };
    }
    assets.push(asset);
  }

  return { ok: true, value: { config, assets } };
}

/**
 * Platform-neutral execution contract. A native QEMU adapter can implement
 * this behind JNI without coupling QEMU or Android APIs to the React UI.
 */
export interface VMEngine {
  getAvailability(): EngineAvailability;
  start(request: VMExecutionRequest): Promise<VMEngineResult<VMEngineSession>>;
  stop(sessionId: string): Promise<VMEngineResult<VMEngineSession>>;
  restart(request: VMExecutionRequest, sessionId?: string): Promise<VMEngineResult<VMEngineSession>>;
  sendConsoleInput(sessionId: string, bytes: Uint8Array): Promise<VMEngineResult<void>>;
  subscribe(sessionId: string, listener: (event: VMEngineEvent) => void): () => void;
}

const unavailable = <T>(): VMEngineResult<T> => ({
  ok: false,
  error: {
    code: 'engine-unavailable',
    message: 'Execution is unavailable until the native QEMU ARM64 engine is integrated.',
  },
});

/** Explicitly unavailable adapter; it never reports a VM as started. */
export const unavailableEngine: VMEngine = {
  getAvailability: () => ({
    available: false,
    engine: 'none',
    hostArchitecture: 'unknown',
    guestArchitectures: [],
    machineTypes: [],
    accelerators: [],
    message: 'QEMU integration is in development. This browser prototype only saves VM configuration.',
  }),
  start: async () => unavailable(),
  stop: async () => unavailable(),
  restart: async () => unavailable(),
  sendConsoleInput: async () => unavailable(),
  subscribe: () => () => undefined,
};

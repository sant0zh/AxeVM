import {
  ARM64_HARDWARE_DEFAULTS,
  type AssetRecord,
  type CpuModel,
  type VMConfig,
  type WorkspaceData,
} from './workspace.ts';

export type VMProfileInput = {
  name: string;
  ramMiB: number;
  diskGiB: number;
  vcpuCount: number;
  cpuModel: CpuModel;
  diskAssetId?: string;
  bootImageId?: string;
};

export type VMProfileValidation =
  | { valid: true; value: VMProfileInput }
  | { valid: false; message: string };

export function validateVMProfile(input: VMProfileInput): VMProfileValidation {
  const name = input.name.trim();
  if (!name || name.length > 64) {
    return { valid: false, message: 'Enter a configuration name between 1 and 64 characters.' };
  }
  if (!Number.isInteger(input.ramMiB) || input.ramMiB < 256 || input.ramMiB > 1_048_576) {
    return { valid: false, message: 'Memory must be a whole number between 256 and 1,048,576 MiB.' };
  }
  if (!Number.isInteger(input.diskGiB) || input.diskGiB < 1 || input.diskGiB > 4096) {
    return { valid: false, message: 'Disk capacity must be a whole number between 1 and 4,096 GiB.' };
  }
  if (!Number.isInteger(input.vcpuCount) || input.vcpuCount < 1 || input.vcpuCount > 64) {
    return { valid: false, message: 'Virtual CPU count must be between 1 and 64.' };
  }
  if (input.cpuModel !== 'max' && input.cpuModel !== 'cortex-a72') {
    return { valid: false, message: 'Choose a supported ARM64 CPU profile.' };
  }
  return { valid: true, value: { ...input, name } };
}

export function createVMProfile(
  data: WorkspaceData,
  input: VMProfileInput,
  id: string,
  timestamp: string,
): WorkspaceData {
  const validation = validateVMProfile(input);
  if (!validation.valid) throw new Error(validation.message);
  if (data.vms.some((vm) => vm.name.toLocaleLowerCase() === validation.value.name.toLocaleLowerCase())) {
    throw new Error('A VM configuration with that name already exists.');
  }

  const profile: VMConfig = {
    id,
    name: validation.value.name,
    architecture: ARM64_HARDWARE_DEFAULTS.architecture,
    ramMiB: validation.value.ramMiB,
    diskGiB: validation.value.diskGiB,
    machineType: data.preferences.defaultMachineType,
    cpuModel: validation.value.cpuModel,
    vcpuCount: validation.value.vcpuCount,
    diskAssetId: validation.value.diskAssetId || undefined,
    bootImageId: validation.value.bootImageId || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { ...data, vms: [profile, ...data.vms], selectedVmId: profile.id };
}

export function updateVMProfile(
  data: WorkspaceData,
  vmId: string,
  input: VMProfileInput,
  timestamp: string,
): WorkspaceData {
  const validation = validateVMProfile(input);
  if (!validation.valid) throw new Error(validation.message);
  const current = data.vms.find((vm) => vm.id === vmId);
  if (!current) throw new Error('The VM configuration no longer exists.');
  if (data.vms.some((vm) => vm.id !== vmId && vm.name.toLocaleLowerCase() === validation.value.name.toLocaleLowerCase())) {
    throw new Error('A VM configuration with that name already exists.');
  }

  const updated: VMConfig = {
    ...current,
    name: validation.value.name,
    architecture: ARM64_HARDWARE_DEFAULTS.architecture,
    ramMiB: validation.value.ramMiB,
    diskGiB: validation.value.diskGiB,
    machineType: data.preferences.defaultMachineType,
    cpuModel: validation.value.cpuModel,
    vcpuCount: validation.value.vcpuCount,
    diskAssetId: validation.value.diskAssetId || undefined,
    bootImageId: validation.value.bootImageId || undefined,
    legacyArchitecture: undefined,
    legacyMachineType: undefined,
    legacyCpuModel: undefined,
    updatedAt: timestamp,
  };
  return {
    ...data,
    vms: data.vms.map((vm) => vm.id === vmId ? updated : vm),
    selectedVmId: vmId,
  };
}

export function deleteVMProfile(data: WorkspaceData, vmId: string): WorkspaceData {
  const vms = data.vms.filter((vm) => vm.id !== vmId);
  return {
    ...data,
    vms,
    selectedVmId: data.selectedVmId === vmId ? (vms[0]?.id ?? null) : data.selectedVmId,
  };
}

export function registerAssets(data: WorkspaceData, assets: readonly AssetRecord[]): WorkspaceData {
  const knownIds = new Set(data.assets.map((asset) => asset.id));
  for (const asset of assets) {
    if (knownIds.has(asset.id)) throw new Error(`Asset ID “${asset.id}” is already registered.`);
    if (!asset.name.trim() || !Number.isFinite(asset.sizeBytes) || asset.sizeBytes <= 0) {
      throw new Error(`Asset “${asset.name}” has invalid metadata.`);
    }
    knownIds.add(asset.id);
  }
  return { ...data, assets: [...assets, ...data.assets] };
}

export type RemoveAssetResult = {
  data: WorkspaceData;
  removed: AssetRecord | null;
  affectedVMs: VMConfig[];
};

export function removeAssetFromWorkspace(
  data: WorkspaceData,
  assetId: string,
  timestamp: string,
): RemoveAssetResult {
  const removed = data.assets.find((asset) => asset.id === assetId) ?? null;
  if (!removed) return { data, removed: null, affectedVMs: [] };

  const affectedVMs = data.vms.filter((vm) => vm.diskAssetId === assetId || vm.bootImageId === assetId);
  const nextData: WorkspaceData = {
    ...data,
    assets: data.assets.filter((asset) => asset.id !== assetId),
    vms: data.vms.map((vm) => vm.diskAssetId === assetId || vm.bootImageId === assetId
      ? {
          ...vm,
          diskAssetId: vm.diskAssetId === assetId ? undefined : vm.diskAssetId,
          bootImageId: vm.bootImageId === assetId ? undefined : vm.bootImageId,
          updatedAt: timestamp,
        }
      : vm),
  };
  return { data: nextData, removed, affectedVMs };
}

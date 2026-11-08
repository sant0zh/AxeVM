# AxeVM Architecture

## Iteration 1 implementation

AxeVM remains a React + TypeScript browser prototype. This iteration strengthens the VM data model, persistence, asset storage, and the boundary for a future execution engine; it does not add a native Android app or run QEMU.

### ARM64 virtual hardware profile

New VM profiles use the canonical AArch64 guest architecture, QEMU `virt` machine type, `max` CPU model, and a configurable vCPU count. `Q35` is an x86 machine type and is no longer offered for these profiles. The hardware values are configuration metadata only; they are not proof that a compatible QEMU binary or host accelerator exists.

Legacy profiles stored before schema version 2 are migrated on load. Their RAM, disk size, name, IDs, timestamps, and asset references are retained. `AArch64` is normalized to `aarch64`; unsupported machine and CPU labels are normalized to the ARM64 profile while their original values are retained for review. Missing vCPU counts receive the default of two.

### Workspace and asset persistence

- VM configuration and preferences are serialized as a schema-versioned workspace document in browser local storage.
- Reads validate the stored structure before using it. Malformed data is preserved and is not automatically overwritten. Writes complete before the UI reports a configuration update as saved.
- New asset binaries are stored in IndexedDB; their names, type, size, MIME type, and IDs remain in workspace metadata. The JSON manifest exports metadata only; individual stored files have separate downloads.
- Older asset records migrate as `reference-only`, since earlier builds saved metadata but not file bytes. They remain visible and can be removed, but cannot be downloaded or resolved for execution.
- Browser storage is local to this browser profile and subject to device/browser storage limits; it is not synchronized.

### VM engine boundary

`VMEngine` defines capability reporting, validated execution requests, session IDs/states, typed success/error results, state/console events, and console-input transport. `VMAssetResolver` maps VM configuration asset IDs to opaque platform-owned file locators. The UI does not access QEMU, JNI, or platform paths directly.

The current adapter reports no engine capabilities and returns `engine-unavailable` for every execution request. No QEMU process is launched, and no boot or console output is generated.

## Planned native integration

1. Kotlin + Jetpack Compose provides the target Android UI.
2. Android-native persistence replaces browser local storage and IndexedDB; the document picker imports and exports real disk and boot files.
3. A native QEMU ARM64 adapter implements the VM engine boundary and resolves app-owned files without exposing filesystem paths to the UI.
4. Kotlin communicates with the C/C++ engine through JNI. Real capability probing, session lifecycle, console output, and guest input are wired through the engine contract.
5. AxeOS boot support requires compatible kernel, firmware, and disk/boot assets. Execution must remain unavailable until a real guest can be launched.

## Deferred to Iteration 2

- Full UI redesign
- Functional VM console and guest keyboard interaction
- Lifecycle UI and QEMU wiring
- Comprehensive automated testing and expanded documentation

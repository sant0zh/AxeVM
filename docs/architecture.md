# AxeVM Architecture

## Current milestone

AxeVM's first milestone is a React + TypeScript browser prototype. It demonstrates the user-facing VM management workflow without claiming to be the native Android application or an emulator.

The UI depends on two narrow boundaries:

- **VM configuration repository:** loads, saves, and removes VM configuration independently of presentation. The browser prototype uses browser storage so configurations survive reloads in the same browser profile. This is local to that browser and is not account-synced.
- **VM engine:** exposes execution capabilities independently of VM configuration and UI. The prototype's engine adapter reports that execution is unavailable. No start, stop, restart, guest input, or boot output is simulated.

The configured guest architecture is AArch64. This represents the intended guest configuration; it does not mean that an ARM64 emulator is running.

## Planned native integration

The target application is native Android:

1. Kotlin + Jetpack Compose provides the Android UI.
2. A native configuration repository replaces browser storage. Android's private app storage and document picker should own VM files and imported/exported assets; configuration metadata can be stored with an Android-native persistence layer.
3. The VM engine boundary is implemented by a native QEMU ARM64 engine.
4. Kotlin communicates with the C/C++ engine through a narrow JNI bridge. Engine lifecycle and console events are surfaced through the engine boundary rather than coupled to UI components.
5. AxeOS boot support requires a real compatible kernel and boot assets. Until these are integrated and successfully launched, the app must show execution as unavailable and must not display invented boot messages.

## Constraints

- Configuration CRUD must not depend on QEMU being present.
- UI code must not call QEMU or JNI directly.
- Browser persistence is a prototype convenience, not the native storage design or a shared backup service.
- Console, power controls, and storage actions must communicate their real capabilities; they must not imply guest execution or file persistence that has not occurred.

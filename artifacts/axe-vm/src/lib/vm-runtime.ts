import {
  createVMExecutionRequest,
  type VMAssetResolver,
  type VMEngine,
  type VMEngineError,
  type VMEngineEvent,
  type VMEngineResult,
  type VMEngineSession,
} from './vm-engine.ts';
import type { VMConfig } from './workspace.ts';

export type VMRuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'unavailable';

export type VMRuntimeStatus = {
  vmId: string;
  state: VMRuntimeState;
  sessionId?: string;
  error?: string;
};

export type VMRuntimeSnapshot = Readonly<Record<string, VMRuntimeStatus>>;
export type VMEngineEventListener = (vmId: string, event: VMEngineEvent) => void;
type RuntimeListener = () => void;
type Operation = 'start' | 'stop' | 'restart';

const allowedTransitions: Record<VMRuntimeState, readonly VMRuntimeState[]> = {
  stopped: ['starting', 'unavailable', 'error'],
  starting: ['starting', 'running', 'stopping', 'stopped', 'error', 'unavailable'],
  running: ['running', 'stopping', 'error', 'unavailable'],
  stopping: ['stopping', 'stopped', 'running', 'error', 'unavailable'],
  error: ['starting', 'stopping', 'stopped', 'error', 'unavailable'],
  unavailable: ['starting', 'stopped', 'error', 'unavailable'],
};

function failure(code: VMEngineError['code'], message: string): VMEngineResult<never> {
  return { ok: false, error: { code, message } };
}

function runtimeState(state: VMEngineSession['state']): VMRuntimeState {
  return state;
}

/** Coordinates UI lifecycle state without assuming that a request means execution started. */
export class VMRuntimeManager {
  private snapshot: VMRuntimeSnapshot = {};
  private readonly listeners = new Set<RuntimeListener>();
  private readonly eventListeners = new Set<VMEngineEventListener>();
  private readonly operations = new Map<string, Operation>();
  private readonly unsubscribeSessions = new Map<string, () => void>();

  constructor(
    private readonly engine: VMEngine,
    private readonly assetResolver: VMAssetResolver,
  ) {}

  getAvailability() {
    return this.engine.getAvailability();
  }

  getSnapshot = (): VMRuntimeSnapshot => this.snapshot;

  getStatus(vmId: string): VMRuntimeStatus {
    const existing = this.snapshot[vmId];
    if (existing) return existing;
    const availability = this.engine.getAvailability();
    return availability.available
      ? { vmId, state: 'stopped' }
      : { vmId, state: 'unavailable', error: availability.message };
  }

  subscribe = (listener: RuntimeListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeEvents(listener: VMEngineEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }

  private setStatus(vmId: string, status: VMRuntimeStatus, validate = true): boolean {
    const current = this.getStatus(vmId);
    if (validate && !allowedTransitions[current.state].includes(status.state)) return false;
    this.snapshot = { ...this.snapshot, [vmId]: status };
    this.publish();
    return true;
  }

  private unavailableStatus(vmId: string, message: string): void {
    this.setStatus(vmId, { vmId, state: 'unavailable', error: message }, false);
  }

  private errorStatus(vmId: string, message: string, sessionId?: string): void {
    this.setStatus(vmId, { vmId, state: 'error', error: message, sessionId }, false);
  }

  private beginOperation(vmId: string, operation: Operation): VMEngineResult<void> {
    if (this.operations.has(vmId)) {
      return failure('operation-in-progress', 'Another lifecycle operation is already in progress for this VM.');
    }
    this.operations.set(vmId, operation);
    return { ok: true, value: undefined };
  }

  private endOperation(vmId: string): void {
    this.operations.delete(vmId);
  }

  private canExecute(vmId: string): VMEngineResult<void> {
    const availability = this.engine.getAvailability();
    if (availability.available) return { ok: true, value: undefined };
    this.unavailableStatus(vmId, availability.message);
    return failure('engine-unavailable', availability.message);
  }

  private async request(config: VMConfig) {
    return createVMExecutionRequest(config, this.assetResolver);
  }

  private attachSession(vmId: string, session: VMEngineSession): void {
    this.unsubscribeSessions.get(vmId)?.();
    const unsubscribe = this.engine.subscribe(session.id, (event) => {
      if (event.type === 'state') {
        if (event.session.vmId !== vmId || this.getStatus(vmId).sessionId !== event.session.id) return;
        const nextState = runtimeState(event.session.state);
        const current = this.getStatus(vmId);
        if (this.operations.get(vmId) === 'restart' && current.sessionId !== event.session.id) return;
        this.setStatus(vmId, {
          vmId,
          sessionId: event.session.id,
          state: nextState,
          error: nextState === 'error' ? current.error ?? 'The engine reported an execution error.' : undefined,
        });
      } else if (event.type === 'error') {
        const current = this.getStatus(vmId);
        if (event.error.code === 'engine-unavailable') this.unavailableStatus(vmId, event.error.message);
        else this.errorStatus(vmId, event.error.message, current.sessionId);
      }
      for (const listener of this.eventListeners) listener(vmId, event);
    });
    this.unsubscribeSessions.set(vmId, unsubscribe);
  }

  private acceptSession(vmId: string, session: VMEngineSession): VMEngineResult<VMEngineSession> {
    if (session.vmId !== vmId || !session.id) {
      const message = 'The engine returned a session that does not match this VM.';
      this.errorStatus(vmId, message);
      return failure('launch-failed', message);
    }
    if (!this.engine.getAvailability().available) {
      const message = this.engine.getAvailability().message;
      this.unavailableStatus(vmId, message);
      return failure('engine-unavailable', message);
    }

    const nextState = runtimeState(session.state);
    this.setStatus(vmId, {
      vmId,
      sessionId: session.id,
      state: nextState,
      error: nextState === 'error' ? 'The engine reported an execution error.' : undefined,
    });
    this.attachSession(vmId, session);
    return { ok: true, value: session };
  }

  async start(config: VMConfig): Promise<VMEngineResult<VMEngineSession>> {
    const current = this.getStatus(config.id);
    if (current.state !== 'stopped' && current.state !== 'error' && current.state !== 'unavailable') {
      return failure('invalid-state', `Cannot start a VM while it is ${current.state}.`);
    }
    const availability = this.canExecute(config.id);
    if (!availability.ok) return availability;
    const operation = this.beginOperation(config.id, 'start');
    if (!operation.ok) return operation;

    this.unsubscribeSessions.get(config.id)?.();
    this.unsubscribeSessions.delete(config.id);
    this.setStatus(config.id, { vmId: config.id, state: 'starting' });
    try {
      const request = await this.request(config);
      if (!request.ok) {
        this.errorStatus(config.id, request.error.message);
        return request;
      }
      const result = await this.engine.start(request.value);
      if (!result.ok) {
        if (result.error.code === 'engine-unavailable') this.unavailableStatus(config.id, result.error.message);
        else this.errorStatus(config.id, result.error.message);
        return result;
      }
      return this.acceptSession(config.id, result.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The VM could not be started.';
      this.errorStatus(config.id, message);
      return failure('launch-failed', message);
    } finally {
      this.endOperation(config.id);
    }
  }

  async stop(vmId: string): Promise<VMEngineResult<VMEngineSession>> {
    const current = this.getStatus(vmId);
    if (current.state !== 'running' || !current.sessionId) {
      return failure('invalid-state', `Cannot stop a VM while it is ${current.state}.`);
    }
    const availability = this.canExecute(vmId);
    if (!availability.ok) return availability;
    const operation = this.beginOperation(vmId, 'stop');
    if (!operation.ok) return operation;
    this.setStatus(vmId, { ...current, state: 'stopping', error: undefined });
    try {
      const result = await this.engine.stop(current.sessionId);
      if (!result.ok) {
        if (result.error.code === 'engine-unavailable') this.unavailableStatus(vmId, result.error.message);
        else this.errorStatus(vmId, result.error.message, current.sessionId);
        return result;
      }
      if (result.value.vmId !== vmId || result.value.id !== current.sessionId) {
        const message = 'The engine returned a stop result for a different VM session.';
        this.errorStatus(vmId, message, current.sessionId);
        return failure('process-not-found', message);
      }
      this.setStatus(vmId, {
        vmId,
        sessionId: result.value.id,
        state: runtimeState(result.value.state),
        error: result.value.state === 'error' ? 'The engine reported an execution error.' : undefined,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The VM could not be stopped.';
      this.errorStatus(vmId, message, current.sessionId);
      return failure('process-not-found', message);
    } finally {
      this.endOperation(vmId);
    }
  }

  async restart(config: VMConfig): Promise<VMEngineResult<VMEngineSession>> {
    const current = this.getStatus(config.id);
    if (current.state !== 'running' && current.state !== 'stopped' && current.state !== 'error') {
      return failure('invalid-state', `Cannot restart a VM while it is ${current.state}.`);
    }
    const availability = this.canExecute(config.id);
    if (!availability.ok) return availability;
    const operation = this.beginOperation(config.id, 'restart');
    if (!operation.ok) return operation;
    this.unsubscribeSessions.get(config.id)?.();
    this.unsubscribeSessions.delete(config.id);
    this.setStatus(config.id, { vmId: config.id, state: 'starting' });
    try {
      const request = await this.request(config);
      if (!request.ok) {
        this.errorStatus(config.id, request.error.message);
        return request;
      }
      const result = await this.engine.restart(request.value, current.sessionId);
      if (!result.ok) {
        if (result.error.code === 'engine-unavailable') this.unavailableStatus(config.id, result.error.message);
        else this.errorStatus(config.id, result.error.message, current.sessionId);
        return result;
      }
      return this.acceptSession(config.id, result.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The VM could not be restarted.';
      this.errorStatus(config.id, message, current.sessionId);
      return failure('launch-failed', message);
    } finally {
      this.endOperation(config.id);
    }
  }

  async sendConsoleInput(vmId: string, bytes: Uint8Array): Promise<VMEngineResult<void>> {
    const current = this.getStatus(vmId);
    if (current.state !== 'running' || !current.sessionId) {
      return failure('invalid-state', 'Console input is available only while the VM is confirmed running.');
    }
    const availability = this.canExecute(vmId);
    if (!availability.ok) return availability;
    try {
      return await this.engine.sendConsoleInput(current.sessionId, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Console input could not be sent.';
      return failure('launch-failed', message);
    }
  }

  forget(vmId: string): void {
    this.unsubscribeSessions.get(vmId)?.();
    this.unsubscribeSessions.delete(vmId);
    if (!(vmId in this.snapshot)) return;
    const next = { ...this.snapshot };
    delete (next as Record<string, VMRuntimeStatus>)[vmId];
    this.snapshot = next;
    this.publish();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribeSessions.values()) unsubscribe();
    this.unsubscribeSessions.clear();
    this.listeners.clear();
    this.eventListeners.clear();
  }
}

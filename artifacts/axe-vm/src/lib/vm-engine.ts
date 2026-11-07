import type { VMConfig } from './workspace';

export type EngineAvailability = {
  available: boolean;
  message: string;
};

/** Narrow boundary for a future QEMU/native implementation. */
export interface VMEngine {
  getAvailability(): EngineAvailability;
  start(config: VMConfig): Promise<EngineAvailability>;
  stop(config: VMConfig): Promise<EngineAvailability>;
  restart(config: VMConfig): Promise<EngineAvailability>;
}

export const unavailableEngine: VMEngine = {
  getAvailability: () => ({
    available: false,
    message: 'QEMU integration is in development. This browser prototype only saves VM configuration.',
  }),
  start: async () => ({ available: false, message: 'Execution unavailable: QEMU integration is in development.' }),
  stop: async () => ({ available: false, message: 'Execution unavailable: no VM process is running in this prototype.' }),
  restart: async () => ({ available: false, message: 'Execution unavailable: QEMU integration is in development.' }),
};

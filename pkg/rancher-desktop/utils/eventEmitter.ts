/**
 * EventEmitter wrapper, where the events are defined by the given interface.
 * Each property on the given interface is an event name, and the value should
 * be a function where the arguments are the event parameters, and the return
 * value is the return value of the event (most likely void).
 */
export default interface EventEmitter<T extends { [P in keyof T]: (...args: any) => void }> {
  addListener<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  emit<eventName extends keyof T>(
    event: eventName,
    ...args: globalThis.Parameters<T[eventName]>
  ): boolean;

  eventNames(): (keyof T)[];

  getMaxListeners(): number;

  listenerCount<eventName extends keyof T>(event: eventName): number;

  listeners<eventName extends keyof T>(
    event: eventName
  ): T[eventName][];

  off<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  on<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  once<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  prependListener<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  prependOnceListener<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  removeAllListeners<eventName extends keyof T>(event: eventName): this;

  removeListener<eventName extends keyof T>(
    event: eventName,
    listener: T[eventName]
  ): this;

  setMaxListeners(n: number): void;

  rawListeners<eventName extends keyof T>(
    event: eventName
  ): T[eventName][];
}

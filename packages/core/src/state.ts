import { AxiomifyError } from './errors';

export class RequestStateImpl {
  private readonly _data = new Map<string, any>();

  constructor() {
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === 'get') {
          return (key: string) => target._data.get(key);
        }
        if (prop === 'set') {
          return (key: string, value: any) => {
            if (target._data.has(key)) {
              throw new AxiomifyError(`AxiomifyError: State key "${key}" is immutable once set.`);
            }
            if (key === 'user' && value && typeof value === 'object') {
              Object.freeze(value);
            }
            target._data.set(key, value);
          };
        }
        if (typeof prop === 'string') {
          return target._data.get(prop);
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (typeof prop === 'string') {
          if (target._data.has(prop)) {
            throw new AxiomifyError(`AxiomifyError: State key "${prop}" is immutable once set.`);
          }
          if (prop === 'user' && value && typeof value === 'object') {
            Object.freeze(value);
          }
          target._data.set(prop, value);
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      }
    }) as any;
  }
}

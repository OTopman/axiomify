import { AxiomifyError } from './errors';
import type { RequestState } from './types';

export class RequestStateImpl implements RequestState {
  private readonly _data = new Map<string, any>();
  [key: string]: any;

  public get(key: string): any {
    return this._data.get(key);
  }

  public set(key: string, value: any): void {
    if (this._data.has(key)) {
      throw new AxiomifyError(`AxiomifyError: State key "${key}" is immutable once set.`);
    }
    if (key === 'user' && value && typeof value === 'object') {
      Object.freeze(value);
    }
    this._data.set(key, value);
  }

  constructor() {
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === 'get') {
          return (key: string) => target.get(key);
        }
        if (prop === 'set') {
          return (key: string, value: any) => target.set(key, value);
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

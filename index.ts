// Polyfill WeakRef para versiones antiguas de Hermes/Android
// Usado por @supabase/realtime-js internamente
if (typeof WeakRef === 'undefined') {
  (global as any).WeakRef = class WeakRef<T extends object> {
    private _target: T;
    constructor(target: T) { this._target = target; }
    deref(): T { return this._target; }
  };
}

import 'expo-router/entry';

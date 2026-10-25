/**
 * Puerto de almacenamiento clave-valor persistente (semana 08).
 *
 * Contrato: `setItem` de UNA clave es atómico (o queda el valor anterior o el
 * nuevo, nunca una mezcla). La integridad multi-registro se logra guardando
 * todo el estado nuevo en una sola clave; ver docs/data-model.md.
 */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Sólo para pruebas y entornos sin almacenamiento nativo; NO sobrevive al proceso. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  snapshot(): Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
    snapshot() {
      return Object.fromEntries(map);
    },
  };
}

/**
 * Adaptador real: AsyncStorage (persistente en Android). Se importa de forma
 * diferida para que las pruebas de lógica pura no carguen el módulo nativo.
 */
export function createAsyncStorageAdapter(): KeyValueStorage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: AsyncStorage } = require('@react-native-async-storage/async-storage') as {
    default: KeyValueStorage;
  };
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  };
}

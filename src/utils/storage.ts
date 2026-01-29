/**
 * In-memory storage for OPD token allocation data
 */

export interface StorageInstance {
  tokens: Map<string, any>;
  allocations: Map<string, any>;
  patients: Map<string, any>;
  waitingQueue: Map<string, any[]>; // slotId -> waiting tokens
}

class InMemoryStorage {
  private static instance: InMemoryStorage;
  private storage: StorageInstance;

  private constructor() {
    this.storage = {
      tokens: new Map(),
      allocations: new Map(),
      patients: new Map(),
      waitingQueue: new Map(),
    };
  }

  public static getInstance(): InMemoryStorage {
    if (!InMemoryStorage.instance) {
      InMemoryStorage.instance = new InMemoryStorage();
    }
    return InMemoryStorage.instance;
  }

  public getStorage(): StorageInstance {
    return this.storage;
  }

  public reset(): void {
    this.storage = {
      tokens: new Map(),
      allocations: new Map(),
      patients: new Map(),
      waitingQueue: new Map(),
    };
  }
}

export const storage = InMemoryStorage.getInstance();

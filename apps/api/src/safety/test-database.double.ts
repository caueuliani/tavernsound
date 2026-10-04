// Deterministic transaction double, NOT a PostgreSQL concurrency test.
// Models commit/rollback and a shared row across service instances.
export function budgetDatabase() {
  let state: any = { id: 'beta', day: '', operations: 0, reservedMinutes: 0, roomId: null, endsAt: null, participants: [] };
  let rooms = 0;
  let queue = Promise.resolve();
  return {
    get state() { return state; },
    $transaction: async (action: (tx: any) => Promise<any>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      let pending = structuredClone(state);
      let pendingRooms = rooms;
      try {
        const result = await action({
          $executeRaw: async () => 0,
          $queryRaw: async () => [structuredClone(pending)],
          testBudget: { update: async ({ data }: any) => { pending = { ...pending, ...data }; } },
          room: { count: async () => pendingRooms, create: async ({ data }: any) => { pendingRooms++; return data; } },
        });
        state = structuredClone(pending); rooms = pendingRooms;
        return result;
      } finally { release(); }
    },
  };
}

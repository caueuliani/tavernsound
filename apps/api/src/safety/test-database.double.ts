// Deterministic transaction double, NOT a PostgreSQL concurrency test.
// Models commit/rollback and a shared row across service instances.
export function budgetDatabase() {
  let state: any = { id: 'beta', day: '', operations: 0, reservedMinutes: 0, roomId: null, endsAt: null, participants: [] };
  let rooms: { id: string; ownerId: string; members: string[] }[] = [];
  let queue = Promise.resolve();
  return {
    get state() { return state; },
    get rooms() { return rooms; },
    addMember(roomId: string, userId: string) { rooms.find(room => room.id === roomId)?.members.push(userId); },
    $transaction: async (action: (tx: any) => Promise<any>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      let pending = structuredClone(state);
      let pendingRooms = structuredClone(rooms);
      try {
        const result = await action({
          $executeRaw: async () => 0,
          $queryRaw: async () => [structuredClone(pending)],
          testBudget: { update: async ({ data }: any) => { pending = { ...pending, ...data }; } },
          room: {
            count: async ({ where }: any = {}) => pendingRooms.filter(room => !where?.ownerId || room.ownerId === where.ownerId).length,
            create: async ({ data }: any) => { pendingRooms.push({ id: data.id, ownerId: data.ownerId, members: [] }); return data; },
          },
        });
        state = structuredClone(pending); rooms = pendingRooms;
        return result;
      } finally { release(); }
    },
  };
}

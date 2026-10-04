// Run only against the disposable LOCAL test database after applying migrations.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { TestSafetyService } = require('./dist/safety/test-safety.service.js');
const url = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/tavernsound_test') {
  throw new Error('This check only modifies the disposable local tavernsound_test database.');
}
process.env.TEST_MODE = 'true';
const db = new PrismaClient(), second = new PrismaClient();
try {
  await db.testBudget.deleteMany();
  await db.room.deleteMany();
  const user = await db.user.upsert({ where: { email: 'quota-check@example.test' }, create: { email: 'quota-check@example.test' }, update: {} });
  const a = new TestSafetyService(db), b = new TestSafetyService(second);
  const rooms = await Promise.allSettled(['ABC123', 'DEF456'].map(id => a.createRoom({ id, name: 'Database check', ownerId: user.id })));
  assert.equal(rooms.filter(r => r.status === 'fulfilled').length, 1);
  const room = await db.room.findFirstOrThrow();
  const admissions = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b).admit(room.id, `u${i}`, `session${i}`, `socket${i}`)));
  assert.equal(admissions.filter(r => r.status === 'fulfilled').length, 5);
  const state = await db.testBudget.findUniqueOrThrow({ where: { id: 'beta' } });
  assert.equal(state.participants.length, 5); assert.equal(state.reservedMinutes, 60);
  await a.release('socket0');
  assert.equal(await b.admit(room.id, 'reconnected', 'new-session', 'new-socket'), state.endsAt.getTime());
  await db.testBudget.update({ where: { id: 'beta' }, data: { operations: 19_999 } });
  const operations = await Promise.allSettled([a.consumeOperation(), b.consumeOperation()]);
  assert.equal(operations.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await db.testBudget.findUniqueOrThrow({ where: { id: 'beta' } })).operations, 20_000);
  await assert.rejects(new TestSafetyService(second).consumeOperation(), /Cota diária/);
  console.log('PostgreSQL checks passed: concurrent room creation, five slots, persistent deadline, and atomic daily quota.');
} finally {
  // This database is dedicated to these checks and the subsequent local smoke test.
  await db.testBudget.deleteMany(); await db.room.deleteMany();
  await Promise.all([db.$disconnect(), second.$disconnect()]);
}

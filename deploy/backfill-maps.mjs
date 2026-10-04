// Run on the existing host, while its local-uploads/maps directory is still present,
// before moving to an ephemeral instance. DATABASE_URL must point to that host's database.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const folder = path.resolve(process.env.LOCAL_UPLOAD_DIR || 'local-uploads/maps');
let migrated = 0;
try {
  const rooms = await db.room.findMany({ select: { id: true, updatedAt: true, sceneData: true, mapUrl: true } });
  for (const room of rooms) {
    const file = room.sceneData?.map?.file;
    if (!file || room.mapUrl?.startsWith('db-webp:')) continue;
    if (typeof file !== 'string' || !/^[a-f0-9-]{36}\.webp$/.test(file)) throw new Error(`Invalid map filename in room ${room.id}`);
    const bytes = await readFile(path.join(folder, file));
    if (bytes.length > 3 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') {
      throw new Error(`Invalid WebP in room ${room.id}`);
    }
    const result = await db.room.updateMany({
      where: { id: room.id, updatedAt: room.updatedAt },
      data: { mapUrl: `db-webp:${bytes.toString('base64')}` },
    });
    if (result.count !== 1) throw new Error(`Room ${room.id} changed during backfill; retry after checking it`);
    migrated++;
  }
  console.log(`Maps stored in PostgreSQL: ${migrated}`);
} finally {
  await db.$disconnect();
}

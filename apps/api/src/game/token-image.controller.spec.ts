import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { TokenImageController } from './token-image.controller';

describe('Character portraits', () => {
  let controller: TokenImageController, prisma: any, access: any, gateway: any;
  const id = createHash('sha256').update('ABC123:user').digest('hex');
  const req = { headers: { cookie: 'session' } } as any;
  beforeEach(() => {
    process.env.LOCAL_TOKEN_UPLOADS = 'true';
    prisma = { token: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    access = { require: jest.fn().mockResolvedValue({}) };
    gateway = { publishTokenImage: jest.fn() };
    controller = new TokenImageController(prisma, { require: jest.fn().mockResolvedValue({ id: 'user' }) } as any, access, gateway);
  });
  afterEach(() => { delete process.env.LOCAL_TOKEN_UPLOADS; });
  const file = async () => ({ buffer: await sharp({ create: { width: 400, height: 600, channels: 3, background: '#ea9030' } }).png().toBuffer() });
  it('persists a bounded WebP portrait for the account token in this room', async () => {
    const result = await controller.upload('ABC123', id, req, await file());
    const bytes = Buffer.from(result.imageData.split(',')[1], 'base64');
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(prisma.token.updateMany).toHaveBeenCalledWith({ where: { id, roomId: 'ABC123' }, data: { imageUrl: result.imageData } });
    expect(gateway.publishTokenImage).toHaveBeenCalledWith('ABC123', id, result.imageData);
  });
  it('rejects another player token before updating', async () => {
    await expect(controller.upload('ABC123', 'foreign', req, await file())).rejects.toThrow('seu personagem');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('requires room access', async () => {
    access.require.mockRejectedValue(new Error('denied'));
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('denied');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('rejects SVG and invalid bytes', async () => {
    await expect(controller.upload('ABC123', id, req, { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') })).rejects.toThrow('PNG');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
  it('does not announce a portrait when the token was deleted', async () => {
    prisma.token.updateMany.mockResolvedValue({ count: 0 });
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('Crie seu token');
    expect(gateway.publishTokenImage).not.toHaveBeenCalled();
  });
  it('respects the hosting feature flag', async () => {
    process.env.LOCAL_TOKEN_UPLOADS = 'false';
    await expect(controller.upload('ABC123', id, req, await file())).rejects.toThrow('não habilitados');
    expect(prisma.token.updateMany).not.toHaveBeenCalled();
  });
});

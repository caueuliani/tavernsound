import { CharactersService } from './characters.service';

describe('Character sheet permissions and validation', () => {
  const campaign = { id: 'camp', ownerId: 'gm', gameSystemId: 'dnd5e-2014-srd51', members: [{ userId: 'player' }] };
  const sheet = { level: 1, abilities: { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 } };
  let db: any;
  let service: CharactersService;

  beforeEach(() => {
    db = {
      campaign: { findUnique: jest.fn().mockResolvedValue(campaign) },
      character: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pc', revision: 1, ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'pc', userId: 'player', revision: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'pc', revision: 2 }),
      },
    };
    service = new CharactersService(db);
  });

  it('lets members create bounded 5e characters', async () => {
    await expect(service.create('camp', 'player', { name: 'Arcane Warrior', sheet })).resolves.toMatchObject({ name: 'Arcane Warrior' });
    expect(db.character.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'player', campaignId: 'camp' }) });
  });

  it('rejects outsiders before reading or writing sheets', async () => {
    await expect(service.list('camp', 'outsider')).rejects.toThrow('Sem acesso');
    await expect(service.create('camp', 'outsider', { name: 'X', sheet })).rejects.toThrow('Sem acesso');
    expect(db.character.create).not.toHaveBeenCalled();
  });

  it('rejects malformed sheets and oversized names', async () => {
    await expect(service.create('camp', 'player', { name: '', sheet })).rejects.toThrow('Nome');
    await expect(service.create('camp', 'player', { name: 'X', sheet: { level: 1 } })).rejects.toThrow('atributos');
    await expect(service.create('camp', 'player', { name: 'X', sheet: { ...sheet, level: 21 } })).rejects.toThrow('Nível');
  });

  it('rejects character creation for generic campaigns', async () => {
    db.campaign.findUnique.mockResolvedValue({ ...campaign, gameSystemId: 'generic' });
    await expect(service.create('camp', 'player', { name: 'X', sheet })).rejects.toThrow('não utiliza');
  });

  it('only permits owner or character player to edit with matching revision', async () => {
    await expect(service.update('camp', 'pc', 'gm', { revision: 1, name: 'New' })).resolves.toHaveProperty('revision', 2);
    await expect(service.update('camp', 'pc', 'player', { revision: 0, name: 'New' })).rejects.toThrow('desatualizada');
    db.character.findFirst.mockResolvedValue({ id: 'pc', userId: 'other', revision: 1 });
    await expect(service.update('camp', 'pc', 'player', { revision: 1, name: 'New' })).rejects.toThrow('Apenas');
  });

  it('rejects concurrent writes to a stale revision', async () => {
    db.character.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('camp', 'pc', 'player', { revision: 1, sheet })).rejects.toThrow('outra conexão');
  });
});

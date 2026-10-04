import { CampaignsService } from './campaigns.service';

describe('Campaign integration fixes', () => {
  it('loads membership to authorize session history', async () => {
    const prisma = { campaign: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', members: [{ userId: 'player' }] }) }, gameSession: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(new CampaignsService(prisma as any).getSessionsByCampaign('campaign', 'player')).resolves.toEqual([]);
    expect(prisma.campaign.findUnique).toHaveBeenCalledWith({ where: { id: 'campaign' }, include: { members: { select: { userId: true } } } });
  });
  it('does not read session history for outsiders', async () => {
    const prisma = { campaign: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', members: [] }) }, gameSession: { findMany: jest.fn() } };
    await expect(new CampaignsService(prisma as any).getSessionsByCampaign('campaign', 'outsider')).rejects.toThrow('acesso');
    expect(prisma.gameSession.findMany).not.toHaveBeenCalled();
  });
  it('cannot change campaign ownership through update payload', async () => {
    const prisma = { campaign: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }), update: jest.fn().mockResolvedValue({}) } };
    await new CampaignsService(prisma as any).updateCampaign('campaign', 'owner', { name: 'Name', ownerId: 'other' } as any);
    expect(prisma.campaign.update.mock.calls[0][0].data).not.toHaveProperty('ownerId');
  });
});

import { GameController } from './game.controller';
import { RtcTokenBuilder } from 'agora-access-token';
import { sceneMediaChannel } from './scene-media.util';
import { TestSafetyService } from '../safety/test-safety.service';

describe('Voice authorization', () => {
  let sessions: any;
  let access: any;
  let controller: GameController;
  const req = { headers: { cookie: 'test-cookie' } } as any;
  beforeEach(() => {
    sessions = { require: jest.fn().mockResolvedValue({ id: 'user', sid: 'session', exp: Math.floor(Date.now() / 1000) + 600 }), voiceUid: jest.fn().mockReturnValue('server-assigned-uid') };
    access = { require: jest.fn().mockResolvedValue({}), requireSceneMedia: jest.fn().mockResolvedValue({ id: 'initial-ABC123' }) };
    controller = new GameController(sessions, access, new TestSafetyService({} as any));
  });
  it('checks session before room access', async () => {
    sessions.require.mockRejectedValue(new Error('unauthenticated'));
    await expect(controller.generateToken('ABC123', req)).rejects.toThrow('unauthenticated');
    expect(access.require).not.toHaveBeenCalled();
  });
  it('does not issue voice credentials to someone outside the room', async () => {
    access.require.mockRejectedValue(new Error('forbidden'));
    await expect(controller.generateToken('ABC123', req)).rejects.toThrow('forbidden');
  });
  it('rejects requests for staged or foreign scene media before issuing an Agora token', async () => {
    access.requireSceneMedia.mockRejectedValue(new Error('inactive scene'));
    const spy = jest.spyOn(RtcTokenBuilder, 'buildTokenWithAccount');
    try {
      await expect(controller.generateToken('ABC123', req, 'secret-scene')).rejects.toThrow('inactive scene');
      expect(access.requireSceneMedia).toHaveBeenCalledWith('ABC123', 'user', 'secret-scene');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('uses distinct Agora channels for distinct authorized scenes without changing legacy tokens', async () => {
    const oldApp = process.env.AGORA_APP_ID, oldCertificate = process.env.AGORA_APP_CERTIFICATE;
    process.env.AGORA_APP_ID = 'test-app'; process.env.AGORA_APP_CERTIFICATE = 'test-certificate';
    const builder = jest.spyOn(RtcTokenBuilder, 'buildTokenWithAccount').mockReturnValue('voice-token');
    try {
      const first = await controller.generateToken('ABC123', req, 'initial-ABC123');
      const next = await controller.generateToken('ABC123', req, 'other-valid-scene');
      const legacy = await controller.generateToken('ABC123', req);
      expect(first.channelName).toBe(sceneMediaChannel('ABC123', 'initial-ABC123'));
      expect(next.channelName).not.toBe(first.channelName);
      expect(legacy.channelName).toBe('ABC123');
      expect(builder).toHaveBeenNthCalledWith(1, 'test-app', 'test-certificate', first.channelName, 'server-assigned-uid', expect.any(Number), first.expiresAt);
      expect(builder).toHaveBeenNthCalledWith(2, 'test-app', 'test-certificate', next.channelName, 'server-assigned-uid', expect.any(Number), next.expiresAt);
      expect(builder).toHaveBeenNthCalledWith(3, 'test-app', 'test-certificate', 'ABC123', 'server-assigned-uid', expect.any(Number), legacy.expiresAt);
    } finally {
      builder.mockRestore();
      if (oldApp === undefined) delete process.env.AGORA_APP_ID; else process.env.AGORA_APP_ID = oldApp;
      if (oldCertificate === undefined) delete process.env.AGORA_APP_CERTIFICATE; else process.env.AGORA_APP_CERTIFICATE = oldCertificate;
    }
  });
  it('binds the token to the server identity and limits it to five minutes', async () => {
    const oldApp = process.env.AGORA_APP_ID, oldCertificate = process.env.AGORA_APP_CERTIFICATE;
    process.env.AGORA_APP_ID = 'test-app'; process.env.AGORA_APP_CERTIFICATE = 'test-certificate';
    const builder = jest.spyOn(RtcTokenBuilder, 'buildTokenWithAccount').mockReturnValue('voice-token');
    try {
      const result = await controller.generateToken('ABC123', req);
      expect(result.uid).toBe('server-assigned-uid');
      expect(result.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300);
      expect(access.require).toHaveBeenCalledWith('ABC123', 'user');
      expect(builder).toHaveBeenCalledWith('test-app', 'test-certificate', 'ABC123', 'server-assigned-uid', expect.any(Number), result.expiresAt);
    } finally {
      builder.mockRestore();
      if (oldApp === undefined) delete process.env.AGORA_APP_ID; else process.env.AGORA_APP_ID = oldApp;
      if (oldCertificate === undefined) delete process.env.AGORA_APP_CERTIFICATE; else process.env.AGORA_APP_CERTIFICATE = oldCertificate;
    }
  });
});

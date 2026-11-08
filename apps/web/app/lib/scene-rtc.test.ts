import test from 'node:test'
import assert from 'node:assert/strict'
import { joinAfterLeave, readRtcCredentials, rtcTokenPath, stopMediaCapture } from './scene-rtc.ts'

test('legacy voice requests use only the room and accept only that channel', () => {
  assert.equal(rtcTokenPath('ABC123'), '/agora/token?channelName=ABC123')
  assert.deepEqual(readRtcCredentials({ token: 'signed', uid: 'user', channelName: 'ABC123' }, 'ABC123'),
    { token: 'signed', uid: 'user', channelName: 'ABC123' })
  assert.throws(() => readRtcCredentials({ token: 'signed', uid: 'user', channelName: 'ABC123-scene-aaa' }, 'ABC123'),
    /incompatível/)
})

test('scene credentials cannot silently reuse the shared room channel', () => {
  assert.equal(rtcTokenPath('ABC123', 'initial-ABC123'),
    '/agora/token?channelName=ABC123&sceneId=initial-ABC123')
  assert.deepEqual(readRtcCredentials({
    token: 'signed', uid: 'user', channelName: 'ABC123-scene-0123456789',
  }, 'ABC123', 'initial-ABC123'), {
    token: 'signed', uid: 'user', channelName: 'ABC123-scene-0123456789',
  })
  assert.throws(() => readRtcCredentials({ token: 'signed', uid: 'user', channelName: 'ABC123' }, 'ABC123', 'initial-ABC123'),
    /incompatível/)
  assert.throws(() => readRtcCredentials({ token: 'signed', uid: 'user', channelName: 'DEF456-scene-123' }, 'ABC123', 'initial-ABC123'),
    /incompatível/)
})

test('invalid or incomplete credentials fail before Agora join', () => {
  for (const input of [null, {}, { token: 'signed' }, { token: '', uid: 'player', channelName: 'ABC123' },
    { token: 'signed', uid: 7, channelName: 'ABC123' }]) {
    assert.throws(() => readRtcCredentials(input, 'ABC123'))
  }
})

test('stops video and microphone synchronously even if one close throws', () => {
  const stopped: string[] = []
  stopMediaCapture(
    { close() { stopped.push('microphone') } },
    { close() { stopped.push('camera'); throw new Error('device already disconnected') } },
  )
  assert.deepEqual(stopped, ['camera', 'microphone'])
})

test('never joins the replacement scene before the old channel leaves', async () => {
  let completeLeave!: () => void
  const pendingLeave = new Promise<void>(resolve => { completeLeave = resolve })
  const calls: string[] = []
  const joining = joinAfterLeave(pendingLeave, async () => {
    calls.push('join-new')
    return 'new-uid'
  })
  await Promise.resolve()
  assert.deepEqual(calls, [])
  calls.push('leave-old')
  completeLeave()
  assert.equal(await joining, 'new-uid')
  assert.deepEqual(calls, ['leave-old', 'join-new'])
})

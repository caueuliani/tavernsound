import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteVoiceMode } from './voice-mode.ts'

test('host hears a player without needing a token', () => {
  assert.equal(remoteVoiceMode(true, 'player', false, true, false), 'global')
})

test('player hears the host without spatial processing or a host token', () => {
  assert.equal(remoteVoiceMode(false, 'host', true, false, false), 'global')
})

test('players with tokens remain spatial', () => {
  assert.equal(remoteVoiceMode(false, 'player', true, true, false), 'spatial')
})

test('missing player tokens never grant global voice', () => {
  assert.equal(remoteVoiceMode(false, 'player', false, true, false), 'silent')
  assert.equal(remoteVoiceMode(false, 'player', true, false, false), 'silent')
  assert.equal(remoteVoiceMode(true, 'player', false, false, false), 'global')
})

test('unannounced Agora identities are silent even for the host', () => {
  assert.equal(remoteVoiceMode(true, undefined, false, false, false), 'silent')
})

test('deafen silences both host and spatial voices', () => {
  assert.equal(remoteVoiceMode(true, 'player', false, true, true), 'silent')
  assert.equal(remoteVoiceMode(false, 'host', true, false, true), 'silent')
  assert.equal(remoteVoiceMode(false, 'player', true, true, true), 'silent')
})

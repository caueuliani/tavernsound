# Audio/video RTC channels per scene — security foundation

## Current behavior (unchanged)
The current VTT continues to use the room-level Agora channel, which carries both audio and webcam video. **Staged player destinations do not move users or change their current RTC channel.** Do not claim that two simultaneous scenes are acoustically isolated yet.

## Optional scene credential endpoint
`GET /agora/token?channelName=ABC123&sceneId=initial-ABC123`

- Requires valid session and authorized room access.
- While live scene activation is not implemented, **only the first/initial scene** can receive these credentials. Staging a player for a draft scene never grants media access to it.
- Returns an RTC token with a deterministic scene-specific Agora channel name as `channelName`, plus `uid` and expiry.
- Agora token remains signed by the server, bound to server-derived account identity, and capped at 5 minutes/beta voice deadline.
- Existing `GET /agora/token?channelName=ABC123` continues to work exactly as before and returns the original room RTC channel.
- Audio and video share Agora channel authorization: scene media isolation must enforce this for **both** tracks.

## Before enabling actual scene transfers
1. Add one authoritative active-scene assignment state separate from preparatory staging, with transactional changes.
2. Make HTTP map/image access, Socket.IO room membership, token visibility, fog and chat scene-aware.
3. Switch the client to the scene's RTC channel **before revealing the new scene**, and close the old connection/remote tracks; handle mic/camera permissions and failures safely.
4. Change token authorization to permit only each user's **activated** scene, with explicit host monitoring rules. Do not reuse staging assignments for this.
5. Remove or constrain legacy room-level RTC authorization for users in split scenes; otherwise they could continue subscribing to the shared room and bypass isolation.
6. Add real-device checks for no cross-scene **audio and webcam**, reconnect, and beta allowance.

No Prisma migration is needed for this isolated backend groundwork.

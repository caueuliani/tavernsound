// Agora 4.24.8 rejects Chromium's optional goog-sped-v1 ICE optimization.
// Preserve trickle ICE, credentials, fingerprints and every other SDP line.
export function compatibleAgoraSdp(sdp: string): string {
  return sdp.replace(/^a=ice-options:([^\r\n]*)/gm, (line, options: string) => {
    const tokens = options.split(/\s+/);
    if (!tokens.includes('goog-sped-v1')) return line;
    return `a=ice-options:${tokens.filter(token => token !== 'goog-sped-v1').join(' ')}`;
  });
}
let installed = false;
export function installAgoraCompatibility() {
  if (installed || typeof RTCPeerConnection === 'undefined') return;
  installed = true;
  for (const method of ['createOffer', 'createAnswer'] as const) {
    const original = RTCPeerConnection.prototype[method];
    Object.defineProperty(RTCPeerConnection.prototype, method, {
      configurable: true, writable: true,
      value: async function (this: RTCPeerConnection, ...args: any[]) {
        const description = await (original as any).apply(this, args);
        return { type: description.type, sdp: description.sdp ? compatibleAgoraSdp(description.sdp) : description.sdp };
      },
    });
  }
}

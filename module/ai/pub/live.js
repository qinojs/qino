// A live talk from the browser: the microphone goes to the provider by WebRTC, its voice comes back.
// The server sets it up (`connect`: the offer's SDP to the answer's) and keeps what is said.

/** Start talking; `close()` hangs up. */
export async function live(connect, { media = { audio: true } } = {}) {
  const pc = new RTCPeerConnection(), voice = new Audio();
  voice.autoplay = true;
  pc.ontrack = (e) => voice.srcObject = e.streams[0];
  const stream = await navigator.mediaDevices.getUserMedia(media);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.createDataChannel("oai-events"); // OpenAI expects it; the server listens instead
  const close = () => {
    for (const track of stream.getTracks()) track.stop();
    pc.close();
  };
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await pc.setRemoteDescription({ type: "answer", sdp: await connect(pc.localDescription.sdp) });
  } catch (e) { throw (close(), e); }
  return { close };
}

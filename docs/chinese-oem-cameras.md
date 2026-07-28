# Guide: generic Chinese OEM cameras (Yoosee, iCSee, and similar)

## Context

Cheap cameras sold under brands like **Yoosee**, **iCSee**, generic ONVIF
"Wyze-style" models, and various other white-label brands often use the
same OEM chipsets (**Hi3518/Hi3516** families, among others) and the same
minimal ONVIF/RTSP firmware stack behind different brand names. This guide
documents, based on real testing against Yoosee cameras in this
environment, which parts of the ONVIF/RTSP protocol these cameras don't
implement correctly, the fallbacks already built into the app to work
around it, and what to do when the camera simply stops responding.

If you're setting up a camera from one of these brands (or any
"generic"/unbranded camera sold with its own app like Yoosee/iCSee/CamHi)
and something doesn't work the standard way, start here before
investigating from scratch.

## Limitation 1: ONVIF events (PullPoint) don't work

**Symptom**: the camera connects normally (ONVIF, PTZ, video streams all
working), but no motion alert ever arrives via "Alertas de movimento"
(ONVIF).

**Confirmed cause**: these cameras advertise `WSPullPointSupport: true` in
`GetCapabilities` (sometimes even reporting an Events service address),
but this is a static/incorrect firmware response — **any** Events SOAP
request (`CreatePullPointSubscription`, `GetEventProperties`,
authenticated or not, in any SOAP format) drops the TCP connection
immediately. This has been tested exhaustively against a real camera (see
`/memories/repo/onvif-events-pullpoint.md` in the agent's memory
repository): it's not a bug in the app, it's the camera firmware's Events
service that doesn't actually exist, despite what it advertises.

This is also the most likely explanation for why other software like
Shinobi/AgentDVR "manage" to detect motion on these same cameras: they
almost certainly don't use ONVIF Events for that, but rather server-side
video analysis.

**Fallback implemented**: the `motionDetectionSource: "video"` field on the
camera (instead of the default `"onvif"`) — runs a local motion detector
via OpenCV analyzing the RTSP stream directly on the server, without
depending on anything from the camera besides the video itself. See
[Video-based motion detection](./motion-detection.md) for all
implementation details and parameter tuning/false-positive notes.

**What to do**: when registering/editing a Yoosee/iCSee/generic camera, set
the motion detection mode to **video** instead of ONVIF. If you already
tried "Alertas de movimento" (ONVIF) and no events ever arrived, this is the
explanation — no need to dig further, it's a known firmware limitation of
the camera.

## Limitation 2: incomplete RTSP (broken Digest authentication)

**Symptom**: RTSP works fine in VLC, ffplay, AgentDVR — but this app's
MediaMTX fails with `bad status code: 400 (Bad Request)` on the same
URL/credentials.

**Confirmed cause**: these cameras' RTSP server only accepts the Digest
authentication retry if it arrives on the **same TCP connection** as the
original `401` challenge. MediaMTX's Go RTSP client (`gortsplib`) doesn't
replicate that behavior (not a bug on its part — it's a strict reading of
the RTSP spec that these cameras don't follow); the `live555` client used
by VLC tolerates this out of the box.

**Fallback implemented**: the `rtspCompatMode: "vlc-relay"` camera
compatibility mode. A headless VLC process
([`backend/src/media/vlcRelay.ts`](../backend/src/media/vlcRelay.ts)) pulls
the stream once as a real, working client and re-exposes it as a new,
unauthenticated RTSP stream on a local port — MediaMTX then pulls from
this relay instead of talking to the camera directly. The relay is
self-healing (restarts on its own if it dies) and is automatically
recreated whenever the camera is reprovisioned. See
[Troubleshooting](./troubleshooting.md#rtsp-works-in-other-tools-vlc-agent-dvr-but-mediamtx-gets-bad-status-code-400)
for more details.

**What to do**: if the camera's "diagnóstico" panel on the Grid page shows
`configured: true` but `ready: false` with no other apparent reason, and
the RTSP URL works manually in VLC, enable the **vlc-relay** mode when
editing the camera.

## Limitation 3: initial ONVIF handshake drops the connection (historical, already fixed in the app)

Cameras of this type also tend to drop the connection (`socket hang up`/
`ECONNRESET`) on the very first unauthenticated ONVIF call
(`GetSystemDateAndTime`) that some ONVIF libraries make by default. The app
already works around this internally by using the `node-onvif` package
(instead of `onvif`) for connection/PTZ/media — there's nothing you need to
do about this, it's just context for why this type of camera is generally
"difficult". Details in
[Troubleshooting](./troubleshooting.md#a-specific-cameras-onvif-connection-resets-socket-hang-up--econnreset).

## What to do when the camera hangs / drops off the network

Cheap OEM cameras like these are known to hang completely (stop responding
to both ONVIF and RTSP, and don't reconnect on their own) on unstable Wi-Fi
or after running too long without a restart. This is a failure of the
**camera's own firmware** — this app's self-healing mechanisms (60s
reconciliation loop, automatic VLC relay respawn, retries with backoff)
fix problems on the **server side** (MediaMTX lost the path, the relay
crashed, etc.), but can't "wake up" a camera whose firmware has genuinely
frozen — that can only be fixed by restarting the physical device.

Recommended order, from least to most invasive:

1. **Restart via the manufacturer's app** (Yoosee, iCSee, CamHi, or
   equivalent): most of these apps have a "restart device"/"reboot" option
   in the device settings (outside this server's scope — it's a
   proprietary app command, not standard ONVIF). Try this first if you
   have the app installed and the camera still shows up in it.
2. **ONVIF `SystemReboot` command**: this exists in the ONVIF
   specification, but this app **deliberately does not expose it** — the
   ONVIF debug console (`/onvif-debug`,
   [`backend/src/onvif/debugCommands.ts`](../backend/src/onvif/debugCommands.ts))
   intentionally excludes mutating/destructive commands like reboot. Even
   if it were exposed, there's no guarantee these cameras' firmware
   implements that command correctly, given that the Events service itself
   already proved to be just a static, incorrect response — it's not worth
   relying on.
3. **Power-cycle the device** (unplug and plug back in): this is the most
   reliable method for this type of camera, since it doesn't depend on any
   part of the firmware actually working. If the camera is physically hard
   to reach, consider a dedicated **smart plug** for it — lets you
   power-cycle it remotely without needing to go there in person.

**Sign that you've reached this point**: the camera's "diagnóstico" panel
on the Grid page shows `configured: true` (the path exists in MediaMTX) but
persistent `ready: false`, **and** the camera also no longer responds to
any ONVIF call (test via `/onvif-debug` or the "Testar conexão" button) —
i.e., it's not a MediaMTX/relay problem, the camera itself has stopped
responding on the network.

## Quick summary

| Symptom | Cause | Fallback/action |
|---|---|---|
| No motion alerts via ONVIF | The firmware's Events service doesn't actually work | `motionDetectionSource: "video"` — see [motion-detection.md](./motion-detection.md) |
| MediaMTX returns `bad status code: 400` on RTSP, but VLC works | Digest auth only accepts the retry on the same TCP connection | `rtspCompatMode: "vlc-relay"` — see [troubleshooting.md](./troubleshooting.md) |
| `socket hang up`/`ECONNRESET` on ONVIF | The initial unauthenticated call drops the connection | Already fixed internally (`node-onvif` package) |
| Camera stops responding (ONVIF and RTSP) | Frozen firmware, not an issue with this app | Manufacturer's app → power cycle (consider a smart plug) |

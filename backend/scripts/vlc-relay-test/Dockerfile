# Isolated test image - NOT wired into the main docker-compose.yml yet.
#
# Runs a minimal headless VLC (vlc-nox, no GUI/X11/Wayland deps) that pulls
# an RTSP stream from a camera VLC can talk to (but our other RTSP clients
# can't, due to a Digest-auth-over-persistent-connection quirk) and re-serves
# it as a brand new, plain RTSP stream. The idea: let MediaMTX (or ffmpeg)
# connect to THIS relay instead of the picky camera directly - VLC did the
# hard part already.
# NOTE: Debian's "vlc"/"vlc-nox" packages do NOT include live555 (licensing
# reasons), so they can't act as an RTSP *client* at all - only as an RTSP
# *server*/output. Alpine's vlc package does link against live555
# (libliveMedia/libgroupsock/libUsageEnvironment), so it can actually open
# rtsp:// URLs as input. Using Alpine here for that reason (also matches the
# rest of this project's Alpine-based images).
FROM alpine:3.20

RUN apk add --no-cache vlc \
  && adduser -D vlc

USER vlc

ENTRYPOINT ["cvlc"]

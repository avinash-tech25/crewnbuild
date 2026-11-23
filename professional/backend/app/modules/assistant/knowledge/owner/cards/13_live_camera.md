+++
id = "live-camera"
title = "Watch the site on the live camera (CCTV)"
stage = 12
keywords = ["camera", "cctv", "live", "dvr", "nvr", "watch site", "recording", "video"]
buttons = [{ label = "My projects", path = "/owner/projects" }]
next = ["escrow-and-budget"]
+++
Where: project -> **Live Camera** tab (the red blinking one).

First time (each person verifies once):
1. Tap **Connect DVR/NVR**.
2. Choose the Device Type (DVR or NVR) and enter the recorder's **IP Address** (numbers only, e.g. 192.168.1.100), **Port**, optional RTSP Port, **Username** and **Password**.
3. Tap **Verify Device**. You'll see "Device verified successfully." and the cameras appear.
If the project already has a recorder, enter the same recorder's username and password to confirm your access.

Watching:
- Site cameras show as a Grid or List. Tap **Watch**, choose HD or SD, go full screen, and use **Reconnect** if needed.
- Recorded: switch to **Recorded**, choose camera, date, start and end time (same day), then **Search recordings** and **Play** (1x to 3x speed). Footage comes from the recorder itself, so how far back it goes depends on the recorder.

Common problems:
- "The device refused the stored credentials." means a wrong username or password.
- "The device address did not answer on the network." means the recorder is off, or can't be reached from the server.
- "This address is outside the networks permitted..." means the recorder must be on the private network or VPN that Crew&Build's server can reach. Public IPs are not allowed.
- Too many checks: wait a minute.
For setup help, the builder or site engineer usually has the recorder details, or contact support.

# Cameras: seeing a site when nobody is there

Veðurvaki can show a camera picture next to each departure, so someone in the office can look at the car park,
the trail head or the harbour before deciding. It does this for two kinds of camera.

| Kind | What it is | How it is shown |
|---|---|---|
| **Page** | A public camera page run by someone else (Vegagerðin road cameras, the Met Office, a partner) | A link that opens in a new tab. The picture is never copied, so the owner's terms are respected |
| **Image** | A snapshot (JPEG) address on **your own** camera | Your server fetches the picture and shows it on the dashboard, refreshed about once a minute |

Set them up in **Admin → Cameras**. A camera is attached to one or more tours (shown in that departure's detail panel) or marked
"for everyone" (a link in the dashboard footer).

## What public cameras exist (honest summary)

I looked for Icelandic cameras that can be reused openly. **I did not find any Icelandic camera feed published under an open licence
that is safe to embed, and I could not confirm a camera API or image address for any of the public sources below** (the sandbox this was built in could not open them).
So the app ships with link-outs only, and you embed pictures only from cameras you own or have permission for.

| Source | What it is | Status |
|---|---|---|
| **Vegagerðin road cameras** | Roadside cameras on main routes, shown on the Umferðin map (umferdin.is) and road.is | Link-out. An EU open-data record lists them with the licence "unknown" (2016); terms and image addresses unconfirmed. **Ask Vegagerðin** whether you may show the images, and how |
| **Icelandic Met Office webcams** | A webcam section on vedur.is (`en.vedur.is/weather/observations/webcams/other/`) | Link-out. The page exists; I could not open it to list cameras or read the terms |
| **aurora.is web cams** | A page collecting road cameras and cloud-cover views, useful for northern-lights tours | Link-out. It credits Vegagerðin as operator |
| **Tourist cameras** (lagoon, waterfalls, volcano views) listed on webcam directories | Private or commercial cameras | Link-out only; whether a feed is online is unverified. The owner's terms apply. Ask for permission or a partnership if you want to embed one |

Elsewhere open camera catalogues do exist (Norway's road administration publishes one), but not for Iceland, as far as I could find.

**Best answer for "see the situation at *our* tour sites": run your own cameras** with open-source software. Public road cameras
are rarely at your meeting point.

## Your own cameras with open-source tools

| Tool | Good for |
|---|---|
| **Frigate** | NVR with object detection (can tell you "a person is in the car park"); bundles go2rtc |
| **go2rtc** | Lightweight: turns a camera's RTSP stream into snapshots, MJPEG, WebRTC, HLS |
| **MediaMTX** | A media server / proxy if you also want live video elsewhere |
| **MotionEye** | Simplest: a web UI for several cheap cameras |
| **ZoneMinder** | Mature, full surveillance system |

Veðurvaki only needs a **snapshot address** that returns a JPEG. Typical addresses (check your version's documentation, and turn authentication on):

* go2rtc: `http://<host>:1984/api/frame.jpeg?src=<stream-name>`
* Frigate: `http://<host>:5000/api/<camera-name>/latest.jpg`
* MotionEye: `http://<host>:8765/picture/<camera-id>/current/`

**Hardware and network at a site:** a weatherproof, cold-rated IP camera with RTSP (PoE), a small always-on computer at the site or base
(a mini PC or Raspberry Pi) running go2rtc or Frigate, and an internet link (a 4G/5G router at remote sites). Connect the site to your server with
a VPN (WireGuard or Tailscale) so the camera is never exposed to the internet.

### Adding one

1. Make the snapshot address work from the server (try it in a browser on the VPN).
2. If it needs a login, put the **full header value** in `.env` on the server, e.g. `CAM_GLACIER_AUTH="Basic dXNlcjpwYXNz"` (base64 of `user:password`), and type only the
   variable name `CAM_GLACIER_AUTH` in the admin form. Passwords never go in the config or the page.
3. A camera on a private network (VPN address like `10.8.0.5`): set `CAMERAS_ALLOW_PRIVATE=1` in `.env` and tick **"This is our own camera"**.
4. Admin → Cameras → **Add camera**: pick the tours, press **Save and test**. A picture should appear in that departure on the dashboard.

## How it stays safe

* The browser never talks to a camera: it asks Veðurvaki, which fetches from addresses an administrator saved. There is no way to make it fetch an arbitrary address.
* **Internal addresses are refused** (localhost, `10.x`, `192.168.x`, link-local and cloud-metadata addresses) unless the camera is marked "own" **and** `CAMERAS_ALLOW_PRIVATE=1`. Redirects are followed manually and every hop is re-checked.
* Only real images are accepted (JPEG, PNG, WebP, GIF; SVG is refused), up to 4 MB, with a timeout.
* Credentials come from `.env`, are never shown in the admin or sent to the dashboard, and the dashboard never learns an image camera's address.
* Pictures are only visible to logged-in staff. Veðurvaki **keeps only the latest frame in memory**: it does not record, store or archive footage.
* A third-party image camera cannot be saved without a written "permission" note, which keeps the licence or agreement on record.

## Privacy and the law (a checklist, not legal advice)

* A camera that can see guests, staff or the public is **electronic surveillance** under Icelandic data-protection law (Act no. 90/2018). Persónuvernd
  expects clear signs, the controller's identity and a lawful purpose, and it has penalised organisations for inadequate signs and for cameras
  covering areas beyond their own premises. Read Persónuvernd's current guidance and sign the site.
* Aim cameras at the car park entrance, the trail head and the sky, not at people. Avoid audio.
* Tell staff. Keep the camera network private. Use strong passwords and keep the firmware up to date.
* Do not embed or re-publish someone else's camera pictures without permission.

## What it does not do (yet)

* No live video, recording, playback or motion alerts. It shows the latest still frame, refreshed about once a minute. (Frigate can send "person detected"
  events; connecting those to alerts would be a separate piece of work.)
* It does not decide anything by itself. A picture can show fog or an empty car park, but not whether a guide is on site or conditions are safe on the ice.
  Use it next to the forecast and your guides' judgement, never instead of them.

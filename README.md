# Middle-Click AutoScroll

A Safari extension for macOS. Middle-click anywhere on a page to arm
autoscroll, then move the pointer to pan the page in any direction — up,
down, left, right, or diagonally — the way autoscroll works in Windows
browsers, which Safari has never supported natively.

## Features

- **Two ways to use it** — a quick click arms autoscroll hands-free (move
  the mouse, no button held); a press-and-drag stops the instant you let go.
- **Speed ramps with distance** from where you clicked, with a small dead
  zone so you don't scroll by accident.
- **Axis snapping** — near-straight drags lock to one axis so small hand
  tremor doesn't cause diagonal drift.
- **Scroll bubbling** — if the scrollable box you started in (a sidebar, a
  code block) hits its own limit, autoscroll keeps going on the page behind
  it instead of getting stuck.
- A compass cursor shows only the directions actually in effect.
- Per-site enable/disable, adjustable speed, and an invert-direction option.
- Middle-clicking a link still opens it in a new tab, as usual — autoscroll
  only arms over non-interactive content.
- Optional, opt-in automatic update checks, with a manual "Check now" option
  — never installs anything without you clicking through to the release
  page.

## Installation

Download the latest `MiddleClickAutoScroll-*.dmg` from the
[Releases page](https://github.com/Micropeptide/MiddleClick-AutoScroll-Safari/releases),
open it, and drag **Middle-Click AutoScroll** into your Applications folder.

It isn't notarized by Apple, so the first time you open it, right-click (or
Control-click) the app and choose **Open**, then confirm in the dialog that
appears. You only need to do this once.

Then:
1. Launch **Middle-Click AutoScroll** once (from Applications) — a small
   window opens with a link straight to Safari's extension settings.
2. In Safari, go to **Settings → Extensions**, enable **Middle-Click
   AutoScroll**, and grant it access to the websites you want (or "All
   Websites").
3. If Safari hides it from that list entirely: enable **Settings →
   Advanced → "Show features for web developers"**, then use the new
   **Develop** menu → **"Allow Unsigned Extensions"**. This resets each time
   Safari fully quits — expected for a non–App Store extension.

Requires macOS 13 (Ventura) or later, Safari 16.4+.

## Usage

- **Middle-click** on empty page content (not a link, button, video,
  slider, or text field) to arm autoscroll. A faint dashed circle marks
  where you clicked.
- **Move the pointer** away from that spot to scroll — the farther you
  move, the faster it scrolls.
- **Stop** by clicking any button, pressing `Esc`, or — if you pressed and
  dragged rather than clicked — simply releasing the button.

Click the toolbar icon for settings: enable/disable (globally and per
site), scroll speed, invert direction, an opt-in "stop on scroll wheel"
toggle, and update checks.

### Why isn't scroll-wheel-to-cancel on by default?

On mice where the scroll wheel doubles as the middle-click button, pressing
it can mechanically wobble the wheel and fire a tiny spurious `wheel`
event — which would cancel autoscroll the instant it starts. Turn it on in
settings if your mouse doesn't have that quirk and you'd like the option.

## Building from source

This is an Xcode project wrapping a standard WebExtension (`extension/` —
manifest v3, no build step, no dependencies).

1. Open `Middle-Click AutoScroll/Middle-Click AutoScroll.xcodeproj` in Xcode.
2. Set your team under **Signing & Capabilities** for both the app and
   extension targets ("Sign to Run Locally" works for local testing).
3. Cmd+R to build and run, then follow the same Safari-side steps as above.

`extension/` is referenced directly by the Xcode project (not copied), so
editing those files and rebuilding is all you need for changes to take
effect. `generate_icons.py` regenerates the app/extension icon (needs
`pip install pillow numpy`). `build_dmg.sh` packages a Release build into a
distributable DMG.

## Notes & limitations

- Autoscroll is driven by a content script, so it only scrolls the frame
  the pointer is in. If the pointer crosses into a same-page iframe (an ad,
  an embed), scrolling pauses rather than running away at a stale speed,
  resuming once the pointer is confirmed back over the page.
- It doesn't stop on window `blur` — embedded iframes/widgets frequently
  steal DOM focus without you actually switching tabs or apps, which used
  to cancel autoscroll unpredictably mid-scroll, especially on long pages
  with lazy-loaded ads. Switching tabs (or the page becoming hidden) still
  stops it.
- A same-button re-press within ~200ms of arming or stopping is ignored —
  this absorbs the mechanical "bounce" some middle-click switches produce,
  which could otherwise instantly cancel autoscroll right as it starts, or
  silently re-arm it right after you click to stop.

## License

MIT

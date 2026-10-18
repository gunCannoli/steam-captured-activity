# Steam Captured Activity

A [Millennium](https://steambrew.app) plugin for the Steam client that puts the screenshots and recordings you
captured in each game's **Activity** feed, in Steam's own style.

Steam normally leaves your captures out of the Activity feed unless you upload them to the Steam Community. This
plugin uses only what Steam already has on your PC: nothing is uploaded, nothing is downloaded, and no account or key
is needed.

## Features

- One card per day with captures, headlined **"{your name} captured"**.
- Your screenshots and clips as 16:9 cards, with clips playable in place and their length shown on the card.
- Works for Steam games **and** non-Steam games (shortcuts you added to your library).
- Works on the desktop and in Big Picture.

[![Captured cards in a non-Steam game's Activity feed](.github/example.png)](.github/example.png)

## Prerequisites

- [Millennium](https://steambrew.app) installed on your Steam client.

## Install

Install **Steam Captured Activity** from Millennium's plugin library, then restart Steam.

To install by hand, clone this repository into your Steam `millennium/plugins` folder, build it, and restart Steam:

```bash
npm install
npm run build
```

## Settings

Open Steam's Millennium settings and pick **Steam Captured Activity**:

| Option | Default | What it does |
| --- | --- | --- |
| Steam games support | On | Your captures in the Activity feed of Steam games |
| Non-Steam games support | On | Your captures in the Activity feed of non-Steam games |

## Notes

- **Deleted captures:** the feed follows what Steam lists. When you delete a screenshot or a recording, it leaves the
  feed the next time you open that game's page, or within 5 minutes if the page stays open.
- **Many screenshots:** a game with more than 100 screenshots shows all of them.
- **Works with Steam Cartridges:** [Steam Cartridges](https://github.com/gunCannoli) gives non-Steam games Steam's
  full detail page (Game Info, artwork, achievements). The two plugins are independent: each works without the other,
  and together a non-Steam game's feed shows both its captures and its achievements.

## About

Shows the screenshots and recordings Steam captured in each game's Activity feed, as daily 16:9 cards with inline clip
playback, for Steam games and non-Steam shortcuts.

## License

MIT

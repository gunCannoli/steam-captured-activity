# Steam Captured Activity

A [Millennium](https://steambrew.app) plugin for the Steam client. It shows the screenshots and recordings you
captured in each game's **Activity** feed, in Steam's own style:

- one card per day with captures, headlined **"{your name} captured"**;
- your screenshots and clips as 16:9 cards, with clips playable in place;
- for Steam games **and** non-Steam games (shortcuts you added to your library);
- on the desktop and in Big Picture.

Steam normally leaves your captures out of the Activity feed unless you upload them to the Steam Community. This
plugin uses only what Steam already has on your PC: nothing is uploaded, nothing is downloaded, and no account or key
is needed.

## Settings

Open Steam's Millennium settings and pick **Steam Captured Activity**:

| Option | Default | What it does |
| --- | --- | --- |
| Steam games support | On | Your captures in the Activity feed of Steam games |
| Non-Steam games support | On | Your captures in the Activity feed of non-Steam games |

## Deleted captures

The feed follows what Steam lists. When you delete a screenshot or a recording, it leaves the feed the next time you
open that game's page, or within 5 minutes if the page stays open.

## Works with

[Steam Cartridges](https://github.com/gunCannoli) gives non-Steam games Steam's full detail page (Game Info, artwork,
achievements). The two plugins are independent: each works without the other, and together a non-Steam game's feed
shows both its captures and its achievements.

## License

MIT

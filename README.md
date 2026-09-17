# Importand Note:
Since I needed a version of df-active-light for v14 for my own gaming sessions, and there was no update to df-active-light beyond v12 in sight, and I also didn’t have the time to manually update it to v14 myself (my day is only so long), I had Claude’s Opus 5 model converted to v14. So this is a massive AI overhaul of the module, and I only tested it afterward (I actually didn’t write a single line of code manually here).

I hope there will be a proper, human-made v14 version of flamewave here someday. Until then, anyone who comes across it can give the result of this overhaul a try if necessary.

Again: **This is a module that has been extensively reworked by AI** (and I’m not happy about it, but due to time constraints, I have no other choice).


# DragonFlagon Active Lights

> **Foundry VTT v14 port (unofficial, 3.0.0).** This version only runs on Foundry VTT v14. The `manifest`/`download`
> URLs were removed from `module.json` on purpose, so Foundry will not "update" it back to the original v12 release.
> Existing animations (stored in the light flags) are kept as they are.

This module provides a way to animate all the various configurations of a light. This animation will be synchronized with the server so that all players should see the same animation states. A simple example for this would be for creating a simple Light House where the light's direction would animate all the way around a 180° rotation. The configuration window for Active Lights can be opened from the Light Animation tab in any Ambient Light config window.

## Animation Functions

The way animations work is that at time T, the position along the transition is at a deterministic position along a mathematical curve. This is some really fancy talk for basically making a dot follow a line.

Take this animation for example:
- Key Frame: 0 Seconds
	- Bright Radius: 0 feet
- Key Frame: 2 Seconds
	- Bright Radius: 40 feet

Given a Linear animation, the following are the results over time:
|0s|0.25s|0.5s|0.75s|1s|
|:-:|:-:|:-:|:-:|:-:|
|0 ft|10 ft|20 ft|30 ft|40 ft|

The same key frames but with an Elliptic Animation would have these results:
|0s|0.25s|0.5s|0.75s|1s|
|:-:|:-:|:-:|:-:|:-:|
|0 ft|15.31 ft|28.28 ft|36.96 ft|40 ft|

### Contributors

- Tonishi & [BrotherSharper](https://github.com/BrotherSharper): Japanese Localization


**[![become a patron for flamewave000](../.assets/patreon-image.png)](https://www.patreon.com/bePatron?u=46113583) If you want to support me or just help me buy doggy treats! Also, you can keep up to date on what I'm working on. I will be announcing any new modules or pre-releases there for anyone wanting to help me test things out!**

## Changelog

You can find all the latest updates [in the CHANGELOG](./CHANGELOG.md)
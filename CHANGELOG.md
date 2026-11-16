# Changelog

## 0.2.0

Hooks that games asked for while moving onto the engine (Nullgard and casa-voxel).

- **audio**: `Sfx` can be extended. `engine`, `ctx`, `output()` and `send()` are now `protected`, so
  a subclass builds its own sounds with the same routing (bus, pan, reverb and echo sends) as the
  built-in effects.
- **audio**: `GameAudio<S>` takes an `sfx` factory to use your own `Sfx` subclass (returned by
  `play()` and the new `sfx` getter), `addScheduler()` to run extra sound sources (for example a
  second `Playback` on a filtered bus) in its loop, and a `state` getter with the context state.
- **kit**: `Dialogue<L>` is generic over the line type, and the new `present` option derives each
  line's speaker label and style, so a game can keep its own line shape.
- **render**: `buildScene` also returns `room` and `instances` (one holder per instance, in order).
  The editor uses them instead of relying on the order of `group.children`.
- **render**: `VoxelMesh` takes `{ cutY }` in its constructor, so a cut mesh is built once.
- **editor**: `/editor/?play=<url>` opens your own game from Play; the editor no longer asks for the
  dev disk API on the published site.

## 0.1.0

First public release: core, render, audio, kit, paint, the editor and the examples.

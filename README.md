# TPA Tools (Meteor Client addon) — macOS Compatibility

`mods/tpatools.jar` is a client-side [Meteor Client](https://meteorclient.com/) addon for Fabric
(mod id `tpa-tools`, v1.6.1) targeting Minecraft `1.21.11` on Java `21+`. It adds the following
modules: `TPABurst`, `AutoLootSell`, `AutoStrength`, `SpawnerNotifier`, plus in-memory
`KillHistory`/`LootHistory` tracking.

## Compatibility analysis

The jar was inspected directly (decompiled bytecode, manifest, and full constant-pool string
scan) to check for anything that would prevent it from running on macOS:

| Check | Result |
|---|---|
| Class file version | All classes compiled to major version `65` (Java 21) — matches the mod's declared `java: ">=21"` requirement and runs on any Java 21 JVM (Intel or Apple Silicon). |
| Native libraries (`.dylib`/`.so`/`.dll`) | None bundled. |
| OS-specific branching (`os.name` checks, etc.) | None found anywhere in the jar. |
| Hardcoded file paths | None — `HistoryStore` (kill/loot history) is purely in-memory; the jar performs no disk I/O of its own. |
| Process execution / `Runtime.exec` / `ProcessBuilder` | Not used. |
| AWT `Robot`, clipboard, Windows registry, JNA/JNI | Not used. |
| External dependencies | Only Meteor Client API, Fabric-intermediary Minecraft classes, Mojang Brigadier, and JOML — all pure-JVM, cross-platform libraries. |

**Conclusion:** the jar contains no Windows-specific or platform-conditional code. It is ordinary
portable JVM bytecode, so it already runs identically on macOS, Windows, and Linux given a
matching Java/Fabric/Meteor Client setup — no code changes were needed.

## Installing on macOS

1. Install a Java 21 JDK/JRE (e.g. via `brew install openjdk@21`, or use the JRE bundled with the
   Minecraft Launcher for 1.21.x).
2. Install [Fabric Loader](https://fabricmc.net/use/) for Minecraft `1.21.11`.
3. Install the [Meteor Client](https://meteorclient.com/) jar for `1.21.11` into your mods folder.
4. Copy `mods/tpatools.jar` into the same mods folder:
   ```
   ~/Library/Application Support/minecraft/mods/
   ```
   (this is the macOS equivalent of `%APPDATA%\.minecraft\mods` on Windows).
5. Launch Minecraft via the Fabric profile. The `TPA Tools` category should appear in the Meteor
   Client module list.

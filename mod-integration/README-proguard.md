# Hardening the jar against decompilation

`proguard.pro` in this folder is a ProGuard rules file that hardens a
built Fabric/Meteor Client addon jar against exactly what happened earlier
in this project: someone ran a decompiler (CFR) against the compiled jar
and got back clean, readable Java source — real class names (`TPABurst`),
real field names (`requestDelay`), real method names
(`onPacketReceive`) — good enough to hand to another AI and get a working
reconstruction back.

## What this actually does (verified, not just claimed)

I built a small dummy jar shaped like the real addon (a `Module` subclass
with a private field, a helper method, and an `@EventHandler`-annotated
method, plus the Fabric entrypoint class) and ran these exact rules against
it. Before → after:

- `TPABurst` → class `a`
- its `secretDelayTicks` field → `a`
- its `helperMath` helper → inlined away completely, no longer exists as a
  separate method for a decompiler to show
- `onTick` (the `@EventHandler` method) → kept as `onTick`, on purpose:
  Meteor's Orbit event bus finds handlers by that annotation at runtime, so
  renaming it would silently break event delivery
- `TPABurstAddon` (the Fabric entrypoint) → kept as-is, name and all:
  `fabric.mod.json` references it by exact string, so Fabric Loader has no
  way to follow a rename

Then I actually ran the obfuscated jar's `onInitialize()` and confirmed it
executes without error — this isn't a rules file that looks right, it's one
that was checked to still work.

## Running it

You need the ProGuard CLI (`proguard.jar`, from
https://github.com/Guardsquare/proguard/releases — GPL-licensed, free) and
the compiled jar you want to harden.

```bash
java -jar proguard.jar @proguard.pro \
  -injars tpatools.jar \
  -outjars tpatools-obfuscated.jar \
  -libraryjars "<path-to-minecraft-client.jar>" \
  -libraryjars "<path-to-fabric-api.jar>" \
  -libraryjars "<path-to-meteor-client.jar>" \
  -libraryjars "<java.home>/jmods"
```

The `-libraryjars` entries need to cover everything the mod calls into but
doesn't itself define, so ProGuard can tell "defined here, safe to rename"
apart from "defined elsewhere, must not touch." The easiest way to gather
them without a full Gradle/Loom project: point at the actual jars already
sitting in a working Fabric instance's `mods/` folder (Fabric API, Meteor
Client) plus the vanilla client jar from the launcher's version folder.

**Test in-game after every run.** Reflection-based discovery (if Meteor or
Fabric API finds any of your classes by scanning rather than by a direct
`new Foo()` in your own code) is the single most common thing this kind of
aggressive renaming silently breaks. If a module stops showing up or you
get a `NoSuchMethodError`/`ClassNotFoundException`, that's ProGuard having
removed or renamed something that was actually reached reflectively — add
a targeted `-keep` rule for that specific class/method and re-run.

## What this doesn't do

It defeats a five-minute "decompile it and read/hand it to an AI" pass —
which is genuinely most of what happened here. It does not make the jar
unreadable to someone willing to spend real time on it: Minecraft/Meteor
API calls still appear by their real (if obfuscated-looking) intermediary
names, and a patient reverse engineer can still work through renamed,
flattened control flow given enough time. Same honest ceiling as
everything else in this project: raises the cost of casual cracking, isn't
a wall against a determined one.

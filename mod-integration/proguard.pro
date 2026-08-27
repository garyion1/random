# ProGuard rules for hardening a Fabric/Meteor Client addon jar against
# decompilation. Run this as a post-build step over the already-compiled
# jar (see mod-integration/README-proguard.md for the exact command).
#
# What this buys you: the readable, CFR-decompiled source we got back
# earlier (real class/method/field names, e.g. "TPABurst", "requestDelay",
# "onPacketReceive") only came out clean because the jar wasn't obfuscated.
# After this, decompiling the jar produces classes named a/b/c with fields
# and methods named a/b/c/d, no line numbers, no local variable names, and
# flattened/inlined control flow. It's much harder to read by hand or feed
# to another decompiler/AI and get something useful back -- it does not
# make decompilation impossible for someone willing to put in real effort.

-dontusemixedcaseclassnames
-allowaccessmodification
-optimizationpasses 5
-repackageclasses ''

# Don't keep debugging info -- this is what strips the readable names,
# line numbers and original file name that made the earlier decompile easy
# to follow. You lose useful stack traces for your own debugging in
# exchange; that's the actual tradeoff, not a free lunch.
-keepattributes !LineNumberTable,!LocalVariableTable,!LocalVariableTypeTable,!SourceFile,!SourceDir

# Standard enum support -- without this, obfuscating enums that use
# values()/valueOf() breaks at runtime.
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# The Fabric entrypoint class is referenced by fully-qualified name from
# fabric.mod.json as a plain string, so Fabric Loader has no way to follow
# a rename -- and since it's never directly `new`'d from your own code,
# ProGuard's shrinker has no other reason to know it's reachable at all.
# Plain -keep (not -keepnames) is required here: it stops both the rename
# AND the shrinker from deleting it and everything it calls into as unused.
# Replace with your actual entrypoint class.
-keep class me.tpaburst.TPABurstAddon { *; }

# Meteor Client's Orbit event bus finds handlers via this annotation at
# runtime; if the method gets renamed, the bus can no longer find it.
-keepclassmembers class * {
    @meteordevelopment.orbit.EventHandler *;
}

# If your build depends on classpath scanning (Meteor/Fabric API discovering
# implementations by type rather than by an explicit `new Foo()` call
# somewhere in your own code), also add a rule keeping the *structure* of
# affected classes, e.g.:
#   -keep class * extends meteordevelopment.meteorclient.systems.modules.Module {
#       <init>();
#   }
# Whether you need this depends on how your addon registers modules --
# test in-game after obfuscating either way; reflection is the single most
# common thing overly-aggressive obfuscation silently breaks.

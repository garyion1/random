package me.tpaburst;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.metadata.ModOrigin;
import net.minecraft.client.MinecraftClient;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Reference implementation, not drop-in code: adapt names/paths to your
 * actual project layout. Wire {@link #check(Consumer)} into a
 * ClientLifecycleEvents.CLIENT_STARTED listener from TPABurstAddon#onInitialize,
 * and only register your real modules in the callback once check() reports
 * success — see the comment at the bottom for the wiring.
 *
 * Point LICENSE_API_URL at wherever you deployed license-bot/, and set
 * API_SHARED_SECRET to the same value as that server's API_SHARED_SECRET env var.
 */
public final class LicenseGate {
    private static final String LICENSE_API_URL = "https://license.yourdomain.com/validate";
    private static final String API_SHARED_SECRET = "REPLACE_WITH_YOUR_SHARED_SECRET";

    // If the server is unreachable (not: reachable-but-invalid), allow the
    // mod to keep working on a cached success for this long before requiring
    // a fresh check. Set to Duration.ZERO to always require a live check.
    private static final Duration OFFLINE_GRACE = Duration.ofHours(72);

    private static final Path CONFIG_DIR = FabricLoader.getInstance().getConfigDir().resolve("tpa-tools");
    private static final Path LICENSE_KEY_FILE = CONFIG_DIR.resolve("license.txt");
    private static final Path CACHE_FILE = CONFIG_DIR.resolve("license-cache.txt");

    private static final Gson GSON = new Gson();
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();

    private LicenseGate() {}

    public enum Result { VALID, INVALID, UNREACHABLE_BUT_CACHED }

    /**
     * Runs the license check off-thread and calls back on completion.
     * onResult receives VALID (register your modules) or anything else
     * (don't -- and tell the player why via chat/log).
     */
    public static void check(Consumer<Result> onResult) {
        Thread thread = new Thread(() -> onResult.accept(checkBlocking()), "tpa-tools-license-check");
        thread.setDaemon(true);
        thread.start();
    }

    private static final ScheduledExecutorService SCHEDULER =
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "tpa-tools-license-recheck");
            t.setDaemon(true);
            return t;
        });

    /**
     * Re-runs the check on a fixed interval for as long as the game is open,
     * so a key revoked (or unbound) mid-session takes effect within one
     * interval instead of only on next launch. Call this once, right after
     * the initial {@link #check(Consumer)} succeeds -- see the wiring
     * example at the bottom of this file for how to actually pull modules
     * back out when onResult reports something other than VALID.
     */
    public static void startPeriodicRecheck(Duration interval, Consumer<Result> onResult) {
        SCHEDULER.scheduleWithFixedDelay(
            () -> onResult.accept(checkBlocking()),
            interval.toMillis(), interval.toMillis(), TimeUnit.MILLISECONDS
        );
    }

    private static Result checkBlocking() {
        String key = readLicenseKey();
        if (key == null || key.isBlank()) {
            System.err.println("[TPA Tools] No license key configured in " + LICENSE_KEY_FILE);
            return Result.INVALID;
        }

        MinecraftClient client = MinecraftClient.getInstance();
        String uuid = client.getSession().getUuidOrNull() != null
            ? client.getSession().getUuidOrNull().toString()
            : null;
        String username = client.getSession().getUsername();

        if (uuid == null) {
            System.err.println("[TPA Tools] No Minecraft session yet, denying by default.");
            return Result.INVALID;
        }

        JsonObject body = new JsonObject();
        body.addProperty("key", key.trim());
        body.addProperty("minecraft_uuid", uuid);
        body.addProperty("minecraft_username", username);
        computeJarHash().ifPresent(hash -> body.addProperty("jar_sha256", hash));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(LICENSE_API_URL))
            .header("Content-Type", "application/json")
            .header("X-Api-Secret", API_SHARED_SECRET)
            .timeout(Duration.ofSeconds(10))
            .POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body), StandardCharsets.UTF_8))
            .build();

        try {
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            JsonObject json = GSON.fromJson(response.body(), JsonObject.class);
            boolean valid = json.has("valid") && json.get("valid").getAsBoolean();

            if (valid) {
                writeCache(true);
                return Result.VALID;
            }

            String reason = json.has("reason") ? json.get("reason").getAsString() : "unknown";
            System.err.println("[TPA Tools] License invalid: " + reason);
            writeCache(false);
            return Result.INVALID;
        } catch (IOException | InterruptedException e) {
            System.err.println("[TPA Tools] Could not reach license server: " + e.getMessage());
            return checkCacheForGracePeriod();
        }
    }

    /**
     * Hashes the actual jar file this mod was loaded from, so the server can
     * tell if it's been modified (most commonly: someone patched this exact
     * license check out of their local copy). Register the hash of every
     * build you ship with the bot's /addhash command -- an unrecognized hash
     * gets logged and alerted, not silently ignored.
     */
    private static Optional<String> computeJarHash() {
        try {
            var container = FabricLoader.getInstance().getModContainer("tpa-tools");
            if (container.isEmpty()) return Optional.empty();

            ModOrigin origin = container.get().getOrigin();
            var paths = origin.getPaths();
            if (paths.isEmpty()) return Optional.empty();

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (Path path : paths) {
                digest.update(Files.readAllBytes(path));
            }
            return Optional.of(HexFormat.of().formatHex(digest.digest()));
        } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
            System.err.println("[TPA Tools] Could not hash own jar: " + e.getMessage());
            return Optional.empty();
        }
    }

    private static String readLicenseKey() {
        try {
            if (!Files.exists(LICENSE_KEY_FILE)) return null;
            return Files.readString(LICENSE_KEY_FILE, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    private static void writeCache(boolean valid) {
        try {
            Files.createDirectories(CONFIG_DIR);
            Properties props = new Properties();
            props.setProperty("valid", String.valueOf(valid));
            props.setProperty("checkedAt", Instant.now().toString());
            try (var out = Files.newOutputStream(CACHE_FILE)) {
                props.store(out, "TPA Tools license cache -- do not edit");
            }
        } catch (IOException ignored) {
            // Cache is best-effort; failing to write it just means no offline grace period next time.
        }
    }

    private static Result checkCacheForGracePeriod() {
        try {
            if (!Files.exists(CACHE_FILE)) return Result.INVALID;
            Properties props = new Properties();
            try (var in = Files.newInputStream(CACHE_FILE)) {
                props.load(in);
            }
            boolean wasValid = Boolean.parseBoolean(props.getProperty("valid", "false"));
            Instant checkedAt = Instant.parse(props.getProperty("checkedAt"));
            if (wasValid && Duration.between(checkedAt, Instant.now()).compareTo(OFFLINE_GRACE) < 0) {
                return Result.UNREACHABLE_BUT_CACHED;
            }
        } catch (Exception ignored) {
            // fall through to INVALID
        }
        return Result.INVALID;
    }
}

/*
 * Wiring into TPABurstAddon (pseudocode -- adapt to your actual class),
 * including a live kill switch so a Discord /revoke actually pulls the
 * modules out of a session that's already running, not just blocks the
 * next launch:
 *
 *   private static List<Module> registered = List.of();
 *   private static boolean disabled = false;
 *
 *   @Override
 *   public void onInitialize() {
 *       ClientLifecycleEvents.CLIENT_STARTED.register(client -> {
 *           LicenseGate.check(result -> {
 *               if (result == LicenseGate.Result.VALID || result == LicenseGate.Result.UNREACHABLE_BUT_CACHED) {
 *                   registered = List.of(new TPABurst(), new AutoLootSell(), new AutoStrength(), new SpawnerNotifier());
 *                   registered.forEach(m -> Modules.get().add(m));
 *
 *                   // Re-check every 5 minutes for the rest of the session. A
 *                   // /revoke or /unbind in Discord takes effect the next time
 *                   // this fires, not instantly -- there's no server-to-client
 *                   // push here, only polling.
 *                   LicenseGate.startPeriodicRecheck(Duration.ofMinutes(5), recheckResult -> {
 *                       if (recheckResult == LicenseGate.Result.INVALID && !disabled) {
 *                           disabled = true;
 *                           client.execute(() -> {
 *                               for (Module m : registered) {
 *                                   if (m.isActive()) m.toggle();
 *                                   Modules.get().remove(m);
 *                               }
 *                           });
 *                           System.err.println("[TPA Tools] License revoked -- modules disabled for this session.");
 *                       }
 *                   });
 *               } else {
 *                   System.err.println("[TPA Tools] License check failed -- modules not loaded.");
 *               }
 *           });
 *       });
 *   }
 *
 * Registering/removing modules from a background thread's callback: make
 * sure Modules.get().add/remove(...) is safe to call off the render thread
 * for your Meteor Client version, or hop back via client.execute(...) as
 * shown above if not.
 */

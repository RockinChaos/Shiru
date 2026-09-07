package watch.shiru.plugin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import watch.shiru.MainActivity;
import watch.shiru.R;

@CapacitorPlugin(name = "MediaSession")
public class MediaSession extends Plugin {

  static final String ACTION_PLAY = "watch.shiru.action.MEDIA_PLAY";
  static final String ACTION_PAUSE = "watch.shiru.action.MEDIA_PAUSE";
  static final String ACTION_PREVIOUS = "watch.shiru.action.MEDIA_PREVIOUS";
  static final String ACTION_NEXT = "watch.shiru.action.MEDIA_NEXT";

  private static final String CHANNEL_ID = "media-playback";
  private static final int SESSION_ID = 1002;
  private static WeakReference<MediaSession> instance = new WeakReference<>(null);

  private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private android.media.session.MediaSession mediaSession;
  private NotificationManager notificationManager;
  private String title = "";
  private String subtitle = "";
  private String artworkUrl = "";
  private Bitmap artwork;
  private boolean active;
  private boolean playing;
  private boolean hasLast;
  private boolean hasNext;
  private long position = PlaybackState.PLAYBACK_POSITION_UNKNOWN;
  private long duration;
  private float playbackSpeed = 1f;
  private int artworkRequest;

  public static class Receiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
      if (ACTION_PLAY.equals(intent.getAction())) {
        dispatchNotificationAction("play");
      } else if (ACTION_PAUSE.equals(intent.getAction())) {
        dispatchNotificationAction("pause");
      } else if (ACTION_PREVIOUS.equals(intent.getAction())) {
        dispatchNotificationAction("last");
      } else if (ACTION_NEXT.equals(intent.getAction())) {
        dispatchNotificationAction("next");
      }
    }
  }

  @Override
  public void load() {
    instance = new WeakReference<>(this);
    notificationManager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    createNotificationChannel();

    mediaSession = new android.media.session.MediaSession(getContext(), getContext().getString(R.string.app_name));
    mediaSession.setFlags(
        android.media.session.MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
            | android.media.session.MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
    );
    mediaSession.setSessionActivity(createSessionActivity());
    mediaSession.setCallback(new android.media.session.MediaSession.Callback() {
      @Override
      public void onPlay() {
        notifyMediaAction("play");
      }

      @Override
      public void onPause() {
        notifyMediaAction("pause");
      }

      @Override
      public void onSkipToPrevious() {
        notifyMediaAction("last");
      }

      @Override
      public void onSkipToNext() {
        notifyMediaAction("next");
      }
    });
  }

  @PluginMethod
  public void setPlaybackState(PluginCall call) {
    boolean nextActive = call.getBoolean("active", false);
    if (!nextActive) {
      deactivate();
      call.resolve();
      return;
    }

    active = true;
    playing = call.getBoolean("playing", false);
    hasLast = call.getBoolean("hasLast", false);
    hasNext = call.getBoolean("hasNext", false);
    title = call.getString("title", "");
    subtitle = call.getString("subtitle", "");
    position = secondsToMilliseconds(call.getDouble("position", -1d));
    duration = secondsToMilliseconds(call.getDouble("duration", 0d));
    playbackSpeed = call.getDouble("playbackRate", 1d).floatValue();

    String nextArtworkUrl = call.getString("artwork", "");
    if (!nextArtworkUrl.equals(artworkUrl)) {
      artworkUrl = nextArtworkUrl;
      artwork = null;
      loadArtwork(nextArtworkUrl, ++artworkRequest);
    }

    updateMetadata();
    updatePlaybackState();
    mediaSession.setActive(true);
    updateNotification();
    call.resolve();
  }

  @PluginMethod
  public void exitPiP(PluginCall call) {
    if (getActivity() == null) {
      call.reject("The player activity is unavailable");
      return;
    }

    getActivity().runOnUiThread(() -> {
      Intent intent = new Intent(getActivity(), MainActivity.class)
          .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
      getActivity().startActivity(intent);
      call.resolve();
    });
  }

  private void updateMetadata() {
    MediaMetadata.Builder metadata = new MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
        .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
        .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle);
    if (duration > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
    if (artwork != null) {
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
      metadata.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);
    }
    mediaSession.setMetadata(metadata.build());
  }

  private void updatePlaybackState() {
    int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
    float speed = playing ? playbackSpeed : 0f;
    long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE;
    if (hasLast) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
    if (hasNext) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
    mediaSession.setPlaybackState(
        new PlaybackState.Builder().setActions(actions).setState(state, position, speed).build()
    );
  }

  private void updateNotification() {
    if (!active) return;

    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(getContext(), CHANNEL_ID)
        : new Notification.Builder(getContext());
    Notification.MediaStyle style = new Notification.MediaStyle()
        .setMediaSession(mediaSession.getSessionToken());

    builder
        .setSmallIcon(R.drawable.ic_filled)
        .setContentTitle(title)
        .setContentText(subtitle)
        .setLargeIcon(artwork)
        .setContentIntent(createSessionActivity())
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setCategory(Notification.CATEGORY_TRANSPORT)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setOngoing(true);

    int actionCount = 0;
    if (hasLast) {
      builder.addAction(createNotificationAction(android.R.drawable.ic_media_previous, "Last", ACTION_PREVIOUS, 2));
      actionCount++;
    }
    builder.addAction(createNotificationAction(
        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
        playing ? "Pause" : "Play",
        playing ? ACTION_PAUSE : ACTION_PLAY,
        playing ? 1 : 0
    ));
    actionCount++;
    if (hasNext) {
      builder.addAction(createNotificationAction(android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 3));
      actionCount++;
    }

    int[] compactActions = new int[actionCount];
    for (int i = 0; i < actionCount; i++) compactActions[i] = i;
    notificationManager.notify(SESSION_ID, builder.setStyle(style.setShowActionsInCompactView(compactActions)).build());
  }

  private Notification.Action createNotificationAction(int icon, String title, String action, int requestCode) {
    Intent intent = new Intent(getContext(), Receiver.class).setAction(action);
    PendingIntent pendingIntent = PendingIntent.getBroadcast(
        getContext(),
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    return new Notification.Action.Builder(icon, title, pendingIntent).build();
  }

  private PendingIntent createSessionActivity() {
    Intent intent = new Intent(getContext(), MainActivity.class)
        .setAction(Intent.ACTION_VIEW)
        .setData(Uri.parse("shiru://player/"))
        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    return PendingIntent.getActivity(
        getContext(),
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
  }

  private void createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID,
        "Media Playback",
        NotificationManager.IMPORTANCE_LOW
    );
    channel.setDescription("Playback controls for the current video");
    channel.setShowBadge(false);
    channel.setSound(null, null);
    channel.enableVibration(false);
    notificationManager.createNotificationChannel(channel);
  }

  private void loadArtwork(String source, int request) {
    if (source.isEmpty()) return;
    artworkExecutor.execute(() -> {
      Bitmap result = null;
      HttpURLConnection connection = null;
      try {
        connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(5_000);
        connection.setReadTimeout(5_000);
        try (InputStream input = connection.getInputStream()) {
          result = BitmapFactory.decodeStream(input);
        }
      } catch (Exception ignored) {
        // The notification remains useful without remote artwork.
      } finally {
        if (connection != null) connection.disconnect();
      }

      Bitmap loadedArtwork = result;
      mainHandler.post(() -> {
        if (active && request == artworkRequest && source.equals(artworkUrl)) {
          artwork = loadedArtwork;
          updateMetadata();
          updateNotification();
        }
      });
    });
  }

  private void notifyMediaAction(String action) {
    JSObject event = new JSObject();
    event.put("action", action);
    notifyListeners("mediaAction", event);
  }

  static void dispatchNotificationAction(String action) {
    MediaSession plugin = instance.get();
    if (plugin != null && plugin.active) plugin.notifyMediaAction(action);
  }

  public static void dispatchPiPChanged(boolean isInPictureInPictureMode) {
    MediaSession plugin = instance.get();
    if (plugin == null) return;
    JSObject event = new JSObject();
    event.put("isInPictureInPictureMode", isInPictureInPictureMode);
    plugin.notifyListeners("pictureInPictureModeChanged", event);
  }

  private long secondsToMilliseconds(double seconds) {
    if (seconds < 0 || !Double.isFinite(seconds)) return PlaybackState.PLAYBACK_POSITION_UNKNOWN;
    return Math.round(seconds * 1_000);
  }

  private void deactivate() {
    if (!active) return;
    active = false;
    artworkRequest++;
    artworkUrl = "";
    artwork = null;
    mediaSession.setActive(false);
    mediaSession.setMetadata(null);
    notificationManager.cancel(SESSION_ID);
  }

  @Override
  protected void handleOnDestroy() {
    deactivate();
    artworkExecutor.shutdownNow();
    mainHandler.removeCallbacksAndMessages(null);
    if (mediaSession != null) {
      mediaSession.release();
      mediaSession = null;
    }
    if (instance.get() == this) instance.clear();
    super.handleOnDestroy();
  }
}
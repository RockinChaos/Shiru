package watch.shiru;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.content.res.Configuration;
import com.getcapacitor.BridgeActivity;

import watch.shiru.plugin.FileManager;
import watch.shiru.plugin.MediaSession;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(FileManager.class);
    registerPlugin(MediaSession.class);

    super.onCreate(savedInstanceState);

    // WebViews default 8px minimum font size breaks percentage-based root font sizes,
    // corrupting rem-based layout calculations.
    WebSettings settings = getBridge().getWebView().getSettings();
    settings.setMinimumFontSize(0);
    settings.setMinimumLogicalFontSize(0);
    settings.setTextZoom(100);

    setupWebViewInsets();
    setupStatusBarOverlay();

    ServiceWorkerController swController = ServiceWorkerController.getInstance();
    swController.setServiceWorkerClient(new ServiceWorkerClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
        if (request.getUrl().toString().contains("index.html")) {
          request.getRequestHeaders().put("Accept", "text/html");
        }
        return bridge.getLocalServer().shouldInterceptRequest(request);
      }
    });
  }

  @Override
  public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
    MediaSession.dispatchPiPChanged(isInPictureInPictureMode);
  }

  /**
   * Fixes Capacitor v8 padding the WebView below the notch on WebView < 140.
   *
   * Injects system insets (navigation bar, gesture bar, display cutout)
   * as CSS variables so the UI can respond to them appropriately.
   */
  private void setupWebViewInsets() {
    ViewCompat.setOnApplyWindowInsetsListener((View) getBridge().getWebView().getParent(), (view, insets) -> {
      Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
      boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
      view.setPadding(0, 0, 0, keyboardVisible ? imeInsets.bottom : 0);

      Insets systemInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      Insets navBarInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
      Insets cutoutInsets = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
      float density = getResources().getDisplayMetrics().density;
      boolean isGestureNav = navBarInsets.bottom > 0 && navBarInsets.bottom < (int) (40 * density);
      int bottom = !keyboardVisible ? (int) (systemInsets.bottom / density) : 0;
      int gestureBottom = isGestureNav && !keyboardVisible ? bottom : 0;
      int navBarRight = (int) (navBarInsets.right / density);
      int cutoutRight = (int) (cutoutInsets.right / density);
      getBridge().getWebView().evaluateJavascript(
          "if (document.documentElement) {" +
              "  document.documentElement.style.setProperty('--notch-inset-right', '" + cutoutRight + "px');" +
              "  document.documentElement.style.setProperty('--navigation-inset-right', '" + navBarRight + "px');" +
              "  document.documentElement.style.setProperty('--navigation-inset-bottom', '" + bottom + "px');" +
              "  document.documentElement.style.setProperty('--gesture-inset-bottom', '" + gestureBottom + "px');" +
          "}", null
      );

      return insets;
    });
  }

  /**
   * Fixes older Android behavior where the status bar prevents true overlay,
   * ensuring the WebView can render behind the status bar correctly.
   */
  private void setupStatusBarOverlay() {
    ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

      return insets;
    });
  }
}
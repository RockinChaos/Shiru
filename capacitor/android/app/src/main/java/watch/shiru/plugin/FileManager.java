package watch.shiru.plugin;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "FileManager")
public class FileManager extends Plugin {

  private ActivityResultLauncher<Intent> folderPickerLauncher;
  private PluginCall savedCall;
  private ActivityResultLauncher<Intent> filePickerLauncher;
  private PluginCall filePickerCall;

  @Override
  public void load() {
    folderPickerLauncher = getActivity().registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        this::handleFolderPickerResult
    );
    filePickerLauncher = getActivity().registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        this::handleFilePickerResult
    );
  }

  @PluginMethod
  public void requestAllFilesAccess(PluginCall call) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (!Environment.isExternalStorageManager()) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
        intent.setData(Uri.parse("package:" + getActivity().getPackageName()));
        getActivity().startActivity(intent);
      }
    }
    call.resolve();
  }

  @PluginMethod
  public void hasAllFilesAccess(PluginCall call) {
    JSObject result = new JSObject();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      result.put("granted", Environment.isExternalStorageManager());
    } else {
      result.put("granted", true);
    }
    call.resolve(result);
  }

  @PluginMethod
  public void pickFolder(PluginCall call) {
    call.setKeepAlive(true);
    savedCall = call;
    folderPickerLauncher.launch(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE));
  }

  @PluginMethod
  public void pickFiles(PluginCall call) {
    if (filePickerCall != null) {
      call.reject("File selection is already in progress");
      return;
    }
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
    filePickerCall = call;
    try {
      filePickerLauncher.launch(intent);
    } catch (Exception error) {
      filePickerCall = null;
      call.reject("Unable to open file picker", error);
    }
  }

  private void handleFilePickerResult(ActivityResult result) {
    PluginCall call = filePickerCall;
    filePickerCall = null;
    if (call == null) return;
    JSArray files = new JSArray();
    if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
      Intent data = result.getData();
      List<Uri> uris = new ArrayList<>();
      ClipData clipData = data.getClipData();
      if (clipData != null) {
        for (int i = 0; i < clipData.getItemCount(); i++) {
          uris.add(clipData.getItemAt(i).getUri());
        }
      } else if (data.getData() != null) uris.add(data.getData());
      for (Uri uri : uris) {
        if (uri == null) continue;
        DocumentFile documentFile = DocumentFile.fromSingleUri(getContext(), uri);
        String name = documentFile != null ? documentFile.getName() : null;
        JSObject file = new JSObject();
        file.put("path", uri.toString());
        file.put("name", name != null ? name : uri.getLastPathSegment());
        files.put(file);
      }
    }
    JSObject response = new JSObject();
    response.put("files", files);
    call.resolve(response);
  }

  private void handleFolderPickerResult(ActivityResult result) {
    if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
      Uri uri = result.getData().getData();
      DocumentFile documentFile = DocumentFile.fromTreeUri(getContext(), uri);
      if (documentFile != null && documentFile.isDirectory()) {
        JSObject obj = new JSObject();
        obj.put("path", uri.toString());
        savedCall.resolve(obj);
      } else {
        savedCall.reject("Selected path is not a valid directory");
      }
    } else {
      savedCall.reject("Folder selection was cancelled or an error occurred");
    }
  }
}
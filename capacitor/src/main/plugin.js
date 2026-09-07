import { registerPlugin } from '@capacitor/core'

const FileManagerPlugin = registerPlugin('FileManager')
export const FileManager = {
  hasAllFilesAccess: async () => (await FileManagerPlugin.hasAllFilesAccess()).granted,
  requestAllFilesAccess: () => FileManagerPlugin.requestAllFilesAccess(),
  pickFolder: async () => (await FileManagerPlugin.pickFolder()).path
}

const MediaSessionPlugin = registerPlugin('MediaSession')
export const MediaSession = {
  onAction: (callback) => MediaSessionPlugin.addListener('mediaAction', ({ action }) => callback(action)),
  onPictureInPictureModeChanged: (callback) => MediaSessionPlugin.addListener('pictureInPictureModeChanged', ({ isInPictureInPictureMode }) => callback(isInPictureInPictureMode)),
  setPlaybackState: (state) => MediaSessionPlugin.setPlaybackState(state),
  exitPiP: () => MediaSessionPlugin.exitPiP()
}
// feature support list, overridden per environment, capacitor

export const SUPPORTS = {
  offscreenRender: false,
  update: false,
  angle: false,
  doh: false,
  discord: false,
  keybinds: typeof navigator !== 'undefined' && /TV|Leanback|AFT/i.test(navigator.userAgent),
  isAndroid: true,
  maxSeeding: 10,
  externalPlayer: false,
  permamentNAT: false // no way of safely closing app
}

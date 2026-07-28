/**
 * The `node-onvif` package (used instead of `onvif` for device/media/PTZ
 * calls - see /memories/repo notes for why) ships no type definitions.
 * Declared loosely here; call sites narrow what they need.
 */
declare module "node-onvif" {
  const nodeOnvif: any;
  export default nodeOnvif;
}

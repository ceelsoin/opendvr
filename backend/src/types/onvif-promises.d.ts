/**
 * The `onvif` package does not ship type definitions for its `onvif/promises`
 * subpath. We declare it loosely as `any` here so the rest of the codebase
 * can use it with normal TypeScript ergonomics elsewhere.
 */
declare module "onvif/promises" {
  const onvif: any;
  export default onvif;
}

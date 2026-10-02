/// <reference types="vite/client" />

/** The preview or connected application, chosen by VITE_APP_MODE at build time. */
declare module '@app-root' {
  const Root: import('react').ComponentType;
  export default Root;
}

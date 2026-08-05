// The sandbox contract for every iframe that renders inscription content.
// allow-scripts only: never allow-same-origin, or inscriptions could read the
// ord origin and each other. One definition so no frame can drift.
export const FRAME_SANDBOX = 'allow-scripts'

export const FRAME_REFERRER_POLICY = 'no-referrer'

export const FRAME_ALLOW = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "accelerometer 'none'",
  "gyroscope 'none'",
  "magnetometer 'none'",
  "payment 'none'",
  "usb 'none'",
  "midi 'none'",
  "xr-spatial-tracking 'none'",
  "fullscreen 'none'",
  "autoplay 'none'",
].join('; ')

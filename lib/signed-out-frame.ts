// What a workspace pane shows when the coach's session has ended: a small page (the real sign-in page cannot be framed) that tells the window holding the pane, which
// shows "Your session ended. Sign in again" in the toolbar. Plain HTML with one inline script (the site allows its own inline scripts); no data in it.
export const SIGNED_OUT_FRAME_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed out</title></head>' +
  '<body style="margin:0;padding:16px;font-family:system-ui,sans-serif;background:#111;color:#ddd;font-size:14px">' +
  "Your session ended. Sign in again from the main window." +
  '<script>try{parent.postMessage({type:"esc-workspace-signed-out"},location.origin)}catch(e){}</script>' +
  "</body></html>";

# Workspace: first look (about 5 minutes, signed in as yourself on a computer, after the deploy)

The code is tested piece by piece, but no one has clicked through it on screen yet. These are the checks that matter, in order. Anything that fails: screenshot it and tell Spot which step.

1. Click the new panel icon at the bottom of the left rail ("Add a view next to this page"). A search box opens. Type `cal` and press Enter. PASS: a panel opens on the right showing your Calendar, and a thin bar appears under the top bar ("Add a view", "Panel (1)").
2. In the panel, open a client's Messages: Add a view, type a client's name and the word `messages`, press Enter. Type half a message in that panel but do not send it.
3. **The important one:** click other links in the main page (Clients, then Business). PASS: the panel and the half-typed message stay exactly as they were (the panel does not flicker or reload). FAIL: the panel reloads or the draft vanishes.
4. Save something on the main page (change a client's session count). PASS: after about 2 seconds the Calendar panel shows the change, and the half-typed message is still there.
5. Add a view, type `programs`, press Shift+Enter. PASS: a floating card opens. Drag it by its top bar, resize it by the corner, snap it to the right half with the small icon, minimize it (it becomes a chip in the bar), restore it.
6. Close the Messages tab with the X. PASS: it asks "Close and discard what you typed?" because the message was never sent.
7. Drag the edge between the page and the panel. Click that edge and press the left/right arrow keys. PASS: the panel gets wider/narrower.
8. Make the window narrower than about 1366 pixels. PASS: cards move into the panel as tabs. Widen it again: they float again.
9. Open a second browser tab of the app. PASS: it shows the same panel and cards; closing one in tab A closes it in tab B.
10. Sign out from the rail. PASS: after signing in again the workspace starts empty (nothing was left on the computer).

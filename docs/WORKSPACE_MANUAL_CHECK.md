# The workspace: first look on the real site

**When and where:** on the REAL live site, signed in as yourself on a computer, right after Ron has pushed and deployed this build (not before: the new build is what has the workspace). Takes about 10 minutes. Everything below is tested piece by piece in code, but nobody has clicked it on screen yet, so these steps are the real test. For each step PASS and FAIL are written down. On a FAIL: screenshot the screen, note the step number, and send both to Spot.

1. **Open it.** At the bottom of the left rail click the new panel icon ("Add a view next to this page"). A search box opens. Type `cal`, press Enter.
   PASS: a panel opens on the right showing your Calendar, and a thin bar appears under the top bar with "Add a view" and "Panel (1)". FAIL: nothing opens, or the page jumps away.
2. **A client's messages.** Press the rail icon again, type a client's name and the word `messages`, press Enter. A second tab appears in the panel. Click into its message box and type half a message. Do NOT send it.
3. **THE important one: the page moves, the panel stays.** Click other links in the main page (Clients, then Business, then a client).
   PASS: the panel does not flicker or reload and the half-typed message is still exactly there. FAIL: the panel reloads, blinks, or the typing is gone.
4. **The same on a slow connection.** In Chrome press F12, open the Network tab, set the speed menu to "Slow 3G" (or turn Wi-Fi off for 3 seconds in the middle of a click). Click a main-page link again, wait for it to finish.
   PASS: the panel and the half-typed message survive even though the page took many seconds. FAIL: the panel vanishes at any point. (Set the speed back to "No throttling" afterwards.)
5. **Two groups.** If you have two groups, stand in one, add Programs to the panel; then stand in the other and add Programs again.
   PASS: two separate tabs, each showing its own group's programs. FAIL: the second one just brings the first forward.
6. **A save shows up elsewhere.** With Calendar open in the panel, change something on the main page (a client's session count). Wait 2 or 3 seconds.
   PASS: the panel shows the change and your half-typed message is still there. FAIL: the panel stays stale, or the typing is gone.
7. **Ask Spot saves count too.** Use Ask Spot to change a setting and confirm it. PASS: a panel showing that setting's page updates by itself. FAIL: it needs a manual refresh.
8. **Cards.** Add a view, type `programs`, press Shift+Enter. PASS: a floating card opens. Drag it by its top bar, resize it by the lower corner, press the small left/right-half icon to snap it, minimize it (it becomes a chip in the bar), restore it, then press the icon that puts it back in the panel.
9. **Closing asks only when it should.** (a) Close a tab with nothing typed in it: PASS = it closes at once, no question. (b) Close the Messages tab with the half-typed message: PASS = it asks "Close and discard what you typed?"; press Cancel and the tab stays. (c) Type in a search or filter box in a pane, then close: PASS = no question.
10. **The divider and keys.** Drag the edge between the page and the panel. Then click that edge and press the left/right arrow keys. PASS: the panel gets wider/narrower both ways.
11. **Narrow window.** Make the browser window narrower than about 1366 pixels wide. PASS: cards move into the panel as tabs; widen it again and they float again.
12. **A page with no coach screen.** Open any client's own mobile-style page (or the link of a public booking page), then come back to Clients. PASS: your panel and its tabs are exactly as before. FAIL: they were lost.
13. **A link to another site.** In a pane showing a client's messages, click a link that goes to another website (ask a test client to send you one). PASS: it opens in a new browser tab and the pane stays as it was. FAIL: the pane goes blank or shows "refused to connect".
14. **Signing out in another tab.** Open a second tab of the app, sign out there. Back in the first tab click anything inside a pane. PASS: the bar shows "Your session ended. Sign in again". After you sign in again the workspace starts empty (nothing of the old one stayed on this computer). FAIL: client names are still visible after signing back in as someone else.

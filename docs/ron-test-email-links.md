# Real-phone check of the email links (about 5 minutes, after this build is deployed)

Why: the sign-up confirmation, the coach invite and the reset email used to land on "Link invalid or expired" (the page could not read the link). The pages now read the link themselves. Only a real phone and a real inbox can prove it.

1. On your phone, open the live app in the browser, tap Sign up, and make a throwaway coach with an email you can open on that phone. Open the confirmation email on the phone and tap the link. PASS: you land in the app (Home), signed in. FAIL: "Link invalid or expired" (send Spot a screenshot).
2. On a computer, go to Forgot password, enter that same email, then open the reset email on your PHONE and tap the link. PASS: the "set a new password" page shows (before, a link asked for on one device failed on another). Set a password and confirm you land in the app.
3. As yourself, open a client who has signed in, Overview tab, press "Email them a sign-in link" (use a test client whose email is yours). PASS: the page says "Sent to x•••@..." and the email arrives; opening it on the phone shows the set-password page.
4. Delete the throwaway coach afterwards (tell Spot; no real data was made).

+++
id = "signup"
title = "Create an account (sign up)"
stage = 1
keywords = ["register", "sign up", "new account", "otp", "verify email", "code"]
buttons = [{ label = "Sign up", path = "/signup" }]
next = ["complete-profile"]
+++
Steps:
1. Open Sign up. Enter **Full Name** and **Email Address**.
2. Under "I am joining as a", choose **Homeowner**.
3. Create a password: at least 10 characters, with an upper-case letter, a lower-case letter, a number and a symbol. Type it again to confirm.
4. Tap **Verify email with OTP**. A 6-digit code is emailed to you. Enter it and tap **Verify OTP**.
5. Tick "I agree to the Terms of Service and Privacy Policy" and tap **Create account**.

Rules:
- The code expires in 10 minutes. You can ask for a new code after 30 seconds. After 5 wrong tries, ask for a new code.
- "Email already registered" means you already have an account. Sign in instead, or use Forgot password.
- Sign up does not ask for phone or country. You add those in your profile.
- Google and Microsoft sign-in buttons are on the Sign in page, not on Sign up.

After sign up, the app asks for your **6-digit pincode**. It checks it with India Post and shows the post office branches: choose yours (one branch is chosen for you), then save. You can tap **Later** to skip; it asks again next time you open the app.
Pincode errors: "Enter a valid 6 digit pincode.", "This pincode was not found. Check the 6 digits and try again.", "The pincode directory could not be reached. Please try again."

# Guest flow: warning, choice, rebooking, voucher, refund

How a guest hears about a weather problem and what they can do about it, and how you set it up.

## What the guest experiences

1. **A message** (SMS and/or email, in their language) says the tour may be affected, or is cancelled,
   with one button/link.
2. **The guest page** (`/g/<private link>`, works on any phone, no login) shows in plain words *why*
   (e.g. "gusts up to 31 m/s; we normally stop at around 28 m/s", with a small gauge), when they must be
   told by, and a short list of choices:
   * **Pick a new day**: same tour, only dates with enough seats and acceptable weather, best weather first
   * **Try a different adventure**: other tours with good conditions, with the price difference shown
   * **Take a voucher**: value of what they paid plus your bonus (default +10%), valid 12 months
   * **Get a refund**: the amount they paid, back to the original payment
   * **Keep my booking**: only while it is still undecided ("we will confirm by 18:00")
3. They pick, see a one-line summary, and confirm. They immediately get a confirmation message, and can
   change their mind until your team has acted on it. Once approved, the page shows what was arranged
   (and the voucher code) and explains how to contact you for changes.
4. **Languages**: English, German and Icelandic, switchable on the page; each guest's own language is used
   for messages. *Have a native speaker read the German and Icelandic text before real use.*

## What happens on your side

`Notifications` → pick a departure at risk → **Prepare warning** (or **cancellation**) → read the previews →
**Send**. Guests' choices appear under `Guest requests`, each with an exact instruction such as
*"Move AA-1001 (4 pax) to 17 Oct 09:00"*, with **Approve / Reject / Mark done** buttons. Approving
sends the guest a confirmation; vouchers get a code at approval.

> **Important:** Veðurvaki does not yet change bookings, issue vouchers or move money in Bókun or your
> payment system. A person does that, guided by the *To do* column, then clicks **Mark done**. That is why
> automatic approval is off by default. Turning it on would tell guests "confirmed" while nothing has actually
> been changed in your booking system.

Seats are protected: a date a guest picked is held against other guests' choices until you process it, so two
guests are never promised the same last seats.

## Set it up (in order)

1. **Public address.** Set `PUBLIC_BASE_URL` (e.g. `https://vedur.arcticadventures.is`) in `.env`. Links in messages use it.
2. **Brand.** Admin → Settings: company name, colour, logo, phone, email. Guests see these.
3. **Guests.** Each guest needs a booking reference, tour, departure, number of guests, a language, and an email and/or phone.
   * Admin → Guests → *Import CSV*, or
   * your booking system pushes them to the API (see [PARTNER-API.md](PARTNER-API.md)).
   Add the amount paid if you can: it is used for refund and voucher values. Without it the app uses
   price × guests.
4. **Email sending (Resend).** Create an account at resend.com, verify your sending domain (it gives you DNS records), create an API key, then set
   `RESEND_API_KEY` and `EMAIL_FROM="Arctic Adventures <bookings@your-domain>"`.
5. **SMS sending (Twilio).** Create a Twilio account, then set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
   `TWILIO_FROM` (a number, or an alphanumeric sender name where allowed for the destination country, which you must
   check and may need to register) or `TWILIO_MESSAGING_SERVICE_SID`. Another provider can be added as a small connector file ([ADDONS.md](ADDONS.md)).
6. **Test.** Admin → Settings → *Send a test message* to yourself. While `MESSAGING_MODE=dry-run` (the default) this only writes to the outbox
   (Admin → Activity), so you can read exactly what guests would get.
7. **Go live.** Set `MESSAGING_MODE=live` and restart. The admin header turns green and the *Send* button asks you to confirm the number of guests.
8. **Policy.** Admin → Settings → *What guests are offered*: switch options on/off, voucher bonus and validity, how far ahead dates are offered.

## Data protection, consent and legal

*This is a checklist, not legal advice.*

* Guest names and contact details are **personal data**. They are stored only in `data/store/` on your server, are deleted automatically
  `retentionDays` (default 90) after the departure, and can be erased per booking (Admin → Guests → *Erase*).
* Twilio and Resend process guest contact details for you: sign their data-processing agreements and note them in your privacy notice.
  Check the destination country's rules for SMS (sender registration, opt-out wording).
* These are service messages about a booking the guest made. Keep them to that purpose. Do not add promotions.
* The refund wording, the right to a refund after a weather cancellation, and voucher terms depend on your terms and the law that applies to your
  guests. Decide them with your advisor before enabling *Refund* or changing the default policy text.
* Guest links are long random tokens (not guessable). Anyone who has a link can act on that one booking, so tell guests not to forward the message.
  Links expire `linkValidDays` after the departure. The guest endpoints are rate-limited per IP.

## Not built yet

* Writing back to Bókun (moving bookings, creating promo codes, refunding): done by hand from the *To do* column.
* Guests replying by SMS, or a chat inside the page. They call or email the contact details shown.
* Add-to-calendar for the new date, payment of price differences online, and delivery receipts from Twilio/Resend (the outbox records what the provider accepted, not final delivery).

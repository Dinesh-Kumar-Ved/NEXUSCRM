# Client Connect Hub

## Project Overview

Build a **full-stack, production-ready CRM web application** for managing clients, tracking proposal/deal status, and communicating with clients directly through **Email, WhatsApp, and Phone Call/SMS** — all from within the app, using real APIs so messages/calls actually go out (not a mockup or simulation).

---

## 1. Client Management

- Add / edit / delete client records with fields:

  - Name, company name, email, phone number, WhatsApp number

  - Source (referral, website, cold outreach, etc.)

  - Tags/labels (e.g. "VIP", "Cold Lead", "Repeat Client")

  - Notes / conversation history log

  - Assigned team member (if multiple users)

  - Date added, last contacted date

- Search, filter, and sort clients (by status, tag, date, name)

- Import clients in bulk via CSV upload

- Export client list to CSV/Excel

## 2. Deal / Proposal Status Tracking

- Each client has a **Proposal Status**:

  - `Proposal Sent` → `Working With Client` → `Accepted` / `Rejected`

  - (Optionally add: `Negotiating`, `On Hold`, `Follow-up Needed`)

- Status shown as a colored badge/tag next to client name

- Kanban-style pipeline board (drag-and-drop clients between status columns) in addition to list view

- Status change history/timeline per client (who changed it, when)

- Filter client list by status instantly

## 3. Multi-Channel Messaging (Real, Working Integrations)

### Email

- Send individual or bulk emails from within the CRM

- Integrate with a real email provider (e.g. **SendGrid**, **Gmail API/SMTP**, **Amazon SES**, or **Mailgun**)

- Email templates (editable) for common messages (offers, follow-ups, thank-you notes)

- Track sent status, opens/clicks if provider supports it

### WhatsApp

- Send/receive WhatsApp messages using the **WhatsApp Business Platform API** (via Meta directly, or a provider like Twilio, Gupshup, or 360dialog)

- Requires a verified WhatsApp Business Account — note this during setup

- Pre-approved message templates for bulk/promotional messages (WhatsApp requires template approval for business-initiated bulk messages)

- Chat-style interface to view conversation threads per client

### Phone Calls / SMS

- Click-to-call functionality using a telephony API (e.g. **Twilio Voice**, **Exotel**, or **Plivo**)

- SMS sending/receiving through the same provider

- Call logs (duration, timestamp, outcome notes) saved to client record

> Note: Real messaging/calling requires signing up for these third-party services and obtaining API keys, a verified sender email/domain, a WhatsApp Business number, and a telephony number. The developer should build the integration layer to be provider-agnostic where possible, so providers can be swapped.

## 4. Bulk Messaging / Broadcast Campaigns

- Select multiple clients (or all, or by filtered segment — e.g. by tag/status) and send one message to all of them via Email, WhatsApp, or SMS

- Personalization tokens (e.g. `{{client_name}}`) so bulk messages still feel individual

- Campaign log showing who was messaged, when, and delivery status

- Opt-out/unsubscribe handling for compliance

## 5. Suggested Additional Features

- **Dashboard**: overview of total clients, deals by status, messages sent this week, conversion rate

- **Follow-up reminders/tasks**: set a reminder to contact a client on a specific date; notification/alert system

- **Calendar/appointment scheduling** integration (e.g. sync with Google Calendar)

- **Notes & activity timeline** per client (calls, emails, status changes, meetings — all in one feed)

- **Role-based access** if multiple team members use it (admin vs. sales rep views)

- **Analytics/reports**: proposal acceptance rate, response time, revenue pipeline value

- **Document/proposal attachment** storage per client (upload PDFs, contracts)

- **Mobile-responsive design** so it works on phone browsers

- **Notifications**: in-app + email alerts for status changes or unread replies

- **Basic invoicing** (optional) once a deal is marked "Accepted"

## 6. Technical Requirements

- **Full-stack, real, working application** — not a static prototype. Data should persist in a real database, and messages should actually send through the integrated APIs when real credentials are provided.

- Suggested stack:

  - Frontend: React (or Next.js) with Tailwind CSS

  - Backend: Node.js/Express or Python/Django/FastAPI

  - Database: PostgreSQL or MongoDB

  - Auth: JWT-based login with secure password storage

  - Hosting: Vercel/Render/AWS for app, managed DB service (e.g. Supabase, Railway, RDS)

- Environment variables / secrets management for all API keys (never hard-coded)

- Basic automated tests for core flows (add client, change status, send message)

## 7. Deliverables Expected

1. Working web app with login

2. Client management module

3. Pipeline/status tracking module

4. Messaging module (Email + WhatsApp + Call/SMS) wired to real APIs

5. Bulk broadcast feature

6. Dashboard/reports

7. Deployment instructions + list of third-party accounts/API keys needed to go fully live

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/485cbe2f-acd1-4607-bf53-2b2e3a41f5f5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

---

## 8. Google OAuth 2.0 & Gmail API Setup Guide

Follow these steps to connect your personal Gmail account to NexusCRM:

### Step 1: Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** > **New Project**, name it (e.g. `NexusCRM`), and click **Create**.

### Step 2: Enable the Gmail API
1. Navigate to **APIs & Services** > **Library**.
2. Search for **Gmail API** and click **Enable**.

### Step 3: Configure the OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **External** (or **Internal** if using Google Workspace) and click **Create**.
3. Fill in:
   - **App name**: `NexusCRM`
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Click **Save and Continue**.

### Step 4: Add the Gmail Send Scope
1. On the **Scopes** page, click **Add or Remove Scopes**.
2. Search for and check:
   - `https://www.googleapis.com/auth/gmail.send` (Send email on your behalf)
3. Click **Update** > **Save and Continue**.
4. On the **Test users** page, add your personal Gmail address (`myemail@gmail.com`).

### Step 5: Create a Web OAuth 2.0 Client
1. Navigate to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Set **Name** to `NexusCRM Web Client`.
5. Under **Authorized redirect URIs**, add:
   ```text
   http://localhost:8081/api/integrations/google/oauth/callback
   ```
6. Click **Create** and copy your **Client ID** and **Client Secret**.

### Step 6: Generate Encryption Key and Configure Environment
1. Generate a 32-byte Base64-encoded key for AES-256-GCM token encryption:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. Add the variables to your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:8081/api/integrations/google/oauth/callback
   GOOGLE_TOKEN_ENCRYPTION_KEY=your_base64_encryption_key_here
   ```

### Step 7: Start NexusCRM and Connect Gmail
1. Start the dev server:
   ```bash
   npm run dev
   ```
2. Open `http://localhost:8081` in your browser.
3. Log in and go to **Settings & Integrations**.
4. In the **Email Integration** card, click **Connect Gmail**.
5. Log in with your Google account and approve permissions.
6. NexusCRM stores the encrypted refresh token and activates your Gmail integration!


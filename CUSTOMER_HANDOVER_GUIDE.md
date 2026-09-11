# Customer Handover Guide

This guide is for trial customers installing and using the PatrolSafe by S4 desktop app for the first time.

## What you will receive

Your handover pack should include:

- the Windows installer
- your trial licence key
- this setup guide
- support contact details

## System requirements

Please prepare a Windows workstation with:

- Windows 10 or Windows 11
- 8 GB RAM recommended
- at least 5 GB free disk space
- stable internet connection
- access to the patrol WhatsApp account that will scan the QR code

For a normal desktop trial install, PostgreSQL is not required.

Recommended:

- use a dedicated machine for the patrol WhatsApp connection
- keep the PC awake during operation
- avoid using the linked WhatsApp account for unrelated personal use

## Install the desktop app

1. Run the Windows installer provided by your support contact.
2. Complete the normal Windows install prompts.
3. Open the PatrolSafe desktop app.

If Windows shows a warning, contact support before bypassing it.

## First-run setup

When the app opens for the first time, follow the setup wizard in this order:

1. Welcome
2. Trial key
3. Company details
4. Storage folder
5. Local database
6. WhatsApp
7. First site
8. Group mapping
9. Schedule
10. Finish

## Activate your trial key

1. Open the `Trial key` step.
2. Enter the trial key provided by support.
3. Continue after the key is accepted.

The app will show trial status and remaining days after activation.

## Enter company and workspace details

At the `Company` step:

- enter your company name
- confirm the workspace name
- create the local admin email and password

These details are used for the trial workspace on this computer.

## Choose the storage folder

At the `Storage` step:

1. Click `Browse`.
2. Select the folder where patrol evidence images will be stored.
3. Continue to the database step.

Choose a folder on a drive with enough free space for image storage.

## Local database setup

At the `Local database` step:

1. Review the local database status.
2. Confirm that the app shows:
   - local database ready
   - database file created
   - tables ready
3. Continue when the status is ready.

The app creates the local database automatically inside the desktop app data folder. No manual database setup is required for a normal customer install.

If support asks you to refresh the checks:

- click `Retry checks`
- or click `Restart app`

## Advanced PostgreSQL mode

PostgreSQL is only needed for advanced or server-based deployments.

If your support team has specifically told you to use PostgreSQL:

1. Open `Advanced database settings`
2. Enter:
   - database host
   - port
   - username
   - password
   - database name
3. Click `Test PostgreSQL`

Possible advanced PostgreSQL results include:

- PostgreSQL not reachable
- password not accepted
- database missing
- app tables missing
- database ready

If needed:

- click `Create DB and run migrations`
- click `Retry checks`
- click `Restart app`

## Prepare the workspace

Once the local database is ready, or once the PostgreSQL test is successful in advanced mode:

1. Click `Prepare workspace`.
2. Wait for the local workspace to finish preparing.

## Link WhatsApp

At the `WhatsApp` step:

1. Click `Start collector`.
2. Wait for the QR code to appear.
3. Use the patrol WhatsApp account on the phone to scan the QR code.
4. Wait for the status to show that WhatsApp is ready.

If you need to reconnect later:

- click `Reconnect WhatsApp`

## Create your first site

At the `First site` step:

1. Enter the site code
2. Enter the site name
3. Enter the client name if required
4. Click `Create site`

Example:

- Site code: `SWI01`
- Site name: `Corner Copse - Swindon`

## Map the WhatsApp group

At the `Group map` step:

1. Select the site
2. Either:
   - choose a detected WhatsApp group, or
   - enter the group name and external group ID manually
3. Save the mapping

This tells the app which WhatsApp group belongs to which site.

If no groups are shown:

- make sure WhatsApp is connected
- make sure the linked account can see the patrol groups
- wait a short time and retry

## Create the patrol schedule

At the `Schedule` step:

1. Select the site
2. Enter:
   - patrol frequency
   - start hour
   - end hour
   - grace minutes
   - active days
3. Click `Save schedule`

This schedule controls expected patrol activity and reporting.

## Finish and start using the system

At the `Finish` step:

1. Open the dashboard
2. Open the collector controls if needed
3. Confirm the trial is active
4. Confirm WhatsApp is ready

Once patrol images begin arriving, they will appear in:

- Evidence
- Dashboard
- Guard Safe

## How to contact support

If you need help with setup:

1. Go to the `Local database` step in setup if the issue is database-related.
2. Click `Copy diagnostic report`.
3. Paste the report into your email or support ticket.

If you are using advanced PostgreSQL mode:

1. Open the database step.
2. Run `Test PostgreSQL` first if support asks for an updated check.
3. Click `Copy diagnostic report`.
4. Paste the report into your email or support ticket.

Also include:

- your company name
- a screenshot of the problem
- the step where you got stuck

## Common troubleshooting issues

### Local database not ready

This usually means:

- the app services have just started
- the local database file is still being created
- the app needs a refresh after setup changes

What to do:

- wait a few seconds
- click `Retry checks`
- click `Restart app` if support asks you to

### PostgreSQL not reachable

This usually means:

- PostgreSQL is not installed
- PostgreSQL service is stopped
- host or port is wrong

What to do:

- confirm PostgreSQL is installed
- confirm the service is running
- re-check host and port
- click `Retry checks`

### Password not accepted

This means the database username or password was rejected.

What to do:

- re-enter the username and password carefully
- confirm the account has access to the PostgreSQL server
- click `Test PostgreSQL` again

### Database missing

This means PostgreSQL is reachable, but the PatrolSafe database has not been created yet.

What to do:

- click `Create DB and run migrations`
- test the database again afterward

### App tables missing

This means the database exists, but the PatrolSafe records are not ready yet.

What to do:

- click `Create DB and run migrations`
- wait for the setup to complete
- click `Test PostgreSQL` again

### WhatsApp QR code does not appear

What to check:

- the workspace has been prepared
- the trial is active
- the collector has been started

If needed:

- click `Restart app`
- try `Start collector` again

### No WhatsApp groups detected

What to check:

- the WhatsApp account is linked successfully
- the linked account can open the patrol groups in WhatsApp
- the app has had time to detect groups

### No patrol images arriving

What to check:

- the correct group was mapped
- the collector is ready
- patrol images are being sent into the mapped group

## Trial expiry

If your trial expires:

- the collector may stop being available to start
- existing evidence remains in place
- your data is not deleted

Contact support to activate a new trial or full licence.

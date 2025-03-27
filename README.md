# HungerRush Sales Summary Generator

A web application that automates the process of extracting sales data from HungerRush and generating a summary report.

## Features

- Automated login to HungerRush platform
- Order details report generation
- Excel data extraction and processing
- Filtering by time of day
- Real-time progress updates
- Responsive UI for both desktop and mobile

## Deployment Options

### Option 1: Run Locally (with Keep-Awake)

This option keeps your computer from going to sleep while the application is running.

```bash
# Install dependencies
npm install

# Set up Playwright (first time only)
npm run setup

# Start the application with keep-awake utility
npm run dev:keep-awake
```

The application will be available at:
- On your computer: http://localhost:3000
- On other devices on the same network: http://YOUR_IP_ADDRESS:3000 (e.g., http://192.168.68.50:3000)

To find your IP address, run `ipconfig` in a command prompt.

### Option 2: Production Deployment on Your Computer

For a more stable deployment on your own computer:

```bash
# Build the application
npm run build

# Start in production mode with keep-awake
npm run start:keep-awake
```

### Option 3: Deploy to Cloud Services

The application includes a fallback mode for cloud deployments where browser automation is not available.

#### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
npm run deploy
```

Note: When deployed to cloud services, the application will use mock or cached data instead of live automation.

### Option 4: Deploy on a Raspberry Pi (24/7 Availability)

For a low-power, always-on solution:

1. Set up a Raspberry Pi with Raspberry Pi OS
2. Clone this repository
3. Install Node.js and dependencies
4. Run in production mode

```bash
# On the Raspberry Pi
git clone <repository-url>
cd <repository-directory>
npm install
npm run setup
npm run build
npm run start
```

## Environment Variables

Create a `.env.local` file with the following:

```
HUNGER_RUSH_USERNAME=your_username
```

The password is hardcoded as 'Eocp2024#' in the application.

## Troubleshooting

- **Sleep Issues**: If your computer goes to sleep despite using the keep-awake utility, manually adjust your power settings to prevent sleep mode.
- **Browser Errors**: If you encounter browser automation errors, try running `npm run setup` again to reinstall the required browser dependencies.
- **Network Access**: Ensure your firewall allows connections on port 3000 for network access.

## Technical Details

- Next.js 14 App Router
- Playwright for browser automation
- TypeScript
- Tailwind CSS for styling
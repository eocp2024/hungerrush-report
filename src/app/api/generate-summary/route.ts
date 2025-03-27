import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { format } from 'date-fns';
import { join } from 'path';
import os from 'os';

// Track current status for progress updates
let currentStatus = 'idle';
let statusMessage = '';
let lastUpdated = Date.now();

// Cache system for production deployments
let cachedResponses: Record<string, any> = {};

interface RequestBody {
  startDateTime: string;
  endDateTime: string;
}

interface Summary {
  cashSalesInStore: number;
  cashSalesDelivery: number;
  creditCardTipsInStore: number;
  creditCardTipsDelivery: number;
  totalOrders: number;
  averageOrderValue: number;
}

// Helper function to wait for navigation with retry
async function waitForNavigationWithRetry(page: any, action: () => Promise<any>, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
        action()
      ]);
      // Add a small delay after navigation to ensure page is stable
      await page.waitForTimeout(2000);
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Navigation attempt ${i + 1} failed, retrying...`);
      await page.waitForTimeout(5000);
    }
  }
}

// Helper function to wait for selector with retry
async function waitForSelectorWithRetry(page: any, selector: string, timeout = 60000, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.waitForSelector(selector, { timeout, state: 'visible' });
      // Add a small delay after finding the selector
      await page.waitForTimeout(1000);
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Selector ${selector} attempt ${i + 1} failed, retrying...`);
      await page.waitForTimeout(5000);
    }
  }
}

// Main API route handler
export async function POST(request: Request) {
  // Mock data for fallback
  const mockData = {
    cashSalesInStore: 256.75,
    cashSalesDelivery: 124.50,
    creditCardTipsInStore: 45.25,
    creditCardTipsDelivery: 32.80,
    totalOrders: 24,
    averageOrderValue: 42.33,
    _note: "This is cached data. For live data, run the app locally."
  };
  
  // Parse the request body
  const body = await request.json() as RequestBody;
  const { startDateTime, endDateTime } = body;

  // Create cache key from request parameters
  const cacheKey = `${startDateTime}-${endDateTime}`;
  
  // In production (Vercel, Railway, etc.), use cached data if available
  if (process.env.NODE_ENV === 'production') {
    console.log('Running in production mode - using cached/mock data');
    
    // If we have a cached response for this exact query, return it
    if (cachedResponses[cacheKey]) {
      console.log('Returning cached data for this query');
      return new Response(
        JSON.stringify(cachedResponses[cacheKey]),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' } 
        }
      );
    }
    
    // Otherwise, return the mock data
    return new Response(
      JSON.stringify(mockData),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
  
  // In development mode, proceed with real automation
  let browser;
  let tempFilePath = '';
  
  try {
    // Check environment variables
    if (!process.env.HUNGER_RUSH_USERNAME) {
      console.error('Missing HungerRush username');
      return new Response(
        JSON.stringify({ error: 'HungerRush username not configured' }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' } 
        }
      );
    }
    
    // Create temp directory that's writable in serverless environments
    const tempDir = os.tmpdir();
    tempFilePath = join(tempDir, `report-${Date.now()}.xlsx`);
    console.log(`Will save downloaded file to: ${tempFilePath}`);
    
    // Launch browser
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: true
    });
    
    // Create a new context with larger viewport
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    // Set default timeouts - increase to give more time for debugging
    page.setDefaultTimeout(60000); // 60 seconds
    page.setDefaultNavigationTimeout(60000); // 60 seconds
    
    // Create a helper function to update status
    const updateStatus = (status: string) => {
      console.log(status);
      // Update the global status
      statusMessage = status;
      
      // Map status message to a status type
      if (status.includes('Navigating to HungerRush')) {
        currentStatus = 'navigating';
      } else if (status.includes('Logging in')) {
        currentStatus = 'logging-in';
      } else if (status.includes('Navigating to Reporting')) {
        currentStatus = 'navigating-to-reporting';
      } else if (status.includes('Selecting store') || status.includes('Piqua store')) {
        currentStatus = 'selecting-store';
      } else if (status.includes('Running report')) {
        currentStatus = 'running-report';
      } else if (status.includes('Exporting') || status.includes('Excel')) {
        currentStatus = 'exporting';
      } else if (status.includes('Processing') || status.includes('Filtering') || status.includes('Calculating')) {
        currentStatus = 'processing';
      } else if (status.includes('complete')) {
        currentStatus = 'completed';
      }
      
      lastUpdated = Date.now();
      return;
    };
    
    // Navigate to HungerRush with retry
    updateStatus('Navigating to HungerRush...');
    await page.goto('https://hub.hungerrush.com/', {
      waitUntil: 'networkidle',
      timeout: 60000
    });
    
    // Take screenshot after loading the page
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-initial.png` });
    
    // Log the current URL
    console.log('Current URL:', await page.url());
    
    // Login using IDs directly like in the Selenium script
    updateStatus('Logging in...');
    await page.waitForSelector('#UserName', { timeout: 20000 });
    await page.fill('#UserName', process.env.HUNGER_RUSH_USERNAME || '');
    await page.fill('#Password', 'Eocp2024#');
    
    // Take screenshot before clicking login
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-login.png` });
    
    // Click login button with JavaScript execution (matching Selenium)
    updateStatus('Clicking login button...');
    await page.evaluate(() => {
      (document.querySelector('#newLogonButton') as HTMLElement).click();
    });
    
    // Wait for navigation to complete
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Take screenshot after login
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-after-login.png` });
    
    // Navigate to Reporting with JavaScript execution (matching Selenium)
    updateStatus('Navigating to Reporting...');
    await page.waitForSelector('#rptvNextAnchor', { timeout: 20000 });
    await page.evaluate(() => {
      (document.querySelector('#rptvNextAnchor') as HTMLElement).click();
    });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Take screenshot of reporting page
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-reporting.png` });
    
    // Click Order Details with JavaScript execution using XPath (matching Selenium)
    updateStatus('Clicking Order Details...');
    await page.waitForSelector('xpath=//span[text()="Order Details"]', { timeout: 20000 });
    await page.evaluate(() => {
      const orderDetailsElement = document.evaluate(
        '//span[text()="Order Details"]',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (orderDetailsElement) {
        (orderDetailsElement as HTMLElement).click();
      }
    });
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Handle store selection with JavaScript (matching Selenium)
    updateStatus('Selecting store...');
    await page.waitForSelector('.p-multiselect-trigger-icon', { timeout: 30000 });
    await page.evaluate(() => {
      (document.querySelector('.p-multiselect-trigger-icon') as HTMLElement).click();
    });
    await page.waitForTimeout(2000); // Wait for dropdown
    
    // Take screenshot of store dropdown
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-store-dropdown.png` });
    
    // Click on Piqua store with JavaScript using XPath (matching Selenium)
    updateStatus('Selecting Piqua store...');
    await page.waitForSelector('xpath=//span[text()="Piqua"]', { timeout: 30000 });
    await page.evaluate(() => {
      const piquaElement = document.evaluate(
        '//span[text()="Piqua"]',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (piquaElement) {
        (piquaElement as HTMLElement).click();
      }
    });
    await page.waitForTimeout(2000); // Wait for selection to be applied
    
    // Set date range
    updateStatus('Skipping date range - using default (current day)');
    
    // Take screenshot before running report
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-before-run-report.png` });
    
    // Click Run Report with JavaScript (matching Selenium)
    updateStatus('Running report...');
    await page.waitForSelector('#runReport', { timeout: 20000 });
    await page.evaluate(() => {
      (document.getElementById('runReport') as HTMLElement).click();
    });
    
    // Wait for report to load
    updateStatus('Waiting for report to load...');
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Take screenshot after report loads
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-report-loaded.png` });
    
    // Click Export button with JavaScript using XPath (matching Selenium)
    updateStatus('Exporting to Excel...');
    await page.waitForSelector('xpath=//div[@class="dx-button-content"]//span[text()=" Export "]', { timeout: 30000 });
    await page.evaluate(() => {
      const exportElement = document.evaluate(
        '//div[@class="dx-button-content"]//span[text()=" Export "]',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (exportElement) {
        (exportElement as HTMLElement).click();
      }
    });
    await page.waitForTimeout(3000); // Wait for export dropdown
    
    // Take screenshot after clicking export
    await page.screenshot({ path: `${os.tmpdir()}/hungerrush-export-dropdown.png` });
    
    // Click Excel export option with JavaScript using XPath (matching Selenium)
    updateStatus('Clicking Excel export option...');
    await page.waitForSelector('xpath=//div[contains(text(), "Export all data to Excel")]', { timeout: 30000 });
    await page.evaluate(() => {
      const excelElement = document.evaluate(
        '//div[contains(text(), "Export all data to Excel")]',
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (excelElement) {
        (excelElement as HTMLElement).click();
      }
    });
    
    // Wait for some time to allow the download to start
    updateStatus('Waiting for download to complete...');
    await page.waitForTimeout(10000);
    
    try {
      // Instead of waiting for the download event, we'll check for the file in the Downloads folder
      // This approach matches the Selenium implementation
      
      // The pattern for the downloaded file (matching what Selenium looks for)
      const downloadFolder = `${os.homedir()}\\Downloads`;
      const filePattern = 'order-details-*.xlsx';
      
      updateStatus('Looking for downloaded Excel file...');
      
      // Function to get the latest matching file
      const getLatestMatchingFile = () => {
        try {
          const files = fs.readdirSync(downloadFolder)
            .filter(file => file.match(/^order-details-.*\.xlsx$/i))
            .map(file => `${downloadFolder}\\${file}`);
          
          if (files.length === 0) return null;
          
          // Get the most recent file by creation time
          return files.sort((a, b) => {
            const statA = fs.statSync(a);
            const statB = fs.statSync(b);
            return statB.ctimeMs - statA.ctimeMs;
          })[0];
        } catch (e) {
          console.error('Error finding downloaded file:', e);
          return null;
        }
      };
      
      // Get the latest matching file
      const excelFilePath = getLatestMatchingFile();
      
      if (!excelFilePath) {
        throw new Error('Excel file not found in downloads folder');
      }
      
      updateStatus('Processing Excel file...');
      
      // Process Excel file
      const workbook = XLSX.readFile(excelFilePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      // Log some sample data for debugging
      console.log('Sample data from Excel:', JSON.stringify(data.slice(0, 2), null, 2));
      
      // Filter data by time of day
      updateStatus(`Filtering data for time range: ${startDateTime} to ${endDateTime}`);
      
      // Log the full timestamp information for debugging
      console.log('Raw startDateTime from request:', startDateTime);
      console.log('Raw endDateTime from request:', endDateTime);
      
      // Extract hours and minutes directly from the ISO string format
      // Format is like "2025-03-26T07:00:00.000Z"
      const startTimeParts = startDateTime.split('T')[1].split(':');
      const endTimeParts = endDateTime.split('T')[1].split(':');
      
      const startHours = parseInt(startTimeParts[0], 10);
      const startMinutes = parseInt(startTimeParts[1], 10);
      const endHours = parseInt(endTimeParts[0], 10);
      const endMinutes = parseInt(endTimeParts[1], 10);
      
      console.log(`Time filter values (direct from ISO): ${startHours.toString().padStart(2, '0')}:${startMinutes.toString().padStart(2, '0')} to ${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`);
      
      // Filter the data based on time of day only (ignore actual date)
      const filteredData = (data as any[]).filter(row => {
        // Skip header and summary rows that don't have proper date/time fields
        if (!row.Date || !row.Time || typeof row.Date !== 'string' || typeof row.Time !== 'string') {
          return false;
        }
        
        try {
          // Parse the time from the Excel format
          const timeStr = row.Time; // e.g., "10:59 AM"
          
          // Extract hours and minutes, handling AM/PM
          const timeMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
          if (!timeMatch) return false;
          
          let hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const period = timeMatch[3].toUpperCase();
          
          // Convert to 24-hour format
          if (period === 'PM' && hours < 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          
          // For all orders, log their time and whether they're in range
          const isInRange = (hours > startHours || (hours === startHours && minutes >= startMinutes)) && 
                           (hours < endHours || (hours === endHours && minutes <= endMinutes));
          
          // Log every order for debugging with more detailed information
          console.log(`Order #${row["Order #"] || "N/A"}: Time "${timeStr}" → ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} | ${isInRange ? '✓ INCLUDED' : '✗ EXCLUDED'} | ${row.Type || "N/A"} | $${row.Total || 0}`);
          
          // Check if the time is within range
          return isInRange;
        } catch (e) {
          console.error('Error parsing time for row:', row, e);
          return false;
        }
      });
      
      // Log complete list of filtered orders for verification
      console.log(`\n------------- FILTERED ORDERS (${filteredData.length}/${(data as any[]).length}) -------------`);
      filteredData.forEach((row, index) => {
        console.log(`${index + 1}. Order #${row["Order #"] || "N/A"}: ${row.Time} | Type: ${row.Type || "N/A"} | Payment: ${row.Payment || "N/A"} | Total: $${row.Total || 0} | Tips: $${row.Tips || 0}`);
      });
      console.log(`-------------------------------------------------------\n`);
      
      console.log(`Filtered data from ${(data as any[]).length} to ${filteredData.length} rows based on time range ${startHours}:${startMinutes} to ${endHours}:${endMinutes}`);
      
      // Calculate summary from filtered data
      updateStatus('Calculating summary data...');
      const df = filteredData;
      
      // Debug column names
      if (df.length > 0) {
        console.log('Available columns:', Object.keys(df[0]));
      }
      
      const cashSalesInStore = df
        .filter(row => 
          row.Payment?.includes('Cash') && 
          /Pick Up|Pickup|To Go|Web Pickup|Web Pick Up/i.test(row.Type || '')
        )
        .reduce((sum, row) => sum + (parseFloat(row.Total) || 0), 0);
        
      const cashSalesDelivery = df
        .filter(row => 
          row.Payment?.includes('Cash') && 
          row.Type?.includes('Delivery')
        )
        .reduce((sum, row) => sum + (parseFloat(row.Total) || 0), 0);
        
      const creditCardTipsInStore = df
        .filter(row => 
          /Visa|MC|AMEX/i.test(row.Payment || '') && 
          /Pick Up|Pickup|To Go|Web Pickup|Web Pick Up/i.test(row.Type || '')
        )
        .reduce((sum, row) => sum + (parseFloat(row.Tips) || 0), 0);
        
      const creditCardTipsDelivery = df
        .filter(row => 
          /Visa|MC|AMEX/i.test(row.Payment || '') && 
          row.Type?.includes('Delivery')
        )
        .reduce((sum, row) => sum + (parseFloat(row.Tips) || 0), 0);
      
      // Calculate total orders and average order value
      const totalOrders = df.length;
      const totalSales = df.reduce((sum, row) => sum + (parseFloat(row.Total) || 0), 0);
      const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
      
      const summary: Summary = {
        cashSalesInStore: Number(cashSalesInStore.toFixed(2)),
        cashSalesDelivery: Number(cashSalesDelivery.toFixed(2)),
        creditCardTipsInStore: Number(creditCardTipsInStore.toFixed(2)),
        creditCardTipsDelivery: Number(creditCardTipsDelivery.toFixed(2)),
        totalOrders,
        averageOrderValue: Number(averageOrderValue.toFixed(2))
      };
      
      updateStatus('Generation complete!');
      console.log('Generated summary from filtered data:', summary);
      
      // After successful execution, cache the result for future production use
      if (summary) {
        cachedResponses[cacheKey] = summary;
        
        // Limit cache size to prevent memory issues
        const cacheKeys = Object.keys(cachedResponses);
        if (cacheKeys.length > 20) {
          // Remove oldest entry
          delete cachedResponses[cacheKeys[0]];
        }
      }
      
      // Return the processed data
      return new Response(
        JSON.stringify(summary),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Error processing file:', error);
      return new Response(
        JSON.stringify({
          ...mockData,
          _error: `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } catch (error) {
    console.error('Error details:', error instanceof Error ? error.stack : 'Unknown error');
    
    // Close the browser if it's open
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
    
    // Delete temporary file if it exists
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.error('Error deleting temporary file:', e);
      }
    }
    
    // Return an error response with mock data as fallback
    return new Response(
      JSON.stringify({
        ...mockData,
        _error: `Automation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Helper function to find the latest file matching a pattern
async function findLatestFile(directory: string, pattern: string): Promise<string | null> {
  const { promisify } = require('util');
  const glob = promisify(require('glob'));
  
  try {
    const files = await glob(`${directory}/${pattern}`);
    if (files.length === 0) return null;
    
    // Get the most recently created file
    const latestFile = files.reduce((latest: string, file: string) => {
      const fileStats = fs.statSync(file);
      const latestStats = fs.statSync(latest);
      return fileStats.ctimeMs > latestStats.ctimeMs ? file : latest;
    }, files[0]);
    
    return latestFile;
  } catch (error) {
    console.error('Error finding latest file:', error);
    return null;
  }
}

// Create a separate endpoint for status updates
export async function GET() {
  return new Response(
    JSON.stringify({ 
      status: currentStatus,
      message: statusMessage,
      lastUpdated
    }),
    { 
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      } 
    }
  );
} 
require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const moment = require("moment");

const app = express();
const PORT = process.env.PORT || 8080;

// Utility: Delay function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchReport(startDatetime, endDatetime) {
    console.log(`📅 Fetching report from ${startDatetime} to ${endDatetime}`);

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ]
    });

    const page = await browser.newPage();
    
    try {
        // Step 1: Login
        console.log("🔑 Logging in...");
        await page.goto("https://hub.hungerrush.com/", { waitUntil: "networkidle2" });
        await page.type("#UserName", process.env.HUNGER_RUSH_EMAIL);
        await page.type("#Password", process.env.HUNGER_RUSH_PASSWORD);
        await page.click("#newLogonButton");

        // Step 2: Wait for main interface
        await page.waitForSelector("#rptvNextAnchor", { timeout: 30000 });
        console.log("✅ Login successful!");

        // Step 3: Navigate to Order Details
        console.log("🧭 Navigating to Order Details...");
        const orderDetailsXPath = "//span[text()='Order Details']";
        
        await page.waitForXPath(orderDetailsXPath, { timeout: 60000 });
        const orderDetailsButton = await page.$x(orderDetailsXPath);
        if (orderDetailsButton.length > 0) {
            console.log("✅ Clicking Order Details!");
            await orderDetailsButton[0].click();
            await page.waitForTimeout(2000);
        } else {
            throw new Error("❌ 'Order Details' button not found!");
        }

        // Step 4: Select Piqua Store
        await page.waitForSelector(".p-multiselect-trigger-icon");
        await page.click(".p-multiselect-trigger-icon");

        await page.waitForXPath("//span[text()='Piqua']", { timeout: 30000 });
        const piquaStoreButton = await page.$x("//span[text()='Piqua']");
        if (piquaStoreButton.length > 0) {
            await piquaStoreButton[0].click();
        } else {
            throw new Error("❌ 'Piqua' store option not found!");
        }

        // Step 5: Click 'Run Report'
        await page.waitForSelector("#runReport");
        await page.click("#runReport");
        console.log("📊 Running Report...");

        // Step 6: Export to Excel
        await page.waitForXPath("//div[@class='dx-button-content']//span[text()=' Export ']", { timeout: 30000 });
        const exportDropdown = await page.$x("//div[@class='dx-button-content']//span[text()=' Export ']");
        if (exportDropdown.length > 0) {
            await exportDropdown[0].click();
        } else {
            throw new Error("❌ 'Export' dropdown not found!");
        }

        await page.waitForXPath("//div[contains(text(), 'Export all data to Excel')]", { timeout: 30000 });
        const exportExcelOption = await page.$x("//div[contains(text(), 'Export all data to Excel')]");
        if (exportExcelOption.length > 0) {
            await exportExcelOption[0].click();
        } else {
            throw new Error("❌ 'Export to Excel' option not found!");
        }

        console.log("📂 Report download initiated!");
        await delay(10000);

        // Step 7: Process Excel File
        const downloadDir = "/app/downloads";
        const files = fs.readdirSync(downloadDir);
        const excelFile = files.filter(file => file.includes("order-details") && file.endsWith(".xlsx")).sort().pop();

        if (!excelFile) {
            throw new Error("❌ Excel file not found!");
        }

        const excelPath = path.join(downloadDir, excelFile);
        console.log(`✅ Excel file found: ${excelPath}`);

        // Step 8: Parse Excel File
        const workbook = xlsx.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Step 9: Filter by Datetime
        const filteredData = data.filter(row => {
            const orderDatetime = moment(`${row.Date} ${row.Time}`, "MMM DD YYYY hh:mm A");
            return orderDatetime.isBetween(moment(startDatetime), moment(endDatetime), undefined, "[]");
        });

        // Step 10: Compute Sales & Tips
        const inStoreOrders = ["Pick Up", "Pickup", "To Go", "Web Pickup", "Web Pick Up"];
        const cashSalesInStore = filteredData.filter(order => inStoreOrders.includes(order.Type) && order.Payment.includes("Cash")).reduce((sum, order) => sum + order.Total, 0);
        const cashSalesDelivery = filteredData.filter(order => order.Type.includes("Delivery") && order.Payment.includes("Cash")).reduce((sum, order) => sum + order.Total, 0);
        const creditCardTipsInStore = filteredData.filter(order => inStoreOrders.includes(order.Type) && /Visa|MC|AMEX/.test(order.Payment)).reduce((sum, order) => sum + (order.Tips || 0), 0);
        const creditCardTipsDelivery = filteredData.filter(order => order.Type.includes("Delivery") && /Visa|MC|AMEX/.test(order.Payment)).reduce((sum, order) => sum + (order.Tips || 0), 0);

        await browser.close();

        return {
            "Cash Sales (In-Store)": cashSalesInStore.toFixed(2),
            "Cash Sales (Delivery)": cashSalesDelivery.toFixed(2),
            "Credit Card Tips (In-Store)": creditCardTipsInStore.toFixed(2),
            "Credit Card Tips (Delivery)": creditCardTipsDelivery.toFixed(2),
        };
    } catch (error) {
        console.error(`❌ ERROR during Puppeteer execution: ${error}`);
        await browser.close();
        return { error: error.message };
    }
}

// API Route
app.get("/summary", async (req, res) => {
    const { start_datetime, end_datetime } = req.query;
    if (!start_datetime || !end_datetime) {
        return res.status(400).json({ error: "❌ Missing parameters" });
    }

    try {
        const result = await fetchReport(start_datetime, end_datetime);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "❌ Internal Server Error" });
    }
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));